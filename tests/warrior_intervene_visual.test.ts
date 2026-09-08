import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { AbilityVfxRibbons, RibbonAnchor } from '../src/render/ability_vfx/ribbons';
import {
  WarriorGuardPlates,
  warriorGuardKind,
} from '../src/render/ability_vfx/warrior_guard_plates';

it('recognizes the ally-owned Intervene reserve independently of caster travel', () => {
  expect(warriorGuardKind({ id: 'intervene', kind: 'absorb', remaining: 6, value: 50 })).toBe(3);
});

it('retains Intervene and Iron Resolve separately, then removes only the depleted reserve', () => {
  const pool = new WarriorGuardPlates(new THREE.Scene());
  vi.spyOn(pool.preparation, 'ready').mockReturnValue(true);
  const ribbons = { appendHeld: vi.fn() } as unknown as AbilityVfxRibbons;
  const anchor: RibbonAnchor = (_id, _f, out = new THREE.Vector3()) => out.set(0, 1, 0);
  const draw = (frame: number) => pool.draw(frame, 0.3, false, anchor, () => 0, undefined, ribbons);
  const intervene = { id: 'intervene', kind: 'absorb', remaining: 6, value: 50 };
  const kind = warriorGuardKind(intervene);
  expect(kind).not.toBeNull();
  if (kind === null) return;
  pool.hold(2, kind, intervene, 0, true);
  pool.hold(2, 1, { id: 'iron_resolve', kind: 'absorb', remaining: 10, value: 90 }, 0, true);
  draw(0);
  expect(pool.mesh.count).toBe(5);
  pool.hold(2, kind, { ...intervene, remaining: 5.7, value: 0 }, 1, true);
  pool.hold(2, 1, { id: 'iron_resolve', kind: 'absorb', remaining: 9.7, value: 90 }, 1, true);
  draw(1);
  expect(pool.mesh.count).toBe(3);
  draw(2);
  expect(pool.mesh.count).toBe(0);
  pool.dispose();
});

it('keeps both sword rails and both escort shoulders when all four protections coexist', () => {
  const pool = new WarriorGuardPlates(new THREE.Scene());
  vi.spyOn(pool.preparation, 'ready').mockReturnValue(true);
  const ribbons = { appendHeld: vi.fn() } as unknown as AbilityVfxRibbons;
  const anchor: RibbonAnchor = (_id, _f, out = new THREE.Vector3()) => out.set(0, 1, 0);
  for (const kind of [0, 1, 2, 3] as const)
    pool.hold(1, kind, { id: 'fixture', remaining: 6, value: 160 }, 0, true);
  pool.draw(0, 0.3, true, anchor, () => 0, undefined, ribbons);
  expect(pool.mesh.count).toBe(6);
  const position = (index: number) => {
    const matrix = new THREE.Matrix4();
    pool.mesh.getMatrixAt(index, matrix);
    return new THREE.Vector3().setFromMatrixPosition(matrix);
  };
  expect(position(2).x * position(3).x).toBeLessThan(0);
  expect(position(4).x * position(5).x).toBeLessThan(0);
  expect(ribbons.appendHeld).toHaveBeenCalledTimes(4);
  pool.dispose();
});
