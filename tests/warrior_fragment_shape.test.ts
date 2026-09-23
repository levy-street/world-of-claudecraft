import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { SolidImpactFragments } from '../src/render/ability_vfx/solid_impact_fragments';
import { prepareImpactFragments } from './helpers/impact_fragment_prewarm';

vi.mock('../src/render/ability_vfx/production_assets', async () => {
  const { IcosahedronGeometry } = await import('three');
  const geometry = new IcosahedronGeometry(1, 0);
  return { fragmentGeometry: () => geometry, warriorRockTexture: () => null };
});

it('varies Warrior stone aspect, tint and rotation inside the existing shared pool', async () => {
  const scene = new THREE.Scene(),
    pool = new SolidImpactFragments(scene);
  await prepareImpactFragments(pool);
  const mesh = scene.children.find((n) => n.name === 'solidImpact:stone_chip') as THREE.Mesh<
    THREE.InstancedBufferGeometry,
    THREE.ShaderMaterial
  >;
  const attributes = Object.keys(mesh.geometry.attributes);
  const burst = (fractured: boolean) =>
    pool.burst('stone_chip', 0, 0.2, 0, 0xaabbcc, 14, 1.6, 0, 1, () => 0, 0.6, fractured);
  expect(burst(true)).toBe(14);
  const shape = mesh.geometry.getAttribute('aShape'),
    tint = mesh.geometry.getAttribute('aTint'),
    life = mesh.geometry.getAttribute('aLife');
  expect(new Set(Array.from({ length: 14 }, (_, i) => shape.getY(i)))).toHaveLength(4);
  expect(
    Math.max(...Array.from({ length: 14 }, (_, i) => shape.getY(i) / shape.getX(i))),
  ).toBeGreaterThan(4);
  expect(
    Math.min(...Array.from({ length: 14 }, (_, i) => shape.getY(i) / shape.getX(i))),
  ).toBeLessThan(0.25);
  expect(new Set(Array.from({ length: 14 }, (_, i) => tint.getX(i))).size).toBeGreaterThan(8);
  for (let i = 0; i < 14; i++) expect(life.getW(i)).toBeLessThan(0);
  expect(burst(true)).toBe(14);
  expect(burst(true)).toBe(4);
  expect(burst(true)).toBe(0);
  expect(mesh.geometry.instanceCount).toBe(32);
  expect(Object.keys(mesh.geometry.attributes)).toEqual(attributes);
  pool.clear();
  expect(burst(false)).toBe(14);
  for (let i = 0; i < 14; i++) {
    expect(shape.getY(i)).toBe(1);
    expect(shape.getZ(i)).toBeCloseTo(0.7);
    expect(life.getW(i)).toBeGreaterThan(0);
  }
  pool.update(0.7, true);
  expect(mesh.visible).toBe(false);
  pool.dispose();
});
