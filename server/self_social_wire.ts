// The self snapshot's three pure social rows (`marks`, `trade`, `duel`),
// extracted whole from server/game.ts at Masterwrought phase 12 (the monolith
// ratchet paid for the perfect_item dispatch case). Each is a plain read over
// the Sim's own state for ONE viewer, built per session because every row is
// viewer-relative (my offer versus theirs, the other duelist's name); the
// party row stays in game.ts, where it rides the per-broadcast projection
// cache and the session map. Byte-identical to the methods they replace.

import type { Sim } from '../src/sim/sim';

/** Raid markers the player's party can see, as { entityId: markerId }; null
 *  when the player is in no party. Pure read: the sim owns marker cleanup. */
export function markersWire(sim: Sim, pid: number): unknown {
  const party = sim.partyOf(pid);
  if (!party) return null;
  return sim.markersFor(pid);
}

/** The viewer's side of their open trade session, or null outside one. FULL
 *  payloads on purpose, no publicInstanceView trim: see stagedOfferSlots
 *  (src/sim/social/trade.ts). */
export function tradeWire(sim: Sim, pid: number): unknown {
  const t = sim.tradeFor(pid);
  if (!t) return null;
  const mine = t.a === pid;
  const otherPid = mine ? t.b : t.a;
  const other = sim.meta(otherPid);
  return {
    otherPid,
    otherName: other?.name ?? '?',
    myOffer: mine ? t.offerA : t.offerB,
    theirOffer: mine ? t.offerB : t.offerA,
    myAccepted: mine ? t.acceptedA : t.acceptedB,
    theirAccepted: mine ? t.acceptedB : t.acceptedA,
  };
}

/** The viewer's live duel (the other duelist and the state), or null. */
export function duelWire(sim: Sim, pid: number): unknown {
  const d = sim.duelFor(pid);
  if (!d) return null;
  const otherPid = d.a === pid ? d.b : d.a;
  return { otherPid, otherName: sim.meta(otherPid)?.name ?? '?', state: d.state };
}
