import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { SeqPoint, SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import { warriorEquipmentPrepare } from '../src/render/ability_vfx/warrior_equipment_prepare';
import { drawWarriorReadinessCast } from '../src/render/ability_vfx/warrior_readiness_cast';

function fixture() {
  const equipment = [
    { present: true, frame: new THREE.Matrix4().makeTranslation(7, 3, -4) },
    { present: true, frame: new THREE.Matrix4().makeTranslation(-2, 2, 6) },
  ];
  const gripLocal = new THREE.Vector3(0, -0.45, 0);
  const prepareWeaponFace = vi.fn((_id: number, hand: 0 | 1) => {
    const equipped = equipment[hand];
    if (!equipped.present) return null;
    return (at: SeqPoint, normal: SeqPoint) => {
      if (!equipped.present) return false;
      Object.assign(at, new THREE.Vector3().setFromMatrixPosition(equipped.frame));
      Object.assign(normal, new THREE.Vector3(0, 0, 1).transformDirection(equipped.frame));
      return true;
    };
  });
  const handPoint = vi.fn((_id: number, hand: 0 | 1, out: SeqPoint) => {
    if (!equipment[hand].present) return null;
    Object.assign(out, gripLocal.clone().applyMatrix4(equipment[hand].frame));
    return out;
  });
  const pathRibbon = vi.fn<SequencerHost['pathRibbon']>(() => true);
  const forbidden = {
    contact: vi.fn(),
    ringAt: vi.fn(),
    burstAt: vi.fn(),
    flipbookAt: vi.fn(),
    shakeAt: vi.fn(),
    bodyGlow: vi.fn(),
  };
  const recorded = {
    prepareWeaponFace,
    handPoint,
    pathRibbon,
    bakedAt: vi.fn(),
    weaponTrail: vi.fn(),
    countPrimitive: vi.fn(),
    isWeaponHand: () => true,
    ...forbidden,
  };
  const host = recorded as unknown as SequencerHost;
  function points(index: number) {
    const result = Array.from({ length: 17 }, () => new THREE.Vector3());
    const count = pathRibbon.mock.calls[index][3](result);
    return result.slice(0, count);
  }
  return { host, equipment, gripLocal, recorded, forbidden, points };
}

it.each([false, true])(
  'draws exactly two limited reflections on the actual equipment face (guard=%s)',
  (guarded) => {
    const h = fixture();
    expect(warriorEquipmentPrepare(h.host, 41, guarded)).toBe(2);
    expect(h.recorded.pathRibbon).toHaveBeenCalledTimes(2);
    for (let layer = 0; layer < 2; layer++) {
      const call = h.recorded.pathRibbon.mock.calls[layer];
      expect(call.slice(0, 3)).toEqual([
        layer ? 0xf0f5f5 : guarded ? 0x93acb6 : 0xb9c7ce,
        layer ? 0.035 : guarded ? 0.16 : 0.12,
        layer ? 0.13 : 0.32,
      ]);
      expect(call.slice(4)).toEqual([true, null, true, 0, null, true]);
      const frame = h.equipment[guarded ? 1 : 0].frame;
      const origin = new THREE.Vector3().setFromMatrixPosition(frame);
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(frame);
      const points = h.points(layer);
      expect(points).toHaveLength(17);
      for (const point of points) {
        const local = point.clone().sub(origin);
        expect(local.dot(normal)).toBeCloseTo(0.04, 12);
        expect(local.length()).toBeLessThan(1);
      }
    }
    expect(h.recorded.prepareWeaponFace).toHaveBeenCalledExactlyOnceWith(41, guarded ? 1 : 0);
    for (const forbidden of Object.values(h.forbidden)) expect(forbidden).not.toHaveBeenCalled();
    expect(h.recorded.bakedAt).not.toHaveBeenCalled();
  },
);

it('falls back from guarding offhand to mainhand, while a wide strike requires the main blade', () => {
  const h = fixture();
  h.equipment[1].present = false;
  expect(warriorEquipmentPrepare(h.host, 41, true)).toBe(2);
  expect(h.recorded.prepareWeaponFace.mock.calls.map(([, hand]) => hand)).toEqual([1, 0]);
  const initial = h.points(0);
  expect(initial.every((p) => p.distanceTo(new THREE.Vector3(7, 3, -4)) < 1)).toBe(true);
  h.equipment[0].present = false;
  expect(h.points(0)).toHaveLength(0);
  expect(h.points(1)).toHaveLength(0);
  expect(warriorEquipmentPrepare(h.host, 41, true)).toBe(0);
  h.equipment[1].present = true;
  expect(warriorEquipmentPrepare(h.host, 41, false)).toBe(0);
  expect(h.recorded.pathRibbon).toHaveBeenCalledTimes(2);
});

it.each([false, true])(
  'resamples both layers after equipment translation and rotation without retaining the old origin (guard=%s)',
  (guarded) => {
    const h = fixture();
    warriorEquipmentPrepare(h.host, 41, guarded);
    const hand = guarded ? 1 : 0;
    const oldFrame = h.equipment[hand].frame.clone();
    const before = [h.points(0), h.points(1)];
    h.equipment[hand].frame
      .makeRotationFromEuler(new THREE.Euler(0.7, 1.2, -0.3))
      .setPosition(18, -2, 10);
    const delta = h.equipment[hand].frame.clone().multiply(oldFrame.invert());
    for (let layer = 0; layer < 2; layer++) {
      const after = h.points(layer);
      for (let i = 0; i < after.length; i++) {
        expect(after[i].distanceTo(before[layer][i].clone().applyMatrix4(delta))).toBeLessThan(
          1e-10,
        );
        expect(after[i].distanceTo(before[layer][i])).toBeGreaterThan(10);
      }
    }
    h.equipment[hand].present = false;
    expect(h.points(0)).toHaveLength(0);
    expect(h.points(1)).toHaveLength(0);
    expect(h.recorded.prepareWeaponFace).toHaveBeenCalledExactlyOnceWith(41, hand);
  },
);

it.each([false, true])(
  'keeps degenerate grip and vertical face frames finite and bounded (guard=%s)',
  (guarded) => {
    const h = fixture();
    const hand = guarded ? 1 : 0;
    for (const rotation of [0, Math.PI / 2, -Math.PI / 2])
      for (const grip of [new THREE.Vector3(), new THREE.Vector3(0, 0, -0.5)]) {
        h.gripLocal.copy(grip);
        h.equipment[hand].frame.makeRotationX(rotation).setPosition(8, 5, -3);
        h.recorded.pathRibbon.mockClear();
        expect(warriorEquipmentPrepare(h.host, 41, guarded)).toBe(2);
        const normal = new THREE.Vector3(0, 0, 1).transformDirection(h.equipment[hand].frame);
        for (const point of [...h.points(0), ...h.points(1)]) {
          expect(point.toArray().every(Number.isFinite)).toBe(true);
          const local = point.clone().sub(new THREE.Vector3(8, 5, -3));
          expect(local.length()).toBeLessThan(1);
          expect(local.dot(normal)).toBeCloseTo(0.04, 10);
        }
      }
  },
);

it('counts only admitted reflections and does nothing without equipment support', () => {
  const h = fixture();
  h.recorded.pathRibbon.mockReturnValueOnce(false);
  expect(warriorEquipmentPrepare(h.host, 41, false)).toBe(1);
  expect(warriorEquipmentPrepare({ ...h.host, prepareWeaponFace: undefined }, 41, true)).toBe(0);
  expect(h.recorded.pathRibbon).toHaveBeenCalledTimes(2);
});

it('activates new equipment reflections only for the first wide or guard beat, never secondary events', () => {
  for (const abilityId of [
    'sweeping_strikes',
    'defensive_stance',
    'sanguine_aura',
    'battle_stance',
    'berserker_stance',
  ])
    for (const beat of [0, 1])
      for (const physicalSecondary of [false, true]) {
        const h = fixture();
        const slot = { abilityId, casterId: 41, physicalSecondary } as SeqSlot;
        expect(drawWarriorReadinessCast(h.host, slot, beat)).toBe(true);
        const reflection =
          !physicalSecondary &&
          beat === 0 &&
          ['sweeping_strikes', 'defensive_stance'].includes(abilityId);
        expect(h.recorded.pathRibbon).toHaveBeenCalledTimes(reflection ? 2 : 0);
        if (physicalSecondary) {
          expect(h.recorded.weaponTrail).not.toHaveBeenCalled();
          expect(h.recorded.bakedAt).not.toHaveBeenCalled();
          expect(h.recorded.countPrimitive).not.toHaveBeenCalled();
        } else if (abilityId === 'sanguine_aura') {
          expect(h.recorded.bakedAt).toHaveBeenCalledTimes(2);
          expect(h.recorded.weaponTrail.mock.calls.map((args) => args[1])).toEqual([0, 1]);
        } else {
          const trails = abilityId === 'berserker_stance' ? 2 : 1;
          expect(h.recorded.weaponTrail).toHaveBeenCalledTimes(trails);
          expect(h.recorded.countPrimitive).toHaveBeenCalledExactlyOnceWith(
            abilityId,
            trails + (reflection ? 2 : 0),
          );
          expect(h.recorded.bakedAt).not.toHaveBeenCalled();
        }
        for (const forbidden of Object.values(h.forbidden))
          expect(forbidden).not.toHaveBeenCalled();
      }
});
