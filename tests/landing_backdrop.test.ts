import { describe, expect, it } from 'vitest';
import { shouldUseStaticBackdrop, BackdropSignals } from '../src/game/landing_backdrop';

const NONE: BackdropSignals = { phone: false, saveData: false, reducedMotion: false, highContrast: false };

describe('shouldUseStaticBackdrop', () => {
  it('plays the trailer (not static) for a desktop user with no preferences', () => {
    expect(shouldUseStaticBackdrop(NONE)).toBe(false);
  });

  it('forces the static poster on phones (battery/data/decode cost)', () => {
    expect(shouldUseStaticBackdrop({ ...NONE, phone: true })).toBe(true);
  });

  it('honors the Save-Data hint', () => {
    expect(shouldUseStaticBackdrop({ ...NONE, saveData: true })).toBe(true);
  });

  it('honors prefers-reduced-motion', () => {
    expect(shouldUseStaticBackdrop({ ...NONE, reducedMotion: true })).toBe(true);
  });

  it('honors the explicit high-contrast setting on desktop', () => {
    expect(shouldUseStaticBackdrop({ ...NONE, highContrast: true })).toBe(true);
  });

  it('stays static when several reasons stack', () => {
    expect(shouldUseStaticBackdrop({ phone: true, saveData: true, reducedMotion: false, highContrast: true })).toBe(true);
  });
});
