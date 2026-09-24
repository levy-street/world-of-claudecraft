import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { FragmentKind } from '../src/render/ability_vfx/production_assets';
import { SolidImpactFragments } from '../src/render/ability_vfx/solid_impact_fragments';
import { prepareImpactFragments } from './helpers/impact_fragment_prewarm';

vi.mock('../src/render/ability_vfx/production_assets', async () => {
  const { IcosahedronGeometry, Texture } = await import('three');
  const geometry = new IcosahedronGeometry(1, 0);
  const rock = new Texture();
  return { fragmentGeometry: () => geometry, warriorRockTexture: () => rock };
});

async function rig(kind: FragmentKind) {
  const scene = new THREE.Scene();
  const pool = new SolidImpactFragments(scene);
  await prepareImpactFragments(pool);
  const mesh = scene.children.find((node) => node.name === `solidImpact:${kind}`) as THREE.Mesh<
    THREE.InstancedBufferGeometry,
    THREE.ShaderMaterial
  >;
  const ground = vi.fn((x: number, z: number) => 0.01 * x + 0.02 * z);
  const burst = (scale?: number, detail = false) =>
    scale === undefined
      ? pool.burst(kind, 3, 0.7, 5, 0xaabbcc, 14, 1.3, 0.4, 1, ground, 0.9, true)
      : pool.burst(kind, 3, 0.7, 5, 0xaabbcc, 14, 1.3, 0.4, 1, ground, 0.9, true, scale, detail);
  const snapshot = () =>
    Object.fromEntries(
      Object.entries(mesh.geometry.attributes).map(([name, attribute]) => [
        name,
        Array.from(attribute.array),
      ]),
    );
  return { scene, pool, mesh, ground, burst, snapshot };
}

describe('solid impact fragment size independent of physical trajectory', () => {
  it.each(['stone_chip', 'metal_splinter', 'ice_shard'] as const)(
    '%s default and explicit one preserve all existing buffer data',
    async (kind) => {
      const original = await rig(kind),
        explicit = await rig(kind);
      expect(original.burst()).toBe(14);
      expect(explicit.burst(1)).toBe(14);
      expect(explicit.snapshot()).toEqual(original.snapshot());
      expect(explicit.ground.mock.calls).toEqual(original.ground.mock.calls);
      original.pool.dispose();
      explicit.pool.dispose();
    },
  );

  it('enlarges only size while preserving trajectories, duration and the same capped pool', async () => {
    const base = await rig('stone_chip'),
      large = await rig('stone_chip');
    const geometry = large.mesh.geometry,
      material = large.mesh.material;
    for (const count of [14, 14, 4, 0]) {
      expect(base.burst(1)).toBe(count);
      expect(large.burst(4)).toBe(count);
    }
    const a = base.mesh.geometry.getAttribute('aLife'),
      b = geometry.getAttribute('aLife');
    for (let i = 0; i < 32; i++) {
      expect(b.getZ(i)).toBe(a.getZ(i) * 4);
      expect([b.getX(i), b.getY(i), b.getW(i)]).toEqual([a.getX(i), a.getY(i), a.getW(i)]);
    }
    for (const name of ['aOrigin', 'aVelocity', 'aShape', 'aTint'])
      expect(Array.from(geometry.getAttribute(name).array)).toEqual(
        Array.from(base.mesh.geometry.getAttribute(name).array),
      );
    expect(large.ground.mock.calls).toEqual(base.ground.mock.calls);
    expect(large.mesh.geometry).toBe(geometry);
    expect(large.mesh.material).toBe(material);
    expect(geometry.instanceCount).toBe(32);
    expect(
      large.scene.children.filter((node) => node.name.startsWith('solidImpact:')),
    ).toHaveLength(3);
    expect(
      large.scene.children
        .filter((node) => !node.name.startsWith('solidImpact:'))
        .every((node) => !node.visible),
    ).toBe(true);
    base.pool.update(0.91, false);
    large.pool.update(0.91, false);
    expect(base.mesh.visible).toBe(false);
    expect(large.mesh.visible).toBe(false);
    expect(base.burst(1)).toBe(14);
    expect(large.burst(4)).toBe(14);
    base.pool.dispose();
    large.pool.dispose();
  });

  it('authors thick mineral chunks without changing their trajectory, lifetime or other instances', async () => {
    const base = await rig('stone_chip'),
      thick = await rig('stone_chip');
    expect(base.burst(3, true)).toBe(14);
    expect(
      thick.pool.burst(
        'stone_chip',
        3,
        0.7,
        5,
        0xaabbcc,
        14,
        1.3,
        0.4,
        1,
        thick.ground,
        0.9,
        true,
        3,
        true,
        3.2,
      ),
    ).toBe(14);
    const before = base.snapshot(),
      after = thick.snapshot();
    const originalShape = base.mesh.geometry.getAttribute('aShape');
    const thickShape = thick.mesh.geometry.getAttribute('aShape');
    for (let i = 0; i < 14; i++) {
      expect(thickShape.getY(i)).toBeCloseTo(originalShape.getY(i) * 3.2, 6);
      expect([thickShape.getX(i), thickShape.getZ(i), thickShape.getW(i)]).toEqual([
        originalShape.getX(i),
        originalShape.getZ(i),
        originalShape.getW(i),
      ]);
    }
    delete before.aShape;
    delete after.aShape;
    expect(after).toEqual(before);
    expect(thick.ground.mock.calls).toEqual(base.ground.mock.calls);
    thick.pool.update(1, false);
    base.pool.update(1, false);
    expect(thick.burst(3)).toBe(14);
    expect(base.burst(3)).toBe(14);
    expect(thick.snapshot()).toEqual(base.snapshot());
    thick.pool.dispose();
    base.pool.dispose();
  });

  it.each([
    [0.01, 0.25],
    [500, 5],
  ])('clamps positive size %s to %s', async (requested, bound) => {
    const a = await rig('stone_chip'),
      b = await rig('stone_chip');
    expect(a.burst(requested)).toBe(14);
    expect(b.burst(bound)).toBe(14);
    expect(a.snapshot()).toEqual(b.snapshot());
    a.pool.dispose();
    b.pool.dispose();
  });

  it('rejects nonfinite and nonpositive scales without consuming slots or advancing the pattern', async () => {
    const subject = await rig('stone_chip'),
      untouched = await rig('stone_chip');
    const before = subject.snapshot();
    for (const value of [NaN, Infinity, -Infinity, 0, -1]) expect(subject.burst(value)).toBe(0);
    expect(subject.snapshot()).toEqual(before);
    expect(subject.ground).not.toHaveBeenCalled();
    expect(subject.mesh.visible).toBe(false);
    expect(subject.burst(1)).toBe(14);
    expect(untouched.burst(1)).toBe(14);
    expect(subject.snapshot()).toEqual(untouched.snapshot());
    subject.pool.dispose();
    untouched.pool.dispose();
  });
});

describe('opt-in prepared mineral surface', () => {
  it.each(['stone_chip', 'metal_splinter', 'ice_shard'] as const)(
    '%s detail changes only the stone instance flag, never physics or pool allocation',
    async (kind) => {
      const base = await rig(kind),
        detailed = await rig(kind);
      const material = detailed.mesh.material,
        geometry = detailed.mesh.geometry;
      const shader = material.fragmentShader,
        texture = material.uniforms.uRockMap.value;
      expect(texture).toBeInstanceOf(THREE.Texture);
      for (const count of [14, 14, 4, 0]) {
        expect(base.burst(3)).toBe(count);
        expect(detailed.burst(3, true)).toBe(count);
      }
      const original = base.snapshot(),
        result = detailed.snapshot();
      expect(original.aDetail).toEqual(Array(32).fill(0));
      expect(result.aDetail).toEqual(Array(32).fill(kind === 'stone_chip' ? 1 : 0));
      delete original.aDetail;
      delete result.aDetail;
      expect(result).toEqual(original);
      expect(Object.values(result).flat().every(Number.isFinite)).toBe(true);
      expect(detailed.ground.mock.calls).toEqual(base.ground.mock.calls);
      expect(detailed.mesh.material).toBe(material);
      expect(detailed.mesh.geometry).toBe(geometry);
      expect(material.uniforms.uRockMap.value).toBe(texture);
      expect(material.fragmentShader).toBe(shader);
      expect(
        detailed.scene.children.filter((node) => node.name.startsWith('solidImpact:')),
      ).toHaveLength(3);
      expect(
        detailed.scene.children
          .filter((node) => !node.name.startsWith('solidImpact:'))
          .every((node) => !node.visible),
      ).toBe(true);
      detailed.pool.update(1, false);
      expect(detailed.burst(3, false)).toBe(14);
      expect(Array.from(geometry.getAttribute('aDetail').array).slice(0, 14)).toEqual(
        Array(14).fill(0),
      );
      base.pool.dispose();
      detailed.pool.dispose();
    },
  );
});
