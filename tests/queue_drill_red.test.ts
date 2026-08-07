import { describe, expect, it } from 'vitest';

// Merge-queue drill: deliberately red. This file exists only on a scratch drill
// branch to prove a red required shard blocks the merge; it is never merged.
describe('queue drill red shard', () => {
  it('fails by design', () => {
    expect(1).toBe(2);
  });
});
