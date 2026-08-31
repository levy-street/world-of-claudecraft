import type { SimEvent } from '../src/sim/types';

// The per-pid index for the events fan-out, the routing counterpart to
// server/event_frame.ts's serialize-once.
//
// routeEvents used to give EVERY session a full walk of the WHOLE batch, and a
// pid-scoped event is reachable by exactly one session (its own pid) plus, for
// a chat line, the spectator watching that pid. So a batch that mints one
// pid-scoped copy per recipient (the zone celebrations: masterworkZone,
// attunedZone, legendaryForgedZone, one copy per in-zone player) cost
// O(recipients x sessions) selection iterations for O(recipients) deliveries:
// 200 in-zone at 1,000 sessions is 200,000 iterations in one tick, and the
// realm ceiling (5,000 in one zone, 5,000 sessions) is 25 million. That term
// dominates the batch's serialization by three to four orders of magnitude,
// and it is pure waste: 99.9% of those iterations reach an event whose pid
// belongs to somebody else, fall through both branches, and do nothing.
//
// This module builds, ONCE per batch, the two lists a session actually needs:
// the ascending event indices scoped to a given pid, and the ascending indices
// of the pid-LESS (world/broadcast) events every session still evaluates for
// itself. It is the share-the-work shape server/interest_candidates.ts already
// applies to the snapshot broadcast, on the event batch instead of the grid.
//
// ORDER IS THE CONTRACT. A session's frame must carry its events in the batch's
// own order, so selection walks the lists MERGED by original index rather than
// one after the other; the merge is what makes this a pure cost change and not
// a wire change. Callers re-apply every per-session predicate (the combat
// filter, the ignore and block sets, the interest radius) to the events they
// visit, exactly as the full walk did: this narrows WHICH events a session
// looks at, never what it decides about one.

/** One shared empty list for a pid with no events in this batch. */
const EMPTY: readonly number[] = [];

export interface EventPidIndex {
  /** Ascending indices of the pid-scoped events addressed to `pid`; empty when none. */
  forPid(pid: number): readonly number[];
  /** Ascending indices of the events carrying no pid (the world/broadcast set). */
  readonly broadcast: readonly number[];
  /** Distinct pids the batch addresses (the fan-out width; the counting arms read it). */
  readonly pidCount: number;
}

/**
 * Bucket a batch's events by their `pid` field. Indices are pushed in batch
 * order, so every returned list is already ascending and the merge walk below
 * needs no sort. Call it AFTER filterRoutableEvents, on the same array the
 * fragments are index-aligned with.
 */
export function buildEventPidIndex(events: readonly SimEvent[]): EventPidIndex {
  const byPid = new Map<number, number[]>();
  const broadcast: number[] = [];
  for (let i = 0; i < events.length; i++) {
    const pid = (events[i] as { pid?: number }).pid;
    if (pid === undefined) {
      broadcast.push(i);
      continue;
    }
    const list = byPid.get(pid);
    if (list === undefined) byPid.set(pid, [i]);
    else list.push(i);
  }
  return {
    forPid(pid: number): readonly number[] {
      return byPid.get(pid) ?? EMPTY;
    },
    broadcast,
    pidCount: byPid.size,
  };
}

/**
 * Visit, in ascending batch order, exactly the event indices one session can
 * be delivered: the events scoped to its ANCHOR pid (its own, or the pid it
 * spectates), the events scoped to its OWN pid when those differ (a spectator
 * still receives its own whispers and party chat), and every pid-less event.
 *
 * Allocation-free: a pointer walk over the three lists the index already holds,
 * so the per-session cost is O(its own pid-scoped events + the broadcast set)
 * and no longer scales with the batch. `selfPid === anchorPid` (the ordinary
 * non-spectating session) walks two lists, never visiting an index twice.
 */
export function forEachSelectedEventIndex(
  index: EventPidIndex,
  anchorPid: number,
  selfPid: number,
  visit: (eventIndex: number) => void,
): void {
  const anchored = index.forPid(anchorPid);
  // Deliberately identity-compared against `anchored`, not just pid-compared:
  // a session spectating its own pid resolves both to the same list, and
  // visiting it twice would double every event in that session's frame.
  const own = selfPid === anchorPid ? EMPTY : index.forPid(selfPid);
  const broadcast = index.broadcast;
  let a = 0;
  let b = 0;
  let c = 0;
  while (a < anchored.length || b < own.length || c < broadcast.length) {
    const av = a < anchored.length ? anchored[a] : Number.POSITIVE_INFINITY;
    const bv = b < own.length ? own[b] : Number.POSITIVE_INFINITY;
    const cv = c < broadcast.length ? broadcast[c] : Number.POSITIVE_INFINITY;
    if (av <= bv && av <= cv) {
      visit(av);
      a++;
    } else if (bv <= cv) {
      visit(bv);
      b++;
    } else {
      visit(cv);
      c++;
    }
  }
}
