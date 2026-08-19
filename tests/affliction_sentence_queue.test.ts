import { describe, expect, it } from 'vitest';
import {
  shouldBufferSentenceDuringGcd,
  shouldPreserveQueuedSentence,
} from '../src/sim/combat/affliction_sentence_queue';
import { CAST_QUEUE_WINDOW_SEC } from '../src/sim/types';

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

  it('buffers Sentence only inside the final GCD queue window', () => {
    expect(shouldBufferSentenceDuringGcd('sentence', CAST_QUEUE_WINDOW_SEC)).toBe(true);
    expect(shouldBufferSentenceDuringGcd('sentence', CAST_QUEUE_WINDOW_SEC + 0.01)).toBe(false);
    expect(shouldBufferSentenceDuringGcd('sentence', 0)).toBe(false);
    expect(shouldBufferSentenceDuringGcd('needle_of_fate', CAST_QUEUE_WINDOW_SEC)).toBe(false);
  });
});
