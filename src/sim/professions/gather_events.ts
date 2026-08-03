// Rare gather events (Professions 2.0): the shared cadence knob, the
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
  // Deed-mark hook: each flavor mark feeds its rare-find
  // deed (col_pristine_vein / col_ancient_heartwood / col_moonlit_bloom).
  ctx.markVisited(finder, 'gather_event:' + flavor);
}

/** The zone-wide masterwork celebration copy. One pid-scoped
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
  const zoneId = zoneAt(crafterE.pos.x, crafterE.pos.z).id;
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
