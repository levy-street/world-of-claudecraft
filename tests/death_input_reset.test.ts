import { describe, expect, it } from 'vitest';
import { shouldClearAutorunOnDeath } from '../src/game/death_input_reset';

describe('death input reset', () => {
  it('clears autorun only when the local player transitions into death', () => {
    expect(shouldClearAutorunOnDeath(false, true)).toBe(true);
    expect(shouldClearAutorunOnDeath(true, true)).toBe(false);
    expect(shouldClearAutorunOnDeath(true, false)).toBe(false);
    expect(shouldClearAutorunOnDeath(false, false)).toBe(false);
  });
});
