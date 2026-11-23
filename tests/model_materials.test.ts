// The Build tool's object-material system: a grouped library over the texture
// registry (with CC0 sets that exist only for objects), per-model hue /
// saturation / light that survive the document sanitizer, and a material
// that carries the constant metalness a metal needs.
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cmBox } from '../src/editor/cm_mesh';
import { newCustomMap } from '../src/editor/custom_map';
import { buildModelMesh, modelLook } from '../src/render/model_gen';
import {
  MATERIAL_GROUP_ORDER,
  materialGroupFor,
  modelMaterialOptions,
  modelMaterialShading,
} from '../src/render/model_materials';
import { terrainTexturePath, terrainTextureSet } from '../src/render/terrain_texture_sets';
import { MODEL_ASSET_ID, sanitizeMapDoc } from '../src/sim/map_doc';

const NEW_SETS = [
  'Bricks076C',
  'Concrete034',
  'Marble012',
  'PavingStones131',
  'Plaster001',
  'Metal032',
  'Metal034',
  'Rust004',
  'Fabric030',
  'Leather037',
];

describe('object material library', () => {
  it('ships every map file the new sets declare', () => {
    for (const key of NEW_SETS) {
      const set = terrainTextureSet(key);
      expect(set, key).toBeTruthy();
      for (const kind of ['color', 'normal', 'rough', 'ao'] as const) {
        const path = terrainTexturePath(key, kind);
        if (!path) continue;
        expect(existsSync(`public/${path}`), path).toBe(true);
      }
    }
  });

  it('groups the whole registry, metals first among the new sets', () => {
    const opts = modelMaterialOptions();
    expect(opts.length).toBeGreaterThan(60);
    // Group order is the picker order.
    const groupIdx = opts.map((o) => MATERIAL_GROUP_ORDER.indexOf(o.group));
    for (let i = 1; i < groupIdx.length; i++)
      expect(groupIdx[i]).toBeGreaterThanOrEqual(groupIdx[i - 1]);
    expect(materialGroupFor('Metal032')).toBe('metal');
    expect(materialGroupFor('Rust004')).toBe('metal');
    expect(materialGroupFor('Cobblestone001')).toBe('paving');
    expect(materialGroupFor('Ground100')).toBe('dirt');
    expect(materialGroupFor('Rock052')).toBe('stone');
    expect(modelMaterialShading('Metal032').metalness).toBeCloseTo(0.9);
    expect(modelMaterialShading('Cobblestone001').metalness).toBe(0);
  });
});

describe('model material adjustments', () => {
  it('survive the sanitizer, clamped to the slider ranges', () => {
    const doc = newCustomMap('m', 'id', 0);
    doc.placements.push({
      assetId: MODEL_ASSET_ID,
      x: 0,
      z: 0,
      rotY: 0,
      scale: 1,
      collide: false,
      meshes: [cmBox(1, 1, 1, 1)],
      modelTexId: 'Metal032',
      modelHue: 400,
      modelSat: -3,
      modelLight: 0.4,
    } as never);
    const out = sanitizeMapDoc(doc);
    expect(out).toBeTruthy();
    // newCustomMap seeds the shipped world's placements; ours is the last.
    const p = out!.placements[out!.placements.length - 1];
    expect(p.modelTexId).toBe('Metal032');
    expect(p.modelHue).toBe(180);
    expect(p.modelSat).toBe(0);
    expect(p.modelLight).toBeCloseTo(0.4);
  });

  it('resolve to a look with neutral defaults and an unknown set dropped', () => {
    expect(modelLook({})).toEqual({ texId: undefined, tile: 4, hue: 0, sat: 1, light: 0 });
    expect(modelLook({ modelTexId: 'NoSuchSet', modelHue: 30.004 }).texId).toBeUndefined();
    expect(modelLook({ modelTexId: 'Rust004', modelHue: 30.004 }).hue).toBe(30);
  });

  it('build a triplanar material that shares a program and carries metalness', () => {
    const steel = buildModelMesh({
      meshes: [cmBox(2, 1, 2, 1)],
      modelTexId: 'Metal032',
      modelHue: 20,
    });
    const stone = buildModelMesh({ meshes: [cmBox(2, 1, 2, 1)], modelTexId: 'Rock052' });
    const again = buildModelMesh({
      meshes: [cmBox(1, 1, 1, 1)],
      modelTexId: 'Metal032',
      modelHue: 20,
    });
    const mSteel = steel.material as import('three').MeshStandardMaterial;
    const mStone = stone.material as import('three').MeshStandardMaterial;
    expect(mSteel.metalness).toBeCloseTo(0.9);
    expect(mStone.metalness).toBe(0);
    expect(typeof mSteel.onBeforeCompile).toBe('function');
    expect(mSteel.customProgramCacheKey()).toBe(mStone.customProgramCacheKey());
    // Same look = same shared material; a different hue is another one.
    expect(again.material).toBe(steel.material);
    const other = buildModelMesh({
      meshes: [cmBox(1, 1, 1, 1)],
      modelTexId: 'Metal032',
      modelHue: 21,
    });
    expect(other.material).not.toBe(steel.material);
    // The shader hook wires the adjustment uniforms and replaces the chunks.
    const shader = {
      uniforms: {} as Record<string, { value: number }>,
      vertexShader: '#include <common>\n#include <worldpos_vertex>',
      fragmentShader:
        '#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n#include <aomap_fragment>',
    };
    mSteel.onBeforeCompile(shader as never, null as never);
    expect(shader.uniforms.uHue.value).toBeCloseTo((20 * Math.PI) / 180);
    expect(shader.uniforms.uTile.value).toBe(4);
    expect(shader.fragmentShader).toContain('wocTriSample');
    expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
    expect(shader.vertexShader).toContain('vTriPos =');
  });
});
