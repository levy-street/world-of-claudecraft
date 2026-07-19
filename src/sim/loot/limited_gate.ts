// Limited-supply drop gate (the true-scarcity relics, content/limited_drops.ts).
// Sits between a loot roll's winning entry and the corpse slot it materializes:
// an item with ItemDef.limitedSupply must claim a 1-based serial from the host's
// mint allocator (SimContext.claimLimitedSerial) before it may drop, and an
// exhausted supply substitutes the item's registered fallback instead. The gate
// draws NO rng and reads NO clock, so roll draw order, replays, and the parity
// goldens never depend on ledger state: only WHICH item id lands in the slot
// (the relic or its fallback) is environmental, exactly like a lockout check.
//
// The serial travels on ItemInstancePayload.serial from the corpse slot through
// every distribution path (direct, round-robin, need/greed, master loot,
// personal) to the winner's bags via the one grant chokepoint below, which also
// fires the one-time limitedMint announcement at the moment of possession.

import { LIMITED_FALLBACK } from '../content/limited_drops';
import { ITEMS } from '../data';
import type { SimContext } from '../sim_context';
import { cloneItemInstancePayload, type ItemInstancePayload } from '../types';

export interface ResolvedDrop {
  itemId: string;
  instance?: ItemInstancePayload;
}

// Resolve a rolled drop id through the limited gate. A plain item passes through
// unchanged. A limited item claims the next serial: minted means the same item
// with a serialed instance payload; exhausted (or no serial available to this
// realm right now) means the registered fallback drops as a plain item. A
// limited item with no registered fallback drops nothing (fail closed; the
// content test pins that every shipped limited item has a fallback, so that
// branch is unreachable for shipped content and exists only so a content
// mistake can never mint past the cap).
export function resolveRolledDrop(ctx: SimContext, itemId: string): ResolvedDrop | null {
  if (ITEMS[itemId]?.limitedSupply === undefined) return { itemId };
  const serial = ctx.claimLimitedSerial(itemId);
  if (serial !== null) return { itemId, instance: { serial } };
  const fallback = LIMITED_FALLBACK[itemId];
  return fallback ? { itemId: fallback } : null;
}

// The offline/headless default behind SimConfig.claimLimitedSerial: a per-world
// next-serial ledger (Sim.limitedMints). Deterministic: the same seed and the
// same command stream mint the same serials, because claims happen in loot-roll
// order and this reads nothing but the map and the static supply cap.
export function claimFromWorldLedger(
  limitedMints: Map<string, number>,
  itemId: string,
): number | null {
  const supply = ITEMS[itemId]?.limitedSupply;
  if (supply === undefined) return null;
  const next = (limitedMints.get(itemId) ?? 0) + 1;
  if (next > supply) return null;
  limitedMints.set(itemId, next);
  return next;
}

// Grant a loot slot's item to a player, preserving the per-instance payload a
// minted relic carries, and fire the one-time limitedMint announcement when the
// granted copy has a serial. The single grant chokepoint for every corpse-loot
// distribution path; plain slots route to the ordinary stacking addItem exactly
// as before. The payload is deep-cloned at this boundary (the corpse slot and
// the granted bag slot must never alias one mutable payload).
export function grantLootItem(
  ctx: SimContext,
  itemId: string,
  count: number,
  instance: ItemInstancePayload | undefined,
  pid: number,
): void {
  if (!instance) {
    ctx.addItem(itemId, count, pid);
    return;
  }
  ctx.addItemInstance(itemId, cloneItemInstancePayload(instance), pid);
  if (instance.serial === undefined) return;
  ctx.emit({
    type: 'limitedMint',
    itemId,
    serial: instance.serial,
    supply: ITEMS[itemId]?.limitedSupply ?? 0,
    name: ctx.players.get(pid)?.name ?? 'Unknown',
    pid,
  });
}
