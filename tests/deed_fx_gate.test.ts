import { describe, expect, it } from 'vitest';
import { shouldPlayDeedFirework } from '../src/render/deed_fx_gate';

describe('shouldPlayDeedFirework', () => {
  it('plays the burst for a fresh unlock at full motion', () => {
    expect(shouldPlayDeedFirework({ retro: false }, false)).toBe(true);
  });

  it('suppresses the burst for a retro back-credit even at full motion', () => {
    expect(shouldPlayDeedFirework({ retro: true }, false)).toBe(false);
  });

  it('suppresses the burst under reduced motion for a fresh unlock', () => {
    expect(shouldPlayDeedFirework({ retro: false }, true)).toBe(false);
  });

  it('suppresses the burst when both retro and reduced motion hold', () => {
    expect(shouldPlayDeedFirework({ retro: true }, true)).toBe(false);
  });

  it('treats an absent retro flag as a fresh unlock', () => {
    expect(shouldPlayDeedFirework({}, false)).toBe(true);
  });
});
