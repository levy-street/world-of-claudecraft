import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { SeqPoint, SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import {
  drawWarriorEchoContact,
  drawWarriorWideningCast,
} from '../src/render/ability_vfx/warrior_widening_arc';

function fixture(outcome = 1) {
  const target = { x: 4, y: 1.3, z: 7 };
  const host = {
    anchorOf: (id: number, _height: number, out?: SeqPoint) => {
      if (!out) throw new Error('Use owned anchor scratch');
      return Object.assign(out, id === 1 ? { x: 0, y: 0, z: 0 } : target);
    },
    facingAt: () => 0,
    flipbookAt: vi.fn(),
    bakedAt: vi.fn(),
    pathRibbon: vi.fn(() => true),
    countPrimitive: vi.fn(),
    contact: vi.fn(),
    burstAt: vi.fn(),
  };
  const slot = {
    abilityId: 'mortal_strike',
    casterId: 1,
    targetId: 2,
    physicalSecondary: true,
    componentOutcomes: outcome,
    tier: 0,
  } as SeqSlot;
  return { host, asHost: host as unknown as SequencerHost, slot, target };
}

it('gives a real secondary hit a large receiving cut without a second caster performance', () => {
  const h = fixture();
  expect(drawWarriorEchoContact(h.asHost, h.slot)).toBe(true);
  expect(h.host.bakedAt).toHaveBeenCalledOnce();
  const spray = h.host.bakedAt.mock.calls[0] as unknown[];
  expect(spray[0]).toBe('warrior_shear');
  expect(spray[4]).toBe(6.6);
  expect(h.host.contact).toHaveBeenCalledOnce();
  expect(h.host.contact.mock.calls[0].slice(0, 2)).toEqual([1, 2]);
  expect(h.host.contact.mock.calls[0][4]).toBe('mortal_strike');
  expect(h.host.pathRibbon).toHaveBeenCalledOnce();
  expect((h.host.pathRibbon.mock.calls[0] as unknown[])[7]).toBe(0);
  const fill = (h.host.pathRibbon.mock.calls[0] as unknown[])[3] as (p: THREE.Vector3[]) => number;
  const points = Array.from({ length: 25 }, () => new THREE.Vector3());
  expect(fill(points)).toBe(25);
  const before = points.map((p) => p.clone());
  h.target.x += 3;
  fill(points);
  points.forEach((p, i) => {
    expect(p.x - before[i].x).toBeCloseTo(3);
  });
});

it('adds a broad prepared steel wake without dropping its cold-pool fallback', () => {
  const h = fixture();
  h.slot.physicalSecondary = false;
  const crestAt = vi.fn<NonNullable<SequencerHost['crestAt']>>(() => true);
  expect(drawWarriorWideningCast({ ...h.asHost, crestAt }, h.slot, 0)).toBe(3);
  expect(crestAt.mock.calls[0][7]).toBe('steel_cut');
  expect(h.host.pathRibbon).toHaveBeenCalledTimes(2);
  crestAt.mockReturnValue(false);
  expect(drawWarriorWideningCast({ ...h.asHost, crestAt }, h.slot, 0)).toBe(2);
  expect(h.host.pathRibbon).toHaveBeenCalledTimes(4);
  expect(h.host.contact).not.toHaveBeenCalled();
});

it.each([0, 2])('keeps avoidance and absorption honest (outcome %s)', (outcome) => {
  const h = fixture(outcome);
  expect(drawWarriorEchoContact(h.asHost, h.slot)).toBe(true);
  expect(h.host.contact).not.toHaveBeenCalled();
  expect(h.host.bakedAt).not.toHaveBeenCalled();
  expect(h.host.pathRibbon).not.toHaveBeenCalled();
  expect(h.host.flipbookAt).toHaveBeenCalledTimes(outcome === 2 ? 1 : 0);
});

it('activates the flourish once without an invented hit and retains its origin across another cast', () => {
  const h = fixture();
  h.slot.physicalSecondary = false;
  expect(drawWarriorWideningCast(h.asHost, h.slot, 0)).toBe(2);
  expect(drawWarriorWideningCast(h.asHost, h.slot, 1)).toBe(0);
  h.slot.physicalSecondary = true;
  expect(drawWarriorWideningCast(h.asHost, h.slot, 0)).toBe(0);
  expect(h.host.contact).not.toHaveBeenCalled();
  const fill = (h.host.pathRibbon.mock.calls[0] as unknown[])[3] as (p: THREE.Vector3[]) => number;
  const points = Array.from({ length: 25 }, () => new THREE.Vector3());
  fill(points);
  expect(Math.max(...points.map((p) => Math.hypot(p.x, p.z)))).toBeCloseTo(4.5);
  const before = points.map((p) => p.toArray());
  drawWarriorWideningCast(h.asHost, { ...h.slot, casterId: 2, physicalSecondary: false }, 0);
  fill(points);
  expect(points.map((p) => p.toArray())).toEqual(before);
});
