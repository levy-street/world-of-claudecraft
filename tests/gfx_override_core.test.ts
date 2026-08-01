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
  pixelRatioCap: 2.5,
  grassRadius: 82,
  grassStep: 1.8,
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
          'pixelRatioCap:1.48',
          'grassRadius:80',
          'grassStep:2.05',
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
      pixelRatioCap: 1.48,
      grassRadius: 80,
      grassStep: 2.05,
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

    expect(hashes).toEqual({
      low: 'e300c8365d0cb6689c198796a350949e929e8ee0ef79e7b0497f6d3e9ba9e3b8',
      medium: '892d0127aa4b348dcdd2746398dd602df81df6d4f1a6272722d32b1f55ef0ac0',
      high: '98b97c6a77a8b684b32d5df741893457a198b54f26c88a5457f42070a3967212',
      ultra: '381c1d4d87ad4f019a8660bd6a840efc462c808da80b8081292dd502e5462a1f',
      insane: '717d895218db192a1e6e95c9f2b1acddf56264df660cacd2e9e894ab394b9169',
      advanced: 'a4001e70e5bed5e9ca886d801130a48636fd15a433adad2db1d65bbcbcad953d',
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
