// The Thornhollow Fields flag/rune per-frame visual core (src/render/battleground_fx_core.ts):
// the transition classifier that picks celebration bursts, and the carried-lean /
// rune-gem pose math the thin Three consumer (battleground_fx.ts) applies.
import { describe, expect, it } from 'vitest';
import {
  BG_CARRY_BACK,
  BG_CARRY_TILT,
  BG_RUNE_BOB_AMP,
  classifyFlagTransition,
  runeGemPose,
} from '../src/render/battleground_fx_core';

describe('classifyFlagTransition', () => {
  it('maps every state pair to exactly the right burst', () => {
    // First sighting is never a burst: the change was not observed.
    expect(classifyFlagTransition(null, 'home')).toBeNull();
    expect(classifyFlagTransition(null, 'carried')).toBeNull();
    expect(classifyFlagTransition(null, 'dropped')).toBeNull();
    // No-change frames are silent.
    expect(classifyFlagTransition('home', 'home')).toBeNull();
    expect(classifyFlagTransition('carried', 'carried')).toBeNull();
    expect(classifyFlagTransition('dropped', 'dropped')).toBeNull();
    // Into carried: a pickup from the stand or from the ground.
    expect(classifyFlagTransition('home', 'carried')).toBe('pickup');
    expect(classifyFlagTransition('dropped', 'carried')).toBe('pickup');
    // Into home: only a capture ends a carry, only a return ends a drop.
    expect(classifyFlagTransition('carried', 'home')).toBe('capture');
    expect(classifyFlagTransition('dropped', 'home')).toBe('return');
    // A drop plays no burst (the banner + the grounded flag carry the beat).
    expect(classifyFlagTransition('carried', 'dropped')).toBeNull();
    // home -> dropped cannot happen in the sim; the classifier stays silent.
    expect(classifyFlagTransition('home', 'dropped')).toBeNull();
  });
});

describe('pose math', () => {
  it('carried mount: a real tilt and a real back offset, no bob constants', () => {
    expect(BG_CARRY_TILT).toBeGreaterThan(0.3);
    expect(BG_CARRY_TILT).toBeLessThan(1.2);
    expect(BG_CARRY_BACK).toBeGreaterThan(0);
  });

  it('rune gem: spin advances monotonically, hover stays bounded', () => {
    let prevSpin = Number.NEGATIVE_INFINITY;
    for (const t of [0, 0.5, 1, 2, 5, 30]) {
      const pose = runeGemPose(t);
      expect(pose.spin).toBeGreaterThan(prevSpin);
      prevSpin = pose.spin;
      expect(Math.abs(pose.bob)).toBeLessThanOrEqual(BG_RUNE_BOB_AMP + 1e-9);
    }
  });
});
