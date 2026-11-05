// Leaf: the Smith's Heart's kill order and the death-recovery rule it feeds
// (docs/design/raid/smith_heart.md, "Death and the run back"; the door's side
// is checkpoint.ts and instances/dungeon_checkpoints.ts).
//
// The guardians fall in any order, so the deepest-cleared rule of the dungeon
// table means nothing here. Instead the rooms to try, best first:
//   no guardian down yet          none (the entrance);
//   one or more down              the room of the guardian the raid killed
//                                 LAST, then each earlier kill in turn;
//   all four down (only the final boss left, or none at all)
//                                 the Heart's Arrival Terrace first.
//
// The kill order is the one fact the claim's roster cannot answer (a corpse
// keeps no time of death), so it is recorded: a vein joins the order the first
// tick its fight is won (seal.ts smithHeartVeinWon: the Hammer's waits on all
// three of the council), in vein order within one tick, and leaves it if its
// fight stands up again (a dev reset). Keyed by the claim's identity and its
// exit (the devPortal idiom of seal.ts), so a fresh claim (a reset) starts
// empty and a recycled slot never inherits a run's order. Draws no rng, reads
// no clock: the same kills on the same ticks give the same order on every host.
// Imports nothing of the fight, so seal.ts can feed it without a cycle.

import type { SmithHeartCheckpointRoom } from '../../content/smith_heart_checkpoints';
import { SMITH_HEART_VEINS, type SmithHeartVein } from '../../content/smith_heart_layout';
import type { InstanceSlot } from '../../sim';

/**
 * The rooms to try, best first, for a claim whose won veins fell in `order`
 * (oldest first). Pure.
 */
export function smithHeartCheckpointRooms(
  order: readonly SmithHeartVein[],
): SmithHeartCheckpointRoom[] {
  const rooms: SmithHeartCheckpointRoom[] = [];
  if (SMITH_HEART_VEINS.every((v) => order.includes(v))) rooms.push('final');
  for (let i = order.length - 1; i >= 0; i--) rooms.push(order[i]);
  return rooms;
}

interface KillOrder {
  exitId: number;
  order: SmithHeartVein[];
}

const killOrders = new WeakMap<InstanceSlot, KillOrder>();

/**
 * Bring a live claim's kill order up to date with the veins it has won right
 * now (`mask`, one bit per vein as `bits` assigns them: seal.ts
 * SMITH_HEART_VEIN_BITS) and return it, oldest first. Allocation free once
 * the claim's record exists.
 */
export function noteSmithHeartKills(
  inst: InstanceSlot,
  mask: number,
  bits: Readonly<Record<SmithHeartVein, number>>,
): readonly SmithHeartVein[] {
  if (inst.partyKey === null || inst.exitId === null) return [];
  let rec = killOrders.get(inst);
  if (!rec || rec.exitId !== inst.exitId) {
    rec = { exitId: inst.exitId, order: [] };
    killOrders.set(inst, rec);
  }
  for (const vein of SMITH_HEART_VEINS) {
    const won = (mask & bits[vein]) !== 0;
    const at = rec.order.indexOf(vein);
    if (won && at < 0) rec.order.push(vein);
    else if (!won && at >= 0) rec.order.splice(at, 1);
  }
  return rec.order;
}
