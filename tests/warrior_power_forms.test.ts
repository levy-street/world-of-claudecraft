import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import {
  warriorBloodTexture,
  warriorSteelTexture,
} from '../src/render/ability_vfx/production_assets';
import type { AbilityVfxRibbons, RibbonAnchor } from '../src/render/ability_vfx/ribbons';
import { WarriorPowerForms } from '../src/render/ability_vfx/warrior_power_forms';

vi.mock('../src/render/ability_vfx/production_assets', async () => {
  const { Texture } = await import('three');
  const steel = new Texture(),
    blood = new Texture();
  return { warriorSteelTexture: () => steel, warriorBloodTexture: () => blood };
});
const aura = { duration: 20, remaining: 17 };
function fixture(ready = true) {
  const scene = new THREE.Scene(),
    pool = new WarriorPowerForms(scene);
  if (ready) for (const prep of pool.preparation) vi.spyOn(prep, 'ready').mockReturnValue(true);
  const lines: THREE.Vector3[][] = [];
  const ribbons = {
    appendHeld: (p: THREE.Vector3[], n: number) => lines.push(p.slice(0, n).map((v) => v.clone())),
  } as unknown as AbilityVfxRibbons;
  let x = 0,
    yaw = 0,
    missingBone: number | null = null;
  const anchor: RibbonAnchor = (_id, _frac, out = new THREE.Vector3()) => out.set(x, 1, 0);
  const bonePosition = new THREE.Vector3();
  const bodyAnchor = (_id: number, piece: number, out: THREE.Matrix4) => {
    if (piece === missingBone) return false;
    const local =
      piece === 0
        ? [0, 0.97, 0]
        : piece < 3
          ? [piece === 1 ? 0.25 : -0.25, 0.8, 0.1]
          : [piece === 3 ? 0.17 : -0.17, 0.29, 0];
    bonePosition.fromArray(local).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    out.makeRotationY(yaw).setPosition(bonePosition.x + x, bonePosition.y + 1, bonePosition.z);
    return true;
  };
  const draw = (frame: number, dt = 0, reduced = false, detail = vi.fn()) =>
    pool.draw(
      frame,
      dt,
      reduced,
      anchor,
      () => yaw,
      ribbons,
      detail,
      missingBone === 5 ? undefined : bodyAnchor,
    );
  return {
    scene,
    pool,
    lines,
    draw,
    missing: (piece: number | null) => {
      missingBone = piece;
    },
    move: (nextX: number, nextYaw: number) => {
      x = nextX;
      yaw = nextYaw;
    },
  };
}
const matrix = (pool: WarriorPowerForms, kind = 0, index = 0) => {
  const m = new THREE.Matrix4();
  pool.meshes[kind].getMatrixAt(index, m);
  return m;
};

it('reenters an old aura fully assembled and tracks wearer movement and rotation', () => {
  const h = fixture();
  h.pool.hold(1, 0, aura, 0, 0, true);
  h.draw(0);
  const before = matrix(h.pool);
  h.pool.sleep(1);
  h.pool.hold(1, 0, { ...aura, remaining: 12 }, 0, 10, true);
  h.draw(10);
  expect(matrix(h.pool).elements).toEqual(before.elements);
  h.move(7, Math.PI / 2);
  h.pool.hold(1, 0, { ...aura, remaining: 11.95 }, 0, 11, true);
  h.draw(11);
  const expected = new THREE.Matrix4()
    .makeTranslation(7, 1, 0)
    .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2))
    .multiply(new THREE.Matrix4().makeTranslation(0, -1, 0))
    .multiply(before);
  matrix(h.pool).elements.forEach((v, i) => {
    expect(v).toBeCloseTo(expected.elements[i], 5);
  });
  h.draw(12);
  expect(h.pool.meshes.every((m) => !m.visible && m.count === 0)).toBe(true);
  h.pool.dispose();
});

it('reassembles only a refreshed aura and removes a slept wearer immediately on the next draw', () => {
  const h = fixture();
  h.pool.hold(1, 0, aura, 0, 0, true);
  h.draw(0);
  const old = matrix(h.pool);
  h.pool.hold(1, 0, { duration: 20, remaining: 20 }, 0, 1, true);
  h.draw(1);
  expect(matrix(h.pool).elements).not.toEqual(old.elements);
  h.pool.sleep(1);
  h.draw(2);
  expect(h.pool.meshes[0].count).toBe(0);
  h.pool.dispose();
});

it('keeps the local wearer and both complete fallback outlines within bounded solid capacity', () => {
  const h = fixture();
  for (let id = 1; id <= 64; id++)
    for (const kind of [0, 1] as const) h.pool.hold(id, kind, aura, 1, 0, false);
  h.pool.hold(999, 0, aura, 0, 0, true);
  h.pool.hold(999, 1, aura, 1, 0, true);
  h.draw(0);
  expect(h.pool.meshes.map((m) => m.count)).toEqual([16, 96, 32, 32]);
  expect(h.pool.meshes.map((m) => m.instanceMatrix.count)).toEqual([16, 96, 32, 32]);
  expect(h.lines).toHaveLength(48 * 2);
  expect(h.lines.every((line) => line.length === 3)).toBe(true);
  for (const [i, count] of [16, 96, 32, 32].entries())
    expect(h.pool.meshes[i].instanceMatrix.updateRanges).toEqual([{ start: 0, count: count * 16 }]);
  h.pool.clear();
  h.lines.length = 0;
  h.pool.hold(999, 0, aura, 0, 1, true);
  h.draw(1);
  expect(h.pool.meshes.map((m) => m.count)).toEqual([1, 0, 2, 2]);
  expect(h.lines).toHaveLength(0);
  h.pool.dispose();
});

it('prepares all four exact buffers and admits only a complete Avatar while blood remains independent', async () => {
  const h = fixture(false),
    program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  const host = {
    properties: { get: () => ({ programs: new Map([['main', program]]) }) },
    compile: vi.fn(async () => {}),
    draw: vi.fn(),
  };
  const units = h.pool.units(host);
  expect(units).toHaveLength(16);
  expect(new Set(units.map((u) => u.id)).size).toBe(16);
  for (const unit of units.slice(0, 4)) await unit.run();
  expect(h.pool.preparation.map((p) => p.ready())).toEqual([true, false, false, false]);
  h.pool.hold(1, 0, aura, 0, 0, true);
  h.pool.hold(1, 1, aura, 1, 0, true);
  h.draw(0);
  expect(h.pool.meshes.map((m) => m.count)).toEqual([0, 0, 0, 0]);
  expect(h.lines).toHaveLength(2);
  expect(h.lines.every((line) => line.length === 3)).toBe(true);
  for (const unit of units.slice(4, 8)) await unit.run();
  h.lines.length = 0;
  h.draw(0);
  expect(h.pool.meshes.map((m) => m.count)).toEqual([0, 6, 0, 0]);
  expect(h.lines).toHaveLength(1);
  for (const unit of units.slice(8, 12)) await unit.run();
  h.lines.length = 0;
  h.draw(0);
  expect(h.pool.meshes.map((m) => m.count)).toEqual([0, 6, 0, 0]);
  expect(h.lines).toHaveLength(1);
  for (const unit of units.slice(12)) await unit.run();
  h.lines.length = 0;
  h.draw(0);
  expect(h.pool.meshes.map((m) => m.count)).toEqual([1, 6, 2, 2]);
  expect(h.lines).toHaveLength(0);
  expect(h.pool.preparation.map((p) => p.ready())).toEqual([true, true, true, true]);
  for (let kind = 0; kind < 4; kind++) {
    const carrier = h.pool.preparation[kind].group.children[0] as THREE.InstancedMesh;
    expect(carrier.material).toBe(h.pool.meshes[kind].material);
    expect(carrier.instanceMatrix).toBe(h.pool.meshes[kind].instanceMatrix);
    expect(carrier.instanceColor).toBe(h.pool.meshes[kind].instanceColor);
  }
  expect(h.pool.units(host)).toEqual([]);
  h.pool.dispose();
});

it.each([0, 1, 2, 3, 4, 5])(
  'keeps a complete outline when native bone %s is missing (5=no callback)',
  (missing) => {
    const h = fixture();
    h.pool.hold(1, 0, aura, 0, 0, true);
    h.pool.hold(1, 1, aura, 1, 0, true);
    h.draw(0);
    expect(h.pool.meshes.map((m) => m.count)).toEqual([1, 6, 2, 2]);
    h.missing(missing);
    h.lines.length = 0;
    h.draw(0);
    expect(h.pool.meshes.map((m) => m.count)).toEqual([0, 6, 0, 0]);
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).toHaveLength(3);
    h.missing(null);
    h.lines.length = 0;
    h.draw(0);
    expect(h.pool.meshes.map((m) => m.count)).toEqual([1, 6, 2, 2]);
    expect(h.lines).toHaveLength(0);
    h.pool.dispose();
  },
);

it('caps ambient particles to one pulse after a stalled frame and disables them for reduced motion', () => {
  const h = fixture(),
    detail = vi.fn();
  h.pool.hold(1, 1, aura, 1, 0, true);
  h.draw(0, 3, false, detail);
  expect(detail).toHaveBeenCalledOnce();
  h.pool.hold(1, 1, aura, 1, 1, true);
  h.draw(1, 0, false, detail);
  expect(detail).toHaveBeenCalledOnce();
  h.pool.hold(1, 1, aura, 1, 2, true);
  h.draw(2, 2, true, detail);
  expect(detail).toHaveBeenCalledOnce();
  h.pool.sleep(1);
  h.pool.hold(1, 1, { ...aura, remaining: 5 }, 1, 3, true);
  h.draw(3, 0, false, detail);
  expect(detail).toHaveBeenCalledOnce();
  h.pool.dispose();
});

it('disposes its own geometry and instances without releasing either shared texture', () => {
  const h = fixture();
  const blood = vi.spyOn(warriorBloodTexture()!, 'dispose'),
    steel = vi.spyOn(warriorSteelTexture()!, 'dispose');
  const owned = h.pool.meshes.map((m) => [
    vi.spyOn(m.geometry, 'dispose'),
    vi.spyOn(m.material, 'dispose'),
    vi.spyOn(m, 'dispose'),
  ]);
  h.pool.dispose();
  h.pool.dispose();
  for (const spies of owned) for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
  expect(blood).not.toHaveBeenCalled();
  expect(steel).not.toHaveBeenCalled();
});
