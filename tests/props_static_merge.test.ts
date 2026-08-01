import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { propStaticMergeInternalsForTest } from '../src/render/props';

function expandedAttribute(geometry: THREE.BufferGeometry, name: string): number[] {
  const attribute = geometry.getAttribute(name);
  const index = geometry.getIndex();
  if (!index) return Array.from(attribute.array);

  const expanded: number[] = [];
  for (let element = 0; element < index.count; element++) {
    const vertexIndex = index.getX(element);
    for (let component = 0; component < attribute.itemSize; component++) {
      expanded.push(attribute.array[vertexIndex * attribute.itemSize + component]);
    }
  }
  return expanded;
}

function indexedQuad(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  );
  geometry.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geometry.setAttribute(
    'color',
    new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1], 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

describe('static prop merging', () => {
  it('preserves the expanded stream while retaining exact index reuse', () => {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial();
    const sharedGeometry = indexedQuad();
    const indexedMesh = new THREE.Mesh(sharedGeometry, material);
    indexedMesh.position.set(2, 3, 4);
    indexedMesh.rotation.y = 0.35;
    indexedMesh.castShadow = true;

    const sharedPlacement = new THREE.Mesh(sharedGeometry, material);
    sharedPlacement.position.set(7, -1, 2);
    sharedPlacement.scale.set(0.5, 1.25, 0.8);
    sharedPlacement.castShadow = true;

    const nonIndexedMesh = new THREE.Mesh(indexedQuad().toNonIndexed(), material);
    nonIndexedMesh.position.set(3, 2, 5);
    nonIndexedMesh.scale.set(1.5, 0.75, 2);
    nonIndexedMesh.castShadow = true;
    group.add(indexedMesh, sharedPlacement, nonIndexedMesh);
    group.updateMatrixWorld(true);

    const sourceAttributes = new Map(
      ['position', 'normal', 'uv', 'color'].map((name) => [
        name,
        Array.from(sharedGeometry.getAttribute(name).array),
      ]),
    );
    const sourceIndex = Array.from(sharedGeometry.getIndex()?.array ?? []);
    const expectedByAttribute = new Map<string, number[]>();
    for (const name of ['position', 'normal', 'uv', 'color']) {
      expectedByAttribute.set(name, [
        ...expandedAttribute(
          indexedMesh.geometry.toNonIndexed().applyMatrix4(indexedMesh.matrixWorld),
          name,
        ),
        ...expandedAttribute(
          sharedPlacement.geometry.toNonIndexed().applyMatrix4(sharedPlacement.matrixWorld),
          name,
        ),
        ...expandedAttribute(
          nonIndexedMesh.geometry.clone().applyMatrix4(nonIndexedMesh.matrixWorld),
          name,
        ),
      ]);
    }

    const merged = propStaticMergeInternalsForTest.mergeStaticMeshes(group, new Set());

    expect(merged).toHaveLength(1);
    expect(group.children).toEqual(merged);
    expect(merged[0].material).toBe(material);
    expect(merged[0].castShadow).toBe(true);
    expect(merged[0].receiveShadow).toBe(true);

    const geometry = merged[0].geometry;
    expect(geometry.getIndex()?.count).toBe(18);
    expect(geometry.getAttribute('position').count).toBe(12);
    for (const name of ['position', 'normal', 'uv', 'color']) {
      expect(expandedAttribute(geometry, name)).toEqual(expectedByAttribute.get(name));
      expect(Array.from(sharedGeometry.getAttribute(name).array)).toEqual(
        sourceAttributes.get(name),
      );
    }
    expect(Array.from(sharedGeometry.getIndex()?.array ?? [])).toEqual(sourceIndex);
  });

  it('keeps material and shadow buckets separate and ordered', () => {
    const group = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial();
    const wood = new THREE.MeshStandardMaterial();
    const stoneUnshadowed = new THREE.Mesh(indexedQuad(), stone);
    const woodUnshadowed = new THREE.Mesh(indexedQuad(), wood);
    const stoneShadowed = new THREE.Mesh(indexedQuad(), stone);
    stoneShadowed.castShadow = true;
    group.add(stoneUnshadowed, woodUnshadowed, stoneShadowed);

    const merged = propStaticMergeInternalsForTest.mergeStaticMeshes(group, new Set());

    expect(merged).toHaveLength(3);
    expect(
      merged.map((mesh) => ({
        material: mesh.material,
        castShadow: mesh.castShadow,
        receiveShadow: mesh.receiveShadow,
      })),
    ).toEqual([
      { material: stone, castShadow: false, receiveShadow: true },
      { material: wood, castShadow: false, receiveShadow: true },
      { material: stone, castShadow: true, receiveShadow: true },
    ]);
  });

  it('de-interleaves indexed source attributes without mutating the shared geometry', () => {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial();
    const geometry = new THREE.BufferGeometry();
    const source = new Float32Array([
      0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1,
    ]);
    const interleaved = new THREE.InterleavedBuffer(source, 6);
    geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(interleaved, 3, 0));
    geometry.setAttribute('normal', new THREE.InterleavedBufferAttribute(interleaved, 3, 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const sourceBefore = Array.from(source);
    const sourceIndexBefore = Array.from(geometry.getIndex()?.array ?? []);
    const mesh = new THREE.Mesh(geometry, material);
    const plainMesh = new THREE.Mesh(geometry.toNonIndexed(), material);
    plainMesh.position.x = 2;
    group.add(mesh, plainMesh);

    const merged = propStaticMergeInternalsForTest.mergeStaticMeshes(group, new Set());

    expect(merged).toHaveLength(1);
    expect(merged[0].geometry.getAttribute('position')).not.toBeInstanceOf(
      THREE.InterleavedBufferAttribute,
    );
    expect(merged[0].geometry.getAttribute('normal')).not.toBeInstanceOf(
      THREE.InterleavedBufferAttribute,
    );
    expect(Array.from(merged[0].geometry.getAttribute('position').array)).toEqual([
      0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 3, 1, 0, 2, 1, 0,
    ]);
    expect(Array.from(merged[0].geometry.getAttribute('normal').array)).toEqual([
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]);
    expect(Array.from(merged[0].geometry.getIndex()?.array ?? [])).toEqual([
      0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7,
    ]);
    expect(Array.from(source)).toEqual(sourceBefore);
    expect(Array.from(geometry.getIndex()?.array ?? [])).toEqual(sourceIndexBefore);
    expect(geometry.getAttribute('position')).toBeInstanceOf(THREE.InterleavedBufferAttribute);
  });
});
