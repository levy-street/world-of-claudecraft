// Client input send cadence (R13, docs/design/player-performance/
// packet-3-input-cadence.md): the two constants and the gate predicate the
// online client's input stream runs on, extracted from src/net/online.ts so
// the server-side cadence-model matrix (tests/input_cadence_model.test.ts)
// imports the REAL send scheme instead of copying magic numbers. A client
// cadence change flips the matrix loudly instead of silently invalidating
// the server inbound contract it was sized against.
//
// The scheme, as online.ts implements it: an unconditional interval timer
// sends the current input every INPUT_SEND_TIMER_INTERVAL_MS with no change
// check, and a changed-only requestAnimationFrame flush (flushInput) sends
// between timer beats only when the input signature changed AND the shared
// gate is open. EVERY send, timer or flush, resets the shared gate clock
// (lastInputSentAt), so a timer send suppresses the next flush inside the
// gate window: measured steady rates sit around 60 to 64 per second with an
// analytic hard cap of about 82.5 per second (1000 / INPUT_FLUSH_GATE_MS,
// plus the timer's 20 per second), which the server's inbound contract is
// sized against (server/msg_rate_limit.ts, server/msg_lanes.ts).
//
// Pure constants plus predicate, no imports and no DOM, so the module loads
// unchanged in Node tests. Client-side send coalescing itself stays OUT of
// scope per the packet's R13 and Decision 3: the facing-feel cluster in
// src/game/ assumes the heading reaches the wire every frame the gate allows.

/** Interval of the unconditional input send timer in online.ts, in ms. */
export const INPUT_SEND_TIMER_INTERVAL_MS = 50;

/** Minimum ms since the last send from either path before a changed-only
 *  flush may send again (the shared gate). */
export const INPUT_FLUSH_GATE_MS = 16;

/**
 * The shared-gate predicate: may a changed-only flush send at `nowMs` when
 * the last send from either path happened at `lastSentAtMs`? Mirrors the
 * `now - lastInputSentAt < 16` skip in online.ts sendInput exactly.
 */
export function inputFlushGateOpen(nowMs: number, lastSentAtMs: number): boolean {
  return nowMs - lastSentAtMs >= INPUT_FLUSH_GATE_MS;
}
