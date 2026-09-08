import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import { drawWarriorShield } from '../src/render/ability_vfx/warrior_shield';
import { buildWarriorShield } from '../src/render/ability_vfx/warrior_shield_shape';
import { WARRIOR_VFX_FULL_SPECS } from '../src/render/warrior_vfx_specs';

it('builds bounded solid plates with depth and finite unit normals', () => {
  const geometry = buildWarriorShield();
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new THREE.Vector3());
  expect(size.x).toBeGreaterThan(2);
  expect(size.y).toBeGreaterThan(2);
  expect(size.z).toBeGreaterThan(0.25);
  const positions = geometry.getAttribute('position');
  expect(positions.count / 3).toBeLessThan(200);
  for (const attribute of Object.values(geometry.attributes))
    expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
  const normals = geometry.getAttribute('normal');
  for (let i = 0; i < normals.count; i++)
    expect(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i))).toBeCloseTo(1, 5);
  geometry.dispose();
});

it('keeps the complete shield and target imprint at reduced detail and during cold preparation', () => {
  const ribbon = vi.fn(),
    contact = vi.fn(),
    crest = vi.fn<NonNullable<SequencerHost['crestAt']>>(() => false);
  let targetX = 2;
  const host = {
    anchorOf: (id: number, fraction: number, out: THREE.Vector3) =>
      Object.assign(out, {
        x: id === 1 ? 0 : targetX,
        y: fraction * 2,
        z: id === 1 ? 0 : 3,
      }),
    groundYAt: () => -1,
    crestAt: crest,
    pathRibbon: ribbon,
    contact,
    flipbookAt: vi.fn(),
    fragmentsAt: vi.fn(),
    burstAt: vi.fn(),
    bakedAt: vi.fn(),
    pulseLight: vi.fn(),
    countPrimitive: vi.fn(),
  } as unknown as SequencerHost;
  const slot = {
    abilityId: 'shield_slam',
    casterId: 1,
    targetId: 2,
    tier: 1,
    spec: WARRIOR_VFX_FULL_SPECS.shield_slam,
    color: 0x657c91,
    accent: 0xd8efff,
  } as SeqSlot;
  expect(drawWarriorShield(host, slot, 0)).toBe(true);
  expect(crest).toHaveBeenCalledTimes(1);
  expect(crest.mock.calls[0][7]).toBe('shield_contact');
  const points = Array.from({ length: 33 }, () => new THREE.Vector3());
  ribbon.mock.calls[0][3](points);
  expect(Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y))).toBeCloseTo(
    3.18,
  );
  expect(ribbon.mock.calls[0][1]).toBe(0.18);
  expect(ribbon.mock.calls[0][7]).toBe(1);
  expect(contact).toHaveBeenCalledExactlyOnceWith(
    1,
    2,
    'physical-crush',
    expect.any(Number),
    'shield_slam',
    0,
  );
  expect(host.bakedAt).not.toHaveBeenCalled();
  targetX = 7;
  drawWarriorShield(host, slot, 0);
  expect(crest.mock.calls[1][0]).toBeCloseTo(7 - (7 / Math.hypot(7, 3)) * 1.05);
  expect(vi.mocked(host.flipbookAt).mock.calls[1][0]).toBe(7);
  drawWarriorShield(host, slot, 1);
  expect(contact).toHaveBeenCalledTimes(2);
});
