// server/tick_event_bookings.ts: the per-event telemetry bookings the world
// tick owes, walked from the server's one observer pass. The portal toll is a
// TICK-driven spend with no command dispatch to be sampled against, so it is
// booked from the sim's text-free portalToll event as a 'travel' flow instead
// of leaking into whichever command recordCopperFlow samples next.
import { describe, expect, it } from 'vitest';
import { COPPER_FLOW_SOURCES } from '../server/economy_telemetry';
import { bookTickEvent, type TickBookingDeps } from '../server/tick_event_bookings';
import type { SimEvent } from '../src/sim/types';

function fakeDeps() {
  const spent: [string, number][] = [];
  const unstuck: SimEvent[] = [];
  const deps: TickBookingDeps = {
    recordUnstuck: (_identity, ev) => {
      unstuck.push(ev);
    },
    copperSpent: (source, amount) => {
      spent.push([source, amount]);
    },
  };
  return { deps, spent, unstuck };
}

const SESSION = { accountId: 7, characterId: 11 };

describe('bookTickEvent', () => {
  it('books a paid portal toll as a travel spend of exactly the toll', () => {
    const { deps, spent } = fakeDeps();
    bookTickEvent({ type: 'portalToll', pid: 3, copper: 5_000 }, SESSION, deps);
    expect(spent).toEqual([['travel', 5_000]]);
    expect(COPPER_FLOW_SOURCES).toContain('travel');
  });

  it('books nothing for a pid with no session (a bot has no series)', () => {
    const { deps, spent, unstuck } = fakeDeps();
    bookTickEvent({ type: 'portalToll', pid: 3, copper: 5_000 }, undefined, deps);
    bookTickEvent(
      { type: 'unstuck', pid: 3, outcome: 'moved' } as unknown as SimEvent,
      undefined,
      deps,
    );
    expect(spent).toEqual([]);
    expect(unstuck).toEqual([]);
  });

  it('routes unstuck events to the unstuck recorder with the session identity', () => {
    const { deps, unstuck, spent } = fakeDeps();
    const ev = { type: 'unstuck', pid: 3, outcome: 'moved' } as unknown as SimEvent;
    bookTickEvent(ev, SESSION, deps);
    expect(unstuck).toEqual([ev]);
    expect(spent).toEqual([]);
  });

  it('ignores every other event', () => {
    const { deps, unstuck, spent } = fakeDeps();
    bookTickEvent({ type: 'ferryBellHome', pid: 3 }, SESSION, deps);
    bookTickEvent({ type: 'log', text: 'x', pid: 3 } as SimEvent, SESSION, deps);
    expect(unstuck).toEqual([]);
    expect(spent).toEqual([]);
  });
});
