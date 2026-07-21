// Rare gather events (Professions 2.0 Phase 4): the shared cadence knob, the
// per-family flavor mapping, the single-draw roll, and the soft zone broadcast
// announcing a hit to every player in the node's zone. Sim-pure and text-free:
// the sim emits ids plus values only, the client renders the localized
// gatherEvent.* lines.

import { DUNGEON_X_THRESHOLD, zoneAt } from '../data';
import type { Rng } from '../rng';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { GatherNodeDef, GatherNodeType, GatherRareEventFlavor, SimEvent } from '../types';
import type { MasterworkProc } from './masterwork';

// One shared cadence knob: state.md target of roughly 1 per zone per 20
// minutes, from 120s node respawn and up to 9 nodes per zone giving at most
// ~90 harvests per zone per 20 minutes; Phase 15 tunes per family.
export const GATHER_RARE_EVENT_CHANCE = 1 / 90;

// A rare event multiplies the harvest yield and forces signed instances
// regardless of the rolled material rarity.
export const GATHER_RARE_EVENT_YIELD_MULT = 5;

export function gatherRareEventFlavor(nodeType: GatherNodeType): GatherRareEventFlavor {
  return nodeType === 'ore'
    ? 'pristine_vein'
    : nodeType === 'wood'
      ? 'ancient_heartwood'
      : 'moonlit_bloom';
}

// Draw #2 of resolveHarvest (after rollMaterialRarity, a pinned determinism
// contract). Draws EXACTLY ONE rng.next() on EVERY call, hit when the draw is
// below GATHER_RARE_EVENT_CHANCE: a constant draw count per harvest keeps the
// sim's rng stream identical across hosts regardless of the outcome.
export function rollGatherRareEvent(
  rng: Rng,
  nodeType: GatherNodeType,
): GatherRareEventFlavor | null {
  return rng.next() < GATHER_RARE_EVENT_CHANCE ? gatherRareEventFlavor(nodeType) : null;
}

// Soft zone broadcast: one pid-scoped copy of the event per player whose
// current zone matches, the finder included (the chat yell fanout precedent,
// src/sim/social/chat.ts). The Phase 6 masterworkZone fanout
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
    if (e.pos.x > DUNGEON_X_THRESHOLD || zoneAt(e.pos.z).id !== zoneId) continue;
    ctx.emit(build(meta.entityId));
  }
}

export function announceGatherRareEvent(
  ctx: SimContext,
  finder: PlayerMeta,
  node: GatherNodeDef,
  flavor: GatherRareEventFlavor,
  itemId: string,
): void {
  emitToZonePlayers(ctx, node.zoneId, (recipientPid) => ({
    type: 'gatherRareEvent',
    pid: recipientPid,
    flavor,
    finderName: finder.name,
    finderPid: finder.entityId,
    zoneId: node.zoneId,
    nodeType: node.type,
    itemId,
  }));
  // Dormant deed-mark hook: Phase 15 registers the per-flavor gather-event
  // deeds; markVisited tolerates mark ids no deed reads yet.
  ctx.markVisited(finder, 'gather_event:' + flavor);
}

/** Phase 6: the zone-wide masterwork celebration copy. One pid-scoped
 *  masterworkZone event per overworld player in the crafter's zone, the
 *  crafter included, via the shared fanout above. Skipped entirely when the
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
  const crafterE = ctx.entities.get(crafterPid);
  if (!crafterE || crafterE.pos.x > DUNGEON_X_THRESHOLD) return;
  const zoneId = zoneAt(crafterE.pos.z).id;
  emitToZonePlayers(ctx, zoneId, (recipientPid) => ({
    type: 'masterworkZone',
    pid: recipientPid,
    crafterPid,
    crafterName,
    itemId: proc.itemId,
    recipeId: proc.recipeId,
    zoneId,
  }));
}
