// Per-event bookings the world tick owes to operator telemetry, walked once
// from Game.detectActivity's single observer pass over the tick's events:
// terminal unstuck outcomes (unstuck_records.ts) and tick-driven copper
// flows. The second is the reason this module exists: recordCopperFlow
// samples the acting player's purse around one command dispatch, so a spend
// the WORLD makes between dispatches (the Wyrmgate Waystone toll) would be
// misattributed to whatever command is sampled next. The sim emits a
// text-free portalToll event for it, and this books it as 'travel'.
// Session-gated like the unstuck record: a bot has no session and no series.

import type { SimEvent } from '../src/sim/types';
import { gameMetricsCounters } from './http/game_signals';
import { REALM } from './realm';
import { recordUnstuckEvent } from './unstuck_records';

export interface TickBookingSession {
  accountId: number;
  characterId: number;
}

export interface TickBookingDeps {
  recordUnstuck: typeof recordUnstuckEvent;
  copperSpent: (source: 'travel', amount: number) => void;
}

const LIVE_DEPS: TickBookingDeps = {
  recordUnstuck: recordUnstuckEvent,
  copperSpent: (source, amount) => gameMetricsCounters().copperSpent(source, amount),
};

export function bookTickEvent(
  ev: SimEvent,
  session: TickBookingSession | undefined,
  deps: TickBookingDeps = LIVE_DEPS,
): void {
  if (!session) return;
  if (ev.type === 'unstuck') {
    deps.recordUnstuck(
      { realm: REALM, accountId: session.accountId, characterId: session.characterId },
      ev,
    );
  } else if (ev.type === 'portalToll') {
    deps.copperSpent('travel', ev.copper);
  }
}
