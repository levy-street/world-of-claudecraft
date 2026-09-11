import { describe, expect, it } from 'vitest';
import {
  LEAF_KIND_MUL,
  LEAN_FRACTION,
  leafStrengthForMaterialName,
  swayKindForAssetPath,
  treeSwayLeafGlsl,
  treeSwayWaveGlsl,
} from '../src/render/tree_sway';

describe('swayKindForAssetPath', () => {
  it('treats the foliage kit trees as trees', () => {
    for (const p of [
      '/models/foliage/oak_1.glb',
      '/models/foliage/pine_4.glb',
      '/models/foliage/twisted_2.glb',
    ]) {
      expect(swayKindForAssetPath(p), p).toBe('tree');
    }
  });

  it('treats the kit bare trunks as trees via the foliage-directory fallback', () => {
    // `dead_1.glb` carries no leafy word in its path at all.
    expect(swayKindForAssetPath('/models/foliage/dead_1.glb')).toBe('tree');
  });

  it('treats undergrowth as bushes', () => {
    for (const p of [
      '/models/foliage/bush.glb',
      '/models/foliage/bush_flowers.glb',
      '/models/foliage/fern.glb',
      '/models/biome/city_vine_1.glb',
      '/models/props/marsh_reed_cluster.glb',
      '/models/medieval_village_v2/nature/Grass_01.glb',
      '/models/medieval_village_v2/nature/Plant_04.glb',
      '/models/medieval_village_v2/nature/Ivy_02.glb',
    ]) {
      expect(swayKindForAssetPath(p), p).toBe('bush');
    }
  });

  it('covers the leafy assets that live outside the foliage kit', () => {
    for (const p of [
      '/models/biome/beach_palm_1.glb',
      '/models/biome/desert_tree.glb',
      '/models/dungeon/tree_pine_orange_small.glb',
      '/models/props/marsh_dead_tree.glb',
      '/models/medieval_village_v2/nature/Tree_01.glb',
    ]) {
      expect(swayKindForAssetPath(p), p).toBe('tree');
    }
  });

  it('gives imported and maker-named models the effect too', () => {
    expect(swayKindForAssetPath('/local/my_big_tree.glb')).toBe('tree');
    expect(swayKindForAssetPath('/local/spooky_shrub_02.glb')).toBe('bush');
  });

  it('leaves rigid things rigid, including the ones with a leafy word in the name', () => {
    for (const p of [
      '/models/foliage/rock_2.glb',
      '/models/foliage/mushroom.glb',
      '/models/biome/desert_boulder_1.glb',
      '/models/biome/desert_cactus_tall_1.glb',
      '/models/biome/hex_tile_grass.glb', // a TILE, not grass
      '/models/medieval_village_v2/nature/FlowerPot_01.glb', // a stone pot
      '/models/props/delve_rite_shrine_reed.glb', // a carved shrine
      '/models/biome/city_crate.glb',
    ]) {
      expect(swayKindForAssetPath(p), p).toBeNull();
    }
  });
});

describe('leafStrengthForMaterialName', () => {
  it('flutters the foliage kit leaf materials at full strength', () => {
    expect(leafStrengthForMaterialName('Leaves_NormalTree')).toBe(1);
    expect(leafStrengthForMaterialName('Leaves_Pine')).toBe(1);
    expect(leafStrengthForMaterialName('Flowers')).toBe(1);
  });

  it('keeps trunks and stone perfectly stiff', () => {
    expect(leafStrengthForMaterialName('Bark_NormalTree')).toBe(0);
    expect(leafStrengthForMaterialName('Bark_DeadTree')).toBe(0);
    expect(leafStrengthForMaterialName('Rocks')).toBe(0);
    expect(leafStrengthForMaterialName('Mushrooms')).toBe(0);
  });

  it('gives an unrecognised (imported) material some life but not full', () => {
    const s = leafStrengthForMaterialName('Material.001');
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});

describe('sway amplitudes', () => {
  it('leans a bush far more of its own height than a tree', () => {
    // A knee-high shrub at the tree's 3.8% would move about a centimetre.
    expect(LEAN_FRACTION.bush).toBeGreaterThan(LEAN_FRACTION.tree * 2);
  });

  it('rustles undergrowth harder than a canopy', () => {
    expect(LEAF_KIND_MUL.bush).toBeGreaterThan(LEAF_KIND_MUL.tree);
  });
});

describe('sway GLSL', () => {
  it('leaves the gate and phase in scope for the shimmer to reuse', () => {
    const wave = treeSwayWaveGlsl();
    expect(wave).toContain('wocSwayGate');
    expect(wave).toContain('wocSwayPh');
    expect(wave).toContain('wocSwayWave');
    // The distance gate is what makes the far field free.
    expect(wave).toContain('uSwayPlayer');
  });

  it('divides the shimmer through the world scale so it stays a fixed size', () => {
    const leaf = treeSwayLeafGlsl(0.075, 'wocSwayScale');
    expect(leaf).toContain('wocLeafWave');
    expect(leaf).toContain('wocSwayGate');
    expect(leaf).toContain('/ max(0.0001, wocSwayScale)');
  });
});
