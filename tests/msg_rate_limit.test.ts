import { describe, expect, it } from 'vitest';
import {
  consumeMsgToken,
  createMsgRateBucket,
  MSG_RATE_BURST,
  MSG_RATE_REFILL_PER_SECOND,
  MSG_RATE_VIOLATIONS_FOR_KICK,
} from '../server/msg_rate_limit';

describe('msg_rate_limit', () => {
  it('allows a fresh bucket to spend its full burst', () => {
    const state = createMsgRateBucket(0);
    for (let i = 0; i < MSG_RATE_BURST; i++) {
      expect(consumeMsgToken(state, 0)).toBe('allow');
    }
    // burst exhausted, no time elapsed to refill
    expect(consumeMsgToken(state, 0)).toBe('drop');
  });

  it('never throttles a sustained legitimate 20 Hz input stream', () => {
    const state = createMsgRateBucket(0);
    let now = 0;
    // drain the initial burst first, as a real connection eventually would
    for (let i = 0; i < MSG_RATE_BURST; i++) consumeMsgToken(state, now);
    // steady 20 Hz traffic for 5 simulated seconds
    for (let i = 0; i < 20 * 5; i++) {
      now += 1 / 20;
      expect(consumeMsgToken(state, now)).toBe('allow');
    }
  });

  it('refills over time up to the burst cap', () => {
    const state = createMsgRateBucket(0);
    for (let i = 0; i < MSG_RATE_BURST; i++) consumeMsgToken(state, 0);
    expect(consumeMsgToken(state, 0)).toBe('drop');
    // enough elapsed time to fully refill
    const later = MSG_RATE_BURST / MSG_RATE_REFILL_PER_SECOND;
    expect(consumeMsgToken(state, later)).toBe('allow');
    expect(state.tokens).toBeLessThanOrEqual(MSG_RATE_BURST);
  });

  it('drops messages once the bucket is empty and no time has passed', () => {
    const state = createMsgRateBucket(0);
    for (let i = 0; i < MSG_RATE_BURST; i++) consumeMsgToken(state, 0);
    for (let i = 0; i < 10; i++) {
      expect(consumeMsgToken(state, 0)).toBe('drop');
    }
  });

  it('kicks a connection that keeps flooding after being dropped', () => {
    const state = createMsgRateBucket(0);
    for (let i = 0; i < MSG_RATE_BURST; i++) consumeMsgToken(state, 0);
    let verdict = 'drop';
    for (let i = 0; i < MSG_RATE_VIOLATIONS_FOR_KICK; i++) {
      verdict = consumeMsgToken(state, 0);
    }
    expect(verdict).toBe('kick');
  });

  it('resets the violation counter once a message is allowed again', () => {
    const state = createMsgRateBucket(0);
    for (let i = 0; i < MSG_RATE_BURST; i++) consumeMsgToken(state, 0);
    for (let i = 0; i < MSG_RATE_VIOLATIONS_FOR_KICK - 1; i++) {
      expect(consumeMsgToken(state, 0)).toBe('drop');
    }
    expect(state.violations).toBe(MSG_RATE_VIOLATIONS_FOR_KICK - 1);
    // enough time passes for one token to refill, resetting the ladder
    const oneToken = 1 / MSG_RATE_REFILL_PER_SECOND;
    expect(consumeMsgToken(state, oneToken)).toBe('allow');
    expect(state.violations).toBe(0);
  });
});
