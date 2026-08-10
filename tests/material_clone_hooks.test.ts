// Material.clone() drops onBeforeCompile while three keys its program cache on
// Material.customProgramCacheKey(), whose default IS onBeforeCompile.toString().
// A bare clone of a patched rig material therefore renders un-patched AND links
// a fresh program on its first draw. The ability-VFX body glow clones exactly
// such materials, per CharacterVisual, so that link landed on the first spec'd
// hit on every new mob rig, mid-combat.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachBiomeHaze } from '../src/render/biome_haze_field';
import { addRimGlow, gfxInternalsForTest, hasRimGlow } from '../src/render/gfx';
import {
  cloneMaterialWithHooks,
  reattachClonedMaterialHooks,
} from '../src/render/material_clone_hooks';
import { applySurfaceDetail } from '../src/render/worn_stone';

// A rig material as characters/assets.ts tintedMaterial builds it on the
// standard tier: rim glow first, then the low-strength object-space worn layer.
function riggedBodyMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0x808080 });
  mat.name = 'knight_cloth';
  addRimGlow(mat);
  applySurfaceDetail(mat, 'fabric', { strength: 0.2, objectSpace: true });
  return mat;
}

// Enough of three's PBR fragment shader for the rim patch to find its anchors.
function fragmentShaderStub(): { uniforms: Record<string, unknown>; fragmentShader: string } {
  return {
    uniforms: {},
    fragmentShader: [
      '#include <common>',
      'void main() {',
      '#include <lights_fragment_begin>',
      '}',
    ].join('\n'),
  };
}

// The rim + surface-detail layers only exist on the standard/detail tiers,
// which is exactly where the glow clone used to split the program cache.
let restoreGfx: () => void = () => {};

beforeEach(() => {
  restoreGfx = gfxInternalsForTest.overrideSettings({
    standardMaterials: true,
    surfaceDetail: true,
  });
});

afterEach(() => {
  restoreGfx();
});

describe('reattachClonedMaterialHooks', () => {
  it('reproduces the bare-clone program split it exists to fix', () => {
    const source = riggedBodyMaterial();
    const bare = source.clone();
    expect(bare.customProgramCacheKey()).not.toBe(source.customProgramCacheKey());
    // The dropped hook is the same reason the bare clone renders un-patched.
    expect(bare.onBeforeCompile).toBe(THREE.Material.prototype.onBeforeCompile);
  });

  it('restores the source program cache key exactly, so the clone reuses its program', () => {
    const source = riggedBodyMaterial();
    const clone = cloneMaterialWithHooks(source);
    expect(clone).not.toBe(source);
    expect(clone.customProgramCacheKey()).toBe(source.customProgramCacheKey());
    // Both layers are represented: the detail layer's own prefix, and the rim
    // hook it chains (surface-detail folds the previous hook's source into its
    // key, which is why the two must be re-attached in the source's order).
    expect(clone.customProgramCacheKey()).toContain('surface-detail|fabric');
    expect(clone.customProgramCacheKey()).toContain('patchPbrRimGlowFragmentShader');
  });

  it('restores the shader patch itself, not just the key', () => {
    const clone = cloneMaterialWithHooks(riggedBodyMaterial());
    const shader = fragmentShaderStub();
    clone.onBeforeCompile(shader as never, null as never);
    expect(shader.fragmentShader).toContain('uniform float uRimBoost;');
    expect(shader.uniforms.uRimBoost).toBeDefined();
  });

  it('never grants a clone a layer its source never carried', () => {
    // A plain material (no rim, no detail): the clone must stay on the stock
    // program key, or it would split the cache in the other direction.
    const plain = new THREE.MeshStandardMaterial({ color: 0x223344 });
    const clone = plain.clone();
    reattachClonedMaterialHooks(plain, clone);
    expect(hasRimGlow(clone)).toBe(false);
    expect(clone.customProgramCacheKey()).toBe(plain.customProgramCacheKey());
    expect(clone.onBeforeCompile).toBe(THREE.Material.prototype.onBeforeCompile);
  });

  it('re-attaches only the surface layer for a detail-only source', () => {
    const source = new THREE.MeshStandardMaterial({ color: 0x445566 });
    applySurfaceDetail(source, 'stone');
    const clone = cloneMaterialWithHooks(source);
    expect(hasRimGlow(clone)).toBe(false);
    expect(clone.customProgramCacheKey()).toBe(source.customProgramCacheKey());
    expect(clone.customProgramCacheKey()).toContain('surface-detail|stone');
  });
});

describe('biome-haze layer survival across the program-preserving clone', () => {
  // The stoneSlab shape (castle_features): a surfaceMat-style source carrying
  // the zone-haze hook plus the worn-stone detail layer.
  function hazedSlabMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a7568 });
    mat.name = 'castle_slab';
    attachBiomeHaze(mat);
    applySurfaceDetail(mat, 'stone', { strength: 0.4 });
    return mat;
  }

  it('documents the lying wocZoneHaze marker a bare clone carries', () => {
    const source = hazedSlabMaterial();
    const bare = source.clone();
    // clone() copies userData, so the marker claims the hook is attached on a
    // clone whose hook was silently dropped; a naive attachBiomeHaze(bare)
    // no-ops on that flag and the key stays split.
    expect((bare.userData as { wocZoneHaze?: boolean }).wocZoneHaze).toBe(true);
    attachBiomeHaze(bare);
    expect(bare.customProgramCacheKey()).not.toBe(source.customProgramCacheKey());
  });

  it('restores the haze layer and the exact program cache key on the clone', () => {
    const source = hazedSlabMaterial();
    const clone = cloneMaterialWithHooks(source);
    expect(clone.customProgramCacheKey()).toBe(source.customProgramCacheKey());
    // The detail layer chains the previous hook's source text into its key,
    // so the haze layer's presence shows as its shader identifier.
    expect(clone.customProgramCacheKey()).toContain('wocHazeVXZ');
  });

  it('never grants haze to a clone of an un-hazed source', () => {
    const source = new THREE.MeshStandardMaterial({ color: 0x97826f });
    applySurfaceDetail(source, 'stone', { strength: 0.4 });
    const clone = cloneMaterialWithHooks(source);
    expect((clone.userData as { wocZoneHaze?: boolean }).wocZoneHaze ?? false).toBe(false);
    expect(clone.customProgramCacheKey()).toBe(source.customProgramCacheKey());
  });
});

describe('the castle stone slabs use the program-preserving clone', () => {
  it('clones the surfaceMat slab sources through material_clone_hooks', () => {
    const castle = readFileSync(
      new URL('../src/render/castle_features.ts', import.meta.url),
      'utf8',
    );
    const start = castle.indexOf('const stoneSlab = (');
    expect(start).toBeGreaterThan(-1);
    const slice = castle.slice(start, castle.indexOf('const slab = (', start));
    expect(slice).toContain('cloneMaterialWithHooks(surfaceMat({ color, roughness }))');
    expect(slice).toContain('cloneMaterialWithHooks(stoneSlab(');
    expect(slice).not.toContain('.clone()');
  });
});

describe('the town ghost and independent-building clones preserve programs', () => {
  it('routes the three kit clone sites through material_clone_hooks', () => {
    // A bare clone at any of these sites drops the zone-haze hook, splits the
    // program cache key, and links a program per kit material the first time
    // a crowd arrival whips the camera across town (the measured
    // first-contact burst: village/khex/fenbridge materials linking inside
    // one frame).
    const sites = [
      ['props.ts', 'const ghostSrc = cloneMaterialWithHooks(src)'],
      ['fenbridge_town.ts', 'independent ? cloneMaterialWithHooks(shared) : shared'],
      ['eastbrook_town.ts', 'independent ? cloneMaterialWithHooks(shared) : shared'],
    ];
    for (const [file, needle] of sites) {
      const source = readFileSync(new URL(`../src/render/${file}`, import.meta.url), 'utf8');
      expect(source, `${file} lost its hook-preserving clone`).toContain(needle);
    }
  });
});

describe('the ability-VFX body glow uses the program-preserving clone', () => {
  it('clones the rig material through material_clone_hooks', () => {
    const visual = readFileSync(
      new URL('../src/render/characters/visual.ts', import.meta.url),
      'utf8',
    );
    const start = visual.indexOf('private auraGlowMaterial(');
    expect(start).toBeGreaterThan(-1);
    const method = visual.slice(start, visual.indexOf('\n  setSoulRend(', start));
    expect(method).toContain('cloneMaterialWithHooks(material)');
    expect(method).not.toContain('material.clone()');
  });
});
