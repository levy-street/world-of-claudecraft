import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { cloneGeometryForBake } from '../src/render/geometry_bake_clone';

function interleavedSource(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.InterleavedBuffer(
    new Int16Array([-32767, 0, 32767, 91, 0, 32767, -32767, 92, 32767, -32767, 0, 93]),
    4,
  );
  const normals = new THREE.InterleavedBuffer(
    new Int8Array([0, 127, 0, 11, 127, 0, 0, 12, 0, 0, 127, 13]),
    4,
  );
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(positions, 3, 0, true));
  geometry.setAttribute('normal', new THREE.InterleavedBufferAttribute(normals, 3, 0, true));
  geometry.setIndex([0, 1, 2]);
  return geometry;
}

function legacyBake(source: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const attribute = source.getAttribute(name);
    if (attribute) geometry.setAttribute(name, attribute.clone());
  }
  if (source.index) geometry.setIndex(source.index.clone());
  return geometry.applyMatrix4(matrix);
}

describe('geometry bake clone', () => {
  it('de-interleaves an immutable source at most once and returns independent mutable clones', () => {
    const source = interleavedSource();
    const first = cloneGeometryForBake(source);

    expect(first.getAttribute('position')).not.toBeInstanceOf(THREE.InterleavedBufferAttribute);
    expect(first.getAttribute('normal')).not.toBeInstanceOf(THREE.InterleavedBufferAttribute);

    source.getAttribute('position').setX(0, 0.5);
    const second = cloneGeometryForBake(source);

    expect(second).not.toBe(first);
    expect(second.getAttribute('position').array).not.toBe(first.getAttribute('position').array);
    expect(second.getAttribute('position').getX(0)).toBe(-1);

    first.getAttribute('position').setX(0, 0.25);
    expect(second.getAttribute('position').getX(0)).toBe(-1);
  });

  it('produces the same baked vertex and index bytes as the previous attribute clones', () => {
    const source = interleavedSource();
    const sourcePositionBytes = Array.from(source.getAttribute('position').array);
    const sourceNormalBytes = Array.from(source.getAttribute('normal').array);
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(0.125, -0.25, 0.375),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, -0.2, 0.3)),
      new THREE.Vector3(0.5, 0.75, 0.625),
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const previous = legacyBake(source, matrix);
    const candidate = cloneGeometryForBake(source).applyMatrix4(matrix);

    expect(Array.from(candidate.getAttribute('position').array)).toEqual(
      Array.from(previous.getAttribute('position').array),
    );
    expect(Array.from(candidate.getAttribute('normal').array)).toEqual(
      Array.from(previous.getAttribute('normal').array),
    );
    expect(Array.from(candidate.getIndex()?.array ?? [])).toEqual(
      Array.from(previous.getIndex()?.array ?? []),
    );
    expect(Array.from(source.getAttribute('position').array)).toEqual(sourcePositionBytes);
    expect(Array.from(source.getAttribute('normal').array)).toEqual(sourceNormalBytes);
    expect(log).toHaveBeenCalledTimes(2);
  });
});

describe('baked attribute set', () => {
  it('carries only the streams the static merge consumes', () => {
    const source = new THREE.BufferGeometry();
    source.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    source.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0]), 3));
    source.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0]), 2));
    // A GLB may ship extra streams. mergeGeometries requires every geometry in a
    // bucket to expose the same set, so forwarding these would break the merge
    // the moment one source in a bucket differs.
    source.setAttribute('color', new THREE.BufferAttribute(new Float32Array([1, 1, 1]), 3));
    source.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array([0, 0]), 2));

    const baked = cloneGeometryForBake(source);

    expect(Object.keys(baked.attributes).sort()).toEqual(['normal', 'position', 'uv']);
  });

  it('omits an attribute the source does not have rather than inventing one', () => {
    const source = new THREE.BufferGeometry();
    source.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));

    expect(Object.keys(cloneGeometryForBake(source).attributes)).toEqual(['position']);
  });
});
