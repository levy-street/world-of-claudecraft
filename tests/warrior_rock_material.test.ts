import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { buildIronguardShape } from '../src/render/ability_vfx/ironguard_shapes';
import { SignatureCrests } from '../src/render/ability_vfx/signature_crests';
import type { CrestKind } from '../src/render/ability_vfx/signature_shapes';

it('stone faces occlude their own rear triangles and return to transparent attack rendering on reuse', () => {
  const scene = new THREE.Scene(),
    pool = new SignatureCrests(scene, () => 0);
  vi.spyOn(pool.preparation, 'ready').mockReturnValue(true);
  const slots = scene.children.filter((n) => n.name === 'signatureCrest') as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.ShaderMaterial
  >[];
  expect(slots).toHaveLength(8);
  const material = slots[0].material;
  for (const kind of [
    'iron_quake',
    'iron_fault',
    'avatar_rupture',
    'leap_rupture',
  ] as CrestKind[]) {
    expect(pool.spawn(0, 0, 0, 1, 1, 0x889099, 0xffffff, kind, 0, 0.6)).toBe(true);
    expect(slots[0].material).toBe(material);
    expect(material.depthWrite).toBe(true);
    pool.clear();
    expect(pool.spawn(0, 1, 0, 1, 1, 0x889099, 0xffffff, 'steel_cut', 0, 0.2)).toBe(true);
    expect(material.depthWrite).toBe(false);
    pool.clear();
  }
  pool.dispose();
  expect(scene.children).toHaveLength(0);
});

it('Faultline keeps a clear caster opening while preserving its full outer reach and peak', () => {
  const geometry = buildIronguardShape('iron_fault');
  const positions = geometry.getAttribute('position');
  let nearest = Infinity,
    farthest = 0,
    peak = 0;
  for (let i = 0; i < positions.count; i++) {
    const radius = Math.hypot(positions.getX(i), positions.getZ(i));
    nearest = Math.min(nearest, radius);
    farthest = Math.max(farthest, radius);
    peak = Math.max(peak, positions.getY(i));
  }
  expect(nearest).toBeGreaterThan(2.1);
  expect(farthest).toBeCloseTo(8, 5);
  expect(peak).toBeCloseTo(3.54, 5);
  expect(geometry.getIndex()!.count / 3).toBeLessThan(1000);
  geometry.dispose();
});
