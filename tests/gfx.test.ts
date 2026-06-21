import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  configureMaskedDoubleSidedVegetationMaterial,
  forcedTierFromSearch, graphicsPresetLabel, isConstrainedBrowser, isWeakIntegratedGpu,
  shouldUseAutoGovernor, tierFromHints, GFX_BUDGETS, type GfxRuntimeHints,
  GFX_BUCKET_BANDS, gfxInternalsForTest,
} from '../src/render/gfx';

const desktop: GfxRuntimeHints = {
  search: '',
  maxTouchPoints: 0,
  coarsePointer: false,
  narrowViewport: false,
};

describe('graphics tier resolution', () => {
  it('resolves initial renderer startup with no persisted preset to ultra graphics', () => {
    expect(desktop.graphicsPreset).toBeUndefined();
    expect(graphicsPresetLabel(desktop.graphicsPreset)).toBe('ultra');
    expect(tierFromHints(desktop, false)).toBe('ultra');
  });

  it('honors explicit URL tier overrides', () => {
    expect(forcedTierFromSearch('?lowgfx')).toBe('low');
    expect(forcedTierFromSearch('?gfx=low')).toBe('low');
    expect(forcedTierFromSearch('?gfx=medium')).toBe('medium');
    expect(forcedTierFromSearch('?gfx=high')).toBe('high');
    expect(forcedTierFromSearch('?gfx=ultra')).toBe('ultra');
    expect(forcedTierFromSearch('?gfx=banana')).toBe(null);
  });

  it('treats phone-class and low-memory browsers as constrained', () => {
    expect(isConstrainedBrowser({ ...desktop, maxTouchPoints: 1, coarsePointer: true })).toBe(true);
    expect(isConstrainedBrowser({ ...desktop, maxTouchPoints: 1, narrowViewport: true })).toBe(true);
    expect(isConstrainedBrowser({ ...desktop, deviceMemory: 4 })).toBe(true);
    expect(isConstrainedBrowser({ ...desktop, maxTouchPoints: 1 })).toBe(false);
    expect(isConstrainedBrowser(desktop)).toBe(false);
  });

  it('defaults missing presets to ultra while preserving legacy low and forced high', () => {
    expect(tierFromHints(desktop, false)).toBe('ultra');
    expect(tierFromHints({ ...desktop, graphicsPreset: 0 }, false)).toBe('low');
    expect(tierFromHints(desktop, true)).toBe('ultra');
    expect(tierFromHints({ ...desktop, maxTouchPoints: 1, coarsePointer: true }, false)).toBe('ultra');
    expect(tierFromHints({ ...desktop, search: '?gfx=high', maxTouchPoints: 1, coarsePointer: true }, false)).toBe('high');
    expect(tierFromHints({ ...desktop, search: '?gfx=ultra' }, true)).toBe('ultra');
  });

  it('honors persisted presets when the URL does not force a tier', () => {
    expect(tierFromHints({ ...desktop, graphicsPreset: 1 }, false)).toBe('low');
    expect(tierFromHints({ ...desktop, graphicsPreset: 2 }, false)).toBe('medium');
    expect(tierFromHints({ ...desktop, graphicsPreset: 3 }, false)).toBe('high');
    expect(tierFromHints({ ...desktop, graphicsPreset: 4 }, false)).toBe('ultra');
    expect(tierFromHints({ ...desktop, graphicsPreset: 5 }, false)).toBe('high');
    expect(tierFromHints({ ...desktop, search: '?gfx=low', graphicsPreset: 3 }, false)).toBe('low');
  });

  it('labels presets and runs the budget governor unless Ultra or URL-forced', () => {
    expect(graphicsPresetLabel(undefined)).toBe('ultra');
    expect(graphicsPresetLabel(0)).toBe('low');
    expect(graphicsPresetLabel(1)).toBe('low');
    expect(graphicsPresetLabel(2)).toBe('medium');
    expect(graphicsPresetLabel(3)).toBe('high');
    expect(graphicsPresetLabel(4)).toBe('ultra');
    expect(graphicsPresetLabel(5)).toBe('advanced');
    expect(shouldUseAutoGovernor({ search: '', graphicsPreset: 0 })).toBe(true);
    expect(shouldUseAutoGovernor({ search: '', graphicsPreset: undefined })).toBe(false);
    expect(shouldUseAutoGovernor({ search: '', graphicsPreset: 1 })).toBe(true);
    expect(shouldUseAutoGovernor({ search: '', graphicsPreset: 2 })).toBe(true);
    expect(shouldUseAutoGovernor({ search: '', graphicsPreset: 3 })).toBe(true);
    expect(shouldUseAutoGovernor({ search: '', graphicsPreset: 4 })).toBe(false);
    expect(shouldUseAutoGovernor({ search: '', graphicsPreset: 5 })).toBe(true);
    expect(shouldUseAutoGovernor({ search: '?gfx=low', graphicsPreset: 0 })).toBe(true);
    expect(shouldUseAutoGovernor({ search: '?gfx=high', graphicsPreset: 0 })).toBe(true);
    expect(shouldUseAutoGovernor({ search: '?gfx=ultra', graphicsPreset: 0 })).toBe(false);
    expect(shouldUseAutoGovernor({ search: '?gfx=ultra', graphicsPreset: 4 })).toBe(false);
    expect(shouldUseAutoGovernor({ search: '?governor=0', graphicsPreset: 1 })).toBe(false);
    expect(shouldUseAutoGovernor({ search: '?gfx=ultra&governor=1', graphicsPreset: 0 })).toBe(true);
  });

  it('keeps every quality tier bounded by explicit runtime budgets', () => {
    for (const [tier, budget] of Object.entries(GFX_BUDGETS)) {
      expect(budget.targetFps).toBe(60);
      expect(budget.maxRenderScale).toBeLessThanOrEqual(1);
      expect(budget.minRenderScaleDesktop).toBeGreaterThanOrEqual(0.5);
      expect(budget.minRenderScaleMobile).toBeGreaterThanOrEqual(0.5);
      expect(budget.dropFrameMs).toBeLessThan(budget.urgentFrameMs);
      expect(budget.recoverFrameMs).toBeLessThan(budget.dropFrameMs);
      expect(tier).toMatch(/^(low|medium|high|ultra)$/);
    }
  });

  it('defines tunable bucket bands for every quality tier', () => {
    for (const [tier, bands] of Object.entries(GFX_BUCKET_BANDS)) {
      expect(Object.keys(bands).sort()).toEqual([
        'characters',
        'foliage',
        'grass',
        'lighting',
        'materials',
        'props',
        'resolution',
        'ui',
        'vfx',
        'waterSky',
        'weapons',
        'worldStreaming',
      ].sort());
      for (const band of Object.values(bands)) {
        expect(band.min).toBeGreaterThanOrEqual(0);
        expect(band.max).toBeLessThanOrEqual(1);
        expect(band.min).toBeLessThanOrEqual(band.baseline);
        expect(band.baseline).toBeLessThanOrEqual(band.max);
      }
      expect(tier).toMatch(/^(low|medium|high|ultra)$/);
    }
    expect(GFX_BUCKET_BANDS.low.grass.baseline).toBeGreaterThan(GFX_BUCKET_BANDS.low.grass.min);
    expect(GFX_BUCKET_BANDS.low.foliage.baseline).toBeGreaterThan(GFX_BUCKET_BANDS.low.foliage.min);
    expect(GFX_BUCKET_BANDS.low.characters.baseline).toBe(1);
    expect(GFX_BUCKET_BANDS.low.weapons.baseline).toBe(1);
  });

  it('keeps medium as a middle tier while high and ultra retain the premium pipeline', () => {
    const low = gfxInternalsForTest.settingsFor('low');
    const medium = gfxInternalsForTest.settingsFor('medium');
    const mediumIris = gfxInternalsForTest.settingsFor('medium', {
      search: '?gfx=medium',
      gpuRenderer: 'ANGLE (Intel, ANGLE Metal Renderer: Intel(R) Iris(TM) Plus Graphics 655)',
    });
    const high = gfxInternalsForTest.settingsFor('high');
    const ultra = gfxInternalsForTest.settingsFor('ultra');

    expect(low.standardMaterials).toBe(false);
    expect(low.leanFoliage).toBe(true);
    expect(low.lowPlus).toBe(true);
    expect(low.composer).toBe(false);
    expect(low.ao).toBe(false);

    expect(medium.standardMaterials).toBe(true);
    expect(medium.leanFoliage).toBe(false);
    expect(medium.lowPlus).toBe(false);
    expect(mediumIris.standardMaterials).toBe(true);
    expect(mediumIris.leanFoliage).toBe(true);
    expect(mediumIris.lowPlus).toBe(false);
    expect(medium.terrainSplat).toBe(true);
    expect(medium.composer).toBe(false);
    expect(medium.ao).toBe(false);
    expect(medium.shadowMap).toBeGreaterThan(low.shadowMap);
    expect(medium.shadowMap).toBeLessThan(high.shadowMap);
    expect(medium.pixelRatioCap).toBeLessThan(high.pixelRatioCap);

    expect(high.standardMaterials).toBe(true);
    expect(high.composer).toBe(true);
    expect(high.ao).toBe(true);
    expect(high.msaaSamples).toBe(4);
    expect(high.shadowMap).toBe(4096);

    expect(ultra.standardMaterials).toBe(true);
    expect(ultra.composer).toBe(true);
    expect(ultra.ao).toBe(true);
    expect(ultra.msaaSamples).toBe(4);
    expect(ultra.shadowMap).toBe(high.shadowMap);
    expect(ultra.pixelRatioCap).toBeGreaterThan(high.pixelRatioCap);
    expect(GFX_BUCKET_BANDS.ultra.grass.baseline).toBeGreaterThan(GFX_BUCKET_BANDS.high.grass.baseline);
    expect(GFX_BUCKET_BANDS.ultra.foliage.baseline).toBeGreaterThan(GFX_BUCKET_BANDS.high.foliage.baseline);
  });

  it('detects older Intel integrated GPUs without overriding the ultra default', () => {
    expect(isWeakIntegratedGpu('ANGLE (Intel, ANGLE Metal Renderer: Intel(R) Iris(TM) Plus Graphics 655)')).toBe(true);
    expect(isWeakIntegratedGpu('ANGLE (Apple, ANGLE Metal Renderer: Apple M2)')).toBe(false);
    expect(tierFromHints({ ...desktop, gpuRenderer: 'ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics 655)' }, false)).toBe('ultra');
  });

  it('keeps masked double-sided vegetation off the transparent blended path', () => {
    const mat = configureMaskedDoubleSidedVegetationMaterial(new THREE.MeshBasicMaterial({
      alphaTest: 0.3,
      transparent: true,
    }));

    expect(mat.alphaTest).toBe(0.3);
    expect(mat.side).toBe(THREE.DoubleSide);
    expect(mat.transparent).toBe(false);
    expect(mat.forceSinglePass).toBe(true);
    expect(mat.depthTest).toBe(true);
    expect(mat.depthWrite).toBe(true);
  });
});
