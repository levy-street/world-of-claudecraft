// Interest management policy: the radii and pure per-entity predicates that
// decide which entities a viewer's snapshot tracks, extracted verbatim from
// server/game.ts per the monolith ratchet. Pure functions over Entity plus
// module constants: no GameServer state, no clock, no rng, so a Vitest
// imports this leaf directly and the broadcast pass in server/game.ts stays
// a thin consumer.

import { bgOriginAt, isBgPos, MOBS } from '../src/sim/data';
import { type Entity, PLAYER_INTEREST_DROP_RADIUS, PLAYER_INTEREST_RADIUS } from '../src/sim/types';

// Interest management: new entities enter interest at the shared sim edge
// (PLAYER_INTEREST_RADIUS; the rationale lives on the sim constant: the client
// renders entities out to 80yd, so entry sits just past that), and known
// entities persist a little farther so the boundary doesn't churn
// create/destroy cycles. Derived, never a second literal: the v0.41.0 Ignivar
// span lifted the number into src/sim/types.ts and this leaf follows it (the
// merge of 3e801dc925, 2026-08-30).
export const INTEREST_RADIUS = PLAYER_INTEREST_RADIUS;
// Exported so the idle-mob-tick radius (and its test) stay pinned to this
// exact number instead of drifting into a second copy.
export const INTEREST_DROP_RADIUS = PLAYER_INTEREST_DROP_RADIUS;
// Stationary quest/vendor npcs anchor map markers, so they keep the legacy
// radius; once known they cost a handful of bytes per snapshot anyway.
export const NPC_INTEREST_RADIUS = 120;
export const NPC_DROP_RADIUS = 130;
// the widest OPEN-WORLD radius any entity kind can be relevant at (the
// battleground band widens past this: BG_MATCH_DROP_RADIUS below)
export const INTEREST_QUERY_RADIUS = NPC_DROP_RADIUS;
// Thornhollow Fields: the 100x280 field (diagonal ~297yd) fits inside this
// raised radius, so a fighter's OWN SIDE and the field's furniture stay
// tracked across the whole field. It is deliberately NOT a blanket same-slot
// widening (see bgWideInterestApplies): it applies to
//   (a) SAME-TEAM player pairs of one match, which the M map plots as teammate
//       positions and the party frames read, and
//   (b) the slot's non-player entities (flags, runes, props), which both sides
//       are meant to track.
// An ENEMY player falls back to the open-world radii above, so their position,
// facing, health, resource, cast bar and auras are never SHIPPED past normal
// interest. Hiding enemies is the server's job here, not the client's: fog is
// presentation, and a client that ignores it must learn nothing extra.
// Same-slot only in every arm: slot spacing (BG_SLOT_SPACING in
// src/sim/data.ts) puts cross-slot pairs beyond BG_MATCH_DROP_RADIUS, pinned by
// the cross-slot corner check in tests/battleground_band.test.ts.
export const BG_MATCH_INTEREST_RADIUS = 300;
export const BG_MATCH_DROP_RADIUS = 320;

/**
 * How far a LANDMARK mob stays in interest, or null for everything else.
 *
 * A world boss (`MobTemplate.landmarkRange`) is thirteen yards of granite that the client
 * draws as a far sprite from across the zone, and it cannot draw an entity it was never
 * sent. The cost is one wire entity per viewer inside a zone-sized radius, for the one
 * creature an hour that opts in; every other mob returns null and keeps the ordinary band.
 */
export function landmarkInterestSq(e: Entity): number | null {
  if (e.kind !== 'mob') return null;
  const range = MOBS[e.templateId]?.landmarkRange;
  return range ? range * range : null;
}

// npcs stay visible to the legacy radius (see the constants above);
// everything else enters at INTEREST_RADIUS and known entities persist to
// the drop radius: hysteresis against churn at the boundary
export function interestLimitSq(e: Entity, known: boolean): number {
  const landmark = landmarkInterestSq(e);
  if (landmark !== null) return landmark;
  if (e.kind === 'npc') {
    return known ? NPC_DROP_RADIUS * NPC_DROP_RADIUS : NPC_INTEREST_RADIUS * NPC_INTEREST_RADIUS;
  }
  return known ? INTEREST_DROP_RADIUS * INTEREST_DROP_RADIUS : INTEREST_RADIUS * INTEREST_RADIUS;
}

export function isStealthed(e: Entity): boolean {
  return e.stealthed; // cached in the sim's updateAuras; see Entity.stealthed
}

// Both endpoints inside the SAME battleground slot: the necessary condition for
// the raised match-wide interest (never across slots, never to the open world).
export function inSameBgSlot(a: Entity, b: Entity): boolean {
  if (!isBgPos(a.pos.x) || !isBgPos(b.pos.x)) return false;
  return bgOriginAt(a.pos.z).slot === bgOriginAt(b.pos.z).slot;
}

// The raised battleground interest, narrowed to what the mode actually needs a
// client to hold (see BG_MATCH_INTEREST_RADIUS): a same-slot TEAMMATE, or a
// same-slot non-player entity (flag, rune, prop). `viewerBgTeam` is the pid
// list of the viewer's own team, or null when the viewer is not in a match.
// An enemy player, and anything an enemy owns, returns false and falls back to
// the open-world radii in interestLimitSq.
export function bgWideInterestApplies(
  viewer: Entity,
  e: Entity,
  viewerBgTeam: readonly number[] | null,
): boolean {
  if (!inSameBgSlot(viewer, e)) return false;
  // A summoned mob (pet, guardian, totem) inherits its OWNER's arm: an enemy's
  // pet trails the enemy, so widening it would leak the same position by proxy.
  const subjectId = e.kind === 'player' ? e.id : e.ownerId;
  if (subjectId === null) return true; // flags, runes, props, npcs, wild mobs
  return viewerBgTeam?.includes(subjectId) ?? false;
}

/**
 * Rescan cadence for the landmark roster, in ticks (20 per second).
 *
 * A world boss rises about once an hour and stands for minutes, so a full entity scan every
 * tick would be paying a per-tick O(entities) walk for an event that changes on the order of
 * once per thousand ticks. One second of latency before he enters far interest is invisible
 * next to the several seconds his rise announcement already takes.
 */
export const LANDMARK_RESCAN_TICKS = 20;

/**
 * The live landmark mobs, refreshed on a slow cadence.
 *
 * Held as a roster rather than recomputed per viewer because the broadcast pass is per
 * viewer and this list is realm-wide: building it once per pass (at most once per second) is
 * the same build-once rule the shared candidate query and the realm readout memo follow.
 */
export class LandmarkRoster {
  private list: Entity[] = [];
  private nextScanTick = 0;

  /** The landmarks alive right now, rescanning if the cadence is due. */
  refresh(tick: number, entities: Iterable<Entity>): readonly Entity[] {
    if (tick < this.nextScanTick) {
      // Between scans the cached ENTITIES are still live objects (positions and hp track
      // themselves), so only death and despawn need filtering, and both are cheap to check
      // over a list that is realistically zero or one long.
      if (this.list.some((e) => e.dead)) this.list = this.list.filter((e) => !e.dead);
      return this.list;
    }
    this.nextScanTick = tick + LANDMARK_RESCAN_TICKS;
    const next: Entity[] = [];
    for (const e of entities) {
      if (!e.dead && landmarkInterestSq(e) !== null) next.push(e);
    }
    this.list = next;
    return this.list;
  }
}
