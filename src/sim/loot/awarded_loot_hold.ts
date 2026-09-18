// The awarded-loot hold: what happens to a need/greed, master-loot, or
// round-robin award when the winner's bags are full.
//
// The inventory hub (Sim.addItem / addItemInstance) is deliberately never
// capacity-capped, so an async award always lands and can never destroy an
// item. Before this module the roll paths leaned on that and force-added the
// award, pushing the winner past their bag capacity (67/62 after a dungeon
// run where one player won everything). Classic behavior is the opposite, and
// it is the whole point of bag space: an award that does not fit STAYS ON THE
// CORPSE as a slot only the winner can take, the corpse keeps at least a full
// decay window from that moment, and the standard capacity-gated personal
// take path (interaction.ts lootCorpse) hands it over once a slot is free,
// bind-on-pickup trade window included. If the winner never makes room, the
// item decays with the corpse like any other unlooted drop. Deliberately NO
// mailbox fallback: a mailbox that catches every overflow is an unlimited
// bag, and nobody would ever need to manage theirs.
//
// `src/sim`-pure: no DOM/Three, no wall clock, no rng of its own.

import { bagPools, countFit } from '../bags';
import { ITEMS } from '../data';
import type { SimContext } from '../sim_context';
import type { ItemInstancePayload, LootSlot } from '../types';
import { bopPartyTradeInstance } from './bop_trade_window';

// Sim-seconds a corpse keeps at least once an award is held on it. A held
// award is UNLOOTED loot, and a classic corpse with loot still on it persists
// about five minutes, not the one-minute trash window (CORPSE_DURATION in
// combat/damage.ts). The first cut reused that 60s window, and a winner who
// was still running back to a rare the party dropped, or dead from the fight
// and walking from the graveyard, found the corpse gone with the item on it
// (the "Corpse disappeared with loot on it" report). Five minutes is the
// classic loot window; the item still decays with the corpse after it, so
// bag space still has to be managed, and there is still no mailbox fallback.
// Stated as a literal rather than derived from CORPSE_DURATION so the loot
// layer stays downstream of the damage layer.
export const HELD_LOOT_CORPSE_SECONDS = 5 * 60;

export interface AwardEligibility {
  names: readonly string[];
  characterIds: readonly number[];
}

// The instance payload a loot award carries: a soulbound item gets the
// bind-on-pickup party trade window over the kill-time eligible roster, a
// plain item none. The ONE statement of that rule, shared by the direct
// grant below, the hold, and the openToAll corpse pickup in interaction.ts.
function awardInstanceFor(
  ctx: SimContext,
  itemId: string,
  eligibility: AwardEligibility,
): ItemInstancePayload | undefined {
  return ITEMS[itemId]?.soulbound
    ? bopPartyTradeInstance(ctx.lockoutNowMs(), eligibility.names, eligibility.characterIds)
    : undefined;
}

// The one shared grant for a loot award (a roll win, a master-loot assignment,
// a round-robin turn, an everyone-passed pickup off the corpse). Never
// capacity-capped: the caller owns the fit decision (grantOrHoldAwardedLoot
// for the async paths, the canAddItem loops in interaction.ts for pickups).
export function grantAwardedLootItem(
  ctx: SimContext,
  itemId: string,
  pid: number,
  eligibility: AwardEligibility,
): void {
  const instance = awardInstanceFor(ctx, itemId, eligibility);
  if (instance) ctx.addItemInstance(itemId, instance, pid, 1);
  else ctx.addItem(itemId, 1, pid);
}

// Grant `itemId` to `pid` exactly as grantAwardedLootItem would, unless the
// winner's bags have no room for it: then hold it on `mobId`'s corpse for
// them. Two backstops keep the never-destroy guarantee of the direct grant:
// a pid the hub cannot resolve, and a corpse that is already gone at
// resolution (a roll can outlive its corpse), both grant as before rather
// than dropping the item on the floor.
export function grantOrHoldAwardedLoot(
  ctx: SimContext,
  mobId: number,
  itemId: string,
  pid: number,
  eligibility: AwardEligibility,
): void {
  const mob = ctx.entities.get(mobId);
  const meta = ctx.players.get(pid);
  const instance = awardInstanceFor(ctx, itemId, eligibility);
  if (
    !mob?.dead ||
    !meta ||
    countFit(meta.inventory, bagPools(meta.bags), itemId, 1, instance) >= 1
  ) {
    grantAwardedLootItem(ctx, itemId, pid, eligibility);
    return;
  }
  const slot: LootSlot = {
    itemId,
    count: 1,
    personalFor: [pid],
    ...(instance ? { instance } : {}),
  };
  if (!mob.loot) mob.loot = { copper: 0, items: [] };
  mob.loot.items.push(slot);
  mob.lootable = true;
  mob.corpseTimer = Math.max(mob.corpseTimer, HELD_LOOT_CORPSE_SECONDS);
  ctx.emit({
    type: 'loot',
    text: `Your bags are full; [[i:${itemId}]] is waiting on the corpse for you.`,
    pid,
  });
}
