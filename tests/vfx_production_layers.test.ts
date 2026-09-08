import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/ability_vfx/production_assets', async () => {
  const three = await import('three');
  const textures = {
    shout_dust: new three.Texture(),
    smoke: new three.Texture(),
    shockwave: new three.Texture(),
  };
  const source = new three.IcosahedronGeometry(1, 0);
  return {
    bakedTexture: (kind: keyof typeof textures) => textures[kind],
    fragmentGeometry: () => source,
    warriorPressureTexture: () => null,
  };
});

import { BakedImpactLayers } from '../src/render/ability_vfx/baked_impact_layers';
import { bakedTexture, fragmentGeometry } from '../src/render/ability_vfx/production_assets';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import { SignatureCrests } from '../src/render/ability_vfx/signature_crests';
import { SolidImpactFragments } from '../src/render/ability_vfx/solid_impact_fragments';
import { drawWarriorShout } from '../src/render/ability_vfx/warrior_shouts';
import { WARRIOR_VFX_FULL_SPECS } from '../src/render/warrior_vfx_specs';

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

it('two full shouts retain four dust quadrants each beside two other live spell volumes', () => {
  const scene = new THREE.Scene(),
    pool = new BakedImpactLayers(scene);
  for (let i = 0; i < 2; i++) pool.spawn('smoke', i, 0, 0, 2, 0xffffff, 0, 1, 0, 0, 0);
  const accepted: boolean[] = [];
  const host = {
    anchorOf: (_id: number, _fraction: number, out: THREE.Vector3) =>
      Object.assign(out, { x: 0, y: 0, z: 0 }),
    groundYAt: () => 0,
    facingAt: () => 0,
    crestAt: vi.fn(),
    pulseLight: vi.fn(),
    fragmentsAt: vi.fn(),
    pathRibbon: vi.fn(),
    countPrimitive: vi.fn(),
    burstAt: vi.fn(),
    bakedAt: (...args: Parameters<NonNullable<SequencerHost['bakedAt']>>) => {
      const [kind, x, y, z, size, tint, hot, duration, delay, heat, angle] = args;
      const success = pool.spawn(kind, x, y, z, size, tint, hot, duration, delay, heat, 0, angle);
      accepted.push(success);
      return success;
    },
  } as unknown as SequencerHost;
  const slot = {
    abilityId: 'piercing_howl',
    casterId: 1,
    targetId: 1,
    tier: 0,
    spec: WARRIOR_VFX_FULL_SPECS.piercing_howl,
  } as SeqSlot;
  for (let caster = 1; caster <= 2; caster++) {
    slot.casterId = caster;
    for (let beat = 0; beat < slot.spec.physical!.beats.length; beat++)
      drawWarriorShout(host, slot, beat);
  }
  expect(accepted).toEqual(Array(8).fill(true));
  pool.update(0.2, new THREE.Quaternion(), false);
  expect(meshes(scene).filter((mesh) => mesh.visible)).toHaveLength(10);
  const dust = meshes(scene).filter(
    (mesh) => mesh.material.uniforms.uMap.value === bakedTexture('shout_dust'),
  );
  expect(dust).toHaveLength(8);
  for (const mesh of dust) {
    expect(mesh.position.y).toBeCloseTo(0.08);
    expect(mesh.material.uniforms.uAuthored.value).toBe(0);
    expect(mesh.material.uniforms.uGutter.value).toBe(4 / 256);
    expect(mesh.material.uniforms.uPivot.value.y).toBeCloseTo(0.5 + 1.25 / 5.6);
    expect(mesh.material.uniforms.uHeat.value).toBe(0);
  }
  drawWarriorShout(host, slot, 0);
  expect(accepted.slice(8)).toEqual(Array(4).fill(false));
  expect(host.burstAt).toHaveBeenCalledTimes(4);
  pool.dispose();
});


it('plays the dust sprite frames while moving out across sampled ground, then holds motion when requested', () => {
  const scene=new THREE.Scene(), pool=new BakedImpactLayers(scene);
  const floor=vi.fn((x:number,z:number)=>x*.2+z*.3);
  expect(pool.spawn('shout_dust',0,.08,0,8,0xd3bb95,0,1,0,0,0,Math.PI/2,floor)).toBe(true);
  const mesh=meshes(scene)[0];
  const samples=floor.mock.calls.length;
  pool.update(.2,new THREE.Quaternion(),false);
  const firstFrame=mesh.material.uniforms.uFrame.value;
  const firstX=mesh.position.x;
  expect(firstFrame).toBeGreaterThan(0);
  expect(mesh.position.y).toBeCloseTo(.08+mesh.position.x*.2,5);
  pool.update(.15,new THREE.Quaternion(),false);
  expect(mesh.material.uniforms.uFrame.value).toBeGreaterThan(firstFrame);
  expect(mesh.position.x).toBeGreaterThan(firstX);
  pool.update(.1,new THREE.Quaternion(),true);
  const frozenPosition=mesh.position.clone();
  expect(mesh.material.uniforms.uFrame.value).toBeCloseTo(.36*63);
  pool.update(.1,new THREE.Quaternion(),true);
  expect(mesh.position.equals(frozenPosition)).toBe(true);
  expect(mesh.material.uniforms.uFrame.value).toBeCloseTo(.36*63);
  expect(floor).toHaveBeenCalledTimes(samples);
  pool.dispose();
});
