import { describe, expect, it } from 'vitest';
import {
  PERF_ATTRIB_CASES,
  PERF_ATTRIB_COMBINED_CASES,
  PERF_ATTRIB_KNOB_CASES,
} from '../scripts/lib/perf_attrib_plan.mjs';
import { gfxInternalsForTest } from '../src/render/gfx';
import {
  GFX_OVERRIDE_VALUE_KINDS,
  type GfxOverrideKey,
  parseGfxOverride,
} from '../src/render/gfx_override_core';

const EXPECTED_LOW_OVERRIDES = {
  composer: 'composer:0',
  gradePass: 'gradePass:0',
  ao: 'ao:0',
  aoFullRes: 'aoFullRes:0',
  msaaSamples: 'msaaSamples:0',
  bloom: 'bloom:0',
  smaa: 'smaa:0',
  dynamicShadows: 'dynamicShadows:0',
  terrainCastShadows: 'terrainCastShadows:0',
  shadowMap: 'shadowMap:2048',
  surfaceDetail: 'surfaceDetail:0',
  surfaceDetailTaps: 'surfaceDetailTaps:0',
  surfaceDetailClampK: 'surfaceDetailClampK:0',
  terrainRelief: 'terrainRelief:0',
  bladeCarpetRadius: 'bladeCarpetRadius:0',
  cliffScree: 'cliffScree:0',
  canopyDetail: 'canopyDetail:0',
  pixelRatioCap: 'pixelRatioCap:1.48',
  grassRadius: 'grassRadius:80',
  grassStep: 'grassStep:2.05',
  leanFoliage: 'leanFoliage:1',
  standardMaterials: 'standardMaterials:0',
  terrainSplat: 'terrainSplat:0',
  maxPointLights: 'maxPointLights:6',
  farCharacterAnimScale: 'farCharacterAnimScale:1',
};

describe('performance attribution plan', () => {
  it('covers every supported gfxo knob exactly once with its low-preset value', () => {
    expect(Object.fromEntries(PERF_ATTRIB_KNOB_CASES.map((row) => [row.knob, row.gfxo]))).toEqual(
      EXPECTED_LOW_OVERRIDES,
    );
    expect(PERF_ATTRIB_KNOB_CASES.map((row) => row.knob).sort()).toEqual(
      Object.keys(GFX_OVERRIDE_VALUE_KINDS).sort(),
    );

    const low = gfxInternalsForTest.settingsFor('low');
    for (const row of PERF_ATTRIB_KNOB_CASES) {
      const key = row.knob as GfxOverrideKey;
      expect(parseGfxOverride(row.gfxo), row.knob).toEqual({ [key]: low[key] });
    }
  });

  it('pins the required combined rows', () => {
    expect(PERF_ATTRIB_COMBINED_CASES).toEqual([
      { knob: 'post-off', gfxo: 'composer:0' },
      {
        knob: 'shadows-off',
        gfxo: 'dynamicShadows:0,terrainCastShadows:0',
      },
      { knob: 'dpr-low', gfxo: 'pixelRatioCap:1.48' },
    ]);
  });

  it('runs control first, followed by every knob and combined row once', () => {
    expect(PERF_ATTRIB_CASES).toEqual([
      { knob: 'control', gfxo: '' },
      ...PERF_ATTRIB_KNOB_CASES,
      ...PERF_ATTRIB_COMBINED_CASES,
    ]);
    expect(new Set(PERF_ATTRIB_CASES.map((row) => row.knob)).size).toBe(PERF_ATTRIB_CASES.length);
  });
});
