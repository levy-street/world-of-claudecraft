// Pre-parse per-connection inbound WebSocket gate: a frame-rate ceiling, a
// per-window byte budget, and a windowed abuse score. Grew out of the global
// per-connection message limit (#978); redesigned by the input cadence
// contract (docs/design/player-performance/packet-3-input-cadence.md).
//
// Every verdict lands BEFORE JSON.parse in GameServer.handleMessage: a flooder
// burns token math, never parse CPU. And every verdict is allow-or-drop, never
// defer: queueing a frame and releasing it later would shift its receive time,
// which the bot detector's timing strategies are calibrated against.
//
// Sizing follows the MEASURED client send cadence, not a documented 20 Hz.
// src/net/online.ts sends input from two paths sharing one sendInput: an
// unconditional 50 ms interval timer (20/s, no change check) and a
// changed-only rAF flush (flushInput) gated at 16 ms since the last send from
// either path. A held turn changes facing every frame, so the rAF arm sends
// every whole frame the gate allows on high-Hz displays; every timer send also
// resets the shared gate clock and suppresses the next flush inside 16 ms, so
// measured steady rates sit around 60 to 64/s with an analytic hard cap of
// about 82.5/s (1000 / 16, plus the 20/s timer). Commands, chat, and telemetry
// ride the same socket on top of that input stream.
//
// The abuse score is shaped by the stall-then-flush constraint: a network
// stall shorter than the keepalive termination window (WS_KEEPALIVE_PING_MS,
// server/game.ts) leaves the client buffering sends at up to 80/s and TCP
// delivers the whole backlog in one burst on recovery, thousands of frames
// inside about one receive-time second.
// Any score that integrates total drops would kick that legitimate client, so
// abuse is counted in whole receive-time seconds instead: a burst can make at
// most one or two seconds abusive, far under the kick requirement, while a
// sustained flood accumulates abusive seconds until it is kicked. Allowed
// frames never reset anything; only time slides the window.
//
// Pure state + functions (no ClientSession/WebSocket import, injected nowSec)
// so the gate math is unit-testable without a live server.

// Frame ceiling: the refill sits about 1.45x above the 82.5/s input-stream
// hard cap, leaving standing headroom for command mashing plus chat plus
// telemetry on top of a maxed input stream. Burst preserves the
// 1.5-seconds-of-refill shape for the reconnect catch-up spike (session
// resume deliberately keeps the existing bucket, benign at this refill).
export const MSG_RATE_REFILL_PER_SECOND = 120; // sustained refill, frames (tokens) per second
export const MSG_RATE_BURST = 180; // bucket capacity, in frames (tokens)

// Byte budget: beside the per-frame ws maxPayload cap (WS_MAX_PAYLOAD_BYTES,
// server/main.ts) this bounds SUSTAINED parse exposure per connection,
// measured on raw.length (the UTF-16 code-unit proxy for bytes). Legitimate
// steady traffic is about 10 KB/s worst case (input frames serialize to 74 to
// 106 bytes, so 80/s costs about 8.5 KB/s, plus chat), roughly 6x headroom.
export const MSG_BYTE_REFILL_PER_SECOND = 64 * 1024; // sustained refill, bytes per second
export const MSG_BYTE_BURST = 128 * 1024; // byte bucket capacity, in bytes

// Abuse window: a second is abusive when its drop tally reaches the floor
// (offered rate at least 25 percent over the refill for a full second); the
// verdict is kick when enough seconds of the sliding window were abusive. A
// slightly over-limit sender throttles forever without kicking; a
// stall-then-flush burst concentrates in one or two seconds and never kicks.
export const MSG_ABUSE_WINDOW_SECONDS = 10; // sliding window the kick verdict looks across
export const MSG_ABUSE_KICK_SECONDS = 5; // abusive seconds within the window that kick
export const MSG_ABUSE_SECOND_DROP_FLOOR = 30; // drops within one second that mark it abusive

// Kick reason (R10): the exact { t: 'error', error } text both limiter kick
// arms in server/game.ts send before closing the socket. Byte-exact wire
// contract in the server/ws_auth.ts style: the client matcher
// (userFacingApiError in src/ui/api_error_i18n.ts) re-localizes exactly these
// bytes, and the lockstep is source-pinned by tests/localization_fixes.test.ts.
// Deliberately session-fatal on the client (no transient-rejection arm: an
// immediately reconnecting flooder re-floods). The anti-bot kick keeps the
// vaguer 'rejected by server' on purpose; vagueness toward bots is a feature.
export const MSG_RATE_KICK_REASON = 'message rate exceeded';

// Seq-gap sanity cap (R9): a parsed input frame whose seq jumps past
// lastInputSeq + 1 on the ordered socket proves the missing seqs were sent and
// never processed, and the gap feeds the woc_input_frames_missed_total counter.
// One observation is capped here so a client/server seq-reset mismatch (resume
// zeroes the server high-water, reconnect restarts the client counter) can
// never book a giant fictitious gap. The counter stays client-attested either
// way (a hostile client can skip seqs on purpose), so it is a correlating
// ops signal beside the drop-cause series, never proof of server loss.
export const MSG_SEQ_GAP_SANITY = 1000; // max missed frames booked per observation

export interface MsgRateBucketState {
  tokens: number;
  byteTokens: number;
  lastRefillSec: number;
  /** floor(nowSec) of the second currently accumulating drops. */
  dropSecond: number;
  dropsThisSecond: number;
  /** Seconds that hit the drop floor, pruned to the window (at most its length). */
  abusiveSeconds: number[];
}

export function createMsgRateBucket(nowSec: number): MsgRateBucketState {
  return {
    tokens: MSG_RATE_BURST,
    byteTokens: MSG_BYTE_BURST,
    lastRefillSec: nowSec,
    dropSecond: Math.floor(nowSec),
    dropsThisSecond: 0,
    abusiveSeconds: [],
  };
}

export type MsgDropCause = 'rate' | 'bytes';

export type InboundFrameVerdict =
  | { verdict: 'allow' }
  | { verdict: 'drop' | 'kick'; cause: MsgDropCause };

/**
 * Mutates `state` in place and returns whether this frame should be processed,
 * with the drop cause when it should not. A dropped frame spends nothing: the
 * frame token and the byte tokens are only consumed on allow.
 */
export function consumeInboundFrame(
  state: MsgRateBucketState,
  nowSec: number,
  approxBytes: number,
): InboundFrameVerdict {
  const elapsed = Math.max(0, nowSec - state.lastRefillSec);
  state.tokens = Math.min(MSG_RATE_BURST, state.tokens + elapsed * MSG_RATE_REFILL_PER_SECOND);
  state.byteTokens = Math.min(
    MSG_BYTE_BURST,
    state.byteTokens + elapsed * MSG_BYTE_REFILL_PER_SECOND,
  );
  state.lastRefillSec = nowSec;
  if (state.tokens < 1) return { verdict: tallyDrop(state, nowSec), cause: 'rate' };
  if (state.byteTokens < approxBytes) return { verdict: tallyDrop(state, nowSec), cause: 'bytes' };
  state.tokens -= 1;
  state.byteTokens -= approxBytes;
  return { verdict: 'allow' };
}

// Per-second drop accounting: drops of every cause tally into the current
// one-second bucket, and the allow path never touches this state. Exported
// for the post-parse lanes (server/msg_lanes.ts): R6 says drops of EVERY
// cause, gate and lane alike, share this one window, so a lane flood
// accumulates abusive seconds through the identical verdict path.
export function tallyDrop(state: MsgRateBucketState, nowSec: number): 'drop' | 'kick' {
  // Clamp the accounting second monotonic, mirroring the refill's
  // negative-elapsed clamp: a backwards clock step must not re-open an older
  // second, which could push a duplicate ring entry.
  const sec = Math.max(Math.floor(nowSec), state.dropSecond);
  if (sec !== state.dropSecond) {
    state.dropSecond = sec;
    state.dropsThisSecond = 0;
  }
  state.dropsThisSecond++;
  // Exactly-once per second: the tally only ever passes the floor going up.
  if (state.dropsThisSecond === MSG_ABUSE_SECOND_DROP_FLOOR) state.abusiveSeconds.push(sec);
  const cutoff = sec - MSG_ABUSE_WINDOW_SECONDS;
  while (state.abusiveSeconds.length > 0 && state.abusiveSeconds[0] <= cutoff) {
    state.abusiveSeconds.shift();
  }
  return state.abusiveSeconds.length >= MSG_ABUSE_KICK_SECONDS ? 'kick' : 'drop';
}
