// Per-tick SimEvent routing index.
//
// routeEvents used to scan the WHOLE event batch once per connected session,
// O(sessions x events) per sim tick, which trends quadratic when activity and
// population rise together (a busy hub: more players => more events => every
// player scans all of them). Almost every event is pid-scoped, so indexing the
// batch once by pid lets each session visit only its own candidates plus the
// (rare) world-anchored events, O(events + sum of per-session candidates).
//
// Order is contract: the client applies events in emit order, and the golden
// gates (tests/parity eventDigest, tests/server/broadcast_golden rawEventsSha)
// pin it. Each event therefore carries its batch index, and the per-session
// candidate lists are merged back into exact batch order before dispatch.
//
// Pure data shaping over the sim's event array: no GameServer state, no
// filtering semantics (blocked senders, spectate arms, interest radius stay in
// routeEvents where the session state lives).
import type { SimEvent } from '../src/sim/types';

export interface IndexedEvent {
  ev: SimEvent;
  idx: number;
}

export interface EventRoutingIndex {
  // pid-scoped events (ev.pid defined), in batch order per pid
  byPid: Map<number, IndexedEvent[]>;
  // events with no pid (world-anchored: routed by distance), in batch order
  world: IndexedEvent[];
}

export function indexEventsForRouting(events: readonly SimEvent[]): EventRoutingIndex {
  const byPid = new Map<number, IndexedEvent[]>();
  const world: IndexedEvent[] = [];
  for (let idx = 0; idx < events.length; idx++) {
    const ev = events[idx];
    const pid = (ev as { pid?: number }).pid;
    if (pid !== undefined) {
      let list = byPid.get(pid);
      if (!list) {
        list = [];
        byPid.set(pid, list);
      }
      list.push({ ev, idx });
    } else {
      world.push({ ev, idx });
    }
  }
  return { byPid, world };
}

// Merge up to three per-pid/world candidate lists (each already in batch
// order) back into one batch-ordered stream, invoking visit() per event
// exactly once. Lists may be undefined or share identity (a non-spectating
// session's own list IS its anchor list); duplicates are collapsed by
// comparing indices, never by scanning.
export function mergeCandidates(
  a: readonly IndexedEvent[] | undefined,
  b: readonly IndexedEvent[] | undefined,
  c: readonly IndexedEvent[] | undefined,
  visit: (ev: SimEvent) => void,
): void {
  const la = a ?? [];
  const lb = b === a ? [] : (b ?? []);
  const lc = c === a || c === b ? [] : (c ?? []);
  let ia = 0;
  let ib = 0;
  let ic = 0;
  for (;;) {
    const na = ia < la.length ? la[ia].idx : Infinity;
    const nb = ib < lb.length ? lb[ib].idx : Infinity;
    const nc = ic < lc.length ? lc[ic].idx : Infinity;
    if (na === Infinity && nb === Infinity && nc === Infinity) return;
    if (na <= nb && na <= nc) {
      visit(la[ia].ev);
      ia++;
    } else if (nb <= nc) {
      visit(lb[ib].ev);
      ib++;
    } else {
      visit(lc[ic].ev);
      ic++;
    }
  }
}
