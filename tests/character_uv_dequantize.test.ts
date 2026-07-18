// Regression for the "BufferAttribute.array must be of consistent array types
// across matching attributes" console error seen merging idle-pose bake
// geometries in src/render/characters/assets.ts `bakeStaticPose`. KayKit
// primitives can ship `uv` quantized as a normalized Uint16Array on one part
// and plain Float32Array on another; naively cloning `uv` (as `bakeStaticPose`
// used to) carries that mismatch straight into mergeGeometries and it silently
// drops the whole merge (returns undefined, logs console.error).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { describe, expect, it, vi } from 'vitest';
import { dequantizeAttribute } from '../src/render/characters/dequantize_attribute';

function geoWithUv(uv: THREE.BufferAttribute): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
  );
  geo.setAttribute('uv', uv);
  geo.setIndex([0, 1, 2]);
  return geo;
}

describe('dequantizeAttribute', () => {
  it('denormalizes a quantized attribute into a plain Float32Array of the same values', () => {
    const quantized = new THREE.BufferAttribute(
      new Uint16Array([0, 0, 65535, 0, 0, 65535]),
      2,
      true,
    );
    const out = dequantizeAttribute(quantized);
    expect(out.array).toBeInstanceOf(Float32Array);
    expect(out.normalized).toBe(false);
    expect(Array.from(out.array as Float32Array)).toEqual([0, 0, 1, 0, 0, 1]);
  });

  it('lets mergeGeometries combine primitives whose uv attributes were quantized differently', () => {
    const floatUv = new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2);
    const quantizedUv = new THREE.BufferAttribute(
      new Uint16Array([0, 0, 65535, 0, 0, 65535]),
      2,
      true,
    );

    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args);
    });

    const naive = mergeGeometries([geoWithUv(floatUv), geoWithUv(quantizedUv.clone())]);
    expect(naive).toBeNull();
    expect(errors.length).toBeGreaterThan(0);

    errors.length = 0;
    const fixed = mergeGeometries([
      geoWithUv(dequantizeAttribute(floatUv)),
      geoWithUv(dequantizeAttribute(quantizedUv)),
    ]);
    expect(errors).toEqual([]);
    expect(fixed).toBeDefined();
    const mergedUv = fixed?.getAttribute('uv');
    expect(mergedUv?.array).toBeInstanceOf(Float32Array);
    expect(Array.from(mergedUv?.array as Float32Array)).toEqual([
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]);

    spy.mockRestore();
  });
});
