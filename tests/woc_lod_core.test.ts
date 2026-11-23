// Which geometry level a WOC character draws (src/render/characters/woc_lod_core.ts): every
// preset, device class and detail.
import { describe, expect, it } from 'vitest';
import type { WocArmorDetail } from '../src/render/characters/woc_armor_core';
import { WOC_FAR_BAKE_LOD, wocLodLevelFor } from '../src/render/characters/woc_lod_core';

const TIERS = ['low', 'medium', 'high', 'ultra'] as const;
const DETAILS: readonly WocArmorDetail[] = ['full', 'crowd'];

describe('wocLodLevelFor', () => {
  it('draws mid for everyone on the low preset, the local player included', () => {
    for (const detail of DETAILS) {
      expect(wocLodLevelFor({ tier: 'low', constrainedMemory: false }, detail), detail).toBe('mid');
    }
  });

  it('draws mid for everyone on a phone, whatever preset it runs', () => {
    for (const tier of TIERS) {
      for (const detail of DETAILS) {
        expect(wocLodLevelFor({ tier, constrainedMemory: true }, detail), `${tier}/${detail}`).toBe(
          'mid',
        );
      }
    }
  });

  it('draws level 0 for full detail and mid for the crowd on every other preset', () => {
    for (const tier of ['medium', 'high', 'ultra'] as const) {
      const profile = { tier, constrainedMemory: false };
      expect(wocLodLevelFor(profile, 'full'), tier).toBe('lod0');
      expect(wocLodLevelFor(profile, 'crowd'), tier).toBe('mid');
    }
  });

  it('defaults to full detail (a body built directly)', () => {
    expect(wocLodLevelFor({ tier: 'high', constrainedMemory: false })).toBe('lod0');
  });

  it('never draws the far level up close: that is the far bake alone', () => {
    for (const tier of TIERS) {
      for (const constrainedMemory of [false, true]) {
        for (const detail of DETAILS) {
          expect(wocLodLevelFor({ tier, constrainedMemory }, detail)).not.toBe('far');
        }
      }
    }
    expect(WOC_FAR_BAKE_LOD).toBe('far');
  });
});
