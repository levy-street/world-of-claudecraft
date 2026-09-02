import { describe, expect, it } from 'vitest';
import {
  CANOPY_FADE_END_AO_ONLY,
  CANOPY_FADE_END_FULL,
  CANOPY_FADE_START,
  CANOPY_TAPS_AO_ONLY,
  CANOPY_TAPS_FULL,
  CANOPY_TAPS_OFF,
  CANOPY_TRIPLANAR_TAPS,
  canopyDetailProfile,
} from '../src/render/canopy_detail_tier_core';
import { gfxInternalsForTest } from '../src/render/gfx';

const TIERS = ['low', 'medium', 'high', 'ultra', 'insane'] as const;
const PHONE = { platform: 'ios' as const };

describe('canopy detail tier profile', () => {
  it('splits the layer into its two triplanar halves', () => {
    expect(CANOPY_TAPS_AO_ONLY).toBe(CANOPY_TRIPLANAR_TAPS);
    expect(CANOPY_TAPS_FULL).toBe(2 * CANOPY_TRIPLANAR_TAPS);
    expect(canopyDetailProfile(CANOPY_TAPS_OFF)).toBeNull();
    expect(canopyDetailProfile(CANOPY_TAPS_AO_ONLY)).toEqual({
      taps: 3,
      normalDetail: false,
      fadeStart: CANOPY_FADE_START,
      fadeEnd: CANOPY_FADE_END_AO_ONLY,
    });
    expect(canopyDetailProfile(CANOPY_TAPS_FULL)).toEqual({
      taps: 6,
      normalDetail: true,
      fadeStart: CANOPY_FADE_START,
      fadeEnd: CANOPY_FADE_END_FULL,
    });
  });

  it('tightens the band with the taps, from the same start', () => {
    const ao = canopyDetailProfile(CANOPY_TAPS_AO_ONLY);
    const full = canopyDetailProfile(CANOPY_TAPS_FULL);
    // Same start: nothing a player sees up close changes on the lighter arm.
    expect(ao?.fadeStart).toBe(full?.fadeStart);
    expect(ao?.fadeEnd).toBeLessThan(full?.fadeEnd ?? 0);
    // A fade that ends before it starts would compile a nonsense smoothstep.
    expect(CANOPY_FADE_START).toBeLessThan(CANOPY_FADE_END_AO_ONLY);
    // The ring the AO-only arm gives up, which is what the cut actually buys.
    const areaShed = 1 - (CANOPY_FADE_END_AO_ONLY / CANOPY_FADE_END_FULL) ** 2;
    expect(areaShed).toBeGreaterThan(0.3);
  });

  it('rounds a stray knob value DOWN onto a shipped rung', () => {
    expect(canopyDetailProfile(0)).toBeNull();
    expect(canopyDetailProfile(2)).toBeNull();
    expect(canopyDetailProfile(-1)).toBeNull();
    expect(canopyDetailProfile(Number.NaN)).toBeNull();
    expect(canopyDetailProfile(5)?.taps).toBe(CANOPY_TAPS_AO_ONLY);
    expect(canopyDetailProfile(99)?.taps).toBe(CANOPY_TAPS_FULL);
  });
});

describe('canopy detail tier ladder', () => {
  it('pins the taps and the band each tier compiles', () => {
    const rows = TIERS.map((tier) => {
      const settings = gfxInternalsForTest.settingsFor(tier);
      const profile = canopyDetailProfile(settings.canopyDetailTaps);
      return [tier, settings.canopyDetailTaps, profile?.fadeEnd ?? null];
    });
    expect(rows).toEqual([
      ['low', 0, null],
      ['medium', 0, null],
      ['high', 0, null],
      ['ultra', 3, CANOPY_FADE_END_AO_ONLY],
      ['insane', 6, CANOPY_FADE_END_FULL],
    ]);
  });

  it('keeps the taps knob and the on/off flag from ever disagreeing', () => {
    // canopy_detail.ts consults both; a tier where one says yes and the other
    // says no would either compile a dead layer or skip a live one.
    for (const tier of TIERS) {
      for (const hints of [undefined, PHONE, { graphicsPreset: 5 }]) {
        const s = gfxInternalsForTest.settingsFor(tier, hints);
        expect(s.canopyDetail, `${tier} ${JSON.stringify(hints ?? null)}`).toBe(
          s.canopyDetailTaps > 0,
        );
      }
    }
  });

  it('never lets a lower tier pay more taps than the one above it', () => {
    const taps = TIERS.map((tier) => gfxInternalsForTest.settingsFor(tier).canopyDetailTaps);
    for (let i = 1; i < taps.length; i++) {
      expect(taps[i], `${TIERS[i]} vs ${TIERS[i - 1]}`).toBeGreaterThanOrEqual(taps[i - 1]);
    }
    // The phone-class memory profile sheds the whole layer on every tier.
    for (const tier of TIERS) {
      expect(gfxInternalsForTest.settingsFor(tier, PHONE).canopyDetailTaps).toBe(CANOPY_TAPS_OFF);
    }
  });

  it('lets the Advanced Foliage Density dial reach both arms', () => {
    const adv = (foliageDensity: number) =>
      gfxInternalsForTest.settingsFor('high', { graphicsPreset: 5, foliageDensity });
    expect(adv(0).canopyDetailTaps).toBe(CANOPY_TAPS_OFF);
    expect(adv(0.5).canopyDetailTaps).toBe(CANOPY_TAPS_OFF);
    expect(adv(1).canopyDetailTaps).toBe(CANOPY_TAPS_AO_ONLY);
    expect(adv(2).canopyDetailTaps).toBe(CANOPY_TAPS_FULL);
  });
});
