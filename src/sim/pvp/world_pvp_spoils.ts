// World PvP spoils: what a paid world kill leaves on the loser's body.
//
// When both the victim and the killing blow carry the /pvp flag, the killing
// blow's share of the gold stake does not vanish into their purse with a chat
// line: it DROPS onto the victim's body next to a trophy skull that remembers
// whose it is, and the killer loots both like any corpse
// (interaction.ts lootCorpse, the loot window, the same take-loot path). Every
// other contributor's share still moves purse to purse inside the kill
// resolution (world_pvp.ts), exactly as before: the body carries only what
// the killing blow earned, so nobody's split changes.
//
// A player's body is not a mob corpse that decays on a clock: it lies where
// it fell until its owner releases or is resurrected, and then the entity
// itself moves. So the spoils are SETTLED the moment the body stops being a
// body (release and every revive route through spirit.ts, and the zone pass
// sweeps any other way out): whatever is still on it goes to the killer
// straight away, or, if the killer has left the world, the gold goes back to
// the victim's purse. The victim can never deny the drop by releasing, and no
// gold is ever destroyed by an unlooted body.
//
// The skull is a provenance-tracked stack (world_pvp_trophy.ts): every skull
// shares one bag stack, and each unit carries its victim as a material-source
// bucket, so the stack reads "2 x Taken from Bet, 1 x Taken from Gimel".
//
// The books row (`ctx.worldPvpBooks.spoils`, victim pid -> killer pid) lives
// on the Sim beside the other World PvP books; it is bounded by the flagged
// players lying dead with spoils on them right now.
//
// Host-agnostic: no DOM, no rng, no wall clock.

import { formatMoney } from '../format_money';
import { gatheredMaterialSources } from '../material_gatherer';
import type { MaterialComposition } from '../material_sources';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity, LootSlot } from '../types';
import { WORLD_PVP_SKULL_ITEM_ID } from './world_pvp_trophy';

export { WORLD_PVP_SKULL_ITEM_ID };

/** A player's corpse clock never ticks (only mobs decay), so a body holding
 *  spoils just needs a non-zero clock to read as "not decayed" to the shared
 *  corpse predicates; settling puts it back to 0. */
const SPOILS_CORPSE_CLOCK = 1;

/** The per-unit source of one skull: the victim recorded exactly as a
 *  gatherer is (their stable identity plus the name they died under), or
 *  undefined for a victim with no identity (unrecorded, like a legacy stack). */
export function worldPvpSkullSources(victim: PlayerMeta): MaterialComposition | undefined {
  return gatheredMaterialSources(victim, 1);
}

/** What the killing blow is told when their spoils drop. Matched by the client
 *  (src/ui/sim_i18n.ts `worldPvp.spoilsOnBody`). */
export function worldPvpSpoilsLine(victimName: string): string {
  return `Loot ${victimName}'s body to claim your spoils.`;
}

/**
 * Drop the killing blow's spoils on the victim's body: `copper` (their share
 * of the stake, already charged to the victim's purse by the caller) and one
 * skull only the killer can take. The body is tapped to the killer, so the
 * loot rights, the popup and the take path are the corpse ones unchanged.
 */
export function placeWorldPvpSpoils(
  ctx: SimContext,
  victim: Entity,
  killer: Entity,
  copper: number,
): void {
  // A body that stood up by a route that did not settle it (and the zone pass
  // has not seen yet) still owes its earlier killer: pay that first, never
  // overwrite it.
  settleWorldPvpSpoils(ctx, victim.id);
  const victimMeta = ctx.players.get(victim.id);
  const sources = victimMeta ? worldPvpSkullSources(victimMeta) : undefined;
  const skull: LootSlot = {
    itemId: WORLD_PVP_SKULL_ITEM_ID,
    count: 1,
    personalFor: [killer.id],
    ...(sources ? { materialSources: sources } : {}),
  };
  victim.loot = { copper: Math.max(0, Math.floor(copper)), items: [skull] };
  victim.lootable = true;
  victim.tappedById = killer.id;
  victim.lootRecipientIds = [killer.id];
  victim.lootFfaTimer = Number.POSITIVE_INFINITY;
  victim.corpseTimer = SPOILS_CORPSE_CLOCK;
  ctx.worldPvpBooks.spoils.set(victim.id, killer.id);
}

function clearSpoils(victim: Entity): void {
  victim.loot = null;
  victim.lootable = false;
  victim.tappedById = null;
  delete victim.lootRecipientIds;
  victim.lootFfaTimer = Number.POSITIVE_INFINITY;
  victim.corpseTimer = 0;
}

/**
 * Settle a body's spoils: whatever the killer has not looted yet goes to them
 * now (the gold with the ordinary loot line and the same looted-gold tally a
 * corpse take books, the skull when it fits their bags; a skull that does not
 * fit is left behind, as full bags leave any corpse loot behind), or, with the
 * killer gone or leaving the world, the gold returns to the victim. A no-op for
 * a player with no spoils row. Idempotent.
 */
export function settleWorldPvpSpoils(ctx: SimContext, victimId: number): void {
  const books = ctx.worldPvpBooks;
  const killerId = books.spoils.get(victimId);
  if (killerId === undefined) return;
  books.spoils.delete(victimId);
  const victim = ctx.entities.get(victimId);
  if (!victim) return;
  const loot = victim.loot;
  clearSpoils(victim);
  if (!loot) return;
  const killerMeta = ctx.players.get(killerId);
  if (!killerMeta || killerMeta.leaving || !ctx.entities.has(killerId)) {
    const victimMeta = ctx.players.get(victimId);
    if (victimMeta && loot.copper > 0) victimMeta.copper += loot.copper;
    return;
  }
  if (loot.copper > 0) {
    killerMeta.copper += loot.copper;
    killerMeta.counters.lootCopper += loot.copper;
    ctx.bumpDeedStat(killerMeta, 'lootCopper', loot.copper);
    ctx.emit({ type: 'loot', text: `You loot ${formatMoney(loot.copper)}.`, pid: killerId });
  }
  let bagsFull = false;
  for (const slot of loot.items) {
    if (slot.count <= 0 || (slot.personalFor && !slot.personalFor.includes(killerId))) continue;
    // A skull is a provenance-tracked stack: it tops up any skull stack with
    // room whoever it names, the victim riding along as a source bucket. The
    // room check stays behind ctx (importing bags.ts here would load the
    // material tables before the content they derive from).
    if (!ctx.canAddItem(slot.itemId, slot.count, killerId, slot.instance)) {
      bagsFull = true;
      continue;
    }
    if (slot.instance) {
      ctx.addItemInstance(slot.itemId, slot.instance, killerId, slot.count, {
        ...(slot.materialSources ? { materialSources: slot.materialSources } : {}),
      });
    } else {
      ctx.addItem(
        slot.itemId,
        slot.count,
        killerId,
        slot.materialSources ? { materialSources: slot.materialSources } : undefined,
      );
    }
  }
  if (bagsFull) ctx.error(killerId, 'Your bags are full.');
}

/**
 * A player is leaving the world (Sim.preparePlayerLeave, before the leave
 * snapshot, and Sim.removePlayer for hosts without that hook): settle their
 * own body if it holds spoils (the killer is paid while the victim's save
 * still has to be written), and every body holding THEIR spoils (paid into
 * their purse now, so the leave snapshot carries it). Without this a victim
 * who logs out dead turns the stake into a gold sink. Bounded by the bodies
 * holding spoils.
 */
export function settleWorldPvpSpoilsOnLeave(ctx: SimContext, pid: number): void {
  const books = ctx.worldPvpBooks;
  if (books.spoils.size === 0) return;
  settleWorldPvpSpoils(ctx, pid);
  for (const [victimId, killerId] of [...books.spoils]) {
    if (killerId === pid) settleWorldPvpSpoils(ctx, victimId);
  }
}

/** Settle every body holding spoils (the realm's graceful shutdown, before its
 *  final save: spoils live only in memory, so an unsettled body would take its
 *  gold down with the process). */
export function settleAllWorldPvpSpoils(ctx: SimContext): void {
  for (const victimId of [...ctx.worldPvpBooks.spoils.keys()]) settleWorldPvpSpoils(ctx, victimId);
}

/** The zone-pass safety net: settle every body that stopped being one by a
 *  route that did not settle it itself (a revive path outside spirit.ts).
 *  Bounded by the bodies holding spoils. */
export function sweepWorldPvpSpoils(ctx: SimContext): void {
  const books = ctx.worldPvpBooks;
  if (books.spoils.size === 0) return;
  for (const victimId of [...books.spoils.keys()]) {
    const victim = ctx.entities.get(victimId);
    if (!victim || !victim.dead || victim.ghost || !victim.lootable) {
      settleWorldPvpSpoils(ctx, victimId);
    }
  }
}
