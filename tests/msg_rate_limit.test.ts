import { describe, expect, it } from 'vitest';
import {
  consumeInboundFrame,
  createMsgRateBucket,
  MSG_ABUSE_SECOND_DROP_FLOOR,
  MSG_BYTE_BURST,
  MSG_RATE_BURST,
  MSG_RATE_REFILL_PER_SECOND,
  type MsgRateBucketState,
} from '../server/msg_rate_limit';

/**
 * Apply the refill at `now` with a first call, then spend every whole frame
 * token as allows so further calls at `now` drop. Callers always arrive with
 * at least one token available post-refill, so the drain itself never drops
 * and contributes nothing to the abuse tally.
 */
function drainFrameTokens(state: MsgRateBucketState, now: number): void {
  do {
    expect(consumeInboundFrame(state, now, 1).verdict).toBe('allow');
  } while (state.tokens >= 1);
}

/**
 * Drive one receive-time second to exactly the abuse drop floor and assert the
 * verdict of the floor-crossing drop: kick when the window fills, drop before.
 */
function makeAbusiveSecond(state: MsgRateBucketState, sec: number, kickOnFloor: boolean): void {
  drainFrameTokens(state, sec);
  for (let i = 0; i < MSG_ABUSE_SECOND_DROP_FLOOR - 1; i++) {
    expect(consumeInboundFrame(state, sec, 1).verdict).toBe('drop');
  }
  const atFloor = consumeInboundFrame(state, sec, 1);
  if (kickOnFloor) {
    expect(atFloor).toEqual({ verdict: 'kick', cause: 'rate' });
  } else {
    expect(atFloor.verdict).toBe('drop');
  }
}

describe('msg_rate_limit', () => {
  it('allows a fresh bucket to spend its full burst then drops with cause rate', () => {
    const state = createMsgRateBucket(0);
    for (let i = 0; i < MSG_RATE_BURST; i++) {
      expect(consumeInboundFrame(state, 0, 1).verdict).toBe('allow');
    }
    // burst exhausted, no time elapsed to refill
    const bytesBefore = state.byteTokens;
    expect(consumeInboundFrame(state, 0, 1)).toEqual({ verdict: 'drop', cause: 'rate' });
    // a rate drop spends nothing from the byte bucket either
    expect(state.byteTokens).toBe(bytesBefore);
  });

  it('keeps an 80 per second mixed stream drop-free indefinitely', () => {
    const state = createMsgRateBucket(0);
    let now = 0;
    // drain the initial burst first, as a reconnect catch-up spike would
    drainFrameTokens(state, now);
    // steady 80/s for 120 simulated seconds: input frames at the measured
    // 74 to 106 byte serialized sizes, plus a chat line and a command each
    // second riding the same socket
    for (let i = 0; i < 80 * 120; i++) {
      now += 1 / 80;
      const slot = i % 80;
      const bytes = slot === 0 ? 200 : slot === 40 ? 120 : 74 + (i % 33);
      expect(consumeInboundFrame(state, now, bytes).verdict).toBe('allow');
    }
  });

  it('never throttles a sustained 20 Hz input stream, the trivial lower bound', () => {
    const state = createMsgRateBucket(0);
    let now = 0;
    drainFrameTokens(state, now);
    for (let i = 0; i < 20 * 5; i++) {
      now += 1 / 20;
      expect(consumeInboundFrame(state, now, 106).verdict).toBe('allow');
    }
  });

  it('refills frame tokens over time up to the burst cap', () => {
    const state = createMsgRateBucket(0);
    drainFrameTokens(state, 0);
    expect(consumeInboundFrame(state, 0, 1).verdict).toBe('drop');
    // the whole-token boundary: half a refilled token still drops, two allow
    expect(consumeInboundFrame(state, 1 / 240, 1).verdict).toBe('drop');
    expect(consumeInboundFrame(state, 1 / 60, 1).verdict).toBe('allow');
    // enough elapsed time to fully refill; a long idle never overfills
    const later = MSG_RATE_BURST / MSG_RATE_REFILL_PER_SECOND;
    expect(consumeInboundFrame(state, later, 1).verdict).toBe('allow');
    consumeInboundFrame(state, later + 3600, 1);
    expect(state.tokens).toBeLessThanOrEqual(MSG_RATE_BURST);
  });

  it('spends byte tokens equal to the frame length on allow', () => {
    const state = createMsgRateBucket(0);
    const before = state.byteTokens;
    expect(consumeInboundFrame(state, 0, 16 * 1024).verdict).toBe('allow');
    expect(before - state.byteTokens).toBe(16_384);
  });

  it('drops with cause bytes on byte exhaustion while frame tokens remain', () => {
    const state = createMsgRateBucket(0);
    // eight max-payload frames drain the byte burst exactly
    for (let i = 0; i < 8; i++) {
      expect(consumeInboundFrame(state, 0, 16 * 1024).verdict).toBe('allow');
    }
    expect(state.byteTokens).toBe(0);
    const framesLeft = state.tokens;
    expect(framesLeft).toBeGreaterThanOrEqual(1);
    expect(consumeInboundFrame(state, 0, 16 * 1024)).toEqual({ verdict: 'drop', cause: 'bytes' });
    // the byte drop spent neither the frame token nor any byte tokens
    expect(state.tokens).toBe(framesLeft);
    expect(state.byteTokens).toBe(0);
  });

  it('refills the byte bucket over time up to its cap', () => {
    const state = createMsgRateBucket(0);
    for (let i = 0; i < 8; i++) consumeInboundFrame(state, 0, 16 * 1024);
    expect(consumeInboundFrame(state, 0, 16 * 1024).verdict).toBe('drop');
    // 64 KiB per second: a quarter second buys exactly the 16 KiB back
    expect(consumeInboundFrame(state, 0.25, 16 * 1024).verdict).toBe('allow');
    consumeInboundFrame(state, 3600, 1);
    expect(state.byteTokens).toBeLessThanOrEqual(MSG_BYTE_BURST);
  });

  it('never kicks when every second stays under the drop floor', () => {
    const state = createMsgRateBucket(0);
    // more seconds than the window holds, each one drop short of the floor
    for (let sec = 0; sec < 12; sec++) {
      drainFrameTokens(state, sec);
      for (let i = 0; i < MSG_ABUSE_SECOND_DROP_FLOOR - 1; i++) {
        expect(consumeInboundFrame(state, sec, 1)).toEqual({ verdict: 'drop', cause: 'rate' });
      }
    }
  });

  it('kicks on the fifth abusive second in the window and not on the fourth', () => {
    const state = createMsgRateBucket(0);
    for (let sec = 0; sec < 4; sec++) makeAbusiveSecond(state, sec, false);
    makeAbusiveSecond(state, 4, true);
  });

  it('lets no allowed frame reset the abuse window', () => {
    const state = createMsgRateBucket(0);
    // every second interleaves refill-funded allows BETWEEN its drop runs; the
    // old consecutive counter reset on any allow, the window must not
    const verdicts: string[] = [];
    for (let sec = 0; sec < 5; sec++) {
      drainFrameTokens(state, sec);
      for (let i = 0; i < 15; i++) verdicts.push(consumeInboundFrame(state, sec, 1).verdict);
      // half a second refills 60 tokens: allows land mid-second, mid-window
      drainFrameTokens(state, sec + 0.5);
      for (let i = 0; i < 15; i++) verdicts.push(consumeInboundFrame(state, sec + 0.5, 1).verdict);
    }
    expect(verdicts.slice(0, -1).every((v) => v === 'drop')).toBe(true);
    expect(verdicts[verdicts.length - 1]).toBe('kick');
  });

  it('never kicks a single-second thousand-drop burst', () => {
    const state = createMsgRateBucket(0);
    // a stall-then-flush backlog: the whole burst lands in one receive second
    drainFrameTokens(state, 0.4);
    for (let i = 0; i < 1000; i++) {
      expect(consumeInboundFrame(state, 0.4, 1).verdict).toBe('drop');
    }
    // live traffic resumes drop-free once the refill catches up
    expect(consumeInboundFrame(state, 2, 106).verdict).toBe('allow');
  });

  it('forgets abusive seconds once they age past the window', () => {
    const state = createMsgRateBucket(0);
    for (let sec = 0; sec < 4; sec++) makeAbusiveSecond(state, sec, false);
    // ten quiet seconds later a fresh abusive second stands alone: no kick
    makeAbusiveSecond(state, 14, false);
  });

  it('kicks a sustained byte flood with cause bytes through the same window', () => {
    const state = createMsgRateBucket(0);
    for (let sec = 0; sec < 5; sec++) {
      // zero the byte bucket with max-payload frames: eight drain the fresh
      // 128 KiB burst, four the 64 KiB a full second refills after that
      const drains = sec === 0 ? 8 : 4;
      for (let i = 0; i < drains; i++) {
        expect(consumeInboundFrame(state, sec, 16 * 1024).verdict).toBe('allow');
      }
      expect(state.byteTokens).toBe(0);
      for (let i = 0; i < MSG_ABUSE_SECOND_DROP_FLOOR - 1; i++) {
        expect(consumeInboundFrame(state, sec, 16 * 1024)).toEqual({
          verdict: 'drop',
          cause: 'bytes',
        });
      }
      const atFloor = consumeInboundFrame(state, sec, 16 * 1024);
      if (sec === 4) {
        expect(atFloor).toEqual({ verdict: 'kick', cause: 'bytes' });
      } else {
        expect(atFloor).toEqual({ verdict: 'drop', cause: 'bytes' });
      }
    }
  });

  it('keeps the abuse accounting monotonic when the clock steps backwards', () => {
    const state = createMsgRateBucket(0);
    for (let sec = 0; sec < 4; sec++) makeAbusiveSecond(state, sec, false);
    // the clock steps back below an already-abusive second: the tally must
    // stay in the latest second and never push a duplicate ring entry, so no
    // amount of backwards drops can manufacture the fifth abusive second
    for (let i = 0; i < MSG_ABUSE_SECOND_DROP_FLOOR * 2; i++) {
      expect(consumeInboundFrame(state, 2.5, 1).verdict).toBe('drop');
    }
    // the genuine fifth abusive second still kicks
    makeAbusiveSecond(state, 4, true);
  });

  it('ages a second out at exactly ten seconds back and keeps one at nine', () => {
    // second 4 is outside the window of second 14; second 5 is inside
    const outside = createMsgRateBucket(0);
    for (const sec of [4, 11, 12, 13]) makeAbusiveSecond(outside, sec, false);
    makeAbusiveSecond(outside, 14, false);
    const inside = createMsgRateBucket(0);
    for (const sec of [5, 11, 12, 13]) makeAbusiveSecond(inside, sec, false);
    makeAbusiveSecond(inside, 14, true);
  });
});
