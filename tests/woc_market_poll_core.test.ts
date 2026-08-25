// The open Exchange window's re-ask cadence.

import { describe, expect, it } from 'vitest';
import {
  anyBondAwaitingChain,
  shouldPollWocMarket,
  WOC_MARKET_AWAITING_POLL_MS,
  WOC_MARKET_IDLE_POLL_MS,
  wocMarketPollIntervalMs,
} from '../src/ui/woc_market_poll_core';

const base = {
  nowMs: 1_000_000,
  lastFetchStartedMs: 1_000_000 - WOC_MARKET_IDLE_POLL_MS,
  inFlight: false,
  awaitingChain: false,
};

describe('shouldPollWocMarket', () => {
  it('polls immediately when nothing has been fetched yet', () => {
    // Opening the window must not be followed by a silent wait for the first
    // interval before anything appears.
    expect(shouldPollWocMarket({ ...base, lastFetchStartedMs: null })).toBe(true);
  });

  it('never stacks a second read on an outstanding one', () => {
    // The HUD band ticks many times per response. Without this the window would
    // stack a request per tick against a slow server, turning one stalled read
    // into a client-side flood, so it outranks even the never-fetched case.
    expect(shouldPollWocMarket({ ...base, inFlight: true })).toBe(false);
    expect(shouldPollWocMarket({ ...base, inFlight: true, lastFetchStartedMs: null })).toBe(false);
    expect(
      shouldPollWocMarket({ ...base, inFlight: true, awaitingChain: true }),
      'not even while awaiting the chain',
    ).toBe(false);
  });

  it('waits out the idle interval, and fires exactly at it', () => {
    const at = (elapsed: number) =>
      shouldPollWocMarket({ ...base, lastFetchStartedMs: base.nowMs - elapsed });
    expect(at(WOC_MARKET_IDLE_POLL_MS - 1)).toBe(false);
    expect(at(WOC_MARKET_IDLE_POLL_MS)).toBe(true);
    expect(at(0)).toBe(false);
  });

  it('uses the faster interval while a payment awaits the chain', () => {
    // The distinction is the whole point of the two constants: at this elapsed
    // time the idle cadence says wait and the awaiting cadence says go.
    const elapsed = WOC_MARKET_AWAITING_POLL_MS;
    expect(elapsed).toBeLessThan(WOC_MARKET_IDLE_POLL_MS);
    const at = (awaitingChain: boolean) =>
      shouldPollWocMarket({ ...base, lastFetchStartedMs: base.nowMs - elapsed, awaitingChain });
    expect(at(false), 'idle still waiting').toBe(false);
    expect(at(true), 'awaiting fires').toBe(true);
  });

  it('polls through a backwards clock jump instead of freezing', () => {
    // A device time correction or a resumed tab can leave the stamp in the
    // future. Waiting it out is unbounded and reads as a hung panel.
    expect(shouldPollWocMarket({ ...base, lastFetchStartedMs: base.nowMs + 60_000 })).toBe(true);
  });

  it('reports the interval it selected', () => {
    expect(wocMarketPollIntervalMs(false)).toBe(WOC_MARKET_IDLE_POLL_MS);
    expect(wocMarketPollIntervalMs(true)).toBe(WOC_MARKET_AWAITING_POLL_MS);
  });
});

describe('anyBondAwaitingChain', () => {
  it('is true only for a pending bond that has a payment submitted', () => {
    expect(anyBondAwaitingChain([{ status: 'pending_bond', bondConfirming: true }])).toBe(true);
    // Not yet paid: the player still has to act, so there is nothing to wait for.
    expect(anyBondAwaitingChain([{ status: 'pending_bond', bondConfirming: false }])).toBe(false);
  });

  it('ignores a confirming flag on a bid that is no longer pending', () => {
    // Defence in depth against the unscoped read: the server scopes the flag to
    // pending_bond, and a client that trusted the flag alone would poll fast
    // forever once any bond had ever been paid.
    for (const status of ['active', 'won', 'lapsed', 'cancelled', 'defaulted']) {
      expect(anyBondAwaitingChain([{ status, bondConfirming: true }]), status).toBe(false);
    }
  });

  it('finds an awaiting bond among others, and is false over none', () => {
    expect(anyBondAwaitingChain([])).toBe(false);
    expect(
      anyBondAwaitingChain([
        { status: 'active', bondConfirming: false },
        { status: 'pending_bond', bondConfirming: true },
      ]),
    ).toBe(true);
  });
});
