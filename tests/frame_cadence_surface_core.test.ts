import { describe, expect, it } from 'vitest';
import { surfaceClassChanged } from '../src/game/frame_cadence_surface_core';

describe('frame cadence surface class', () => {
  it('changes on a ratio of pixel counts, in either direction', () => {
    const fullHd = 1920 * 1080;
    expect(surfaceClassChanged(fullHd, 2560 * 1440)).toBe(true);
    expect(surfaceClassChanged(2560 * 1440, fullHd)).toBe(true);
    expect(surfaceClassChanged(fullHd, 1600 * 900)).toBe(false);
    expect(surfaceClassChanged(fullHd, fullHd)).toBe(false);
  });

  it('never changes on an unknown surface', () => {
    expect(surfaceClassChanged(0, 1920 * 1080)).toBe(false);
    expect(surfaceClassChanged(1920 * 1080, 0)).toBe(false);
    expect(surfaceClassChanged(Number.NaN, 5)).toBe(false);
  });
});
