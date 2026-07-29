// The Undermount Descent: the three-wing raid under Thornpeak Heights (pass 6
// of docs/prd/furnace-lair-raid.md; finale: Volzharr, the Buried Furnace).
// Wing 1 is the Kiln-Keepers duo, wing 2 Odrenn the Temperer, wing 3 Volzharr;
// the Forge-Heart (Quenching) wing was cut in the pass-6 review.
// This module owns the wing-chain metadata and
// the pure seal predicate: each wing's door stays sealed until the prior wing's
// boss has been cleared (permanent raid progress, NOT the daily lockout, so a
// farm raid never re-clears wing 1 to reach wing 2). Per-wing encounter drivers
// land here later, following the encounters/nythraxis.ts pattern; for now this
// is the walking-skeleton backbone that the instance layer consults.
//
// The wing chain + seal predicate are pure (no rng, no Sim state, no DOM); the
// instance layer (src/sim/instances/dungeons.ts) consumes them. onUndermountBossDeath
// is the one ctx-dependent function (duo frenzy + wing-clear credit), mirroring
// encounters/nythraxis.ts grantNythraxisLockout.

import type { SimContext } from '../sim_context';
import { type Aura, dist2d, type Entity } from '../types';

// Players within this many yards of the dead boss's spawn get the wing cleared.
// Matches NYTHRAXIS_ROOM_RADIUS: large enough to cover the interior, small enough
// not to bleed into an adjacent instance's origin.
const UNDERMOUNT_ROOM_RADIUS = 260;

// Kiln Fury: the surviving keeper of a duo frenzies when its partner falls (the
// kill-together tension). The engine's packFrenzy only buffs SAME-templateId
// packmates, so this cross-keeper frenzy is bespoke to the encounter.
const KEEPER_FRENZY_AURA_ID = 'undermount_keeper_frenzy';
const KEEPER_FRENZY_HASTE = 0.5; // +50% attack speed while enraged (tuning)
const KEEPER_FRENZY_DURATION = 90; // effectively the rest of the fight (tuning)

export interface UndermountWing {
  /** The DUNGEON_DEFS id for this wing's instance. */
  dungeonId: string;
  /** 1-based wing number, in descent order. */
  order: number;
  /** The bosses of this wing. The wing clears only when ALL of them are dead,
   *  so a duo (wing 1: Vosh + Saan) clears on the last keeper to die. */
  bossMobIds: readonly string[];
  /** The wing that must be cleared before this one's door opens; null for wing 1. */
  requires: string | null;
}

// Descent order. dungeonIds and bossMobIds are the stable content contract the
// DUNGEON_DEFS + MobTemplate records must match. Wing 1 is the Kiln-Keepers duo
// (Vosh + Saan); wings 2 and 3 are still single stub bosses pending their kits.
export const UNDERMOUNT_WINGS: readonly UndermountWing[] = [
  {
    dungeonId: 'undermount_wing1',
    order: 1,
    bossMobIds: ['vosh_the_glazier', 'saan_the_stoker'],
    requires: null,
  },
  {
    dungeonId: 'undermount_wing2',
    order: 2,
    bossMobIds: ['odrenn_the_temperer'],
    requires: 'undermount_wing1',
  },
  {
    dungeonId: 'undermount_wing3',
    order: 3,
    bossMobIds: ['volzharr_buried_furnace'],
    requires: 'undermount_wing2',
  },
] as const;

const WING_BY_DUNGEON = new Map(UNDERMOUNT_WINGS.map((w) => [w.dungeonId, w] as const));

/** The wing record for a dungeonId, or undefined if it is not an Undermount wing. */
export function undermountWing(dungeonId: string): UndermountWing | undefined {
  return WING_BY_DUNGEON.get(dungeonId);
}

/**
 * True when `dungeonId` is an Undermount wing whose prerequisite wing has not
 * been cleared. Non-Undermount dungeons and wing 1 (no prerequisite) are never
 * sealed. `cleared` is the set of wing dungeonIds whose boss the entering
 * raid/character has ever killed (permanent progress, not the daily lockout).
 */
export function undermountWingSealed(cleared: ReadonlySet<string>, dungeonId: string): boolean {
  const wing = WING_BY_DUNGEON.get(dungeonId);
  if (!wing || wing.requires === null) return false;
  return !cleared.has(wing.requires);
}

const WING_BY_BOSS = new Map(
  UNDERMOUNT_WINGS.flatMap((w) => w.bossMobIds.map((id) => [id, w] as const)),
);

/** The wing whose boss is `bossMobId`, or undefined if it is not an Undermount boss. */
export function undermountWingByBoss(bossMobId: string): UndermountWing | undefined {
  return WING_BY_BOSS.get(bossMobId);
}

// Whether every OTHER boss of `wing` is already down (dead or despawned) in the
// room around the just-slain `dying` boss. A live partner nearby means the
// encounter is not finished, so a duo does not clear on the first keeper's death.
function wingBossesAllDown(ctx: SimContext, wing: UndermountWing, dying: Entity): boolean {
  for (const id of wing.bossMobIds) {
    if (id === dying.templateId) continue;
    for (const ent of ctx.entities.values()) {
      if (
        ent.templateId === id &&
        !ent.dead &&
        dist2d(ent.pos, dying.spawnPos) <= UNDERMOUNT_ROOM_RADIUS
      ) {
        return false;
      }
    }
  }
  return true;
}

// Frenzy the surviving keeper(s) of a duo when one of them dies: a stacking-free
// haste buff so killing the keepers far apart is a wipe. No-op for a single-boss
// wing or when no partner is still up in the room.
function frenzyUndermountPartners(ctx: SimContext, wing: UndermountWing, dying: Entity): void {
  if (wing.bossMobIds.length < 2) return;
  for (const ent of ctx.entities.values()) {
    if (ent.kind !== 'mob' || ent.dead || ent.id === dying.id) continue;
    if (!wing.bossMobIds.includes(ent.templateId)) continue;
    if (dist2d(ent.pos, dying.spawnPos) > UNDERMOUNT_ROOM_RADIUS) continue;
    if (ent.auras.some((a) => a.id === KEEPER_FRENZY_AURA_ID)) continue;
    const aura: Aura = {
      id: KEEPER_FRENZY_AURA_ID,
      name: 'Kiln Fury',
      kind: 'buff_haste',
      remaining: KEEPER_FRENZY_DURATION,
      duration: KEEPER_FRENZY_DURATION,
      value: KEEPER_FRENZY_HASTE,
      sourceId: ent.id,
      school: 'physical',
    };
    ent.auras.push(aura);
    ctx.emit({ type: 'aura', targetId: ent.id, name: 'Kiln Fury', gained: true });
  }
}

/**
 * Undermount wing boss-death hook, fired for every wing-boss death:
 * 1. Frenzy any surviving duo partner (Kiln Fury), the kill-together tension.
 * 2. When the LAST boss of the wing is down, record the wing as cleared
 *    (permanent progress) on every player in the room, opening the sealed door
 *    to the next wing. Crediting is scoped by proximity to the boss's spawn,
 *    like grantNythraxisLockout.
 * No-ops for a non-wing-boss death; for a duo the clear waits for the last keeper.
 */
export function onUndermountBossDeath(ctx: SimContext, boss: Entity): void {
  const wing = WING_BY_BOSS.get(boss.templateId);
  if (!wing) return;
  frenzyUndermountPartners(ctx, wing, boss);
  if (!wingBossesAllDown(ctx, wing, boss)) return;
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (p && dist2d(p.pos, boss.spawnPos) <= UNDERMOUNT_ROOM_RADIUS) {
      meta.undermountCleared.add(wing.dungeonId);
    }
  }
}
