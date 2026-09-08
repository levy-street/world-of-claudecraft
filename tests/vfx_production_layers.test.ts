import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/ability_vfx/production_assets', async () => {
  const three = await import('three');
  const textures = { smoke: new three.Texture(), shockwave: new three.Texture() };
  const source = new three.IcosahedronGeometry(1, 0);
  return {
    bakedTexture: (kind: keyof typeof textures) => textures[kind],
    fragmentGeometry: () => source,
  };
});

import { BakedImpactLayers } from '../src/render/ability_vfx/baked_impact_layers';
import { bakedTexture, fragmentGeometry } from '../src/render/ability_vfx/production_assets';
import { SignatureCrests } from '../src/render/ability_vfx/signature_crests';
import { SolidImpactFragments } from '../src/render/ability_vfx/solid_impact_fragments';

function meshes(scene: THREE.Scene) {
  return scene.children as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[];
}

describe('baked impact volumes', () => {
  it('drapes a turned shockwave onto sloped ground without changing it every frame', () => {
    const scene = new THREE.Scene(),
      pool = new BakedImpactLayers(scene);
    const ground = (x: number, z: number) => x * 0.3 + z * 0.17;
    pool.spawn(
      'shockwave',
      2,
      ground(2, 3) + 0.08,
      3,
      7,
      0xffffff,
      0xffffff,
      1,
      0,
      0,
      ground(2, 3),
      0.6,
      ground,
    );
    const mesh = meshes(scene)[0],
      position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const point = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      expect(point.y).toBeCloseTo(ground(point.x, point.z) + 0.08, 5);
    }
    const version = position.version;
    pool.update(0.2, new THREE.Quaternion(), false);
    expect(position.version).toBe(version);
    pool.clear();
    pool.spawn('smoke', 0, 1, 0, 3, 0xffffff, 0xffffff, 1, 0, 0, 0);
    for (let i = 0; i < position.count; i++) expect(position.getZ(i)).toBe(0);
    pool.dispose();
  });
  it('holds delayed layers, blends temporal frames, and freezes volume motion for accessibility', () => {
    const scene = new THREE.Scene(),
      pool = new BakedImpactLayers(scene);
    expect(pool.spawn('smoke', 3, 2, 5, 4, 0x888888, 0xffbb66, 2, 0.2, 1, 0)).toBe(true);
    const mesh = meshes(scene)[0];
    const camera = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
    pool.update(0.1, camera, false);
    expect(mesh.visible).toBe(false);
    pool.update(0.6, camera, false);
    expect(mesh.visible).toBe(true);
    expect(mesh.material.uniforms.uFrame.value).toBeCloseTo(15.75);
    expect(mesh.quaternion.equals(camera)).toBe(true);
    expect(mesh.material.uniforms.uMap.value).toBe(bakedTexture('smoke'));
    expect(mesh.material.depthWrite).toBe(false);
    pool.update(0.1, camera, true);
    expect(mesh.material.uniforms.uFrame.value).toBeCloseTo(22.68);
    expect(mesh.position.y).toBe(2);
    pool.update(3, camera, false);
    expect(mesh.visible).toBe(false);
    pool.dispose();
  });

  it('caps concurrent volumes, clears prepared slots, and keeps shared atlases alive', () => {
    const scene = new THREE.Scene(),
      pool = new BakedImpactLayers(scene);
    const spawn = () => pool.spawn('shockwave', 0, 0.09, 0, 3, 0xffffff, 0xffffff, 1, 0, 0, 0);
    for (let i = 0; i < 10; i++) expect(spawn()).toBe(true);
    expect(spawn()).toBe(false);
    expect(scene.children).toHaveLength(10);
    pool.update(0.1, new THREE.Quaternion(), false);
    expect(meshes(scene)[0].rotation.x).toBeCloseTo(-Math.PI / 2);
    const atlas = bakedTexture('shockwave');
    if (!atlas) throw new Error('Missing test atlas');
    const dispose = vi.spyOn(atlas, 'dispose');
    pool.clear();
    expect(scene.children.every((m) => !m.visible)).toBe(true);
    expect(spawn()).toBe(true);
    expect(pool.spawn('smoke', NaN, 0, 0, 2, 0, 0, 1, 0, 0, 0)).toBe(false);
    pool.dispose();
    pool.dispose();
    expect(scene.children).toHaveLength(0);
    expect(dispose).not.toHaveBeenCalled();
    expect(spawn()).toBe(false);
  });
});

describe('solid fragment pool', () => {
  it('uses three opaque draws, bounded directional bursts, and uniform-only frame updates', () => {
    const scene = new THREE.Scene(),
      pool = new SolidImpactFragments(scene);
    const floor = vi.fn(() => 0);
    expect(pool.burst('ice_shard', 0, 1, 0, 0xaaccee, 99, 1, 10, 0, floor)).toBe(14);
    expect(floor).toHaveBeenCalledTimes(14);
    const mesh = meshes(scene)[0];
    expect(scene.children).toHaveLength(3);
    expect(mesh.material.depthWrite).toBe(true);
    expect(mesh.material.transparent).toBe(false);
    const velocity = mesh.geometry.getAttribute('aVelocity');
    let xSum = 0;
    for (let i = 0; i < 14; i++) xSum += velocity.getX(i);
    expect(xSum / 14).toBeGreaterThan(0.8);
    const life = mesh.geometry.getAttribute('aLife') as THREE.InstancedBufferAttribute;
    const version = life.version;
    pool.update(0.2, true);
    expect(life.version).toBe(version);
    expect(mesh.material.uniforms.uMotion.value).toBe(0);
    expect(pool.burst('ice_shard', 0, 1, 0, 0xffffff, 14, 1, 1, 0, floor)).toBe(14);
    expect(pool.burst('ice_shard', 0, 1, 0, 0xffffff, 14, 1, 1, 0, floor)).toBe(4);
    expect(pool.burst('ice_shard', 0, 1, 0, 0xffffff, 14, 1, 1, 0, floor)).toBe(0);
    pool.update(3, false);
    expect(mesh.visible).toBe(false);
    expect(pool.burst('ice_shard', 0, 1, 0, 0xffffff, 1, 1, 0, 0, floor)).toBe(1);
    pool.dispose();
  });

  it('rejects corrupt anchors and releases only owned geometry and materials', () => {
    const scene = new THREE.Scene(),
      pool = new SolidImpactFragments(scene);
    const source = fragmentGeometry('stone_chip');
    if (!source) throw new Error('Missing test fragment');
    const sourceDispose = vi.spyOn(source, 'dispose');
    expect(meshes(scene)[0].geometry.getAttribute('position')).not.toBe(
      source.getAttribute('position'),
    );
    expect(pool.burst('stone_chip', Infinity, 1, 0, 0, 12, 1, 0, 0, () => 0)).toBe(0);
    expect(pool.burst('stone_chip', 0, 1, 0, 0, 12, 1, 0, 0, () => NaN)).toBe(0);
    pool.clear();
    expect(scene.children.every((m) => !m.visible)).toBe(true);
    pool.dispose();
    pool.dispose();
    expect(sourceDispose).not.toHaveBeenCalled();
    expect(scene.children).toHaveLength(0);
  });
});

it('uses distinct prepared silhouettes and preserves their direction without rebuilding geometry', () => {
  const scene = new THREE.Scene(),
    pool = new SignatureCrests(scene);
  const kinds = ['ice', 'water', 'fire', 'shadow', 'light'] as const;
  for (const kind of kinds) pool.spawn(0, 0, 0, 1, 1, 0xffffff, 0xffffff, kind, 0.7);
  const active = meshes(scene).slice(0, 5);
  expect(new Set(active.map((m) => m.geometry)).size).toBe(5);
  expect(new Set(active.map((m) => m.geometry.getAttribute('position').count)).size).toBe(5);
  const geometries = active.map((m) => m.geometry);
  pool.update(0.25, true);
  for (const mesh of active) {
    expect(mesh.rotation.y).toBeCloseTo(0.7);
    expect(mesh.material.uniforms.uMotion.value).toBe(0);
    expect(Array.from(mesh.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(
      true,
    );
  }
  pool.update(0.25, false);
  expect(active.map((m) => m.geometry)).toEqual(geometries);
  pool.dispose();
  expect(scene.children).toHaveLength(0);
});
