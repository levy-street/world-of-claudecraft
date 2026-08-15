import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeShadowOnlyMaterial } from '../src/render/shadow_only_material';

// Mirror three's program-cache-key resolution exactly: an own
// customProgramCacheKey overrides the Material.prototype default, whose
// return value is onBeforeCompile.toString().
const programKey = (mat: THREE.Material): string => mat.customProgramCacheKey();

describe('makeShadowOnlyMaterial', () => {
  it('keeps the program cache key of a wind-hooked source (the mid-travel compile hitch)', () => {
    const src = new THREE.MeshStandardMaterial();
    // addWind's shape: an own onBeforeCompile arrow, default cache key.
    src.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '// wind');
    };
    const clone = makeShadowOnlyMaterial(src);
    expect(programKey(clone)).toBe(programKey(src));
  });

  it('keeps an own customProgramCacheKey chain (the leaf shared-map-emissive shape)', () => {
    const src = new THREE.MeshStandardMaterial();
    src.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '// emissive reuse');
    };
    src.customProgramCacheKey = () => 'foliage-shared-map-emissive|inner';
    const clone = makeShadowOnlyMaterial(src);
    expect(programKey(clone)).toBe('foliage-shared-map-emissive|inner');
  });

  it('matches a hook-free source too (stock materials share the stock key)', () => {
    const src = new THREE.MeshStandardMaterial();
    const clone = makeShadowOnlyMaterial(src);
    expect(programKey(clone)).toBe(programKey(src));
  });

  it('is colour-pass inert, cached per source, and leaves the source untouched', () => {
    const src = new THREE.MeshStandardMaterial();
    const clone = makeShadowOnlyMaterial(src);
    expect(clone.colorWrite).toBe(false);
    expect(clone.depthWrite).toBe(false);
    expect(src.colorWrite).toBe(true);
    expect(src.depthWrite).toBe(true);
    expect(makeShadowOnlyMaterial(src)).toBe(clone);
  });
});
