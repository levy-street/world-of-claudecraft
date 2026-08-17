import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/assets/loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/assets/loader')>();
  return {
    ...actual,
    loadGltf: () => new Promise(() => {}),
    loadTexture: () => new Promise(() => {}),
    releaseGltf: () => {},
  };
});
vi.mock('../src/render/assets/preload', () => ({
  registerPreload: () => {},
  registerDeferredPreload: () => {},
}));
vi.mock('../src/render/textures', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/textures')>();
  return {
    ...actual,
    grassTuftTexture: () => new THREE.Texture(),
    flowerTuftTexture: () => new THREE.Texture(),
  };
});
vi.mock('../src/render/gfx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/gfx')>();
  return {
    ...actual,
    // A LIVE object: the tests below mutate it between generateDressing calls,
    // which is safe because the dressing profile is read at call time.
    GFX: actual.gfxInternalsForTest.settingsFor('low'),
  };
});

// The ground-dressing richness trio (step 10 vs 12, the 1.24 density scale, the
// 1.08 spot boost) is compensation art for the weak-GPU cohort, the same family
// as the fatter lowPlus grass cards. It must ride GFX.denseDressing (lowPlus
// plus the leanFoliage medium session), never the tier or leanFoliage alone: a
// plain low session takes medium-parity dressing so low stays monotonically
// lighter (the July investigation measured the old lean-keyed boost at about
// 1.79x medium's dressing density on every low session), while the medium
// weak-iGPU session keeps the compensation its lean model set was authored
// with (the lowPlus re-key had silently stripped it).
describe('ground dressing richness profile', () => {
  it('gives a plain low session medium-parity dressing and reserves the boost for denseDressing', async () => {
    const { GFX } = await import('../src/render/gfx');
    const { foliageDressingInternalsForTest } = await import('../src/render/foliage');
    const { generateDressing, dressStep } = foliageDressingInternalsForTest;
    const live = GFX as { denseDressing: boolean } & typeof GFX;

    expect(live.denseDressing).toBe(false);
    expect(dressStep()).toBe(12);
    const plainLow = generateDressing(20_061);
    expect(plainLow.length).toBeGreaterThan(0);

    live.denseDressing = true;
    expect(dressStep()).toBe(10);
    const weakLow = generateDressing(20_061);
    // Tighter grid AND the 1.24 density scale: strictly more spots. The
    // strictly-more assertion alone is satisfied by the tighter grid ((12/10)^2
    // is about 1.44x cells), so the phase 5 QA probe round set the density
    // scale to 1 and stayed green. Pin the RATIO instead: this seed lands at
    // 1.586 (the July 1.79x compressed where density x 1.24 saturates past a
    // biome's acceptance ceiling); a dropped density scale lands near 1.44 and
    // reds the floor, a runaway one reds the ceiling.
    expect(weakLow.length).toBeGreaterThan(plainLow.length);
    const countRatio = weakLow.length / plainLow.length;
    expect(countRatio).toBeGreaterThan(1.5);
    expect(countRatio).toBeLessThan(1.7);
    // The 1.08 spot boost: the two grids sample different hash positions, so
    // compare the scale distribution maxima as a RATIO band around 1.08 (dense
    // sampling puts both maxima near the distribution ceiling). A dropped boost
    // lands the ratio near 1.0; a boost leaking into the plain profile too.
    const maxScale = (spots: { scale: number }[]) =>
      spots.reduce((max, spot) => Math.max(max, spot.scale), 0);
    const boostRatio = maxScale(weakLow) / maxScale(plainLow);
    expect(boostRatio).toBeGreaterThan(1.07);
    expect(boostRatio).toBeLessThan(1.09);

    // Medium parity for the plain profile: with every medium field applied the
    // dressing output is IDENTICAL, so any future field the generator starts
    // reading beyond denseDressing reds this equality.
    live.denseDressing = false;
    const gfxModule = await import('../src/render/gfx');
    const medium = (
      gfxModule as unknown as {
        gfxInternalsForTest: { settingsFor: (tier: string) => object };
      }
    ).gfxInternalsForTest.settingsFor('medium');
    const lowSnapshot = { ...live };
    Object.assign(live, medium);
    expect((GFX as { denseDressing: boolean }).denseDressing).toBe(false);
    const mediumSpots = generateDressing(20_061);
    Object.assign(live, lowSnapshot);
    expect(mediumSpots).toEqual(plainLow);
  });

  it('keeps the denser-dressing compensation on the medium weak-iGPU cohort', async () => {
    const { GFX, gfxInternalsForTest } = await import('../src/render/gfx');
    const { foliageDressingInternalsForTest } = await import('../src/render/foliage');
    const { generateDressing, dressStep } = foliageDressingInternalsForTest;
    const live = GFX as { denseDressing: boolean } & typeof GFX;
    const snapshot = { ...live };

    // Cohort membership comes from the REAL settings table, not a hand-set
    // flag: the leanFoliage medium session (weak integrated GPU) keeps the
    // compensation its lean model set was authored with, while plain medium
    // and plain low stay uncompensated (gfx.test.ts pins the full cohort).
    const plainMedium = gfxInternalsForTest.settingsFor('medium');
    const mediumWeakIgpu = gfxInternalsForTest.settingsFor('medium', {
      gpuRenderer: 'ANGLE (Intel, ANGLE Metal Renderer: Intel(R) Iris(TM) Plus Graphics 655)',
    });
    expect(plainMedium.denseDressing).toBe(false);
    expect(mediumWeakIgpu.denseDressing).toBe(true);

    Object.assign(live, plainMedium);
    expect(dressStep()).toBe(12);
    const plainSpots = generateDressing(20_061);
    Object.assign(live, mediumWeakIgpu);
    expect(dressStep()).toBe(10);
    const compensatedSpots = generateDressing(20_061);
    Object.assign(live, snapshot);
    // Same 1.5 to 1.7 richness band the lowPlus arm pins above: the cohort
    // takes the full trio, not just the tighter grid.
    expect(compensatedSpots.length).toBeGreaterThan(plainSpots.length);
    const countRatio = compensatedSpots.length / plainSpots.length;
    expect(countRatio).toBeGreaterThan(1.5);
    expect(countRatio).toBeLessThan(1.7);
  });
});
