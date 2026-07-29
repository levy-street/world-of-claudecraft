import { describe, expect, it } from 'vitest';
import { isOfflineModeAvailable } from '../src/game/offline_mode_gate';

describe('isOfflineModeAvailable', () => {
  it('is available under dev builds', () => {
    expect(isOfflineModeAvailable(true)).toBe(true);
  });

  it('is disabled in production builds', () => {
    expect(isOfflineModeAvailable(false)).toBe(false);
  });
});
