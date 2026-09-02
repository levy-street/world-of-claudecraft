import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  poolSectorAxisCount,
  poolSectorLines,
  poolSectorOfSlot,
  poolSectorWidth,
} from '../src/render/blade_grass_pool_core';
import { buildBladeSectorPool } from '../src/render/blade_grass_sector_pool';

const partition = (gridW: number, axis: number) => {
  const width = poolSectorWidth(gridW, axis);
  const axisCount = poolSectorAxisCount(gridW, width);
  return { width, axisCount };
};

describe('blade grass sector partition', () => {
  it('gives every slot exactly one sector and every sector its exact capacity', () => {
    for (const gridW of [148, 192, 7]) {
      for (const axis of [1, 2, 4, 5]) {
        const { width, axisCount } = partition(gridW, axis);
        const capacity: number[] = [];
        for (let sj = 0; sj < axisCount; sj++) {
          for (let si = 0; si < axisCount; si++) {
            capacity.push(poolSectorLines(gridW, width, si) * poolSectorLines(gridW, width, sj));
          }
        }
        const used = new Array(capacity.length).fill(0);
        for (let slot = 0; slot < gridW * gridW; slot++) {
          const sector = poolSectorOfSlot(slot, gridW, width, axisCount);
          expect(sector).toBeGreaterThanOrEqual(0);
          expect(sector).toBeLessThan(capacity.length);
          used[sector]++;
        }
        expect(used).toEqual(capacity);
        expect(capacity.reduce((a, b) => a + b, 0)).toBe(gridW * gridW);
      }
    }
  });

  it('keeps a slot in the same sector whatever the pool base does', () => {
    // A sector is a range of SLOT lines, and a slot's line never changes, so
    // no cluster ever migrates between sector buffers as the player walks.
    const { width, axisCount } = partition(148, 4);
    const before = poolSectorOfSlot(148 * 90 + 17, 148, width, axisCount);
    expect(poolSectorOfSlot(148 * 90 + 17, 148, width, axisCount)).toBe(before);
    expect(poolSectorOfSlot(148 * 90 + 18, 148, width, axisCount)).toBe(before);
  });

  it('collapses to a single sector at axis 1', () => {
    const { width, axisCount } = partition(148, 1);
    expect(width).toBe(148);
    expect(axisCount).toBe(1);
    expect(poolSectorOfSlot(148 * 147 + 147, 148, width, axisCount)).toBe(0);
  });
});

const makePool = (gridW: number, axis: number) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 1, 0, 0.5, 0, 0]), 3),
  );
  const material = new THREE.MeshBasicMaterial();
  return {
    geometry,
    material,
    pool: buildBladeSectorPool({ gridW, axis, geometry, material, clusterPad: 2 }),
  };
};

describe('blade grass sector pool', () => {
  it('shares one geometry and one material across every sector mesh', () => {
    const { geometry, material, pool } = makePool(8, 4);
    expect(pool.meshes).toHaveLength(16);
    for (const mesh of pool.meshes) {
      expect(mesh.geometry).toBe(geometry);
      expect(mesh.material).toBe(material);
      expect(mesh.frustumCulled).toBe(true);
      expect(mesh.castShadow).toBe(false);
      expect(mesh.receiveShadow).toBe(true);
      expect(mesh.count).toBe(0);
    }
    // one mesh at axis 1: the ?bladesectors=1 A/B arm
    expect(makePool(8, 1).pool.meshes).toHaveLength(1);
  });

  it('fills every sector to its exact capacity without overflowing', () => {
    const gridW = 8;
    const { pool } = makePool(gridW, 4);
    const m = new THREE.Matrix4();
    const c = new THREE.Color(1, 1, 1);
    for (let slot = 0; slot < gridW * gridW; slot++) {
      m.setPosition(slot % gridW, 0, (slot / gridW) | 0);
      pool.place(slot, m, c);
    }
    pool.syncSectors();
    expect(pool.count()).toBe(gridW * gridW);
    let drawn = 0;
    for (const mesh of pool.meshes) drawn += mesh.count;
    expect(drawn).toBe(gridW * gridW);
  });

  it('bounds each sector around the instances it actually holds', () => {
    const gridW = 8;
    const { pool } = makePool(gridW, 4);
    const m = new THREE.Matrix4();
    const c = new THREE.Color(1, 1, 1);
    const at = new Map<number, THREE.Vector3>();
    for (let slot = 0; slot < gridW * gridW; slot++) {
      const gi = slot % gridW;
      const gj = (slot / gridW) | 0;
      const p = new THREE.Vector3(gi * 3, gj * 0.25, gj * 3);
      at.set(slot, p);
      m.setPosition(p);
      pool.place(slot, m, c);
    }
    pool.syncSectors();
    const { width, axisCount } = partition(gridW, 4);
    for (const [slot, p] of at) {
      const mesh = pool.meshes[poolSectorOfSlot(slot, gridW, width, axisCount)];
      const sphere = mesh.boundingSphere;
      expect(sphere).not.toBeNull();
      // every placed cluster is inside its own sector's sphere, with the
      // cluster pad still to spare
      expect(sphere?.center.distanceTo(p)).toBeLessThanOrEqual((sphere?.radius ?? 0) - 2 + 1e-6);
    }
  });

  it('drops removed slots and re-densifies the sector prefix', () => {
    const gridW = 4;
    const { pool } = makePool(gridW, 2);
    const m = new THREE.Matrix4();
    const c = new THREE.Color(1, 1, 1);
    for (let slot = 0; slot < gridW * gridW; slot++) {
      m.setPosition(slot, 0, 0);
      pool.place(slot, m, c);
    }
    pool.syncSectors();
    expect(pool.count()).toBe(16);
    pool.remove(0);
    pool.remove(5);
    pool.remove(5); // idempotent
    pool.syncSectors();
    expect(pool.count()).toBe(14);
    // the surviving instances still occupy a dense prefix of each mesh
    for (const mesh of pool.meshes) {
      const seen = new Set<number>();
      for (let d = 0; d < mesh.count; d++) {
        mesh.getMatrixAt(d, m);
        seen.add(m.elements[12]);
      }
      expect(seen.size).toBe(mesh.count);
      expect(seen.has(0)).toBe(false);
      expect(seen.has(5)).toBe(false);
    }
  });

  it('queues update ranges only for the sectors it touched', () => {
    const gridW = 8;
    const { pool } = makePool(gridW, 4);
    const m = new THREE.Matrix4();
    const c = new THREE.Color(1, 1, 1);
    for (let slot = 0; slot < gridW * gridW; slot++) pool.place(slot, m, c);
    pool.dropUploads();
    for (const mesh of pool.meshes) {
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceColor?.clearUpdateRanges();
    }

    pool.place(0, m, c);
    pool.queueUploads();
    const touched = pool.meshes.filter((mesh) => mesh.instanceMatrix.updateRanges.length > 0);
    expect(touched).toHaveLength(1);
    expect(touched[0]).toBe(pool.meshes[0]);
    expect(touched[0].instanceMatrix.updateRanges).toEqual([{ start: 0, count: 16 }]);
    expect(touched[0].instanceColor?.updateRanges).toEqual([{ start: 0, count: 3 }]);

    // a second flush with nothing marked queues nothing new
    pool.queueUploads();
    expect(touched[0].instanceMatrix.updateRanges).toHaveLength(1);
  });
});
