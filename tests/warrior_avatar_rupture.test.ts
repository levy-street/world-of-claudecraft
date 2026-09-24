import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { ACTIVE_WARRIOR_CRESTS } from '../src/render/ability_vfx/active_kit_prewarm';
import type { SequencerHost } from '../src/render/ability_vfx/sequencer';
import { SignatureCrests } from '../src/render/ability_vfx/signature_crests';
import {
  drawWarriorAvatarRupture,
  warriorAvatarRuptureShape,
} from '../src/render/ability_vfx/warrior_avatar_rupture';

it('sculpts closed outward slabs with an open central wearer space', () => {
  const geometry = warriorAvatarRuptureShape(),
    p = geometry.getAttribute('position');
  const edges = new Map<string, number>();
  const key = (v: THREE.Vector3) =>
    v
      .toArray()
      .map((n) => n.toFixed(5))
      .join(',');
  let volume = 0;
  for (let i = 0; i < p.count; i += 3) {
    const [a, b, c] = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(p, i + j));
    const normal = b.clone().sub(a).cross(c.clone().sub(a));
    expect(normal.lengthSq()).toBeGreaterThan(1e-10);
    volume += a.dot(b.clone().cross(c)) / 6;
    const floorTriangle = new THREE.Triangle(
      ...([a, b, c].map((v) => new THREE.Vector3(v.x, 0, v.z)) as [
        THREE.Vector3,
        THREE.Vector3,
        THREE.Vector3,
      ]),
    );
    // Check triangles, not just vertices: a face must not bridge across the actor.
    if (floorTriangle.getArea() > 1e-8)
      expect(
        floorTriangle.closestPointToPoint(new THREE.Vector3(), new THREE.Vector3()).length(),
      ).toBeGreaterThan(0.8);
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const edge = `${key(from)}>${key(to)}`;
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }
  for (const [edge, count] of edges) {
    const [from, to] = edge.split('>');
    expect(edges.get(`${to}>${from}`)).toBe(count);
  }
  expect(volume).toBeGreaterThan(5);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  expect(bounds.min.y).toBeGreaterThan(0);
  expect(bounds.max.x - bounds.min.x).toBeGreaterThan(6.5);
  expect(bounds.max.y).toBeGreaterThan(1.8);
  expect(p.count / 3).toBeLessThan(300);
  geometry.dispose();
});

it('prepares before first visibility and samples the rotated real ground for every slab', () => {
  const ground = (x: number, z: number) => x * 0.12 + z * 0.21;
  const scene = new THREE.Scene(),
    crests = new SignatureCrests(scene, ground);
  const cast = () =>
    crests.spawn(13, ground(13, -7), -7, 1, 1, 0x969284, 0xead5a9, 'avatar_rupture', 0.7, 0.66);
  expect(ACTIVE_WARRIOR_CRESTS).toContain('avatar_rupture');
  expect(cast()).toBe(false);
  vi.spyOn(crests.preparation, 'ready').mockReturnValue(true);
  expect(cast()).toBe(true);
  const mesh = scene.children.find((n) => n.name === 'signatureCrest' && n.visible) as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.ShaderMaterial
  >;
  expect(mesh.material.uniforms.uKind.value).toBe(21);
  const grid = mesh.material.uniforms.uPressureGround.value as Float32Array;
  for (let row = 0; row < 5; row++)
    for (let col = 0; col < 5; col++) {
      const x = (col / 4 - 0.5) * 8,
        z = (row / 4 - 0.5) * 8;
      expect(grid[row * 5 + col]).toBeCloseTo(
        ground(
          13 + x * Math.cos(0.7) + z * Math.sin(0.7),
          -7 + z * Math.cos(0.7) - x * Math.sin(0.7),
        ) - ground(13, -7),
        5,
      );
    }
  crests.clear();
  expect(mesh.visible).toBe(false);
  crests.dispose();
});

it.each([false, true])(
  'retains the complete primary transformation when the solid pool is full (full=%s)',
  (full) => {
    const paths: THREE.Vector3[][] = [];
    const host = {
      groundYAt: (x: number, z: number) => 0.1 * x + 0.05 * z,
      crestAt: vi.fn(() => false),
      bakedAt: vi.fn(() => false),
      fragmentsAt: vi.fn(),
      pathRibbon: vi.fn((_color, _width, _life, fill) => {
        const p = Array.from({ length: 20 }, () => new THREE.Vector3());
        fill(p);
        paths.push(p);
      }),
    } as unknown as SequencerHost;
    drawWarriorAvatarRupture(host, 4, -5, 0.7, full);
    expect(paths).toHaveLength(2);
    for (const p of paths) {
      expect(p.at(-1)!.y - host.groundYAt(p.at(-1)!.x, p.at(-1)!.z)).toBeCloseTo(3.48);
      for (const v of p) expect(v.y).toBeGreaterThan(host.groundYAt(v.x, v.z));
    }
    expect(host.crestAt).toHaveBeenCalledTimes(1);
    expect(host.bakedAt).toHaveBeenCalledTimes(2);
  },
);
