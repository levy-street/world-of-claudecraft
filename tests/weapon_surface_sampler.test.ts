import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ShamanWeaponEnchantments } from '../src/render/ability_vfx/shaman_weapon_enchantments';
import { weaponTrailAnchor } from '../src/render/weapon_trail_anchor';

function fixture(longAxis: 'x' | 'y' | 'z') {
  const root = new THREE.Group();
  const holder = new THREE.Group();
  holder.userData.heldPropHolder = true;
  holder.userData.heldSlot = 0;
  root.add(holder);
  const dimensions =
    longAxis === 'x' ? [1.6, 0.62, 0.12] : longAxis === 'y' ? [0.62, 1.6, 0.12] : [0.12, 0.62, 1.6];
  const blade = new THREE.Mesh(new THREE.BoxGeometry(...(dimensions as [number, number, number])));
  blade.userData.weaponMesh = true;
  holder.add(blade);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12));
  handle.userData.weaponMesh = true;
  handle.position.y = -0.7;
  holder.add(handle);
  const sample = weaponTrailAnchor(root, 0);
  if (!sample) throw new Error('Missing weapon sampler');
  return { root, holder, blade, handle, sample };
}

describe('actual equipped weapon surface bounds', () => {
  it('places persistent water across both real blade faces rather than inside the grip', () => {
    const h = fixture('z');
    const painter = new ShamanWeaponEnchantments();
    const frame = new THREE.Matrix4(),
      extents = new THREE.Vector3();
    expect(h.sample.surface?.(frame, extents)).toBe(true);
    const inverse = frame.clone().invert();
    const paths: THREE.Vector3[][] = [];
    const ribbons = {
      appendHeld(points: THREE.Vector3[], count: number) {
        paths.push(points.slice(0, count).map((p) => p.clone().applyMatrix4(inverse)));
      },
    };
    painter.draw(h.sample, 4, 0, 30, true, ribbons, { push() {} });
    expect(paths).toHaveLength(4);
    expect(paths[0].every((p) => p.z < -extents.z)).toBe(true);
    expect(paths[2].every((p) => p.z > extents.z)).toBe(true);
    for (const path of paths) {
      expect(path[0].y).toBeCloseTo(-extents.y);
      expect(path[path.length - 1].y).toBeCloseTo(extents.y);
      const xs = path.map((p) => p.x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(extents.x);
    }
  });

  it.each(['x', 'y', 'z'] as const)(
    'covers every mesh and face when the authored longest axis is %s',
    (axis) => {
      const h = fixture(axis);
      const frame = new THREE.Matrix4(),
        extents = new THREE.Vector3();
      expect(h.sample.surface?.(frame, extents)).toBe(true);
      expect(extents.y).toBeGreaterThan(0.6);
      expect(extents.x).toBeGreaterThan(extents.z);
      const inverse = frame.clone().invert();
      for (const mesh of [h.blade, h.handle]) {
        mesh.updateWorldMatrix(true, false);
        const positions = mesh.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          const p = new THREE.Vector3()
            .fromBufferAttribute(positions, i)
            .applyMatrix4(mesh.matrixWorld)
            .applyMatrix4(inverse);
          expect(Math.abs(p.x)).toBeLessThanOrEqual(extents.x + 0.00001);
          expect(Math.abs(p.y)).toBeLessThanOrEqual(extents.y + 0.00001);
          expect(Math.abs(p.z)).toBeLessThanOrEqual(extents.z + 0.00001);
        }
      }
    },
  );

  it('tracks animated rotation and grip scaling without changing existing tip and face sampling', () => {
    const h = fixture('z');
    const frame = new THREE.Matrix4(),
      extents = new THREE.Vector3();
    const tip = new THREE.Vector3(),
      originalTip = new THREE.Vector3(),
      face = new THREE.Matrix4(),
      originalFace = new THREE.Matrix4();
    h.sample(originalTip);
    h.sample.frame?.(originalFace);
    h.sample.surface?.(frame, extents);
    h.sample(tip);
    h.sample.frame?.(face);
    expect(tip).toEqual(originalTip);
    expect(face).toEqual(originalFace);
    const before = extents.clone();
    h.holder.scale.setScalar(2);
    h.holder.rotation.set(0.3, 0.7, -0.2);
    h.holder.position.set(3, 4, 5);
    expect(h.sample.surface?.(frame, extents)).toBe(true);
    expect(extents.x).toBeCloseTo(before.x * 2);
    expect(extents.y).toBeCloseTo(before.y * 2);
    expect(extents.z).toBeCloseTo(before.z * 2);
    expect(new THREE.Vector3().setFromMatrixColumn(frame, 0).length()).toBeCloseTo(1);
  });

  it('refuses hidden and detached equipment instead of leaving a floating enchantment', () => {
    const h = fixture('y');
    const frame = new THREE.Matrix4(),
      extents = new THREE.Vector3();
    h.holder.visible = false;
    expect(h.sample.surface?.(frame, extents)).toBe(false);
    h.holder.visible = true;
    h.root.remove(h.holder);
    expect(h.sample.surface?.(frame, extents)).toBe(false);
  });
});
