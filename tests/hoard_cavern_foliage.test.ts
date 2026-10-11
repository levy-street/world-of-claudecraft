import { existsSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import {
  hoardCavernFoliagePreloadInternalsForTest as assets,
  buildHoardCavernFoliage,
  updateHoardCavernFoliageTint,
} from '../src/render/hoard_cavern_foliage';
import { buildHoardValleyPlan } from '../src/render/hoard_valley_core';

afterEach(() => assets.clear());

function plan() {
  return buildHoardValleyPlan({
    zoneId: 'amberfall',
    seed: 42,
    low: false,
    layout: { zMin: 0, zMax: 140, floorHalfX: 34, dais: { x: 0, z: 125, r: 12 } },
  });
}

function seedTree() {
  const source = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0x77aa66 });
  material.name = 'Leaves_NormalTree';
  const geometry = new THREE.BoxGeometry(2, 8, 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 7;
  source.add(mesh);
  assets.seedScene('/models/foliage/oak_1_field.glb', source);
  return { source, material, geometry };
}

describe('hoard cavern foliage', () => {
  it('reuses shipped and manifested world assets', () => {
    for (const url of assets.urls) {
      const relative = url.replace(/^\//, '');
      expect(existsSync(path.join(__dirname, '../public', relative))).toBe(true);
      expect(MEDIA_ASSETS[relative]).toBeDefined();
    }
  });
  it('grades from the authored color without accumulating darkness', () => {
    const { material: original } = seedTree();
    const mesh = buildHoardCavernFoliage(plan(), false).children[0] as THREE.InstancedMesh;
    const material = mesh.material as THREE.MeshBasicMaterial;
    updateHoardCavernFoliageTint([0.5, 0.5, 0.5]);
    const expected = material.color.clone();
    updateHoardCavernFoliageTint([0.5, 0.5, 0.5]);
    expect(material.color).toEqual(expected);
    updateHoardCavernFoliageTint([1, 1, 1]);
    expect(material.color).toEqual(original.color);
  });

  it('retains geometry material groups and every source material', () => {
    const scene = new THREE.Group();
    const geometry = new THREE.BoxGeometry(2, 8, 2);
    const materials = Array.from(
      { length: 6 },
      (_, i) => new THREE.MeshStandardMaterial({ color: i * 0x111111 }),
    );
    scene.add(new THREE.Mesh(geometry, materials));
    assets.seedScene('/models/foliage/oak_1_field.glb', scene);
    const mesh = buildHoardCavernFoliage(plan(), false).children[0] as THREE.InstancedMesh;
    expect(mesh.geometry.groups).toEqual(geometry.groups);
    expect(mesh.material).toHaveLength(6);
    expect(
      (mesh.material as THREE.MeshBasicMaterial[]).map((material) => material.color.getHex()),
    ).toEqual(materials.map((material) => material.color.getHex()));
  });

  it('remains safe before deferred assets resolve', () => {
    expect(buildHoardCavernFoliage(plan(), false).children).toHaveLength(0);
  });

  it('seats shared GLB geometry without changing cached source resources', () => {
    const { source, material, geometry } = seedTree();
    const a = buildHoardCavernFoliage(plan(), true).children[0] as THREE.InstancedMesh;
    const b = buildHoardCavernFoliage(plan(), false).children[0] as THREE.InstancedMesh;
    expect(a.count).toBeGreaterThan(0);
    expect(a.geometry).toBe(b.geometry);
    expect(a.material).toBe(b.material);
    expect(a.geometry.userData.sharedRendererResource).toBe(true);
    expect((a.material as THREE.Material).userData.sharedRendererResource).toBe(true);
    expect(a.geometry.boundingBox?.min.y).toBeCloseTo(0);
    expect(a.geometry.boundingBox?.max.y).toBeCloseTo(8);
    expect(source.children[0].position.y).toBe(7);
    expect(geometry.boundingBox).toBeNull();
    expect(material.color.getHex()).toBe(0x77aa66);
    expect(a.castShadow).toBe(true);
    expect(b.castShadow).toBe(false);
  });

  it('keeps rotated broad crowns clear of the fight spine and avoids tree clusters', () => {
    const source = new THREE.Group();
    source.add(new THREE.Mesh(new THREE.BoxGeometry(8, 8, 8), new THREE.MeshStandardMaterial()));
    assets.seedScene('/models/foliage/oak_1_field.glb', source);
    const p = plan();
    const mesh = buildHoardCavernFoliage(p, false).children[0] as THREE.InstancedMesh;
    expect(mesh.count).toBeLessThanOrEqual(6);
    const positions: THREE.Vector3[] = [];
    for (let i = 0; i < mesh.count; i++) {
      const matrix = new THREE.Matrix4();
      mesh.getMatrixAt(i, matrix);
      const position = new THREE.Vector3().setFromMatrixPosition(matrix);
      expect(Math.abs(position.x)).toBeGreaterThan(p.centerClearHalfWidth + 1);
      expect(position.z).toBeGreaterThanOrEqual(p.revealZ);
      const vertices = mesh.geometry.getAttribute('position');
      for (let vertex = 0; vertex < vertices.count; vertex++) {
        const world = new THREE.Vector3()
          .fromBufferAttribute(vertices, vertex)
          .applyMatrix4(matrix);
        expect(Math.abs(world.x)).toBeGreaterThanOrEqual(8);
      }
      for (const other of positions) expect(position.distanceTo(other)).toBeGreaterThanOrEqual(10);
      positions.push(position);
    }
  });
});
