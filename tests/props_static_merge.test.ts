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

  it('keeps material buckets separate but merges casters with non-casters', () => {
    const group = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial();
    const wood = new THREE.MeshStandardMaterial();
    const stoneUnshadowed = new THREE.Mesh(indexedQuad(), stone);
    const woodUnshadowed = new THREE.Mesh(indexedQuad(), wood);
    const stoneShadowed = new THREE.Mesh(indexedQuad(), stone);
    stoneShadowed.castShadow = true;
    group.add(stoneUnshadowed, woodUnshadowed, stoneShadowed);

    const merged = propStaticMergeInternalsForTest.mergeStaticMeshes(group, new Set());

    expect(merged).toHaveLength(2);
    expect(
      merged.map((mesh) => ({
        material: mesh.material,
        castShadow: mesh.castShadow,
        receiveShadow: mesh.receiveShadow,
      })),
    ).toEqual([
      { material: stone, castShadow: true, receiveShadow: true },
      { material: wood, castShadow: false, receiveShadow: true },
    ]);
  });

  it('draws only the caster prefix in the shadow pass of a mixed bucket', () => {
    const group = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial();
    const unshadowed = new THREE.Mesh(indexedQuad(), stone);
    unshadowed.position.x = 4;
    const shadowed = new THREE.Mesh(indexedQuad(), stone);
    shadowed.castShadow = true;
    // Source order deliberately puts the non-caster first: the merge has to
    // reorder, or the shadow prefix would clip the wrong half.
    group.add(unshadowed, shadowed);

    const merged = propStaticMergeInternalsForTest.mergeStaticMeshes(group, new Set());

    expect(merged).toHaveLength(1);
    const mesh = merged[0];
    expect(mesh.castShadow).toBe(true);
    expect((mesh as unknown as { shadowRangeIndexCount?: number }).shadowRangeIndexCount).toBe(6);
    expect(mesh.geometry.getIndex()?.count).toBe(12);
    // The caster's triangles come first, so its world position leads the
    // merged position stream.
    expect(Array.from(mesh.geometry.getAttribute('position').array).slice(0, 3)).toEqual([0, 0, 0]);

    expect(mesh.geometry.drawRange).toEqual({ start: 0, count: Number.POSITIVE_INFINITY });
    (mesh as unknown as { onBeforeShadow: () => void }).onBeforeShadow();
    expect(mesh.geometry.drawRange).toEqual({ start: 0, count: 6 });
    (mesh as unknown as { onAfterShadow: () => void }).onAfterShadow();
    expect(mesh.geometry.drawRange).toEqual({ start: 0, count: Number.POSITIVE_INFINITY });
  });

  it('leaves a single-sided bucket ungated', () => {
    const group = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial();
    const a = new THREE.Mesh(indexedQuad(), stone);
    a.castShadow = true;
    const b = new THREE.Mesh(indexedQuad(), stone);
    b.castShadow = true;
    b.position.x = 4;
    group.add(a, b);

    const merged = propStaticMergeInternalsForTest.mergeStaticMeshes(group, new Set());

    expect(merged).toHaveLength(1);
    const mesh = merged[0];
    expect(mesh.castShadow).toBe(true);
    expect((mesh as unknown as { shadowRangeIndexCount?: number }).shadowRangeIndexCount).toBe(
      undefined,
    );
    // three's own no-op hook survives on the prototype; the decisive check is
    // that the shadow pass still draws the whole bucket.
    (mesh as unknown as { onBeforeShadow: () => void }).onBeforeShadow();
    expect(mesh.geometry.drawRange).toEqual({ start: 0, count: Number.POSITIVE_INFINITY });
  });

  it('never merges geometries whose attribute sets disagree', () => {
    const group = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial();
    const full = new THREE.Mesh(indexedQuad(), stone);
    const sparse = indexedQuad();
    sparse.deleteAttribute('color');
    const partial = new THREE.Mesh(sparse, stone);
    partial.position.x = 4;
    group.add(full, partial);

    const merged = propStaticMergeInternalsForTest.mergeStaticMeshes(group, new Set());

    // Both survive: a single bucket would make three's mergeGeometries return
    // null and drop the whole bucket out of the scene.
    expect(merged).toHaveLength(2);
    expect(merged.map((m) => m.geometry.getIndex()?.count)).toEqual([6, 6]);
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
