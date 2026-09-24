import { describe, expect, it } from 'vitest';
import {
  hoardEntranceProfile,
  hoardMotePose,
  hoardRevealPose,
  hoardRimScale,
  hoardTerrainSample,
} from '../src/render/hoard_entrance_core';

describe('unearthed hatch presentation', () => {
  it('rises deterministically and pauses trajectories under reduced motion', () => {
    const pose = { x: 0, y: 0, z: 0, scale: 0 };
    const first = { ...hoardMotePose(1, 0, 8, false, pose) };
    expect(hoardMotePose(1, 1, 8, false, pose).y).toBeGreaterThan(first.y);
    expect(hoardMotePose(1, 99, 8, true, pose)).toEqual(first);
    expect(hoardMotePose(1, 99, 8, true, pose)).toBe(pose);
  });
  it('uses item-quality rarity colours and increasing distance cues', () => {
    const profiles = (['common', 'rare', 'epic', 'legendary'] as const).map((r) =>
      hoardEntranceProfile(r, 'ultra'),
    );
    expect(profiles.map((p) => p.color)).toEqual([0x1eff00, 0x0070dd, 0xa335ee, 0xff8000]);
    for (let i = 1; i < profiles.length; i++) {
      expect(profiles[i].motes).toBeGreaterThan(profiles[i - 1].motes);
      expect(profiles[i].shaftHeight).toBeGreaterThan(profiles[i - 1].shaftHeight);
    }
  });
  it('Low removes only expensive decoration, retaining rarity identity', () => {
    for (const rarity of ['common', 'rare', 'epic', 'legendary'] as const) {
      const low = hoardEntranceProfile(rarity, 'low');
      expect(low.color).toBe(hoardEntranceProfile(rarity, 'ultra').color);
      expect(low).toMatchObject({
        motes: 0,
        shaftHeight: 0,
        glow: false,
        rarity,
      });
    }
  });
  it('opens over one second, with the light following the hatch', () => {
    expect(hoardRevealPose(0)).toEqual({ hatch: 0, light: 0, earth: 0 });
    expect(hoardRevealPose(0.25).hatch).toBeGreaterThan(0);
    expect(hoardRevealPose(0.25).light).toBe(0);
    expect(hoardRevealPose(1)).toMatchObject({ hatch: 1, light: 1 });
    expect(hoardRevealPose(30)).toMatchObject({ hatch: 1, light: 1 });
    expect(hoardRevealPose(0, true)).toMatchObject({ hatch: 1, light: 1 });
  });
  it('only legendary pulses and respects reduced motion', () => {
    expect(hoardRimScale('common', 1, false)).toBe(1);
    expect(hoardRimScale('legendary', 1, false)).toBeGreaterThan(1);
    expect(hoardRimScale('legendary', 1, true)).toBe(1);
  });
  it('samples the rotated world footprint instead of an unrotated slope', () => {
    const sample = hoardTerrainSample(10, 20, Math.PI / 2, 2, 3);
    expect(sample.x).toBeCloseTo(13);
    expect(sample.z).toBeCloseTo(18);
  });
});
