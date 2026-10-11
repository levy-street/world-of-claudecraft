import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { WarriorSpiritHammers } from '../src/render/ability_vfx/warrior_spirit_hammers';

it('prepares one bounded solid pool and falls back while cold or full', () => {
  const scene = new THREE.Scene(),
    pool = new WarriorSpiritHammers(scene);
  expect(pool.draw(0, 1, 0, 2.1, 0, 0, false)).toBe(false);
  expect(pool.mesh.visible).toBe(false);
  vi.spyOn(pool.preparation, 'ready').mockReturnValue(true);
  const geometry = pool.mesh.geometry,
    material = pool.mesh.material;
  pool.beginFrame();
  for (let i = 0; i < 8; i++) expect(pool.draw(i, 2, 3, 2.1, 0, 0.12, false)).toBe(true);
  expect(pool.draw(9, 2, 3, 2.1, 0, 0.12, false)).toBe(false);
  pool.endFrame();
  expect(pool.mesh.count).toBe(8);
  expect(pool.mesh.visible).toBe(true);
  expect(pool.mesh.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 128 }]);
  pool.beginFrame();
  pool.draw(10, 3, 4, 2.1, 0, 0.2, false);
  pool.endFrame();
  expect(pool.mesh.geometry).toBe(geometry);
  expect(pool.mesh.material).toBe(material);
  expect(pool.mesh.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 16 }]);
  const m = new THREE.Matrix4();
  pool.mesh.getMatrixAt(0, m);
  expect(new THREE.Vector3().setFromMatrixPosition(m).toArray()).toEqual([10, 3, 4]);
  pool.beginFrame();
  pool.endFrame();
  expect(pool.mesh.visible).toBe(false);
  const disposeGeometry = vi.spyOn(geometry, 'dispose'),
    disposeMaterial = vi.spyOn(material, 'dispose');
  const disposeInstances = vi.spyOn(pool.mesh, 'dispose');
  pool.dispose();
  pool.dispose();
  expect(disposeGeometry).toHaveBeenCalledOnce();
  expect(disposeMaterial).toHaveBeenCalledOnce();
  expect(disposeInstances).toHaveBeenCalledOnce();
  expect(scene.children).toHaveLength(0);
  expect(pool.draw(0, 1, 0, 2.1, 0, 0, false)).toBe(false);
});

it('keeps a broad head, long grip, bevels and contrasted inlays at world scale', () => {
  const pool = new WarriorSpiritHammers(new THREE.Scene());
  const g = pool.mesh.geometry,
    bounds = g.boundingBox!;
  expect(bounds.max.x - bounds.min.x).toBeGreaterThan(1.1);
  expect(bounds.max.y - bounds.min.y).toBeGreaterThan(1.2);
  expect(bounds.max.z - bounds.min.z).toBeGreaterThan(0.4);
  const p = g.getAttribute('position'),
    colors = g.getAttribute('color');
  expect(p.count).toBeLessThan(6000);
  expect([...p.array].every(Number.isFinite)).toBe(true);
  expect(
    new Set(Array.from({ length: colors.count }, (_, i) => colors.getX(i))).size,
  ).toBeGreaterThan(8);
  vi.spyOn(pool.preparation, 'ready').mockReturnValue(true);
  const matrix = new THREE.Matrix4();
  function draw(time: number, reduced: boolean) {
    pool.beginFrame();
    pool.draw(0, 0, 0, 2.1, 0.7, time, reduced);
    pool.mesh.getMatrixAt(0, matrix);
    return matrix.toArray();
  }
  expect(draw(0.1, false)).not.toEqual(draw(0.2, false));
  expect(draw(0.1, true)).toEqual(draw(0.2, true));
  pool.dispose();
});
