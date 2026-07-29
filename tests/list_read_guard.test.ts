// The dedicated ignore/block list-readout bucket (server/list_read_guard.ts),
// added by the phase 06 maintainer ruling of the input-cadence packet: burst
// and refill arithmetic, refusal-spends-nothing, the idle cap, and the
// backwards-clock clamp, all with injected time only. The GameServer-seam
// wiring pins (drop-before-read, write exemption, the shared-window kick)
// live beside the other chat-surface pins in tests/msg_lanes.test.ts.

import { describe, expect, it } from 'vitest';
import {
  consumeListReadToken,
  createListReadGuard,
  LIST_READ_BURST,
  LIST_READ_REFILL_PER_SECOND,
} from '../server/list_read_guard';

describe('list-read guard budget arithmetic', () => {
  it('pins the constants against disagreeing literals', () => {
    expect(LIST_READ_BURST).toBe(10);
    expect(LIST_READ_REFILL_PER_SECOND).toBe(1);
  });

  it('allows exactly the burst at one instant and refuses the next draw', () => {
    const state = createListReadGuard(1000);
    for (let i = 0; i < LIST_READ_BURST; i++) {
      expect(consumeListReadToken(state, 1000)).toBe(true);
    }
    expect(consumeListReadToken(state, 1000)).toBe(false);
  });

  it('spends nothing on a refusal', () => {
    const state = createListReadGuard(1000);
    for (let i = 0; i < LIST_READ_BURST; i++) consumeListReadToken(state, 1000);
    const drained = { ...state };
    expect(consumeListReadToken(state, 1000)).toBe(false);
    expect(state).toEqual(drained);
  });

  it('refuses on half a refilled token and allows on a whole one', () => {
    const state = createListReadGuard(1000);
    for (let i = 0; i < LIST_READ_BURST; i++) consumeListReadToken(state, 1000);
    expect(consumeListReadToken(state, 1000.5)).toBe(false);
    expect(consumeListReadToken(state, 1001.5)).toBe(true);
    expect(consumeListReadToken(state, 1001.5)).toBe(false);
  });

  it('caps an idle refill at the burst', () => {
    const state = createListReadGuard(1000);
    consumeListReadToken(state, 1000);
    for (let i = 0; i < LIST_READ_BURST; i++) {
      expect(consumeListReadToken(state, 100000)).toBe(true);
    }
    expect(consumeListReadToken(state, 100000)).toBe(false);
  });

  it('clamps a backwards clock step to zero refill', () => {
    const state = createListReadGuard(1000);
    for (let i = 0; i < LIST_READ_BURST; i++) consumeListReadToken(state, 1000);
    expect(consumeListReadToken(state, 900)).toBe(false);
    expect(consumeListReadToken(state, 901)).toBe(true);
  });
});
