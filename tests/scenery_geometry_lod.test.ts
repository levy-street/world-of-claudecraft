import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { geometryLodVariant, setGeometryLod } from '../src/render/assets/geometry_lod';
import { bakePalmParts } from '../src/render/jungle_features';
import {
  prepareSceneryGeometryLod,
  updateSceneryGeometryLod,
} from '../src/render/scenery_geometry_lod';
import { sceneryUsesCoarseGeometry } from '../src/render/scenery_geometry_lod_core';

function geometry(): THREE.BufferGeometry {
  const source = new THREE.PlaneGeometry(20, 20, 4, 4);
  source.rotateX(-Math.PI / 2);
  setGeometryLod(source, { far: new THREE.Uint16BufferAttribute([0, 4, 20, 4, 24, 20], 1) });
  return source;
}

describe('scenery geometry LOD', () => {
  it('carries palm levels through a quantized source rebake without changing the source', () => {
    const source = geometry();
    const positions = source.getAttribute('position');
    source.setAttribute(
      'position',
      new THREE.Int16BufferAttribute(
        Array.from(positions.array, (value) => Math.round((value / 10) * 32767)),
        3,
        true,
      ),
    );
    const before = Array.from(source.getAttribute('position').array);
    const scene = new THREE.Group();
    scene.position.set(100, 20, 30);
    scene.scale.set(2, 3, 4);
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(source, material);
    mesh.position.z = 5;
    scene.add(mesh);
    const [part] = bakePalmParts(scene);
    expect(part.material).toBe(material);
    expect(Array.from(source.getAttribute('position').array)).toEqual(before);
    const expected = new THREE.Vector3()
      .fromBufferAttribute(source.getAttribute('position'), 4)
      .applyMatrix4(mesh.matrixWorld);
    const baked = new THREE.Vector3().fromBufferAttribute(
      part.geometry.getAttribute('position'),
      4,
    );
    expect(baked.distanceTo(expected)).toBeLessThan(0.00001);
    const far = geometryLodVariant(part.geometry, 'far');
    expect(far.index?.count).toBe(6);
    expect(far.attributes).toBe(part.geometry.attributes);
    expect(far.index).not.toBe(geometryLodVariant(source, 'far').index);
    expect(part.geometry.index?.count).toBe(96);
  });

  it('retains detail on approach and avoids flicker around the far boundary', () => {
    expect(sceneryUsesCoarseGeometry(119, 120, false)).toBe(false);
    expect(sceneryUsesCoarseGeometry(120, 120, false)).toBe(true);
    expect(sceneryUsesCoarseGeometry(110, 120, true)).toBe(true);
    expect(sceneryUsesCoarseGeometry(107, 120, true)).toBe(false);
    for (const distance of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(sceneryUsesCoarseGeometry(distance, 120, true)).toBe(false);
    }
    expect(sceneryUsesCoarseGeometry(1000, 0, true)).toBe(false);
    expect(sceneryUsesCoarseGeometry(1000, Number.POSITIVE_INFINITY, true)).toBe(false);
  });

  it('swaps only indices at distance and restores the exact source on approach', () => {
    const root = new THREE.Group();
    root.position.x = 400;
    const source = geometry();
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(source, material);
    root.add(mesh);
    prepareSceneryGeometryLod(root);
    updateSceneryGeometryLod(root, 0, 0, 120);
    expect(mesh.geometry).not.toBe(source);
    expect(mesh.geometry.index?.count).toBe(6);
    expect(mesh.geometry.attributes).toBe(source.attributes);
    expect(mesh.material).toBe(material);
    expect(mesh.visible).toBe(true);
    updateSceneryGeometryLod(root, 400, 0, 120);
    expect(mesh.geometry).toBe(source);
    expect(source.index?.count).toBe(96);
  });

  it('protects the nearest instance of a wide batch instead of using its centre', () => {
    const root = new THREE.Group();
    const source = geometry();
    const mesh = new THREE.InstancedMesh(source, new THREE.MeshBasicMaterial(), 2);
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, 0));
    mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(1000, 0, 0));
    root.add(mesh);
    prepareSceneryGeometryLod(root);
    updateSceneryGeometryLod(root, 0, 0, 120);
    expect(mesh.geometry).toBe(source);
    updateSceneryGeometryLod(root, -200, 0, 120);
    expect(mesh.geometry).not.toBe(source);
    updateSceneryGeometryLod(root, 1000, 0, 120);
    expect(mesh.geometry).toBe(source);
  });

  it('leaves unprepared roots and assets without authored levels untouched', () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    root.add(mesh);
    const source = mesh.geometry;
    updateSceneryGeometryLod(root, 2000, 0, 120);
    prepareSceneryGeometryLod(root);
    updateSceneryGeometryLod(root, 2000, 0, 120);
    expect(mesh.geometry).toBe(source);
  });
});
