import { describe, expect, it } from 'vitest';
import { isTalentRowUnlockLevel } from '../src/ui/row_unlock_toast';

describe('row unlock toast levels', () => {
  it('fires only on talent row unlock levels', () => {
    for (const level of [5, 8, 11, 14, 17, 20]) {
      expect(isTalentRowUnlockLevel(level)).toBe(true);
    }
    for (const level of [1, 4, 6, 7, 9, 13, 18, 21]) {
      expect(isTalentRowUnlockLevel(level)).toBe(false);
    }
  });
});
