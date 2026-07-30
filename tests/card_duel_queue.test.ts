import { describe, expect, it } from 'vitest';
import {
  cardDuelQueueSize,
  createCardDuelQueue,
  isQueuedForCardDuel,
  joinCardDuelQueue,
  leaveCardDuelQueue,
  tryPairCardDuel,
} from '../src/sim/social/card_duel_queue';

describe('card_duel_queue', () => {
  it('joins any pid regardless of class (no eligibility gate but state)', () => {
    const q = createCardDuelQueue();
    expect(joinCardDuelQueue(q, 1, false)).toEqual({ ok: true });
    expect(isQueuedForCardDuel(q, 1)).toBe(true);
    expect(cardDuelQueueSize(q)).toBe(1);
  });

  it('refuses a second join while already queued', () => {
    const q = createCardDuelQueue();
    joinCardDuelQueue(q, 1, false);
    expect(joinCardDuelQueue(q, 1, false)).toEqual({ ok: false, reason: 'already_queued' });
    expect(cardDuelQueueSize(q)).toBe(1);
  });

  it('refuses a join while already in a live duel', () => {
    const q = createCardDuelQueue();
    expect(joinCardDuelQueue(q, 1, true)).toEqual({ ok: false, reason: 'already_in_duel' });
    expect(cardDuelQueueSize(q)).toBe(0);
  });

  it('leave removes the pid and is a no-op if absent', () => {
    const q = createCardDuelQueue();
    joinCardDuelQueue(q, 1, false);
    expect(leaveCardDuelQueue(q, 1)).toBe(true);
    expect(isQueuedForCardDuel(q, 1)).toBe(false);
    expect(leaveCardDuelQueue(q, 1)).toBe(false);
  });

  it('pairs the two longest-waiting players FIFO', () => {
    const q = createCardDuelQueue();
    joinCardDuelQueue(q, 1, false);
    joinCardDuelQueue(q, 2, false);
    joinCardDuelQueue(q, 3, false);
    expect(tryPairCardDuel(q)).toEqual([1, 2]);
    expect(cardDuelQueueSize(q)).toBe(1);
    expect(tryPairCardDuel(q)).toBeNull();
  });
});
