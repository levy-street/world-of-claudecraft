// Rare gather events (Professions 2.0): the shared cadence knob, the
// per-family flavor mapping, the single-draw roll, and the soft zone broadcast
// announcing a hit to every player in the node's zone. Sim-pure and text-free:
// the sim emits ids plus values only, the client renders the localized
// gatherEvent.* lines.

import { DUNGEON_X_THRESHOLD, zoneAt } from '../data';
import { noteReliquaryMark } from '../reliquary';
import type { Rng } from '../rng';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { GatherRareEventFlavor, GatherRareEventSource, SimEvent } from '../types';
import type { MasterworkProc } from './masterwork';

// One shared cadence knob: state.md target of roughly 1 per zone per 20
// minutes, from 240s node respawn and 18 nodes per zone giving at most
// ~90 harvests per zone per 20 minutes; tuned per family. The derivation is
// the TUNED zones' (the R37 'complete' set): the v0.32.0 expansion's starter
// zones carry 6 nodes each, so their ceiling is ~30 harvests per 20 minutes
// and this knob lands them at roughly 1 event per zone per hour, an
// UN-TUNED cadence the zone-4 design pass owns per R37 (a per-zone knob or a
// starter-zone node count are both open there; do not split the constant
// here without that pass).
//
// Those two inputs both doubled at once (120s and up to 9 nodes before), and
// their product is what this knob reads, so the derivation lands on the same 90
// and the constant did not move. That is not a coincidence to preserve by luck:
// the node count and the respawn were changed together precisely to hold the
// per-zone harvest ceiling flat (see NODE_HARVEST_TABLE in gathering.ts). If
// either is ever tuned alone, re-derive this.
export const GATHER_RARE_EVENT_CHANCE = 1 / 90;

// A rare event multiplies the harvest yield and forces signed instances
// regardless of the rolled material rarity.
export const GATHER_RARE_EVENT_YIELD_MULT = 5;

// Exhaustive on purpose: the record is typed over the whole source union, so a
// fifth source added to the union fails tsc here instead of silently minting a
// golden harvest, and the runtime list below is derived from the same record
// (Masterwrought Phase 19F review round) so a guide pin can walk every source
// rather than a hand-copied four; the list's consumers are that guide pin and
// this module's own suite (the sim reads the record through
// gatherRareEventFlavor). NULL-PROTOTYPE and frozen: the switch this replaced
// returned undefined for an out-of-union runtime value, which the
// farming harvest's `!= null` belt relies on; a plain object literal would
// have answered 'constructor' or 'toString' with a function instead.
const FLAVOR_BY_SOURCE: Record<GatherRareEventSource, GatherRareEventFlavor> = Object.freeze(
  Object.assign(Object.create(null) as Record<GatherRareEventSource, GatherRareEventFlavor>, {
    ore: 'pristine_vein',
    wood: 'ancient_heartwood',
    herb: 'moonlit_bloom',
    crop: 'golden_harvest',
  } satisfies Record<GatherRareEventSource, GatherRareEventFlavor>),
);
export const GATHER_RARE_EVENT_SOURCES: readonly GatherRareEventSource[] = Object.freeze(
  Object.keys(FLAVOR_BY_SOURCE) as (keyof typeof FLAVOR_BY_SOURCE)[],
);
export function gatherRareEventFlavor(source: GatherRareEventSource): GatherRareEventFlavor {
  return FLAVOR_BY_SOURCE[source];
}

// Draw #2 of resolveHarvest (after rollMaterialRarity, a pinned determinism
// contract). Draws EXACTLY ONE rng.next() on EVERY call, hit when the draw is
// below GATHER_RARE_EVENT_CHANCE: a constant draw count per harvest keeps the
// sim's rng stream identical across hosts regardless of the outcome. The
// farming harvest draw block is the second caller (source 'crop', state.md
// D12: the SAME shared chance, never a farming copy of the constant).
export function rollGatherRareEvent(
  rng: Rng,
  source: GatherRareEventSource,
): GatherRareEventFlavor | null {
  return rng.next() < GATHER_RARE_EVENT_CHANCE ? gatherRareEventFlavor(source) : null;
}

// Soft zone broadcast: one pid-scoped copy of the event per player whose
// current zone matches, the finder included (the chat yell fanout precedent,
// src/sim/social/chat.ts). The masterworkZone fanout
// (announceMasterworkZone below) is the first reuser; exported so later
// zone-visible celebrations can ride the same fanout and exclusion rules
// without re-deriving them.
export function emitToZonePlayers(
  ctx: SimContext,
  zoneId: string,
  build: (recipientPid: number) => SimEvent,
): void {
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e) continue;
    // zoneAt is overworld-only: instance space (dungeons, arenas, delves) lives
    // in far-off x bands whose z can overlap a zone strip, so instanced players
    // are excluded from zone broadcasts.
    if (e.pos.x > DUNGEON_X_THRESHOLD || zoneAt(e.pos.x, e.pos.z).id !== zoneId) continue;
    ctx.emit(build(meta.entityId));
  }
}

// The `source` parameter is structural on purpose: a GatherNodeDef satisfies
// it as-is (the three node flavors), and the farming harvest passes its bed's
// zone with type 'crop' (golden_harvest) without farm beds ever becoming
// gather nodes.
export function announceGatherRareEvent(
  ctx: SimContext,
  finder: PlayerMeta,
  source: { zoneId: string; type: GatherRareEventSource },
  flavor: GatherRareEventFlavor,
  itemId: string,
): void {
  emitToZonePlayers(ctx, source.zoneId, (recipientPid) => ({
    type: 'gatherRareEvent',
    pid: recipientPid,
    flavor,
    finderName: finder.name,
    finderPid: finder.entityId,
    zoneId: source.zoneId,
    nodeType: source.type,
    itemId,
  }));
  // Deed-mark hook: each flavor mark feeds its rare-find deed
  // (col_pristine_vein / col_ancient_heartwood / col_moonlit_bloom, and the
  // farming phase's golden-harvest deed on gather_event:golden_harvest).
  // Reliquary field-note trophies reuse the same stable gather_event:* ids
  // (catalog allowlist only; noteReliquaryMark no-ops an id the catalog does
  // not carry). All four flavors have a cell since masterwrought Phase 18,
  // which retired the farming phase's ledgered golden_harvest deferral.
  const visitMark = `gather_event:${flavor}`;
  ctx.markVisited(finder, visitMark);
  noteReliquaryMark(ctx, finder, visitMark);
}

/** The ONE zone-celebration prologue every zone-wide celebration producer
 *  runs (extracted 2026-08-27, rule of three: masterworkZone here,
 *  attunedZone in attunement_events.ts, legendaryForgedZone in
 *  perfecting.ts): resolve the celebrant entity, skip instance space
 *  entirely (x past DUNGEON_X_THRESHOLD: an instanced celebrant keeps only
 *  its personal event, deliberately), resolve the overworld zone, and fan
 *  one pid-scoped copy per player in it through emitToZonePlayers above.
 *  Draws NO rng, so a producer's position in its path cannot fork the
 *  deterministic draw order. */
export function announceZoneCelebration(
  ctx: SimContext,
  ownerPid: number,
  build: (recipientPid: number, zoneId: string) => SimEvent,
): void {
  const ownerE = ctx.entities.get(ownerPid);
  if (!ownerE || ownerE.pos.x > DUNGEON_X_THRESHOLD) return;
  const zoneId = zoneAt(ownerE.pos.x, ownerE.pos.z).id;
  emitToZonePlayers(ctx, zoneId, (recipientPid) => build(recipientPid, zoneId));
}

/** The zone-wide masterwork celebration copy. One pid-scoped
 *  masterworkZone event per overworld player in the crafter's zone, the
 *  crafter included, via the shared prologue above. Skipped entirely when the
 *  crafter is in instance space (instanced masterworks stay a personal toast,
 *  deliberately). Draws NO rng and must run AFTER the personal masterwork
 *  emit in Sim.craftItem, keeping the craft path's pinned single-draw
 *  contract and event order intact. */
export function announceMasterworkZone(
  ctx: SimContext,
  crafterPid: number,
  crafterName: string,
  proc: MasterworkProc,
): void {
  announceZoneCelebration(ctx, crafterPid, (recipientPid, zoneId) => ({
    type: 'masterworkZone',
    pid: recipientPid,
    crafterPid,
    crafterName,
    itemId: proc.itemId,
    recipeId: proc.recipeId,
    zoneId,
  }));
}
