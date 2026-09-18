import { Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import { warriorCrushContact } from '../src/render/ability_vfx/warrior_crush_contact';
import { drawWarriorShield } from '../src/render/ability_vfx/warrior_shield';
import { WARRIOR_VFX_FULL_SPECS } from '../src/render/warrior_vfx_specs';

type Ribbon = Parameters<SequencerHost['pathRibbon']>;
function fixture() {
  const actors = new Map([
    [1, { x: -2, y: 1, z: -3, height: 2, yaw: 0.6 }],
    [2, { x: 3, y: 2, z: 5, height: 2.4, yaw: -0.4 }],
    [3, { x: -17, y: 8, z: 11, height: 1.6, yaw: 2 }],
    [4, { x: 21, y: -2, z: -16, height: 3, yaw: -2 }],
  ]);
  const host = {
    anchorOf: (id: number, fraction: number, out = { x: 0, y: 0, z: 0 }) => {
      const actor = actors.get(id);
      return actor
        ? Object.assign(out, { x: actor.x, y: actor.y + fraction * actor.height, z: actor.z })
        : null;
    },
    facingAt: (id: number) => actors.get(id)?.yaw ?? null,
    groundYAt: () => 0,
    pathRibbon: vi.fn((..._args: Ribbon) => true),
    crestAt: vi.fn(() => true),
    flipbookAt: vi.fn(),
    fragmentsAt: vi.fn(),
    burstAt: vi.fn(),
    bakedAt: vi.fn(),
    pulseLight: vi.fn(),
    countPrimitive: vi.fn(),
    contact: vi.fn(),
    shakeAt: vi.fn(),
    weaponFace: vi.fn<NonNullable<SequencerHost['weaponFace']>>((_id, _hand, out, normal) => {
      Object.assign(out, { x: 0.25, y: 1.4, z: 1.6 });
      Object.assign(normal, { x: 0, y: 0, z: 1 });
      return true;
    }),
  } as unknown as SequencerHost;
  return { host, actors };
}
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing required shield fixture');
  return value;
}
function slot(outcome = 1, tier = 0): SeqSlot {
  return {
    abilityId: 'shield_slam',
    casterId: 1,
    targetId: 2,
    tier,
    componentOutcomes: outcome,
    spec: WARRIOR_VFX_FULL_SPECS.shield_slam,
  } as SeqSlot;
}
function sample(call: Ribbon) {
  const points = Array.from({ length: 25 }, () => new Vector3());
  expect(call[3](points)).toBe(points.length);
  expect(points.every((p) => p.toArray().every(Number.isFinite))).toBe(true);
  return points;
}
function expectPoints(actual: Vector3[], expected: Vector3[]) {
  for (let i = 0; i < expected.length; i++)
    expect(actual[i].distanceTo(expected[i])).toBeLessThan(1e-8);
}

describe('Shieldcrack receiving compression', () => {
  it.each([
    [1, 0.18],
    [2, 0.28],
    [4, 0.56],
    [8, 0.75],
  ])('fits the receiving surface for a body height of %s', (height, surface) => {
    const { host, actors } = fixture();
    const actor = required(actors.get(2));
    actor.height = height;
    const caster = required(actors.get(1));
    // The equipped shield faces +Z, but the victim-facing cut uses the actual
    // source direction. Rotating that incoming direction must rotate the offset.
    for (const yaw of [0.3, 1.7, -2.1]) {
      caster.x = actor.x - Math.sin(yaw) * 5;
      caster.z = actor.z - Math.cos(yaw) * 5;
      drawWarriorShield(host, slot(), 0);
      const hit = required(vi.mocked(host.flipbookAt).mock.calls.at(-1));
      expect(hit[0]).toBeCloseTo(actor.x - Math.sin(yaw) * surface);
      expect(hit[2]).toBeCloseTo(actor.z - Math.cos(yaw) * surface);
      expect(hit[5]).toBe('contact_crush');
      expect(vi.mocked(required(host.crestAt)).mock.calls.at(-1)?.slice(0, 5)).toEqual([
        0.25, 1.4, 1.6, 1.4, 1.4,
      ]);
    }
  });

  it.each([0, 1])('follows the original victim after slot reuse at detail %s', (tier) => {
    const { host, actors } = fixture();
    const hit = slot(1, tier);
    drawWarriorShield(host, hit, 0);
    const wounds = vi.mocked(host.pathRibbon).mock.calls.filter((call) => call[9]);
    expect(wounds).toHaveLength(tier ? 2 : 6);
    const before = wounds.map(sample);
    const actor = required(actors.get(2));
    const pivot = new Vector3(actor.x, actor.y, actor.z);
    Object.assign(hit, { casterId: 3, targetId: 4 });
    drawWarriorShield(host, hit, 0);
    wounds.forEach((call, i) => {
      expectPoints(sample(call), before[i]);
    });
    const translation = new Vector3(6, -1, 3);
    actor.x += translation.x;
    actor.y += translation.y;
    actor.z += translation.z;
    actor.yaw += 1.2;
    wounds.forEach((call, i) => {
      expectPoints(
        sample(call),
        before[i].map((p) =>
          p
            .clone()
            .sub(pivot)
            .applyAxisAngle(new Vector3(0, 1, 0), 1.2)
            .add(pivot)
            .add(translation),
        ),
      );
    });
    expect(host.contact).toHaveBeenCalledTimes(2);
    expect(host.shakeAt).toHaveBeenCalledTimes(2);
    actors.delete(2);
    for (const call of wounds) expect(call[3]([new Vector3(), new Vector3()])).toBe(0);
    expect(host.contact).toHaveBeenCalledTimes(2);
  });

  it.each([0, 2])('cannot imply receiving damage for outcome %s', (outcome) => {
    const { host } = fixture();
    drawWarriorShield(host, slot(outcome), 0);
    expect(vi.mocked(host.pathRibbon).mock.calls.filter((call) => call[9])).toHaveLength(0);
    for (const effect of [host.contact, host.shakeAt, host.burstAt, host.fragmentsAt, host.bakedAt])
      expect(effect).not.toHaveBeenCalled();
    expect(host.flipbookAt).toHaveBeenCalledTimes(outcome === 2 ? 1 : 0);
  });

  it('does not invent contact or camera events when the receiving helper redraws', () => {
    const { host } = fixture();
    const at = required(host.anchorOf(2, 0.5));
    expect(warriorCrushContact(host, 2, at, 0.5, 0.8, 4.6, 1)).toBe(3);
    const calls = vi.mocked(host.pathRibbon).mock.calls;
    for (let i = 0; i < 5; i++) calls.forEach(sample);
    for (const effect of [host.contact, host.shakeAt, host.burstAt])
      expect(effect).not.toHaveBeenCalled();
    expect(calls[0][2]).toBeGreaterThan(calls[1][2]);
    expect(calls[0][0]).not.toBe(calls[1][0]);
  });
});
