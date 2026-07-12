import { describe, expect, it } from 'vitest';
import { DEFAULT_LOGO_FADE_WINDOWS, logoFadeOpacity } from '../src/game/logo_fade';

const TOTAL = 9; // matches spawnCinematicFor's durationSec

describe('logoFadeOpacity', () => {
  it('is fully transparent at t=0', () => {
    expect(logoFadeOpacity(0, TOTAL)).toBe(0);
  });

  it('ramps up during the fade-in window', () => {
    const half = DEFAULT_LOGO_FADE_WINDOWS.fadeInSec / 2;
    const opacity = logoFadeOpacity(half, TOTAL);
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
    expect(opacity).toBeCloseTo(0.5, 5);
  });

  it('is fully opaque throughout the hold window', () => {
    const { fadeInSec, holdSec } = DEFAULT_LOGO_FADE_WINDOWS;
    expect(logoFadeOpacity(fadeInSec, TOTAL)).toBe(1);
    expect(logoFadeOpacity(fadeInSec + holdSec / 2, TOTAL)).toBe(1);
    expect(logoFadeOpacity(fadeInSec + holdSec - 0.001, TOTAL)).toBeCloseTo(1, 3);
  });

  it('ramps down during the fade-out window', () => {
    const { fadeInSec, holdSec, fadeOutSec } = DEFAULT_LOGO_FADE_WINDOWS;
    const midFadeOut = fadeInSec + holdSec + fadeOutSec / 2;
    const opacity = logoFadeOpacity(midFadeOut, TOTAL);
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
    expect(opacity).toBeCloseTo(0.5, 5);
  });

  it('is fully transparent once the fade-out window ends, well before the cinematic lands', () => {
    const { fadeInSec, holdSec, fadeOutSec } = DEFAULT_LOGO_FADE_WINDOWS;
    const fadeOutEnd = fadeInSec + holdSec + fadeOutSec;
    expect(logoFadeOpacity(fadeOutEnd, TOTAL)).toBe(0);
    expect(logoFadeOpacity(fadeOutEnd + 0.5, TOTAL)).toBe(0);
    expect(fadeOutEnd).toBeLessThan(TOTAL);
  });

  it('is fully transparent at and after the total cinematic duration', () => {
    expect(logoFadeOpacity(TOTAL, TOTAL)).toBe(0);
    expect(logoFadeOpacity(TOTAL + 5, TOTAL)).toBe(0);
  });

  it('never exceeds [0, 1] across a dense sweep of the whole duration', () => {
    for (let t = 0; t <= TOTAL; t += 0.05) {
      const opacity = logoFadeOpacity(t, TOTAL);
      expect(opacity).toBeGreaterThanOrEqual(0);
      expect(opacity).toBeLessThanOrEqual(1);
    }
  });

  it('snaps straight to fully opaque with a zero-length fade-in window', () => {
    const windows = { fadeInSec: 0, holdSec: 2.5, fadeOutSec: 1.5 };
    expect(logoFadeOpacity(0.001, TOTAL, windows)).toBe(1);
    expect(logoFadeOpacity(0.5, TOTAL, windows)).toBe(1);
  });

  it('snaps straight to fully transparent with a zero-length fade-out window', () => {
    const windows = { fadeInSec: 1.5, holdSec: 2.5, fadeOutSec: 0 };
    const holdEnd = windows.fadeInSec + windows.holdSec;
    expect(logoFadeOpacity(holdEnd, TOTAL, windows)).toBe(0);
    expect(logoFadeOpacity(holdEnd + 0.001, TOTAL, windows)).toBe(0);
  });

  it('snaps to fully transparent when totalDurationSec falls below the fade-out window mid-fade', () => {
    const windows = DEFAULT_LOGO_FADE_WINDOWS;
    const { fadeInSec, holdSec, fadeOutSec } = windows;
    const fadeOutEnd = fadeInSec + holdSec + fadeOutSec;
    // Without the totalDurationSec cutoff, t=3.5 would land inside the hold
    // window (fadeInSec=1.5 to holdEnd=4.0) and return opacity 1.
    const shortTotal = fadeInSec + holdSec - 0.5;
    expect(shortTotal).toBeLessThan(fadeOutEnd);
    expect(logoFadeOpacity(fadeInSec + holdSec - 0.5, shortTotal, windows)).toBe(0);
  });
});
