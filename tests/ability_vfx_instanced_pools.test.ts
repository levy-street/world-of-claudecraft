// The two pooled families that never deform per slot (buff/barrier shells and
// light pillars) draw as ONE InstancedMesh each, not one mesh and one cloned
// material per slot. A raid frame used to pay eight shell and ten pillar
// materials, each a setProgram, a VAO bind and a full uniform upload, to draw
// copies of a single sphere and a single tapered cylinder.
//
// These pins hold the three things that make that safe: one material and one
// geometry for the family, an instance count that tracks the live slots (so an
// idle pool leaves the render list entirely), and a bounding sphere refreshed
// from the packed instances, because three caches an InstancedMesh's own sphere
// once and would otherwise cull a moving shell against a stale one.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LightPillars } from '../src/render/ability_vfx/pillars';
import { BuffShells } from '../src/render/ability_vfx/shells';

function instanced(scene: THREE.Scene): THREE.InstancedMesh {
  const drawables = scene.children.filter((child) => (child as THREE.Mesh).isMesh);
  expect(drawables).toHaveLength(1);
  const mesh = drawables[0] as THREE.InstancedMesh;
  expect(mesh.isInstancedMesh).toBe(true);
  expect(mesh.userData.renderCategory).toBe('vfx');
  return mesh;
}

const anchorAt =
  (x: number, y: number, z: number) => (_id: number, _frac: number, out?: THREE.Vector3) =>
    (out ?? new THREE.Vector3()).set(x, y, z);

describe('BuffShells', () => {
  it('draws the whole pool through one instanced mesh', () => {
    const scene = new THREE.Scene();
    const shells = new BuffShells(scene);
    const mesh = instanced(scene);
    expect(Array.isArray(mesh.material)).toBe(false);
    expect(mesh.geometry.getAttribute('aColor')).toBeDefined();
    expect(mesh.geometry.getAttribute('aOpacity')).toBeDefined();
    shells.dispose();
  });

  it('leaves the render list while no shell is live', () => {
    const scene = new THREE.Scene();
    const shells = new BuffShells(scene);
    const mesh = instanced(scene);
    expect(mesh.count).toBe(0);
    expect(mesh.visible).toBe(false);

    shells.flash(7, 0x66ccff, 0.5);
    shells.update(1 / 60, 0, 1, anchorAt(3, 1, 4));
    expect(mesh.count).toBe(1);
    expect(mesh.visible).toBe(true);

    // Past its life the slot releases and the pool leaves again.
    shells.update(1, 1, 2, anchorAt(3, 1, 4));
    expect(mesh.count).toBe(0);
    expect(mesh.visible).toBe(false);
    shells.dispose();
  });

  it('front-packs live shells and carries each one colour and opacity', () => {
    const scene = new THREE.Scene();
    const shells = new BuffShells(scene);
    const mesh = instanced(scene);
    shells.flash(7, 0xff0000, 5);
    shells.flash(8, 0x00ff00, 5);
    shells.update(0.2, 0, 1, anchorAt(0, 1, 0));
    expect(mesh.count).toBe(2);

    const colors = mesh.geometry.getAttribute('aColor');
    const opacities = mesh.geometry.getAttribute('aOpacity');
    expect(colors.getX(0)).toBeGreaterThan(0.9);
    expect(colors.getY(0)).toBeCloseTo(0, 5);
    expect(colors.getY(1)).toBeGreaterThan(0.9);
    expect(colors.getX(1)).toBeCloseTo(0, 5);
    expect(opacities.getX(0)).toBeGreaterThan(0);

    // Releasing the FIRST one re-packs the second into instance 0, so the count
    // is never a high-water mark with holes drawn inside it.
    shells.sleepEntity(7);
    expect(mesh.count).toBe(1);
    shells.update(0.05, 0, 2, anchorAt(0, 1, 0));
    expect(mesh.geometry.getAttribute('aColor').getY(0)).toBeGreaterThan(0.9);
    shells.dispose();
  });

  it('refreshes the bounding sphere from the live instances', () => {
    const scene = new THREE.Scene();
    const shells = new BuffShells(scene);
    const mesh = instanced(scene);
    shells.flash(7, 0x66ccff, 5);
    shells.update(0.2, 0, 1, anchorAt(100, 2, -40));
    const sphere = mesh.boundingSphere as THREE.Sphere;
    expect(sphere.center.x).toBeCloseTo(100, 5);
    expect(sphere.center.z).toBeCloseTo(-40, 5);
    expect(sphere.radius).toBeGreaterThan(0);
    // A shell that moves takes the sphere with it: a cached one would cull it.
    shells.update(0.2, 0, 2, anchorAt(-70, 2, 15));
    expect(sphere.center.x).toBeCloseTo(-70, 5);
    shells.dispose();
  });
});

describe('LightPillars', () => {
  it('draws the whole pool through one instanced mesh', () => {
    const scene = new THREE.Scene();
    const pillars = new LightPillars(scene);
    const mesh = instanced(scene);
    expect(mesh.geometry.getAttribute('aColor')).toBeDefined();
    expect(mesh.geometry.getAttribute('aOpacity')).toBeDefined();
    pillars.dispose();
  });

  it('counts live columns and leaves the render list when they expire', () => {
    const scene = new THREE.Scene();
    const pillars = new LightPillars(scene);
    const mesh = instanced(scene);
    expect(mesh.count).toBe(0);

    pillars.spawn(2, 0, 3, 1, 12, 0xffaa33, 0.6);
    pillars.spawn(5, 0, 3, 1, 12, 0xffaa33, 0.6);
    // Spawn packs immediately, so a column spawned outside the update pass
    // (prewarmSpawn, behind the loading cover) is still submitted.
    expect(mesh.count).toBe(2);
    pillars.update(0.2);
    expect(mesh.count).toBe(2);
    expect(mesh.geometry.getAttribute('aOpacity').getX(0)).toBeGreaterThan(0);

    pillars.update(1);
    expect(mesh.count).toBe(0);
    expect(mesh.visible).toBe(false);
    pillars.dispose();
  });

  it('keeps the authored colour lift the basic material carried', () => {
    const scene = new THREE.Scene();
    const pillars = new LightPillars(scene);
    const mesh = instanced(scene);
    pillars.spawn(0, 0, 0, 1, 12, 0x804020, 0.6);
    pillars.update(0.1);
    // MeshBasicMaterial.color.setHex(hex).multiplyScalar(1.7) was the old form.
    const expected = new THREE.Color(0x804020).multiplyScalar(1.7);
    const colors = mesh.geometry.getAttribute('aColor');
    expect(colors.getX(0)).toBeCloseTo(expected.r, 5);
    expect(colors.getY(0)).toBeCloseTo(expected.g, 5);
    expect(colors.getZ(0)).toBeCloseTo(expected.b, 5);
    pillars.dispose();
  });

  it('clear() empties the pool', () => {
    const scene = new THREE.Scene();
    const pillars = new LightPillars(scene);
    const mesh = instanced(scene);
    pillars.spawn(0, 0, 0, 1, 12, 0xffffff, 0.6);
    expect(mesh.count).toBe(1);
    pillars.clear();
    expect(mesh.count).toBe(0);
    expect(mesh.visible).toBe(false);
    pillars.dispose();
  });
});
