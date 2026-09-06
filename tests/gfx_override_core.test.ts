import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { gfxInternalsForTest } from '../src/render/gfx';
import {
  applyGfxOverridesFromSearch,
  GFX_OVERRIDE_VALUE_KINDS,
  type GfxOverrideSettings,
  parseGfxOverride,
} from '../src/render/gfx_override_core';

const settings = {
  composer: true,
  gradePass: true,
  ao: true,
  aoFullRes: true,
  msaaSamples: 4,
  bloom: true,
  smaa: false,
  fxaa: true,
  dynamicShadows: true,
  terrainCastShadows: true,
  shadowMap: 4096,
  surfaceDetail: true,
  surfaceDetailTaps: 4,
  surfaceDetailClampK: 1,
  terrainRelief: 3,
  bladeCarpetRadius: 34,
  cliffScree: true,
  canopyDetail: true,
  canopyDetailTaps: 6,
  pixelRatioCap: 2.5,
  grassRadius: 82,
  grassStep: 1.8,
  grassCardsPerTuft: 4,
  leanFoliage: false,
  standardMaterials: true,
  terrainSplat: true,
  maxPointLights: 6,
  farCharacterAnimScale: 1.55,
} satisfies GfxOverrideSettings;

describe('gfx override parsing', () => {
  it('parses every supported boolean and numeric setting', () => {
    expect(
      parseGfxOverride(
        [
          'composer:0',
          'gradePass:0',
          'ao:0',
          'aoFullRes:0',
          'msaaSamples:0',
          'bloom:0',
          'smaa:1',
          'fxaa:0',
          'dynamicShadows:0',
          'terrainCastShadows:0',
          'shadowMap:2048',
          'surfaceDetail:0',
          'surfaceDetailTaps:0',
          'surfaceDetailClampK:0.65',
          'terrainRelief:2',
          'bladeCarpetRadius:24',
          'cliffScree:0',
          'canopyDetail:0',
          'canopyDetailTaps:3',
          'pixelRatioCap:1.48',
          'grassRadius:80',
          'grassStep:2.05',
          'grassCardsPerTuft:3',
          'leanFoliage:1',
          'standardMaterials:0',
          'terrainSplat:0',
          'maxPointLights:3',
          'farCharacterAnimScale:1',
        ].join(','),
      ),
    ).toEqual({
      composer: false,
      gradePass: false,
      ao: false,
      aoFullRes: false,
      msaaSamples: 0,
      bloom: false,
      smaa: true,
      fxaa: false,
      dynamicShadows: false,
      terrainCastShadows: false,
      shadowMap: 2048,
      surfaceDetail: false,
      surfaceDetailTaps: 0,
      surfaceDetailClampK: 0.65,
      terrainRelief: 2,
      bladeCarpetRadius: 24,
      cliffScree: false,
      canopyDetail: false,
      canopyDetailTaps: 3,
      pixelRatioCap: 1.48,
      grassRadius: 80,
      grassStep: 2.05,
      grassCardsPerTuft: 3,
      leanFoliage: true,
      standardMaterials: false,
      terrainSplat: false,
      maxPointLights: 3,
      farCharacterAnimScale: 1,
    });
  });

  it('accepts only 0 or 1 for booleans and ignores unknown or non-finite values', () => {
    expect(
      parseGfxOverride('composer:true,ao:2,shadowMap:Infinity,grassStep:NaN,unknown:1,__proto__:1'),
    ).toEqual({});
  });

  it('accepts both boolean values for every boolean key', () => {
    const booleanKeys = Object.entries(GFX_OVERRIDE_VALUE_KINDS)
      .filter(([, kind]) => kind === 'boolean')
      .map(([key]) => key);

    for (const key of booleanKeys) {
      expect(parseGfxOverride(`${key}:0`), key).toEqual({ [key]: false });
      expect(parseGfxOverride(`${key}:1`), key).toEqual({ [key]: true });
    }
  });

  it('ignores malformed tokens and empty numeric values', () => {
    expect(parseGfxOverride('missing-colon,:1,ao:,shadowMap:,grassStep:')).toEqual({});
  });

  it('uses the last valid value when a key is repeated', () => {
    expect(parseGfxOverride('ao:0,ao:no,ao:1,shadowMap:1024,shadowMap:2048')).toEqual({
      ao: true,
      shadowMap: 2048,
    });
  });
});

describe('gfx override application', () => {
  it('pins no-gfxo derived settings bytes for every preset profile', () => {
    const cases = {
      low: gfxInternalsForTest.settingsFor('low'),
      medium: gfxInternalsForTest.settingsFor('medium'),
      high: gfxInternalsForTest.settingsFor('high'),
      ultra: gfxInternalsForTest.settingsFor('ultra'),
      insane: gfxInternalsForTest.settingsFor('insane'),
      advanced: gfxInternalsForTest.settingsFor('high', { graphicsPreset: 5 }),
    };
    const hashes = Object.fromEntries(
      Object.entries(cases).map(([preset, derived]) => [
        preset,
        createHash('sha256').update(JSON.stringify(derived)).digest('hex'),
      ]),
    );

    // Regenerated for the GfxSettings.nativeIosMemoryProfile -> iosMemoryProfile rename (the
    // field now covers every iOS WebKit host, not just the packaged native app; see gfx.ts).
    // Only the serialized KEY NAME moves for these desktop-default cases (none of them pass an
    // iOS platform hint, so the field's VALUE stays false throughout), but JSON.stringify bakes
    // the key name into the byte pin same as any other field.
    // Regenerated again for the C1 memory-ratchet fix: the desktop
    // maxPooledCharacterVisuals arm moved from POSITIVE_INFINITY (which
    // JSON.stringify serializes as null) to the bounded 128 (see gfx.ts and
    // tests/character_visual_pool.test.ts), so every desktop-default profile's
    // serialized bytes moved by exactly that one value.
    // The low row alone was regenerated once more when the desktop-client
    // branch merged: its phase 5 low retune (bands/caps/grassRadius 72,
    // characters floor 0.86, pinned per-axis by
    // tests/gfx_low_monotonicity.test.ts) stacks on top of the C1 value, so
    // low hashes differently from the release row while the other five match
    // it byte for byte.
    // Regenerated across the board for the denseDressing field (the dressing
    // compensation cohort: lowPlus plus the leanFoliage medium session; see
    // gfx.ts and tests/gfx.test.ts). Its VALUE is false for every
    // desktop-default case here, only the serialized key name moves the bytes.
    // Regenerated across the board for the `fxaa` field (edge AA fused into the
    // output grade pass; see gfx_aa_policy_core.ts). Unlike the renames above
    // this one moves a VALUE too: medium and the Advanced grade-only mix are
    // the profiles the new AA policy grants it to, and low/high/ultra/insane
    // move only by the serialized key name.
    // The HIGH row alone moved once more when the high tier's shadowMap
    // dropped from 4096 to the 2560 working map (see gfx.ts and
    // tests/gfx.test.ts). advanced did NOT move, which is the check that the
    // dial's top rung still writes 4096 explicitly instead of inheriting the
    // new high base.
    // Regenerated across the board for `grassCardsPerTuft`, the grass tuft's
    // card count (grass_tuft_cards_core.ts). This one moves a VALUE on every
    // row: 2 on low, 3 on medium and high, 4 on ultra, insane and the
    // Advanced default mix. The ladder itself is pinned by name in
    // tests/gfx.test.ts and tests/grass_tuft_cards_core.test.ts; this row is
    // the byte guard that says nothing ELSE moved with it.
    // Regenerated across the board again for `canopyDetailTaps`, the canopy
    // clump layer's per-tier tap count (canopy_detail_tier_core.ts): 0 below
    // ultra, 3 on ultra and the Advanced default mix, 6 on insane. Named pins
    // for it live in tests/gfx.test.ts and
    // tests/canopy_detail_tier_core.test.ts.
    expect(hashes).toEqual({
      low: '1b4559cd53dfa04a243eabb5bb01d2843cf7a0a9a2205e02110910e37cd6f42f',
      medium: '3c859917380988dde4dc455aea2efb3391e987e952b64f039e973308ead2ad21',
      high: '287d510dd2ec26b7ae8c8d7fa9f1642ae2cedef3ec86dcae897535952d501017',
      ultra: 'b64b55668c28b2d0eaaa95580885b4276e99b2aa95f6777303922a6cf2116f22',
      insane: '7ec7889501315477ef4f107088b0f618dd16d7c40e9ccb9712b27d5d8a3d93e3',
      advanced: '7d357c28f5aa9b54c6190a1e12dd274c0a05c0b804ac349990a6a50f768f5da1',
    });
  });

  it('keeps settings byte-identical and returns the same object when gfxo is absent', () => {
    const derived = gfxInternalsForTest.settingsFor('insane', {
      search: '?perf&gfx=insane',
    });
    const before = JSON.stringify(derived);
    const applied = applyGfxOverridesFromSearch(derived, '?perf&gfx=insane');

    expect(applied).toBe(derived);
    expect(JSON.stringify(applied)).toBe(before);
  });

  it('returns the same object when gfxo contains no valid override', () => {
    expect(applyGfxOverridesFromSearch(settings, '?gfxo=unknown%3A1')).toBe(settings);
  });

  it('applies decoded comma-separated overrides without changing unrelated fields', () => {
    const applied = applyGfxOverridesFromSearch(
      settings,
      '?gfxo=dynamicShadows%3A0%2CshadowMap%3A2048%2CpixelRatioCap%3A1.48',
    );

    expect(applied).not.toBe(settings);
    expect(applied).toEqual({
      ...settings,
      dynamicShadows: false,
      shadowMap: 2048,
      pixelRatioCap: 1.48,
    });
  });

  it('runs after Advanced and tier settings are fully derived', () => {
    const derived = gfxInternalsForTest.settingsFor('high', {
      graphicsPreset: 5,
      foliageDensity: 2,
      surfaceDetail: 2,
      search: '?gfx=high&gfxo=bladeCarpetRadius:7,surfaceDetailTaps:1',
    });

    expect(derived.bladeCarpetRadius).toBe(7);
    expect(derived.surfaceDetailTaps).toBe(1);
    expect(derived.surfaceDetail).toBe(true);
    expect(derived.tier).toBe('high');
  });
});
