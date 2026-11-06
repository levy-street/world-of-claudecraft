import { describe, expect, it } from 'vitest';
import { autoStepDown, autoStepUp } from '../src/game/frame_cadence_auto_core';
import {
  autoEffectiveIntent,
  autoReadingHz,
  autoRestoresUnderTop,
  autoTopCeiling,
  exemptSkipsUnderTop,
} from '../src/game/frame_cadence_platform_core';

describe('frame cadence platform top', () => {
  it('tops Auto at 60 on iOS WebKit only', () => {
    expect(autoTopCeiling('ios')).toBe(60);
    expect(autoTopCeiling('android')).toBe(0);
    expect(autoTopCeiling('other')).toBe(0);
  });

  it('clamps the automatic verdict to the top, never above it', () => {
    expect(autoEffectiveIntent(0, 60)).toBe(60);
    expect(autoEffectiveIntent(60, 60)).toBe(60);
    expect(autoEffectiveIntent(30, 60)).toBe(30);
  });

  it('leaves the verdict alone without a top', () => {
    expect(autoEffectiveIntent(0, 0)).toBe(0);
    expect(autoEffectiveIntent(60, 0)).toBe(60);
    expect(autoEffectiveIntent(30, 0)).toBe(30);
  });

  it('reads a display faster than the top as the top', () => {
    expect(autoReadingHz(120, 60)).toBe(60);
    expect(autoReadingHz(90, 60)).toBe(60);
    expect(autoReadingHz(60, 60)).toBe(60);
    expect(autoReadingHz(120, 0)).toBe(120);
  });

  it('under the top the automatic steps go straight to 30 and probe back to the top', () => {
    const hz = autoReadingHz(120, 60);
    expect(autoStepDown(0, hz)).toBe(30);
    expect(autoEffectiveIntent(autoStepUp(30, hz), 60)).toBe(60);
    // Without the top, the same display steps through 60 first.
    expect(autoStepDown(0, 120)).toBe(60);
  });

  it('restores only a remembered ceiling under the top', () => {
    expect(autoRestoresUnderTop(0, 60)).toBe(false);
    expect(autoRestoresUnderTop(60, 60)).toBe(false);
    expect(autoRestoresUnderTop(30, 60)).toBe(true);
    expect(autoRestoresUnderTop(60, 0)).toBe(true);
    expect(autoRestoresUnderTop(30, 0)).toBe(true);
    expect(autoRestoresUnderTop(0, 0)).toBe(false);
  });

  it('skips every other exempt callback on 120 Hz under the top, none on 60 Hz', () => {
    expect(exemptSkipsUnderTop(0, 8.3, 60)).toBe(false);
    expect(exemptSkipsUnderTop(100, 108.3, 60)).toBe(true);
    expect(exemptSkipsUnderTop(100, 116.7, 60)).toBe(false);
    // A 60 Hz slot arriving a little early still renders.
    expect(exemptSkipsUnderTop(100, 115.5, 60)).toBe(false);
    expect(exemptSkipsUnderTop(100, 108.3, 0)).toBe(false);
  });
});
