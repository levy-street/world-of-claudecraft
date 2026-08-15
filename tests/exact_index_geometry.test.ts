import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { indexExactVertexTuples } from '../src/render/exact_index_geometry';

function expandedAttribute(geometry: THREE.BufferGeometry, name: string): number[] {
  const attribute = geometry.getAttribute(name);
  const index = geometry.getIndex();
  const expanded: number[] = [];
  if (!index) return Array.from(attribute.array);
  for (let element = 0; element < index.count; element++) {
    const vertexIndex = index.getX(element);
    for (let component = 0; component < attribute.itemSize; component++) {
      expanded.push(attribute.array[vertexIndex * attribute.itemSize + component]);
    }
  }
  return expanded;
}

function twoTriangleGeometry(secondAU = 0): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  );
  geometry.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
  );
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, secondAU, 0, 1, 1, 0, 1], 2),
  );
  return geometry;
}

describe('exact geometry indexing', () => {
  it('compacts byte-identical tuples while preserving the expanded triangle stream', () => {
    const source = twoTriangleGeometry();
    const indexed = indexExactVertexTuples(source);

    expect(source.getIndex()).toBeNull();
    expect(indexed.getIndex()?.array).toBeInstanceOf(Uint16Array);
    expect(indexed.getIndex()?.count).toBe(6);
    expect(indexed.getAttribute('position').count).toBe(4);
    for (const name of ['position', 'normal', 'uv']) {
      expect(expandedAttribute(indexed, name)).toEqual(expandedAttribute(source, name));
    }
  });

  it('does not merge positions whose other shader inputs differ', () => {
    const indexed = indexExactVertexTuples(twoTriangleGeometry(0.5));

    expect(indexed.getAttribute('position').count).toBe(5);
    expect(expandedAttribute(indexed, 'position')).toEqual([
      0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0,
    ]);
    expect(expandedAttribute(indexed, 'uv')).toEqual([0, 0, 1, 0, 1, 1, 0.5, 0, 1, 1, 0, 1]);
  });
});
