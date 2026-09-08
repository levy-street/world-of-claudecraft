import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import {
  drawBloodlettingRecovery,
  drawFuriousMending,
  isWarriorFuryAuraEvent,
} from '../src/render/ability_vfx/warrior_fury_feedback';
import { ABILITIES } from '../src/sim/data';
import type { SimEvent } from '../src/sim/types';

function fixture() {
  const paths: THREE.Vector3[][] = [];
  const host = {
    anchorOf: (_id: number, _f: number, out: { x: number; y: number; z: number }) =>
      Object.assign(out, { x: 10, y: 2, z: 30 }),
    facingAt: () => 0.6,
    pathRibbon: vi.fn((_c, _w, _l, fill) => {
      const p = Array.from({ length: 20 }, () => new THREE.Vector3());
      fill(p);
      paths.push(p);
    }),
    bakedAt: vi.fn(),
    countPrimitive: vi.fn(),
  } as unknown as SequencerHost;
  return { host, paths };
}
it('reserves bespoke aura feedback only for a matching actual live snapshot', () => {
  const event = { type: 'aura', targetId: 1, name: 'Mayhem', gained: true } as Extract<
    SimEvent,
    { type: 'aura' }
  >;
  const target = { auras: [{ id: 'fury_enrage', kind: 'enrage', name: 'Mayhem', remaining: 4 }] };
  expect(isWarriorFuryAuraEvent(event, target)).toBe(true);
  expect(isWarriorFuryAuraEvent({ ...event, gained: false }, target)).toBe(false);
  expect(isWarriorFuryAuraEvent({ ...event, name: 'Other' }, target)).toBe(false);
  expect(isWarriorFuryAuraEvent(event, { auras: [{ ...target.auras[0], remaining: 0 }] })).toBe(
    false,
  );
});
it('draws inward recovery from real effective health, independently of weapon damage', () => {
  const { host, paths } = fixture();
  const event = {
    type: 'heal2',
    sourceId: 1,
    targetId: 1,
    ability: ABILITIES.bloodthirst.name,
    amount: 20,
  } as Extract<SimEvent, { type: 'heal2' }>;
  expect(drawBloodlettingRecovery(host, event, 100)).toBe(true);
  expect(paths).toHaveLength(2);
  for (const p of paths) {
    expect(p.at(-1)!.distanceTo(new THREE.Vector3(10, 2, 30))).toBeLessThan(
      p[0].distanceTo(new THREE.Vector3(10, 2, 30)),
    );
    for (const v of p) expect(v.toArray().every(Number.isFinite)).toBe(true);
  }
  expect(host.bakedAt).toHaveBeenCalledTimes(1);
  expect(drawBloodlettingRecovery(host, { ...event, amount: 0 }, 100)).toBe(true);
  expect(host.bakedAt).toHaveBeenCalledTimes(1);
  expect(drawBloodlettingRecovery(host, { ...event, sourceId: 2 }, 100)).toBe(false);
});
it.each([0, 1, 2])(
  'Mending has one caster clench at quality tier %s, never a repeated impact',
  (tier) => {
    const { host, paths } = fixture();
    const slot = {
      abilityId: 'furious_mending',
      casterId: 1,
      tier,
      physicalSecondary: false,
    } as SeqSlot;
    expect(drawFuriousMending(host, slot, 0)).toBe(true);
    expect(paths.length).toBe(tier === 0 ? 6 : 2);
    expect(host.bakedAt).toHaveBeenCalledTimes(2);
    drawFuriousMending(host, slot, 1);
    drawFuriousMending(host, { ...slot, physicalSecondary: true }, 0);
    expect(host.bakedAt).toHaveBeenCalledTimes(2);
  },
);
