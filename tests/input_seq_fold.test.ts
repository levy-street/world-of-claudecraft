// server/input_seq.ts: the one fold for every seq-bearing inbound frame (movement
// input frames and the client's seq-bearing 'target' command) into the session's
// ack high-water, with the R9 gap booking. The dispatcher's two call sites are
// exercised end to end by tests/snapshots.test.ts ("echoes the last processed
// input sequence" and its target-command sibling).

import { describe, expect, it, vi } from 'vitest';
import { foldReceivedInputSeq } from '../server/input_seq';
import { MSG_SEQ_GAP_SANITY } from '../server/msg_rate_limit';

describe('foldReceivedInputSeq', () => {
  it('advances the high-water and returns the folded seq', () => {
    const session = { lastInputSeq: 0 };
    const onGap = vi.fn();
    expect(foldReceivedInputSeq(session, 1, onGap)).toBe(1);
    expect(foldReceivedInputSeq(session, 2, onGap)).toBe(2);
    expect(session.lastInputSeq).toBe(2);
    expect(onGap).not.toHaveBeenCalled();
  });

  it('ignores an absent, non-finite, or non-positive seq without touching the session', () => {
    const session = { lastInputSeq: 4 };
    const onGap = vi.fn();
    for (const raw of [undefined, null, 'x', Number.NaN, Number.POSITIVE_INFINITY, 0, -3]) {
      expect(foldReceivedInputSeq(session, raw, onGap)).toBeNull();
    }
    expect(session.lastInputSeq).toBe(4);
    expect(onGap).not.toHaveBeenCalled();
  });

  it('floors a fractional seq', () => {
    const session = { lastInputSeq: 0 };
    expect(foldReceivedInputSeq(session, 3.9, vi.fn())).toBe(3);
    expect(session.lastInputSeq).toBe(3);
  });

  it('a reordered or replayed seq at or below the high-water folds to no change', () => {
    const session = { lastInputSeq: 7 };
    const onGap = vi.fn();
    expect(foldReceivedInputSeq(session, 6, onGap)).toBe(6);
    expect(foldReceivedInputSeq(session, 7, onGap)).toBe(7);
    expect(session.lastInputSeq).toBe(7);
    expect(onGap).not.toHaveBeenCalled();
  });

  it('R9: a forward jump past high-water + 1 books the missed count, capped', () => {
    const session = { lastInputSeq: 10 };
    const onGap = vi.fn();
    foldReceivedInputSeq(session, 14, onGap);
    expect(onGap).toHaveBeenCalledWith(3);
    foldReceivedInputSeq(session, 14 + MSG_SEQ_GAP_SANITY + 500, onGap);
    expect(onGap).toHaveBeenLastCalledWith(MSG_SEQ_GAP_SANITY);
  });

  it('R9: a zero high-water (fresh session or post-resume) never books a gap', () => {
    const session = { lastInputSeq: 0 };
    const onGap = vi.fn();
    foldReceivedInputSeq(session, 500, onGap);
    expect(onGap).not.toHaveBeenCalled();
    expect(session.lastInputSeq).toBe(500);
  });

  it('a target command seq interleaved with input frames leaves no gap to book', () => {
    // The client draws both from one counter: input 1, target 2, input 3.
    const session = { lastInputSeq: 0 };
    const onGap = vi.fn();
    foldReceivedInputSeq(session, 1, onGap);
    foldReceivedInputSeq(session, 2, onGap); // the 'target' command's seq
    foldReceivedInputSeq(session, 3, onGap);
    expect(session.lastInputSeq).toBe(3);
    expect(onGap).not.toHaveBeenCalled();
  });
});
