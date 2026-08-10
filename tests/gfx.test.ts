import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEVICE_MEMORY_GB_KEY, ENTRY_TIGHT_MODE_KEY } from '../src/device_memory_hint';
import { NAMEPLATE_INTERVAL_LOW_SEC, nameplateIntervalSec } from '../src/game/ui_tier_knobs';
import { FAR_ANIM_RANGE_SCALE_MAX } from '../src/render/crowd_lod';
import {
  classifyGpuRenderer,
  configureMaskedDoubleSidedVegetationMaterial,
  firstRunGraphicsPreset,
  forcedTierFromSearch,
  GFX_BUCKET_BANDS,
  GFX_BUDGETS,
  type GfxRuntimeHints,
  gfxInternalsForTest,
  graphicsPresetLabel,
  isConstrainedBrowser,
  isSoftwareGL,
  isWeakIntegratedGpu,
  resolveDefaultGraphicsPreset,
  shouldUseAutoGovernor,
  tierFromHints,
} from '../src/render/gfx';

const desktop: GfxRuntimeHints = {
  search: '',
  maxTouchPoints: 0,
  coarsePointer: false,
  narrowViewport: false,
};

describe('graphics tier resolution', () => {
  it('resolves an unset preset device-aware, matching the medium data-fx-level fallback', () => {
    // The 3D tier (tierFromHints) and the HUD data-fx-level (graphicsPresetLabel(settings def))
    // must agree on the unset/first-run default so they never diverge. An unrecognized device
    // falls to MEDIUM on BOTH paths (settings.ts graphicsPreset def is 2 = medium); the old code
    // fell back to ultra here while the HUD stayed medium, which this guards against.
    expect(desktop.graphicsPreset).toBeUndefined();
    expect(tierFromHints(desktop, false)).toBe('medium'); // unknown GPU -> medium fallback
    expect(graphicsPresetLabel(2)).toBe('medium'); // settings def -> same tier, no divergence
    // A recognized strong desktop GPU lifts the unset 3D tier to ultra...
    expect(
      tierFromHints({ ...desktop, gpuRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080)' }, false),
    ).toBe('ultra');
    // ...and a recognized weak GPU drops it to low (the cost ceiling), not the old ultra default.
    expect(tierFromHints({ ...desktop, gpuRenderer: 'Adreno (TM) 330' }, false)).toBe('low');
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
    expect(
      isConstrainedBrowser({
        ...desktop,
        maxTouchPoints: 1,
        coarsePointer: true,
      }),
    ).toBe(true);
    expect(
      isConstrainedBrowser({
        ...desktop,
        maxTouchPoints: 1,
        narrowViewport: true,
      }),
    ).toBe(true);
    expect(isConstrainedBrowser({ ...desktop, deviceMemory: 4 })).toBe(true);
    expect(isConstrainedBrowser({ ...desktop, maxTouchPoints: 1 })).toBe(false);
    expect(isConstrainedBrowser(desktop)).toBe(false);
  });

  it('resolves an unset preset by device, honoring legacy explicit values and URL force', () => {
    expect(tierFromHints(desktop, false)).toBe('medium'); // unknown device -> medium fallback
    expect(tierFromHints({ ...desktop, graphicsPreset: 0 }, false)).toBe('low'); // legacy explicit 0
    expect(tierFromHints(desktop, true)).toBe('low'); // software GL with no preset -> low floor
    // unset + any touch device -> low (the mobile entry-memory floor; never the old unset ->
    // ultra default, and no longer the medium an unknown phone used to land on)
    expect(tierFromHints({ ...desktop, maxTouchPoints: 1, coarsePointer: true }, false)).toBe(
      'low',
    );
    // a URL-forced tier always wins, even on a touch device or software GL
    expect(
      tierFromHints(
        {
          ...desktop,
          search: '?gfx=high',
          maxTouchPoints: 1,
          coarsePointer: true,
        },
        false,
      ),
    ).toBe('high');
    expect(tierFromHints({ ...desktop, search: '?gfx=ultra' }, true)).toBe('ultra');
  });

  it('honors persisted presets when the URL does not force a tier', () => {
    expect(tierFromHints({ ...desktop, graphicsPreset: 1 }, false)).toBe('low');
    expect(tierFromHints({ ...desktop, graphicsPreset: 2 }, false)).toBe('medium');
    expect(tierFromHints({ ...desktop, graphicsPreset: 3 }, false)).toBe('high');
    expect(tierFromHints({ ...desktop, graphicsPreset: 4 }, false)).toBe('ultra');
    expect(tierFromHints({ ...desktop, graphicsPreset: 5 }, false)).toBe('high');
    expect(tierFromHints({ ...desktop, graphicsPreset: 6 }, false)).toBe('insane');
    expect(tierFromHints({ ...desktop, search: '?gfx=low', graphicsPreset: 3 }, false)).toBe('low');
    expect(tierFromHints({ ...desktop, search: '?gfx=insane' }, false)).toBe('insane');
    expect(forcedTierFromSearch('?gfx=insane')).toBe('insane');
  });

  it('labels presets and runs the budget governor on every tier by default', () => {
    expect(graphicsPresetLabel(undefined)).toBe('ultra');
    expect(graphicsPresetLabel(0)).toBe('low');
    expect(graphicsPresetLabel(1)).toBe('low');
    expect(graphicsPresetLabel(2)).toBe('medium');
    expect(graphicsPresetLabel(3)).toBe('high');
    expect(graphicsPresetLabel(4)).toBe('ultra');
    expect(graphicsPresetLabel(5)).toBe('advanced');
    expect(graphicsPresetLabel(6)).toBe('insane');
    // The governor follows the RESOLVED tier and stays armed on every tier. Ultra and insane use
    // loose budgets so a transient dip cannot fight the selected preset.
    expect(shouldUseAutoGovernor('low', '')).toBe(true);
    expect(shouldUseAutoGovernor('medium', '')).toBe(true);
    expect(shouldUseAutoGovernor('high', '')).toBe(true);
    expect(shouldUseAutoGovernor('ultra', '')).toBe(true);
    expect(shouldUseAutoGovernor('insane', '')).toBe(true);
    // The URL governor override beats the tier.
    expect(shouldUseAutoGovernor('ultra', '?gfx=ultra&governor=1')).toBe(true);
    expect(shouldUseAutoGovernor('low', '?governor=0')).toBe(false);
    expect(shouldUseAutoGovernor('ultra', '?gfx=ultra')).toBe(true);
    expect(shouldUseAutoGovernor('ultra', '?gfx=ultra&governor=0')).toBe(false);
  });

  it('keeps every quality tier bounded by explicit runtime budgets', () => {
    for (const [tier, budget] of Object.entries(GFX_BUDGETS)) {
      expect(budget.targetFps).toBe(60);
      expect(budget.maxRenderScale).toBeLessThanOrEqual(1);
      expect(budget.minRenderScaleDesktop).toBeGreaterThanOrEqual(0.5);
      expect(budget.minRenderScaleMobile).toBeGreaterThanOrEqual(0.5);
      expect(budget.dropFrameMs).toBeLessThan(budget.urgentFrameMs);
      expect(budget.recoverFrameMs).toBeLessThan(budget.dropFrameMs);
      expect(tier).toMatch(/^(low|medium|high|ultra|insane)$/);
    }
    // Premium tiers use literal-pinned disaster thresholds. High reacts at 22/32ms, while
    // ultra and insane wait for sustained 30ms pressure or a 44ms urgent frame.
    expect(GFX_BUDGETS.high.dropFrameMs).toBe(22);
    expect(GFX_BUDGETS.high.urgentFrameMs).toBe(32);
    expect(GFX_BUDGETS.ultra.dropFrameMs).toBe(30);
    expect(GFX_BUDGETS.ultra.urgentFrameMs).toBe(44);
    expect(GFX_BUDGETS.insane.dropFrameMs).toBe(30);
    expect(GFX_BUDGETS.insane.urgentFrameMs).toBe(44);
  });

  it('defines tunable bucket bands for every quality tier', () => {
    for (const [tier, bands] of Object.entries(GFX_BUCKET_BANDS)) {
      expect(Object.keys(bands).sort()).toEqual(
        [
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
        ].sort(),
      );
      for (const band of Object.values(bands)) {
        expect(band.min).toBeGreaterThanOrEqual(0);
        expect(band.max).toBeLessThanOrEqual(1);
        expect(band.min).toBeLessThanOrEqual(band.baseline);
        expect(band.baseline).toBeLessThanOrEqual(band.max);
      }
      expect(tier).toMatch(/^(low|medium|high|ultra|insane)$/);
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
    expect(low.dynamicShadows).toBe(false);
    expect(low.leanFoliage).toBe(true);
    expect(low.lowPlus).toBe(true);
    expect(low.composer).toBe(false);
    expect(low.ao).toBe(false);

    expect(medium.standardMaterials).toBe(true);
    expect(medium.dynamicShadows).toBe(true);
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
    expect(medium.msaaSamples).toBe(0);
    expect(medium.smaa).toBe(false);

    expect(high.standardMaterials).toBe(true);
    expect(high.dynamicShadows).toBe(true);
    expect(high.composer).toBe(true);
    expect(high.ao).toBe(true);
    expect(high.msaaSamples).toBe(0);
    expect(high.smaa).toBe(true);
    expect(high.shadowMap).toBe(4096);

    expect(ultra.standardMaterials).toBe(true);
    expect(ultra.composer).toBe(true);
    expect(ultra.ao).toBe(true);
    expect(ultra.msaaSamples).toBe(0);
    expect(ultra.smaa).toBe(true);
    expect(ultra.shadowMap).toBe(high.shadowMap);
    expect(ultra.pixelRatioCap).toBe(high.pixelRatioCap);
    expect(GFX_BUCKET_BANDS.ultra.grass.baseline).toBeGreaterThan(
      GFX_BUCKET_BANDS.high.grass.baseline,
    );
    expect(GFX_BUCKET_BANDS.ultra.foliage.baseline).toBeGreaterThan(
      GFX_BUCKET_BANDS.high.foliage.baseline,
    );
  });

  it('insane is the everything-on tier above ultra, and only ever a manual opt-in', () => {
    const high = gfxInternalsForTest.settingsFor('high');
    const ultra = gfxInternalsForTest.settingsFor('ultra');
    const insane = gfxInternalsForTest.settingsFor('insane');
    // Full premium pipeline, matching ultra's knobs (the tiers differ inside
    // the render layers: worn-stone taps, terrain micro-shadow).
    expect(insane.standardMaterials).toBe(true);
    expect(insane.composer).toBe(true);
    expect(insane.ao).toBe(true);
    expect(insane.gradePass).toBe(true);
    expect(insane.msaaSamples).toBe(0);
    expect(insane.smaa).toBe(true);
    expect(insane.shadowMap).toBe(ultra.shadowMap);
    expect(insane.pixelRatioCap).toBe(ultra.pixelRatioCap);
    expect(insane.grassRadius).toBe(ultra.grassRadius);
    expect(insane.grassStep).toBe(ultra.grassStep);
    expect(
      ['low', 'medium', 'high', 'ultra', 'insane'].map(
        (tier) =>
          gfxInternalsForTest.settingsFor(tier as 'low' | 'medium' | 'high' | 'ultra' | 'insane')
            .farGrassDensityFloor,
      ),
    ).toEqual([0.55, 0.62, 0.7, 0.75, 0.8]);
    expect(insane.terrainSplat).toBe(true);
    expect(insane.leanFoliage).toBe(false);
    // The round-10 detail-layer ladder: High takes the coherent Advanced-Medium
    // profile to recover its steady frame cost, while Ultra and Insane keep the
    // full fixed detail layers. Advanced can still opt into every level.
    const medium = gfxInternalsForTest.settingsFor('medium');
    for (const below of [gfxInternalsForTest.settingsFor('low'), medium]) {
      expect(below.surfaceDetail).toBe(false);
      expect(below.surfaceDetailTaps).toBe(0);
      expect(below.bladeCarpetRadius).toBe(0);
      expect(below.cliffScree).toBe(false);
      expect(below.canopyDetail).toBe(false);
      expect(below.terrainRelief).toBe(0);
    }
    expect(high.surfaceDetail).toBe(true);
    expect(high.surfaceDetailTaps).toBe(0);
    expect(high.surfaceDetailClampK).toBe(0);
    expect(high.bladeCarpetRadius).toBe(24);
    expect(high.cliffScree).toBe(false);
    expect(high.canopyDetail).toBe(false);
    expect(high.terrainRelief).toBe(1);
    for (const tier of [ultra, insane]) {
      expect(tier.surfaceDetail).toBe(true);
      expect(tier.bladeCarpetRadius).toBe(34);
      expect(tier.cliffScree).toBe(true);
      expect(tier.canopyDetail).toBe(true);
      expect(tier.bloom).toBe(true);
    }
    expect(ultra.surfaceDetailTaps).toBe(3);
    expect(ultra.surfaceDetailClampK).toBe(0.85);
    expect(insane.surfaceDetailTaps).toBe(4);
    expect(insane.surfaceDetailClampK).toBe(1);
    expect(ultra.terrainRelief).toBe(3);
    expect(insane.terrainRelief).toBe(3);
    expect(high.aoFullRes).toBe(false);
    expect(ultra.aoFullRes).toBe(true);
    expect(insane.aoFullRes).toBe(true);
    expect(high.smaa).toBe(true);
    // Hardware detection can never land on insane: the strongest recognized
    // desktop resolves to ultra (4); insane is a manual choice only.
    expect(
      resolveDefaultGraphicsPreset({
        ...desktop,
        deviceMemory: 8,
        hardwareConcurrency: 16,
        gpuRenderer: 'NVIDIA GeForce RTX 4090',
      }),
    ).toBe(4);
  });

  it('the advanced sub-setting ladders map onto the same tier knobs, back-compatibly', () => {
    const adv = (overrides: Partial<GfxRuntimeHints>) =>
      gfxInternalsForTest.settingsFor('high', { graphicsPreset: 5, ...overrides });
    // Historical binary values keep their meaning: 0 is Low, 1 is High.
    const legacyLowTerrain = adv({ terrainDetail: 0 });
    expect(legacyLowTerrain.terrainSplat).toBe(false);
    expect(legacyLowTerrain.terrainRelief).toBe(0);
    expect(adv({ terrainDetail: 1 }).terrainRelief).toBe(2);
    // The new levels: Medium (0.5) buys cavity-only relief, Insane (2) the
    // ultra micro-shadow execution.
    expect(adv({ terrainDetail: 0.5 }).terrainRelief).toBe(1);
    expect(adv({ terrainDetail: 2 }).terrainRelief).toBe(3);
    // Foliage: Low keeps the historical sparse tufts and sheds the overhaul
    // layers; Medium buys the reduced carpet; Insane extends the ring.
    const foliageLow = adv({ foliageDensity: 0 });
    expect(foliageLow.grassStep).toBe(3.8);
    expect(foliageLow.farGrassDensityFloor).toBe(0.5);
    expect(foliageLow.bladeCarpetRadius).toBe(0);
    expect(foliageLow.cliffScree).toBe(false);
    expect(foliageLow.canopyDetail).toBe(false);
    const foliageMedium = adv({ foliageDensity: 0.5 });
    expect(foliageMedium.farGrassDensityFloor).toBe(0.62);
    expect(foliageMedium.bladeCarpetRadius).toBe(24);
    expect(foliageMedium.cliffScree).toBe(false);
    const foliageHigh = adv({ foliageDensity: 1 });
    expect(foliageHigh.bladeCarpetRadius).toBe(34);
    expect(foliageHigh.cliffScree).toBe(true);
    expect(foliageHigh.canopyDetail).toBe(true);
    expect(adv({ foliageDensity: 2 }).bladeCarpetRadius).toBe(40);
    expect(adv({ foliageDensity: 2 }).farGrassDensityFloor).toBe(0.85);
    // Surface Detail (the town-cost dial): Off / Basic / Full / Insane.
    const surfaceOff = adv({ surfaceDetail: 0 });
    expect(surfaceOff.surfaceDetail).toBe(false);
    expect(surfaceOff.surfaceDetailTaps).toBe(0);
    const surfaceBasic = adv({ surfaceDetail: 0.5 });
    expect(surfaceBasic.surfaceDetail).toBe(true);
    expect(surfaceBasic.surfaceDetailTaps).toBe(0);
    expect(adv({ surfaceDetail: 1 }).surfaceDetailTaps).toBe(3);
    expect(adv({ surfaceDetail: 1 }).surfaceDetailClampK).toBe(0.85);
    expect(adv({ surfaceDetail: 2 }).surfaceDetailTaps).toBe(4);
    expect(adv({ surfaceDetail: 2 }).surfaceDetailClampK).toBe(1);
    // Effects & Lighting: Low is the grade-only mini composer; Medium adds
    // N8AO without bloom/SMAA; High keeps the full high-tier stack.
    const effectsLow = adv({ effectsQuality: 0 });
    expect(effectsLow.composer).toBe(false);
    expect(effectsLow.gradePass).toBe(true);
    expect(effectsLow.ao).toBe(false);
    expect(effectsLow.msaaSamples).toBe(0);
    expect(effectsLow.smaa).toBe(false);
    const effectsMedium = adv({ effectsQuality: 0.5 });
    expect(effectsMedium.ao).toBe(true);
    expect(effectsMedium.bloom).toBe(false);
    expect(effectsMedium.smaa).toBe(false);
    const effectsHigh = adv({ effectsQuality: 1 });
    expect(effectsHigh.ao).toBe(true);
    expect(effectsHigh.bloom).toBe(true);
    expect(effectsHigh.smaa).toBe(true);
    // Shadows: pure map-size steps; terrain-cast joins at High.
    expect(adv({ shadowQuality: 0 }).shadowMap).toBe(1024);
    expect(adv({ shadowQuality: 0 }).terrainCastShadows).toBe(false);
    expect(adv({ shadowQuality: 0.5 }).shadowMap).toBe(2560);
    expect(adv({ shadowQuality: 1 }).shadowMap).toBe(4096);
    expect(adv({ shadowQuality: 1 }).terrainCastShadows).toBe(true);
    expect(adv({ shadowQuality: 2 }).shadowMap).toBe(8192);
  });

  it('sheds the memory-spike knobs on constrained (phone-class) browsers, cosmetics only', () => {
    // A phone-class hint set (touch + coarse pointer): matches iOS WebKit, whose
    // per-process memory ceiling kills the WebContent process at world entry.
    const phone = {
      maxTouchPoints: 5,
      coarsePointer: true,
      narrowViewport: true,
    };
    const medium = gfxInternalsForTest.settingsFor('medium', phone);
    const high = gfxInternalsForTest.settingsFor('high', phone);
    const ultra = gfxInternalsForTest.settingsFor('ultra', phone);
    const desktopMedium = gfxInternalsForTest.settingsFor('medium');
    const desktopHigh = gfxInternalsForTest.settingsFor('high');

    expect(medium.constrainedMemory).toBe(true);
    expect(desktopMedium.constrainedMemory).toBe(false);
    expect(medium.dynamicShadows).toBe(false);
    expect(high.dynamicShadows).toBe(false);
    expect(ultra.dynamicShadows).toBe(false);
    expect(desktopMedium.dynamicShadows).toBe(true);

    // The big one-shot GPU allocations shrink...
    expect(medium.shadowMap).toBe(1536);
    expect(high.shadowMap).toBe(2048);
    expect(ultra.shadowMap).toBe(2048);
    expect(high.msaaSamples).toBe(0);
    expect(ultra.msaaSamples).toBe(0);
    expect(high.pixelRatioCap).toBe(1.48);
    expect(ultra.pixelRatioCap).toBe(1.48);

    // ...while actionable information remains untouched (fairness rule). The constrained
    // profile keeps the Medium material/terrain identity and all entity visibility, while
    // shedding cosmetic shadow and grass work that duplicates millions of triangles.
    expect(medium.standardMaterials).toBe(desktopMedium.standardMaterials);
    expect(medium.terrainSplat).toBe(desktopMedium.terrainSplat);
    expect(medium.leanFoliage).toBe(false);
    expect(medium.grassRadius).toBe(62);
    expect(medium.grassStep).toBe(2.35);
    expect(medium.farGrassDensityFloor).toBe(0.55);
    expect(medium.maxPointLights).toBe(3);
    expect(high.composer).toBe(desktopHigh.composer);
    expect(high.ao).toBe(desktopHigh.ao);

    // Low deviceMemory alone (Chromium's clamped signal) also lands constrained.
    const lowMem = gfxInternalsForTest.settingsFor('medium', {
      maxTouchPoints: 0,
      coarsePointer: false,
      narrowViewport: false,
      deviceMemory: 4,
    });
    expect(lowMem.constrainedMemory).toBe(true);
    expect(lowMem.dynamicShadows).toBe(false);
    expect(lowMem.shadowMap).toBe(1536);
    expect(lowMem.leanFoliage).toBe(false);
    expect(lowMem.grassRadius).toBe(62);
    expect(lowMem.grassStep).toBe(2.35);
    expect(lowMem.maxPointLights).toBe(3);
  });

  it('uses the bounded-residency renderer profile on EVERY iOS WebKit host, not just the packaged native app', () => {
    const nativeIos = {
      maxTouchPoints: 5,
      coarsePointer: true,
      narrowViewport: true,
      nativeApp: true,
      platform: 'ios' as const,
    };
    const medium = gfxInternalsForTest.settingsFor('medium', nativeIos);
    const high = gfxInternalsForTest.settingsFor('high', nativeIos);
    // iOS Safari (or any other iOS browser): platform 'ios', but NOT the packaged
    // native shell. Regression coverage for the bug this file used to pin as correct:
    // Mobile Safari and the native WKWebView shell run the same WebKit engine under
    // the same per-process WebContent memory ceiling (see safeStartupGraphicsPreset's
    // isIosWebkit and the sibling tightMemoryProfile rung below, both of which already
    // treated Safari and native identically), so gating this profile on `nativeApp`
    // left every plain-browser iOS session - i.e. most iOS players - eagerly loading
    // full-residency assets under the exact same ceiling the native app was bounded
    // against, and crashing under ordinary play.
    const mobileWeb = gfxInternalsForTest.settingsFor('medium', {
      ...nativeIos,
      nativeApp: false,
    });
    const nativeAndroid = gfxInternalsForTest.settingsFor('medium', {
      ...nativeIos,
      platform: 'android',
    });

    expect(medium.tier).toBe('medium');
    expect(medium.iosMemoryProfile).toBe(true);
    expect(medium.standardMaterials).toBe(false);
    expect(medium.lowPlus).toBe(true);
    // Collision-bearing tree/rock placement stays identical to other Medium clients.
    expect(medium.leanFoliage).toBe(false);
    expect(medium.terrainSplat).toBe(false);
    expect(medium.composer).toBe(false);
    expect(medium.ao).toBe(false);
    expect(medium.dynamicShadows).toBe(false);
    expect(medium.msaaSamples).toBe(0);
    expect(medium.shadowMap).toBe(1024);
    expect(medium.pixelRatioCap).toBeLessThanOrEqual(1.25);
    expect(medium.grassRadius).toBeLessThan(62);
    expect(medium.grassStep).toBeGreaterThan(2.35);
    expect(medium.farGrassDensityFloor).toBe(0.5);
    expect(medium.maxPointLights).toBe(2);
    expect(medium.maxPooledCharacterVisuals).toBe(6);

    // Higher labels can retain their density/bucket progression, but they must not
    // re-enable WKWebView's unbounded GPU-residency features.
    expect(high.iosMemoryProfile).toBe(true);
    expect(high.standardMaterials).toBe(false);
    expect(high.terrainSplat).toBe(false);
    expect(high.composer).toBe(false);
    expect(high.dynamicShadows).toBe(false);

    // iOS Safari now gets EXACTLY the native app's bounded-residency profile: same flag,
    // same knobs, byte for byte. Only the platform check (`platform === 'ios'`) decides
    // this, never `nativeApp`.
    expect(mobileWeb.iosMemoryProfile).toBe(true);
    expect(mobileWeb).toEqual(medium);
    // Android stays on the generic cross-platform constrainedMemory tier: this profile
    // (and its extra streamed-asset/quality knobs) is iOS WebKit specific.
    expect(nativeAndroid.iosMemoryProfile).toBe(false);
    expect(nativeAndroid.standardMaterials).toBe(true);
    // A touch/coarse-pointer device is `constrainedMemory` regardless of platform (see
    // isConstrainedBrowser), so Android still falls onto the SAME bounded reuse-pool tier
    // every other mobile budget in this function already uses (maxPointLights above), not
    // the desktop-only POSITIVE_INFINITY.
    expect(nativeAndroid.maxPooledCharacterVisuals).toBe(24);
    expect(nativeAndroid.maxPooledObjects).toBe(24);
    // mobileWeb gets the TIGHTER iosMemoryProfile pool cap (6), not the generic
    // constrainedMemory cap (24) Android and pre-fix Safari used to share.
    expect(mobileWeb.maxPooledCharacterVisuals).toBe(6);
    expect(mobileWeb.maxPooledObjects).toBe(6);
  });

  it('bounds the pooled-visual and pooled-object reuse caps on every constrained-memory device, never just the two narrow iOS profiles', () => {
    const desktop = gfxInternalsForTest.settingsFor('high');
    const androidBrowser = gfxInternalsForTest.settingsFor('high', {
      maxTouchPoints: 5,
      coarsePointer: true,
      narrowViewport: true,
      nativeApp: false,
      platform: 'android' as const,
    });
    const androidNative = gfxInternalsForTest.settingsFor('high', {
      maxTouchPoints: 5,
      coarsePointer: true,
      narrowViewport: true,
      nativeApp: true,
      platform: 'android' as const,
    });

    expect(desktop.constrainedMemory).toBe(false);
    // The character pool is bounded on EVERY profile since the C1 memory-ratchet
    // fix (128 on desktop, LRU-evicted; see tests/character_visual_pool.test.ts);
    // only the ground-object pool keeps the historical desktop Infinity.
    expect(desktop.maxPooledCharacterVisuals).toBe(128);
    expect(desktop.maxPooledObjects).toBe(Number.POSITIVE_INFINITY);

    for (const constrained of [androidBrowser, androidNative]) {
      expect(constrained.constrainedMemory).toBe(true);
      expect(constrained.maxPooledCharacterVisuals).toBe(24);
      expect(Number.isFinite(constrained.maxPooledCharacterVisuals)).toBe(true);
      expect(constrained.maxPooledObjects).toBe(24);
      expect(Number.isFinite(constrained.maxPooledObjects)).toBe(true);
    }
  });

  it('applies the 4 GB-class tight-memory rung to native iOS and recovered iOS web', () => {
    const nativeIos = {
      maxTouchPoints: 5,
      coarsePointer: true,
      narrowViewport: true,
      nativeApp: true,
      platform: 'ios' as const,
    };
    const tight = gfxInternalsForTest.settingsFor('medium', { ...nativeIos, tightMemory: true });
    const standard = gfxInternalsForTest.settingsFor('medium', nativeIos);
    const tightWeb = gfxInternalsForTest.settingsFor('medium', {
      ...nativeIos,
      nativeApp: false,
      tightMemory: true,
    });
    const tightAndroid = gfxInternalsForTest.settingsFor('medium', {
      ...nativeIos,
      platform: 'android',
      tightMemory: true,
    });

    expect(tight.tightMemory).toBe(true);
    expect(tight.pixelRatioCap).toBe(1.0);
    // Reuses the Advanced sub-knob's lean grass values (34 / 3.8): the leanest
    // grass the game already ships, so the rung adds no new visual floor.
    expect(tight.grassRadius).toBe(34);
    expect(tight.grassStep).toBe(3.8);
    expect(tight.maxPooledCharacterVisuals).toBe(4);
    // Collision-bearing tree/rock placement fairness holds on the tight rung too.
    expect(tight.leanFoliage).toBe(false);
    expect(tight.iosMemoryProfile).toBe(true);

    // Without the hint the standard native profile is exactly what it was: a
    // device the shell cannot measure keeps today's behaviour, byte for byte.
    expect(standard.tightMemory).toBe(false);
    expect(standard.pixelRatioCap).toBe(1.25);
    expect(standard.grassRadius).toBe(52);
    expect(standard.grassStep).toBe(2.75);
    expect(standard.maxPooledCharacterVisuals).toBe(6);

    // A foreground entry crash also stamps the marker for iOS Safari, which
    // shares WKWebView's WebContent memory ceiling and needs the same lower rung.
    expect(tightWeb.tightMemory).toBe(true);
    expect(tightWeb.pixelRatioCap).toBe(1.0);
    expect(tightAndroid.tightMemory).toBe(false);
  });

  it('carries cached memory and recovery markers into the synchronous runtime hints', () => {
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const values = new Map<string, string>([
      [DEVICE_MEMORY_GB_KEY, '4'],
      [ENTRY_TIGHT_MODE_KEY, JSON.stringify({ at: Date.now() })],
    ]);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
        removeItem: (key: string) => void values.delete(key),
      },
    });
    try {
      expect(gfxInternalsForTest.runtimeHints().tightMemory).toBe(true);
    } finally {
      if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });

  it('never raises the native iOS light bound from an Advanced low-effects override', () => {
    const advanced = gfxInternalsForTest.settingsFor('high', {
      maxTouchPoints: 5,
      coarsePointer: true,
      narrowViewport: true,
      nativeApp: true,
      platform: 'ios',
      graphicsPreset: 5,
      effectsQuality: 0,
    });
    expect(advanced.maxPointLights).toBe(2);
  });

  it('routes Advanced low effects through the low static effects tier', () => {
    const low = gfxInternalsForTest.settingsFor('low', {
      graphicsPreset: 1,
      effectsQuality: 1,
    });
    const advancedLow = gfxInternalsForTest.settingsFor('high', {
      graphicsPreset: 5,
      effectsQuality: 0.49,
    });
    const advancedFull = gfxInternalsForTest.settingsFor('high', {
      graphicsPreset: 5,
      effectsQuality: 0.5,
    });

    expect(low.effectsTier).toBe('low');
    expect(advancedLow.effectsTier).toBe('low');
    expect(advancedFull.effectsTier).toBe('high');
  });

  it('detects the packaged runtime platform from shipping navigator values', () => {
    expect(
      gfxInternalsForTest.mobilePlatformFromNavigator({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
        platform: 'iPhone',
        maxTouchPoints: 5,
      }),
    ).toBe('ios');
    expect(
      gfxInternalsForTest.mobilePlatformFromNavigator({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      }),
    ).toBe('ios');
    expect(
      gfxInternalsForTest.mobilePlatformFromNavigator({
        userAgent: 'Mozilla/5.0 (Linux; Android 16)',
        platform: 'Linux armv8l',
        maxTouchPoints: 5,
      }),
    ).toBe('android');
    expect(
      gfxInternalsForTest.mobilePlatformFromNavigator({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)',
        platform: 'MacIntel',
        maxTouchPoints: 0,
      }),
    ).toBe('other');

    const source = readFileSync(new URL('../src/render/gfx.ts', import.meta.url), 'utf8');
    expect(source).toContain('nativeApp: NATIVE_APP');
    expect(source).toContain('platform: mobilePlatformFromNavigator(nav)');
  });

  it('detects older Intel integrated GPUs and lows the unset 3D tier instead of defaulting ultra', () => {
    expect(
      isWeakIntegratedGpu(
        'ANGLE (Intel, ANGLE Metal Renderer: Intel(R) Iris(TM) Plus Graphics 655)',
      ),
    ).toBe(true);
    expect(isWeakIntegratedGpu('ANGLE (Apple, ANGLE Metal Renderer: Apple M2)')).toBe(false);
    // A recognized weak iGPU with no explicit preset now resolves the 3D tier to LOW (the cost
    // ceiling), instead of the old unset -> ultra default that ignored the GPU string entirely.
    expect(
      tierFromHints(
        {
          ...desktop,
          gpuRenderer: 'ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics 655)',
        },
        false,
      ),
    ).toBe('low');
  });

  it('classifies GPU renderer strings into device-capability buckets', () => {
    expect(classifyGpuRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080)')).toBe('strongDesktop');
    // Apple Silicon is its own class (split from strongDesktop) so it can default to the safe
    // middle rather than ultra on thermally constrained MacBooks (issue 1676).
    expect(classifyGpuRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M2)')).toBe(
      'appleSilicon',
    );
    expect(classifyGpuRenderer('Apple M1 Pro')).toBe('appleSilicon');
    // AMD discrete + Intel Arc desktop -> strongDesktop (the "(TM)" Windows drivers print is tolerated)
    expect(classifyGpuRenderer('ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0)')).toBe(
      'strongDesktop',
    );
    expect(classifyGpuRenderer('AMD Radeon(TM) RX 580')).toBe('strongDesktop');
    expect(classifyGpuRenderer('ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics)')).toBe(
      'strongDesktop',
    );
    expect(classifyGpuRenderer('Adreno (TM) 730')).toBe('flagshipMobile');
    expect(classifyGpuRenderer('Mali-G715')).toBe('flagshipMobile');
    expect(classifyGpuRenderer('Apple A17 Pro GPU')).toBe('flagshipMobile');
    // software rasterizers -> software. The bare "software" token stays in lockstep with
    // isSoftwareGL so a string like "Apple Software Renderer" lows BOTH the 3D tier and the HUD
    // data-fx-level (never one low, one medium).
    expect(classifyGpuRenderer('Google SwiftShader')).toBe('software');
    expect(classifyGpuRenderer('Mesa llvmpipe (LLVM 15.0.7, 256 bits)')).toBe('software');
    expect(classifyGpuRenderer('Apple Software Renderer')).toBe('software');
    // WARP, the Windows D3D11 software fallback Chromium 141 switched to after removing the
    // SwiftShader WebGL path: caught via its "Microsoft Basic Render" tokens, not a bare "warp".
    expect(
      classifyGpuRenderer(
        'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)',
      ),
    ).toBe('software');
    // the codebase's named weak-integrated parts stay weak (checked before mid-integrated)
    expect(classifyGpuRenderer('ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics 655)')).toBe('weak');
    expect(classifyGpuRenderer('Adreno (TM) 330')).toBe('weak');
    expect(classifyGpuRenderer('PowerVR SGX 544')).toBe('weak');
    // entry-level Mali Valhall (G51/G52) are weak (NOT shadowed by the mid Mali clause) -> LOW
    expect(classifyGpuRenderer('Mali-G51')).toBe('weak');
    expect(classifyGpuRenderer('Mali-G52')).toBe('weak');
    // older Intel UHD desktop iGPU stays weak; the modern UHD 7xx desktop part is mid
    expect(classifyGpuRenderer('ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11)')).toBe('weak');
    expect(classifyGpuRenderer('ANGLE (Intel, Intel(R) UHD Graphics 770)')).toBe('midIntegrated');
    // newer integrated + mid mobile -> their own buckets (the MEDIUM path)
    expect(classifyGpuRenderer('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics)')).toBe(
      'midIntegrated',
    );
    // AMD Ryzen iGPUs print "(TM)" in Chrome's ANGLE string; both forms bucket midIntegrated
    expect(classifyGpuRenderer('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11)')).toBe(
      'midIntegrated',
    );
    expect(classifyGpuRenderer('ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics)')).toBe(
      'midIntegrated',
    );
    expect(classifyGpuRenderer('AMD Radeon Vega 8 Graphics')).toBe('midIntegrated');
    expect(classifyGpuRenderer('Mali-G57')).toBe('midMobile');
    // masked / unplaced / empty -> unknown -> the MEDIUM fallback path
    expect(classifyGpuRenderer('Apple GPU')).toBe('unknown');
    expect(classifyGpuRenderer(undefined)).toBe('unknown');
    expect(classifyGpuRenderer('')).toBe('unknown');
  });

  it('isSoftwareGL reads the live GL context and flags WARP + SwiftShader, not a real GPU', () => {
    const fakeRenderer = (rendererString: string): THREE.WebGLRenderer => {
      const getParameter = vi.fn(() => rendererString);
      const getExtension = vi.fn((name: string) =>
        name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null,
      );
      const gl = { getExtension, getParameter };
      return { getContext: () => gl } as unknown as THREE.WebGLRenderer;
    };
    // WARP is now caught here too (the narrow /swiftshader|llvmpipe|software/ used to miss it).
    expect(
      isSoftwareGL(
        fakeRenderer('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)'),
      ),
    ).toBe(true);
    expect(isSoftwareGL(fakeRenderer('Google SwiftShader'))).toBe(true);
    expect(isSoftwareGL(fakeRenderer('Mesa/X.org llvmpipe (LLVM 15.0.6, 256 bits)'))).toBe(true);
    expect(isSoftwareGL(fakeRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080)'))).toBe(false);
  });

  describe('resolveDefaultGraphicsPreset: device-aware first-run default (medium fallback)', () => {
    // preset numbers: 1 low, 2 medium, 3 high, 4 ultra (never 5/advanced as an auto-default).
    const phone: GfxRuntimeHints = {
      ...desktop,
      maxTouchPoints: 5,
      coarsePointer: true,
    };

    it('falls back to MEDIUM for a masked/unknown or mid GPU with no corroborating signal', () => {
      expect(resolveDefaultGraphicsPreset(desktop)).toBe(2); // no GPU/mem/cores -> medium
      expect(resolveDefaultGraphicsPreset({ ...desktop, gpuRenderer: 'Apple GPU' })).toBe(2); // masked
      expect(
        resolveDefaultGraphicsPreset({
          ...desktop,
          gpuRenderer: 'Intel Iris Xe',
        }),
      ).toBe(2); // mid
      // AMD Ryzen iGPU desktop (ample RAM + cores) must bucket midIntegrated -> MEDIUM, NOT be
      // promoted to HIGH via the unknown-desktop branch (the "(TM)" misclassification regression).
      expect(
        resolveDefaultGraphicsPreset({
          ...desktop,
          gpuRenderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11)',
          deviceMemory: 8,
          hardwareConcurrency: 16,
        }),
      ).toBe(2);
    });

    it('drops a software or weak GPU to LOW (only the GPU class can low, never RAM/cores)', () => {
      expect(
        resolveDefaultGraphicsPreset({
          ...desktop,
          gpuRenderer: 'Google SwiftShader',
        }),
      ).toBe(1);
      // a bare "software" renderer (e.g. Apple's GPU-disabled fallback) lows on BOTH paths, even on
      // a Chrome box with ample mem+cores (where the old asymmetry would have persisted it HIGH).
      expect(
        resolveDefaultGraphicsPreset({
          ...desktop,
          gpuRenderer: 'Apple Software Renderer',
          deviceMemory: 8,
          hardwareConcurrency: 16,
        }),
      ).toBe(1);
      expect(tierFromHints({ ...desktop, gpuRenderer: 'Apple Software Renderer' }, false)).toBe(
        'low',
      );
      expect(
        resolveDefaultGraphicsPreset({
          ...desktop,
          gpuRenderer: 'Adreno (TM) 330',
        }),
      ).toBe(1);
      // entry-level Mali-G52 budget phone -> LOW (must not be shadowed into the mid Mali bucket)
      expect(resolveDefaultGraphicsPreset({ ...phone, gpuRenderer: 'Mali-G52' })).toBe(1);
      // PITFALL 1: a thin RAM/core count NEVER pulls a tier down (a flagship iPhone reports
      // cores=2 / mem=undefined); an unknown GPU with low mem+cores stays MEDIUM, not low.
      expect(resolveDefaultGraphicsPreset({ ...desktop, deviceMemory: 2 })).toBe(2);
      expect(
        resolveDefaultGraphicsPreset({
          ...desktop,
          deviceMemory: 4,
          hardwareConcurrency: 2,
        }),
      ).toBe(2);
    });

    it('floors EVERY touch device at LOW, whatever its GPU class reports', () => {
      // The world-entry scene build's peak memory footprint, not the frame rate, is what the
      // mobile default protects: phone-class WebKit kills the WebContent process when the tab
      // crosses its per-process ceiling, and the tier the build runs at is what decides that
      // footprint. So detection may never hand a touch device anything above the floor.
      expect(
        resolveDefaultGraphicsPreset({
          ...phone,
          gpuRenderer: 'Adreno (TM) 740',
          deviceMemory: 8,
        }),
      ).toBe(1); // flagship phone, previously HIGH
      // an M-series iPad (Apple Silicon on a touch device), previously HIGH
      expect(resolveDefaultGraphicsPreset({ ...phone, gpuRenderer: 'Apple M2' })).toBe(1);
      // a desktop-class discrete GPU string on a touch device, previously HIGH
      expect(
        resolveDefaultGraphicsPreset({
          ...phone,
          gpuRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080)',
          deviceMemory: 8,
          hardwareConcurrency: 16,
        }),
      ).toBe(1);
      expect(
        resolveDefaultGraphicsPreset({
          ...phone,
          gpuRenderer: 'Adreno (TM) 330',
        }),
      ).toBe(1); // old phone
      expect(resolveDefaultGraphicsPreset(phone)).toBe(1); // typical/masked phone, previously MEDIUM
      // narrowViewport is the other half of the touch check: a coarse-pointer-less touch device
      // on a narrow viewport is still mobile, so it floors too.
      expect(
        resolveDefaultGraphicsPreset({
          ...desktop,
          maxTouchPoints: 5,
          narrowViewport: true,
          gpuRenderer: 'Apple M2',
        }),
      ).toBe(1);
    });

    it('leaves the DESKTOP ladder untouched: no-touch devices keep their historical tiers', () => {
      // The mobile floor keys off the touch check ALONE, so a device reporting no touch points
      // must be unaffected, including a mobile-flagship GPU string (Android TV box, emulation).
      expect(resolveDefaultGraphicsPreset({ ...desktop, gpuRenderer: 'Adreno (TM) 740' })).toBe(3);
      expect(resolveDefaultGraphicsPreset({ ...desktop, gpuRenderer: 'Apple M2' })).toBe(2);
      expect(resolveDefaultGraphicsPreset(desktop)).toBe(2);
      // a touchscreen laptop (touch points, but a fine pointer on a wide viewport) is NOT mobile
      expect(
        resolveDefaultGraphicsPreset({
          ...desktop,
          maxTouchPoints: 10,
          gpuRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080)',
          deviceMemory: 8,
          hardwareConcurrency: 16,
        }),
      ).toBe(4);
    });

    it('makes every mobile result CONCLUSIVE, so first run persists it instead of re-detecting', () => {
      // firstRunGraphicsPreset persists what resolveDefaultGraphicsPreset returns unless it is
      // MEDIUM, the inconclusive fallback it deliberately leaves unpinned to re-detect on later
      // boots. The mobile floor must therefore never resolve to MEDIUM, or a phone would be
      // re-detected every boot and never carry a persisted preset at all.
      for (const gpuRenderer of [undefined, 'Apple M2', 'Adreno (TM) 740', 'Mali-G52']) {
        expect(resolveDefaultGraphicsPreset({ ...phone, gpuRenderer })).not.toBe(2);
      }
      // and the marker still short-circuits ahead of any detection, so a later explicit player
      // choice is never re-detected over.
      expect(firstRunGraphicsPreset(true)).toBeNull();
    });

    it('lands the unset-preset mobile RENDER tier on low too, matching the persisted preset', () => {
      // tierFromHints shares resolveDefaultGraphicsPreset, so the 3D tier and the data-fx-level
      // stamp agree on a first boot before main.ts has persisted anything.
      expect(tierFromHints({ ...phone, gpuRenderer: 'Apple M2' }, false)).toBe('low');
      expect(tierFromHints(phone, false)).toBe('low');
      // an EXPLICIT stored preset still wins on mobile: the floor is a default, not a cap.
      expect(tierFromHints({ ...phone, gpuRenderer: 'Apple M2', graphicsPreset: 3 }, false)).toBe(
        'high',
      );
    });

    it('floors a REPORTED tight-memory mobile device at LOW, and every other phone with it', () => {
      // #2955 added this as a memory-gated floor: a flagship-class mobile GPU paired with a
      // genuine 3-4 GB total RAM budget is a common real Android configuration, and the world's
      // baseline texture/geometry residency alone on HIGH is large enough to cross the OS's
      // per-tab memory ceiling during ordinary play, reported upstream as "randomly disconnects
      // no matter the network." Those cases still floor; the blanket mobile floor now subsumes
      // them, which is why the cases that used to sit just OUTSIDE the memory gate floor too.
      expect(
        resolveDefaultGraphicsPreset({
          ...phone,
          gpuRenderer: 'Adreno (TM) 740', // flagship: HIGH before either floor
          deviceMemory: 3,
        }),
      ).toBe(1);
      expect(
        resolveDefaultGraphicsPreset({
          ...phone,
          gpuRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080)', // strongDesktop-on-touch
          deviceMemory: 4,
        }),
      ).toBe(1);
      // At the old TIGHT_MEMORY_MAX_GB threshold and one above it: both floor now. The threshold
      // is no longer load-bearing for the preset, since ample RAM does not buy a phone a tier.
      expect(
        resolveDefaultGraphicsPreset({ ...phone, gpuRenderer: 'Adreno (TM) 740', deviceMemory: 4 }),
      ).toBe(1);
      // One above the tight-memory threshold is still LOW because the mobile
      // first-run floor is broader than the RAM-only emergency cap.
      expect(
        resolveDefaultGraphicsPreset({ ...phone, gpuRenderer: 'Adreno (TM) 740', deviceMemory: 5 }),
      ).toBe(1);
      // Never fires on desktop (not mobile) even at the same low deviceMemory: PITFALL 1's
      // "thin RAM never pulls a tier down" rule still holds for the GPU-capability ladder.
      expect(resolveDefaultGraphicsPreset({ ...desktop, deviceMemory: 3 })).toBe(2);
      // Unreported memory (Safari/Firefox) must not fabricate a tight-memory reason, but the
      // broader mobile first-run floor still covers iOS/WebKit, whose process kill is most brutal.
      expect(resolveDefaultGraphicsPreset({ ...phone, gpuRenderer: 'Apple A17 Pro GPU' })).toBe(1);
    });

    it('defaults Apple Silicon Macs to MEDIUM, not ultra (thermally constrained laptops, issue 1676)', () => {
      // A MacBook (Apple Silicon on a non-touch device) with ample RAM+cores would have earned
      // ULTRA under the old strongDesktop bucket; it now defaults to the safe middle so the fanless
      // form factor does not sit pinned at ultra. Ample corroborating signal must NOT promote it.
      for (const gpuRenderer of ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2)', 'Apple M3 Max']) {
        expect(
          resolveDefaultGraphicsPreset({
            ...desktop,
            gpuRenderer,
            deviceMemory: 8,
            hardwareConcurrency: 16,
          }),
        ).toBe(2);
      }
      // Non-regression: a real strong desktop discrete GPU still reaches ULTRA (the split did not
      // demote NVIDIA/AMD/Arc).
      expect(
        resolveDefaultGraphicsPreset({
          ...desktop,
          gpuRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080)',
          deviceMemory: 8,
          hardwareConcurrency: 16,
        }),
      ).toBe(4);
    });

    it('rewards a strong desktop: ULTRA with a corroborating signal (or unreported mem), else HIGH', () => {
      const rtx = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080)';
      expect(
        resolveDefaultGraphicsPreset({
          ...desktop,
          gpuRenderer: rtx,
          deviceMemory: 8,
          hardwareConcurrency: 16,
        }),
      ).toBe(4);
      // mem unreported (Firefox) with a recognized strong GPU still earns ULTRA
      expect(resolveDefaultGraphicsPreset({ ...desktop, gpuRenderer: rtx })).toBe(4);
      // a strong GPU but a present, sub-threshold mem+cores -> HIGH (corroboration absent)
      expect(
        resolveDefaultGraphicsPreset({
          ...desktop,
          gpuRenderer: rtx,
          deviceMemory: 4,
          hardwareConcurrency: 4,
        }),
      ).toBe(3);
    });

    it('raises an unknown desktop GPU to HIGH only with ample RAM AND cores', () => {
      expect(
        resolveDefaultGraphicsPreset({
          ...desktop,
          deviceMemory: 8,
          hardwareConcurrency: 12,
        }),
      ).toBe(3);
      // ample on only one axis is not enough for the unknown bucket -> MEDIUM
      expect(
        resolveDefaultGraphicsPreset({
          ...desktop,
          deviceMemory: 8,
          hardwareConcurrency: 4,
        }),
      ).toBe(2);
    });

    it('a software/weak device lands on LOW, restoring the 1/15s nameplate cost ceiling', () => {
      // The whole point of the default: a weak device -> low preset -> the data-fx-level low
      // tier -> the restored nameplate staleness ceiling (the PR901 weak-GPU mitigation).
      const preset = resolveDefaultGraphicsPreset({
        ...desktop,
        gpuRenderer: 'Google SwiftShader',
      });
      expect(preset).toBe(1);
      const label = graphicsPresetLabel(preset);
      expect(label).toBe('low');
      expect(nameplateIntervalSec(label as 'low')).toBe(NAMEPLATE_INTERVAL_LOW_SEC);
    });
  });

  describe('firstRunGraphicsPreset: device default applied at most once, never over a choice', () => {
    function stubGpu(renderer: string | undefined): void {
      gfxInternalsForTest.resetGpuRendererProbe();
      const getParameter = vi.fn(() => renderer);
      const getExtension = vi.fn((name: string) =>
        name === 'WEBGL_lose_context'
          ? { loseContext: vi.fn() }
          : { UNMASKED_RENDERER_WEBGL: 0x9246 },
      );
      const getContext = vi.fn(() =>
        renderer === undefined ? null : { getExtension, getParameter },
      );
      vi.stubGlobal('document', {
        createElement: vi.fn(() => ({ getContext })),
      });
    }
    afterEach(() => {
      vi.unstubAllGlobals();
      gfxInternalsForTest.resetGpuRendererProbe();
    });

    it('returns null once a device default has been applied (never re-detects over a choice)', () => {
      stubGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080)');
      expect(firstRunGraphicsPreset(true)).toBeNull();
    });

    it('detects a recognized desktop GPU on first run, gated by the marker not the preset key', () => {
      // The gate is the dedicated marker arg, NOT the graphicsPreset key (which Settings.save()
      // def-fills the moment any setting is stored), so a strong desktop still resolves to a real
      // high-or-ultra tier on first run even after an unrelated setting has been persisted.
      stubGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080)');
      const preset = firstRunGraphicsPreset(false);
      expect(preset).not.toBeNull();
      expect(preset).toBeGreaterThanOrEqual(3); // high or ultra, never the medium fallback
    });

    it('leaves a masked/inconclusive device unpersisted (null) so it re-detects later', () => {
      stubGpu('Apple GPU'); // masked -> unknown -> medium fallback -> null (not persisted, re-probed next boot)
      expect(firstRunGraphicsPreset(false)).toBeNull();
    });
  });

  describe('probeGpuRenderer: one cached probe, context released (PR901 exhaustion guard)', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      gfxInternalsForTest.resetGpuRendererProbe();
    });

    it('creates exactly one WebGL context, loses it, and memoizes the renderer string', () => {
      gfxInternalsForTest.resetGpuRendererProbe();
      const loseContext = vi.fn();
      const getParameter = vi.fn(() => 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080)');
      const getExtension = vi.fn((name: string) =>
        name === 'WEBGL_lose_context' ? { loseContext } : { UNMASKED_RENDERER_WEBGL: 0x9246 },
      );
      const getContext = vi.fn(() => ({ getExtension, getParameter }));
      const createElement = vi.fn(() => ({ getContext }));
      vi.stubGlobal('document', { createElement });

      const first = gfxInternalsForTest.probeGpuRenderer();
      const second = gfxInternalsForTest.probeGpuRenderer();

      expect(first).toBe('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080)');
      expect(second).toBe(first);
      // Memoized: only the first call probes; the rest reuse the cached string.
      expect(createElement).toHaveBeenCalledTimes(1);
      expect(getContext).toHaveBeenCalledTimes(1);
      // The throwaway probe context is released instead of left to leak (PR901).
      expect(loseContext).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps masked double-sided vegetation off the transparent blended path', () => {
    const mat = configureMaskedDoubleSidedVegetationMaterial(
      new THREE.MeshBasicMaterial({
        alphaTest: 0.3,
        transparent: true,
      }),
    );

    expect(mat.alphaTest).toBe(0.3);
    expect(mat.side).toBe(THREE.DoubleSide);
    expect(mat.transparent).toBe(false);
    expect(mat.forceSinglePass).toBe(true);
    expect(mat.depthTest).toBe(true);
    expect(mat.depthWrite).toBe(true);
  });
});

// The animated far character band (crowd_lod.ts) is skinning + draw-call cost, so
// its per-tier ceiling opts out exactly where extra rigs are unaffordable. A tier
// that silently regained the extension would push articulated rigs out to ~75yd on
// software GL and phone WebKit, which is the profile the frozen far mesh exists for.
describe('animated far character band: per-tier ceiling', () => {
  it('opts the low tier and software GL out (straight-to-frozen far LOD)', () => {
    expect(gfxInternalsForTest.settingsFor('low', desktop).farCharacterAnimScale).toBe(1);
  });

  it('extends the band on the desktop tiers', () => {
    for (const tier of ['medium', 'high', 'ultra'] as const) {
      const scale = gfxInternalsForTest.settingsFor(tier, desktop).farCharacterAnimScale;
      expect(scale).toBe(FAR_ANIM_RANGE_SCALE_MAX);
      expect(scale).toBeGreaterThan(1);
    }
  });

  it('opts the phone memory profiles out on every tier', () => {
    const nativeIos: GfxRuntimeHints = {
      search: '',
      maxTouchPoints: 5,
      coarsePointer: true,
      narrowViewport: true,
      nativeApp: true,
      platform: 'ios',
    };
    const constrained: GfxRuntimeHints = { ...nativeIos, nativeApp: false, deviceMemory: 2 };
    for (const tier of ['medium', 'high', 'ultra'] as const) {
      expect(gfxInternalsForTest.settingsFor(tier, nativeIos).farCharacterAnimScale).toBe(1);
      expect(gfxInternalsForTest.settingsFor(tier, constrained).farCharacterAnimScale).toBe(1);
    }
  });
});
