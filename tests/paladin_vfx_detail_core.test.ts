import { afterEach, describe, expect, it } from 'vitest';
import {
  paladinVfxDetailNow,
  setPaladinVfxDetailForTest,
  setPaladinVfxQuality,
  withPaladinCastDetail,
} from '../src/render/ability_vfx/paladin_vfx_detail';
import {
  PALADIN_FULL_QUALITY_FLOOR,
  paladinDetailCount,
  paladinDetailLinger,
  paladinDetailScale,
  paladinPresetDetail,
  paladinVfxDetail,
} from '../src/render/ability_vfx/paladin_vfx_detail_core';

describe('Paladin VFX detail rule', () => {
  it('maps the effects preset to a detail level: Low minimal, Medium light, High up full', () => {
    expect(paladinPresetDetail('low')).toBe('minimal');
    expect(paladinPresetDetail('medium')).toBe('light');
    expect(paladinPresetDetail('high')).toBe('full');
    expect(paladinPresetDetail('ultra')).toBe('full');
    expect(paladinPresetDetail('insane')).toBe('full');
  });

  it('takes the lowest of preset, live quality and cast budget', () => {
    expect(paladinVfxDetail({ effectsTier: 'ultra', quality: 1 })).toBe('full');
    expect(
      paladinVfxDetail({ effectsTier: 'high', quality: PALADIN_FULL_QUALITY_FLOOR - 0.01 }),
    ).toBe('light');
    expect(paladinVfxDetail({ effectsTier: 'high', quality: 1, castTier: 1 })).toBe('light');
    expect(paladinVfxDetail({ effectsTier: 'ultra', quality: 1, castTier: 2 })).toBe('minimal');
    expect(paladinVfxDetail({ effectsTier: 'medium', quality: 1, castTier: 0 })).toBe('light');
    expect(paladinVfxDetail({ effectsTier: 'medium', quality: 1, castTier: 2 })).toBe('minimal');
    // Low stays minimal however good the scene is; nothing goes below minimal.
    expect(paladinVfxDetail({ effectsTier: 'low', quality: 1, castTier: 0 })).toBe('minimal');
    expect(paladinVfxDetail({ effectsTier: 'low', quality: 0, castTier: 2 })).toBe('minimal');
    // A non-finite quality reads as an unloaded scene, not a degraded one.
    expect(paladinVfxDetail({ effectsTier: 'high', quality: Number.NaN })).toBe('full');
  });

  it('thins an effect on lower tiers without deleting it', () => {
    expect(paladinDetailCount(20, 'full')).toBe(20);
    expect(paladinDetailCount(20, 'light')).toBe(10);
    expect(paladinDetailCount(20, 'minimal')).toBe(6);
    expect(paladinDetailCount(1, 'minimal')).toBe(1);
    expect(paladinDetailCount(0, 'full')).toBe(0);
    expect(paladinDetailLinger(2, 'full')).toBe(2);
    expect(paladinDetailLinger(2, 'minimal')).toBeLessThan(paladinDetailLinger(2, 'light'));
    expect(paladinDetailScale('full')).toMatchObject({ accents: true, secondary: true });
    expect(paladinDetailScale('light')).toMatchObject({ accents: false, secondary: true });
    expect(paladinDetailScale('minimal')).toMatchObject({ accents: false, secondary: false });
  });
});

describe('Paladin VFX detail source', () => {
  afterEach(() => {
    setPaladinVfxDetailForTest(null);
    setPaladinVfxQuality(1);
  });

  it('scopes a cast budget tier to the dispatch it wraps', () => {
    setPaladinVfxQuality(1);
    const ambient = paladinVfxDetailNow();
    const inside = withPaladinCastDetail(2, () => paladinVfxDetailNow());
    expect(inside).toBe('minimal');
    expect(paladinVfxDetailNow()).toBe(ambient);
  });

  it('restores the ambient detail when the dispatch throws', () => {
    const ambient = paladinVfxDetailNow();
    expect(() =>
      withPaladinCastDetail(2, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(paladinVfxDetailNow()).toBe(ambient);
  });

  it('lets a test pin the detail every spawn sees', () => {
    setPaladinVfxDetailForTest('light');
    expect(paladinVfxDetailNow()).toBe('light');
    expect(withPaladinCastDetail(0, () => paladinVfxDetailNow())).toBe('light');
  });
});
