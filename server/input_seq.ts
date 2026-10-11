// The per-session input sequence high-water (`session.lastInputSeq`), folded
// from every seq-bearing frame the ordered socket delivers and echoed back to
// the client as `snap.self.ack` (server/game.ts selfWireJson).
//
// Two frame kinds carry a seq: every movement `input` frame, and the client's
// 'target' command (src/net/target_echo.ts explains why: the ack is how the
// online mirror tells a snapshot built after the command from a stale in-flight
// one, so the optimistic target never bounces back to the previous one on a
// long round trip). Both draw from ONE client-side counter, so both must fold
// into the one high-water here: a command that skipped the fold would leave the
// next input frame reading as a gap.
//
// Pure and socket-free (no metrics import: the gap sink is injected), so the
// dispatcher stays a thin caller and tests pin the arithmetic directly.

import { MSG_SEQ_GAP_SANITY } from './msg_rate_limit';

export interface InputSeqSession {
  lastInputSeq: number;
}

/**
 * Fold one received frame's `seq` into the session high-water.
 *
 * Returns the folded seq, or null when the frame carried no usable seq (absent,
 * non-finite, or not positive), in which case the session is untouched.
 *
 * R9: the client seq is a per-send increment on an ordered socket, so a forward
 * jump past the receive high-water proves the missing seqs were sent and never
 * processed (the seq-attributed share of the server's own drops); `onGap`
 * receives that count. Guarded to a positive high-water because resume zeroes it
 * while the client restarts its counter on reconnect, and capped at
 * `MSG_SEQ_GAP_SANITY` so a reset mismatch never books a giant gap. A seq at or
 * below the high-water (a reordered or replayed frame) folds to no change.
 */
export function foldReceivedInputSeq(
  session: InputSeqSession,
  rawSeq: unknown,
  onGap: (missed: number) => void,
): number | null {
  if (typeof rawSeq !== 'number' || !Number.isFinite(rawSeq) || rawSeq <= 0) return null;
  const seq = Math.floor(rawSeq);
  if (session.lastInputSeq > 0 && seq > session.lastInputSeq + 1) {
    onGap(Math.min(seq - session.lastInputSeq - 1, MSG_SEQ_GAP_SANITY));
  }
  session.lastInputSeq = Math.max(session.lastInputSeq, seq);
  return seq;
}
