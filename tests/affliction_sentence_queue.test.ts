import { describe, expect, it } from 'vitest';
import { shouldPreserveQueuedSentence } from '../src/sim/combat/affliction_sentence_queue';
import { CAST_QUEUE_WINDOW_SEC } from '../src/sim/types';

// The Sentence-only GCD buffer this module used to carry was absorbed by the
// general GCD-tail spell queue (casting_lifecycle.ts); what remains here is the
// preserve rule, the one deliberate exception to the queue's last-press-wins.
describe('Affliction Sentence queue policy', () => {
  it('uses the classic 0.4 second queue window', () => {
    expect(CAST_QUEUE_WINDOW_SEC).toBe(0.4);
  });

  it('protects queued Sentence from repeated generator and release presses', () => {
    expect(shouldPreserveQueuedSentence('sentence', 'needle_of_fate')).toBe(true);
    expect(shouldPreserveQueuedSentence('sentence', 'sentence')).toBe(true);
    expect(shouldPreserveQueuedSentence('sentence', 'drain_life')).toBe(false);
    expect(shouldPreserveQueuedSentence('needle_of_fate', 'needle_of_fate')).toBe(false);
    expect(shouldPreserveQueuedSentence(null, 'needle_of_fate')).toBe(false);
  });
});
