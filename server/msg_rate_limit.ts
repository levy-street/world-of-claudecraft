// Global per-connection inbound WebSocket message rate limit (#978).
//
// Only chat had a token bucket (CHAT_RATE_BURST/CHAT_RATE_REFILL_PER_SECOND in
// game.ts); every other inbound frame (input, cast, cmd, ...) was processed
// unconditionally, so a client flooding non-chat frames burns server CPU with
// no throttle or disconnect. This is a SEPARATE, more generous bucket that
// covers ALL inbound messages so it never throttles legitimate 20 Hz movement
// input, only genuine floods well above normal traffic.
//
// Pure state + functions (no ClientSession/WebSocket import) so the bucket
// math is unit-testable without a live server.

// Legitimate traffic is at most ~20 input frames/sec plus occasional cast/cmd
// frames. Burst covers a reconnect catch-up spike; refill comfortably clears
// that burst while capping sustained throughput well above 20 Hz.
export const MSG_RATE_BURST = 60;
export const MSG_RATE_REFILL_PER_SECOND = 40;
// Consecutive over-budget frames (each already dropped) before the connection
// is kicked outright, mirroring the chat cooldown-then-kick ladder.
export const MSG_RATE_VIOLATIONS_FOR_KICK = 200;

export interface MsgRateBucketState {
  tokens: number;
  lastRefillSec: number;
  violations: number;
}

export function createMsgRateBucket(nowSec: number): MsgRateBucketState {
  return { tokens: MSG_RATE_BURST, lastRefillSec: nowSec, violations: 0 };
}

export type MsgRateVerdict = 'allow' | 'drop' | 'kick';

/** Mutates `state` in place and returns whether this message should be processed. */
export function consumeMsgToken(state: MsgRateBucketState, nowSec: number): MsgRateVerdict {
  const elapsed = Math.max(0, nowSec - state.lastRefillSec);
  state.tokens = Math.min(MSG_RATE_BURST, state.tokens + elapsed * MSG_RATE_REFILL_PER_SECOND);
  state.lastRefillSec = nowSec;
  if (state.tokens >= 1) {
    state.tokens -= 1;
    state.violations = 0;
    return 'allow';
  }
  state.violations++;
  if (state.violations >= MSG_RATE_VIOLATIONS_FOR_KICK) return 'kick';
  return 'drop';
}
