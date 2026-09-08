import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { BakedImpactLayers } from '../src/render/ability_vfx/baked_impact_layers';
import { bakedTexture } from '../src/render/ability_vfx/production_assets';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import {
  drawWarriorPowerCast,
  warriorPowerRelease,
} from '../src/render/ability_vfx/warrior_power_cast';

vi.mock('../src/render/ability_vfx/production_assets', async () => {
  const { Texture } = await import('three');
  const texture = new Texture();
  return { bakedTexture: () => texture };
});

it('mirrors the authored pivot and plays a real inward extraction instead of an outward burst', () => {
  const scene = new THREE.Scene(),
    pool = new BakedImpactLayers(scene, () => true);
  expect(
    pool.spawn(
      'warrior_power',
      0,
      1.2,
      0,
      4.6,
      0xffffff,
      0xffffff,
      0.5,
      0,
      0.8,
      0,
      0,
      undefined,
      false,
    ),
  ).toBe(true);
  expect(
    pool.spawn(
      'warrior_power',
      0,
      1.2,
      0,
      4.6,
      0xffffff,
      0xffffff,
      0.5,
      0,
      0.8,
      0,
      Math.PI,
      undefined,
      true,
    ),
  ).toBe(true);
  pool.update(0.1, new THREE.Quaternion(), false);
  const [forward, reverse] = scene.children as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.ShaderMaterial
  >[];
  expect(forward.material.uniforms.uFrame.value).toBeCloseTo(12.6);
  expect(reverse.material.uniforms.uFrame.value).toBeCloseTo(50.4);
  expect(forward.material.uniforms.uMirror.value).toBe(1);
  expect(reverse.material.uniforms.uMirror.value).toBe(-1);
  expect(
    forward.material.uniforms.uPivot.value.x + reverse.material.uniforms.uPivot.value.x,
  ).toBeCloseTo(1);
  expect(forward.position.y).toBe(1.2);
  expect(reverse.position.y).toBe(1.2);
  pool.update(0.1, new THREE.Quaternion(), true);
  expect(reverse.material.uniforms.uFrame.value).toBeCloseTo(22.68);
  pool.clear();
  pool.spawn('smoke', 0, 1.2, 0, 4.6, 0xffffff, 0xffffff, 0.5, 0, 0, 0);
  pool.update(0.1, new THREE.Quaternion(), false);
  expect(forward.material.uniforms.uFrame.value).toBeCloseTo(12.6);
  expect(forward.material.uniforms.uPivot.value.x).toBe(0.5);
  expect(forward.material.uniforms.uMirror.value).toBe(1);
  pool.dispose();
});

it('keeps a decoded power atlas cold until this renderer has completed its upload', () => {
  const ready = new WeakSet<THREE.Texture>();
  const pool = new BakedImpactLayers(new THREE.Scene(), (texture) => ready.has(texture));
  const cast = (target = pool) =>
    target.spawn('warrior_power', 0, 1, 0, 5, 0xffffff, 0xffffff, 0.3, 0, 1, 0);
  // Queued, cancelled and failed work never enters the renderer's ready set.
  expect(cast()).toBe(false);
  const upload = () => {
    throw Error('upload failed');
  };
  expect(upload).toThrow('upload failed');
  expect(cast()).toBe(false);
  ready.add(bakedTexture('warrior_power')!);
  expect(cast()).toBe(true);
  const replacement = new BakedImpactLayers(new THREE.Scene(), () => false);
  expect(cast(replacement)).toBe(false);
  const unprepared = new BakedImpactLayers(new THREE.Scene());
  expect(cast(unprepared)).toBe(false);
  expect(unprepared.spawn('smoke', 0, 1, 0, 5, 0xffffff, 0xffffff, 0.3, 0, 1, 0)).toBe(true);
  pool.dispose();
  replacement.dispose();
  unprepared.dispose();
});

it('gives each power its own physical sentence without enemy impacts or generic rings', () => {
  const paths: Record<string, number[][][]> = {};
  for (const id of ['avatar', 'recklessness', 'bloodrage', 'berserker_rage']) {
    paths[id] = [];
    const host = new Proxy(
      {
        anchorOf: (_id: number, _f: number, out: object) =>
          Object.assign(out, { x: 0, y: 0, z: 0 }),
        groundYAt: () => 0,
        facingAt: () => 0,
        pathRibbon: (
          _c: number,
          _w: number,
          _life: number,
          fill: (points: THREE.Vector3[]) => number,
        ) => {
          const points = Array.from({ length: 20 }, () => new THREE.Vector3());
          const count = fill(points);
          paths[id].push(points.slice(0, count).map((p) => p.toArray()));
        },
      },
      {
        get(target, key) {
          if (!(key in target)) Reflect.set(target, key, vi.fn());
          return Reflect.get(target, key);
        },
      },
    ) as unknown as SequencerHost;
    const slot = {
      abilityId: id,
      casterId: 1,
      targetId: 1,
      tier: 0,
      physicalSecondary: false,
    } as SeqSlot;
    warriorPowerRelease(host, slot);
    expect(drawWarriorPowerCast(host, slot, 0)).toBe(true);
    expect(host.ringAt).not.toHaveBeenCalled();
    expect(host.glowPulse).not.toHaveBeenCalled();
    expect(host.contact).not.toHaveBeenCalled();
    expect(paths[id].length).toBeGreaterThan(1);
    const calls = vi.mocked(host.bakedAt!).mock.calls;
    if (id === 'bloodrage') {
      expect(calls).toHaveLength(2);
      expect(calls.every((c) => c[0] === 'warrior_power' && c[11] === true)).toBe(true);
    } else if (id !== 'avatar')
      expect(calls.filter((c) => c[0] === 'warrior_power')).toHaveLength(2);
    else expect(calls.every((c) => c[0] === 'shout_dust')).toBe(true);
  }
  expect(new Set(Object.values(paths).map((p) => JSON.stringify(p))).size).toBe(4);
});
