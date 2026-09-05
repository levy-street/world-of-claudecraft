import { describe, expect, it } from 'vitest';
import type { CollapseWindowValues } from '../src/render/foliage_collapse';
import {
  createFoliageFrameWindows,
  type FoliageFrameInput,
  resolveFoliageFrameWindows,
} from '../src/render/foliage_frame_windows_core';
import { IMPOSTOR_SWAP_FADE, spriteSwapDistance } from '../src/render/foliage_impostor_core';
import {
  foliageDistanceScale,
  foliageFogLimit,
  LOD_HIGH,
  LOD_LOW,
  treeDetailDistance,
} from '../src/render/foliage_lod';

function collapseBlock(): CollapseWindowValues {
  return {
    treeMax: -1,
    rockMax: -1,
    dressMax: -1,
    buildingMax: -1,
    fogCull: -1,
    fade: -1,
    spriteFar: -1,
  };
}

function resolve(over: Partial<FoliageFrameInput>) {
  const input: FoliageFrameInput = {
    modelQuality: 1,
    leanFoliage: false,
    spritesOn: true,
    impostorsActive: true,
    fogFar: 420,
    atmosFogNear: 180,
    atmosFogFar: 900,
    dists: LOD_HIGH,
    ...over,
  };
  const out = createFoliageFrameWindows();
  const collapse = collapseBlock();
  resolveFoliageFrameWindows(input, out, collapse);
  return { input, out, collapse };
}

const LEAN: Partial<FoliageFrameInput> = {
  leanFoliage: true,
  spritesOn: false,
  impostorsActive: false,
  dists: LOD_LOW,
};

describe('foliage frame windows: the lean rock and dress shader windows ARE the bucket caps', () => {
  // The invariant behind the near-edge slab cull (foliage_lod.ts maxNearEdge):
  // a slab kept alive until its nearest boulder crosses the cap must have
  // every boulder past that cap collapsed by the vertex shader, or the extra
  // kept instances are live triangles. Before this resolver the lean arm
  // bound rockMax/dressMax to the FOG wall, ~2x the rock cap.
  for (const q of [0, 0.35, 0.72, 1]) {
    it(`lean arm at governor level ${q}`, () => {
      const { out, collapse } = resolve({ ...LEAN, modelQuality: q });
      const scale = foliageDistanceScale(q, true);
      const fogLimit = foliageFogLimit(420, q);
      expect(out.rockSwap).toBe(Math.min(LOD_LOW.rockFar * scale, fogLimit));
      expect(out.dressSwap).toBe(Math.min(LOD_LOW.dressFar * scale, fogLimit));
      expect(collapse.rockMax).toBe(out.rockSwap);
      expect(collapse.dressMax).toBe(out.dressSwap);
      expect(collapse.rockMax).toBeLessThan(fogLimit);
      expect(collapse.dressMax).toBeLessThan(fogLimit);
    });
  }

  it('the lean arm keeps a hard boundary: no fade, buildings and plain rows end at the fog', () => {
    const { out, collapse } = resolve(LEAN);
    expect(collapse.fade).toBe(0);
    expect(collapse.buildingMax).toBe(out.fogLimit);
    expect(collapse.fogCull).toBe(out.fogLimit);
  });

  it('a full tier built WITHOUT impostors (near-edge rows) binds the caps too', () => {
    const { collapse } = resolve({ leanFoliage: false, spritesOn: false, impostorsActive: false });
    const scale = foliageDistanceScale(1, false);
    const fogLimit = foliageFogLimit(420, 1);
    expect(collapse.rockMax).toBe(Math.min(LOD_HIGH.rockFar * scale, fogLimit));
    expect(collapse.dressMax).toBe(Math.min(LOD_HIGH.dressFar * scale, fogLimit));
    expect(collapse.fade).toBe(0);
  });

  it('a sprite-arm build whose bake failed keeps rocks and dressing to the fog wall', () => {
    // The rows were registered expecting a sprite behind the swap; with none
    // live they must not collapse into nothing (the pre-existing fallback).
    const { out, collapse } = resolve({
      leanFoliage: false,
      spritesOn: false,
      impostorsActive: true,
    });
    const scale = foliageDistanceScale(1, false);
    const fogLimit = foliageFogLimit(420, 1);
    expect(collapse.rockMax).toBe(out.fogLimit);
    expect(collapse.dressMax).toBe(out.fogLimit);
    expect(collapse.buildingMax).toBe(out.fogLimit);
    expect(collapse.fade).toBe(0);
    expect(out.detailFar).toBe(
      treeDetailDistance(LOD_HIGH.treeDetailFar, 180, 900, scale, fogLimit),
    );
  });

  it('the sprite arm is unchanged: swaps and fade as before', () => {
    const { out, collapse } = resolve({});
    const scale = foliageDistanceScale(1, false);
    const fogLimit = foliageFogLimit(420, 1);
    expect(collapse.rockMax).toBe(Math.min(LOD_HIGH.rockFar * scale, fogLimit));
    expect(collapse.dressMax).toBe(Math.min(LOD_HIGH.dressFar * scale, fogLimit));
    expect(collapse.buildingMax).toBe(out.buildingSwap);
    expect(out.buildingSwap).toBe(420 - 40);
    expect(collapse.fade).toBe(IMPOSTOR_SWAP_FADE);
    expect(collapse.spriteFar).toBe(900);
  });
});

describe('foliage frame windows: the detail swap keeps each arm its own law', () => {
  it('sprite arm follows the budget (spriteSwapDistance)', () => {
    const { out } = resolve({ modelQuality: 0.5 });
    const scale = foliageDistanceScale(0.5, false);
    const fogLimit = foliageFogLimit(420, 0.5);
    expect(out.detailFar).toBe(
      spriteSwapDistance(LOD_HIGH.treeDetailFar, scale, 180, 900, fogLimit),
    );
    expect(out.distanceScale).toBe(scale);
    expect(out.fogLimit).toBe(fogLimit);
    expect(out.detailFar).toBe(resolve({ modelQuality: 0.5 }).collapse.treeMax);
  });

  it('lean arm follows the fog blend law (treeDetailDistance)', () => {
    const { out, collapse } = resolve({ ...LEAN, modelQuality: 0.5 });
    const scale = foliageDistanceScale(0.5, true);
    const fogLimit = foliageFogLimit(420, 0.5);
    expect(out.detailFar).toBe(
      treeDetailDistance(LOD_LOW.treeDetailFar, 180, 900, scale, fogLimit),
    );
    expect(collapse.treeMax).toBe(out.detailFar);
  });

  it('a short interior fog bounds the sprites, a wide atmosphere carries them to the rim', () => {
    expect(resolve({ fogFar: 60, atmosFogFar: 60 }).collapse.spriteFar).toBe(60);
    expect(resolve({ fogFar: 60, atmosFogFar: 1400 }).collapse.spriteFar).toBe(1400);
    expect(resolve({ fogFar: 30 }).out.buildingSwap).toBe(0);
  });

  it('writes into the caller-owned reused blocks', () => {
    const out = createFoliageFrameWindows();
    const collapse = collapseBlock();
    resolveFoliageFrameWindows({ ...resolve({}).input }, out, collapse);
    expect(out.rockSwap).toBeGreaterThan(0);
    expect(collapse.rockMax).toBe(out.rockSwap);
  });
});
