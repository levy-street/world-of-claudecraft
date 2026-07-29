// Material.clone() drops onBeforeCompile while three keys its program cache on
// Material.customProgramCacheKey(), whose default IS onBeforeCompile.toString().
// A bare clone of a patched rig material therefore renders un-patched AND links
// a fresh program on its first draw. The ability-VFX body glow clones exactly
// such materials, per CharacterVisual, so that link landed on the first spec'd
// hit on every new mob rig, mid-combat.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
