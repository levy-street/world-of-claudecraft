import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { describe, expect, it } from 'vitest';
import { normalizeGeometryAttributesForMerge } from '../src/render/geometry_merge';

describe('geometry merge normalization', () => {
  it('makes normalized integer GLB attributes mergeable with float attributes', () => {
    const floatGeometry = new THREE.PlaneGeometry(1, 1).toNonIndexed();
    const quantizedGeometry = floatGeometry.clone();
    const sourceUv = quantizedGeometry.getAttribute('uv');
    const quantizedUv = new Uint16Array(sourceUv.count * 2);
    for (let i = 0; i < sourceUv.count; i++) {
      quantizedUv[i * 2] = Math.round(sourceUv.getX(i) * 65_535);
      quantizedUv[i * 2 + 1] = Math.round(sourceUv.getY(i) * 65_535);
    }
    quantizedGeometry.setAttribute('uv', new THREE.BufferAttribute(quantizedUv, 2, true));

    expect(mergeGeometries([floatGeometry, quantizedGeometry], false)).toBeNull();

    normalizeGeometryAttributesForMerge(quantizedGeometry);
    const merged = mergeGeometries([floatGeometry, quantizedGeometry], false);
    expect(merged).not.toBeNull();
    expect(merged?.getAttribute('uv').array).toBeInstanceOf(Float32Array);
  });
});
