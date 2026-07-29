import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { canonicalizeMaterialGroups } from '../src/render/characters/material_groups';

function groupedGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(27), 3));
  geometry.addGroup(0, 3, 0);
  geometry.addGroup(3, 3, 1);
  geometry.addGroup(6, 3, 2);
  return geometry;
}

describe('baked character material groups', () => {
  it('collapses adjacent duplicate materials without changing draw order', () => {
    const shared = new THREE.MeshBasicMaterial();
    const other = new THREE.MeshBasicMaterial();
    const geometry = groupedGeometry();
    const materials = canonicalizeMaterialGroups(geometry, [shared, shared, other]);
    expect(materials).toEqual([shared, other]);
    expect(geometry.groups).toEqual([
      { start: 0, count: 6, materialIndex: 0 },
      { start: 6, count: 3, materialIndex: 1 },
    ]);
  });

  it('deduplicates slots but preserves nonadjacent group ordering', () => {
    const first = new THREE.MeshBasicMaterial();
    const middle = new THREE.MeshBasicMaterial();
    const geometry = groupedGeometry();
    const materials = canonicalizeMaterialGroups(geometry, [first, middle, first]);
    expect(materials).toEqual([first, middle]);
    expect(geometry.groups).toEqual([
      { start: 0, count: 3, materialIndex: 0 },
      { start: 3, count: 3, materialIndex: 1 },
      { start: 6, count: 3, materialIndex: 0 },
    ]);
  });
});
