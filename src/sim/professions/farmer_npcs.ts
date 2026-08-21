// The farmer NPCs' range predicate (the farming go-live): is this player
// standing beside a farmer? It gates the husk-to-compost trade
// (farming.ts convertHusks), whose design fiction is the farmer working the
// husks into compost, so the trade needs a farmer in reach the way the bank
// needs a banker (bank.ts nearBanker) and a purchase needs the vendor
// (items.ts buyItem). It gates NOTHING ELSE: plant, harvest and the watch fee
// are bed-side actions paid at the bed (D8/D9), so a farmer being far away
// never refuses them.
//
// A sibling module rather than more farming.ts body: the predicate is a pure
// read of the live roster against the shipped NPC catalog, so a Vitest drives
// it directly and the command stays a thin consumer.
//
// Farmers are found by the NpcDef `farmer` FLAG, resolved through the NPC
// catalog by templateId, never by a hard-keyed id list (the warfareVendor
// precedent, the heroic quartermaster's one-id mistake not repeated): a fifth
// farmer is one content row and this file does not change. The scan is the
// spatial grid's radius query (interaction.ts's spirit-healer walk), which
// holds every roster entity including static NPCs, so no anchor list needs
// seeding in the Sim ctor and no SimContext member is added.
//
// Draws ZERO rng and reads no clock: distance arithmetic over the roster.

import { NPCS } from '../data';
import type { SimContext } from '../sim_context';
import { type Entity, INTERACT_RANGE } from '../types';

/** How close a player must stand to a farmer NPC to trade husks: the same
 *  INTERACT_RANGE + 2 reach the vendor purchase (buyItem) and the bank
 *  (nearBanker) use, inclusive, so a player who can buy from the farmer can
 *  trade with them from the same spot. */
export const FARMER_TRADE_RANGE = INTERACT_RANGE + 2;

/** True when this NPC entity is a farmer: an npc whose def carries the flag.
 *  A template the catalog does not know (a custom-map NPC) is not a farmer. */
export function isFarmerNpcEntity(e: Entity): boolean {
  return e.kind === 'npc' && NPCS[e.templateId]?.farmer === true;
}

/** True when the entity stands within FARMER_TRADE_RANGE of any live farmer
 *  NPC. Inclusive at the boundary, like nearBanker. */
export function nearFarmerNpc(ctx: SimContext, e: Entity): boolean {
  let near = false;
  ctx.grid.forEachInRadius(e.pos.x, e.pos.z, FARMER_TRADE_RANGE, (other) => {
    if (!near && isFarmerNpcEntity(other)) near = true;
  });
  return near;
}
