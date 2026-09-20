import { Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { drawBreachmaker } from '../src/render/ability_vfx/breachmaker';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import { drawWarriorAreaContact } from '../src/render/ability_vfx/warrior_area';
import { drawWarriorBlade } from '../src/render/ability_vfx/warrior_blades';
import { warriorSteelContact } from '../src/render/ability_vfx/warrior_steel_contact';
import { meleeContactPoint, meleeImpactProfile } from '../src/render/melee_impact_core';
import { WARRIOR_VFX_FULL_SPECS } from '../src/render/warrior_vfx_specs';

const blades = ['slam', 'overpower', 'mortal_strike', 'execute'] as const;
const battlecraft = [...blades, 'breachmaker', 'cleave'] as const;
type Ribbon = Parameters<SequencerHost['pathRibbon']>;

function fixture() {
  const actors = new Map([
    [1, { x: -2, y: 1, z: -3, height: 2, yaw: 0.6 }],
    [2, { x: 3, y: 2, z: 5, height: 2.4, yaw: -0.4 }],
    [3, { x: -17, y: 8, z: 11, height: 1.6, yaw: 2 }],
    [4, { x: 21, y: -2, z: -16, height: 3, yaw: -2 }],
  ]);
  const host = new Proxy(
    {
      anchorOf: (id: number, fraction: number, out = { x: 0, y: 0, z: 0 }) => {
        const actor = actors.get(id);
        return actor
          ? Object.assign(out, {
              x: actor.x,
              y: actor.y + fraction * actor.height,
              z: actor.z,
            })
          : null;
      },
      facingAt: (id: number) => actors.get(id)?.yaw ?? 0,
      groundYAt: () => 0,
      pathRibbon: vi.fn((..._args: Ribbon) => true),
      bakedAt: vi.fn(() => true),
    },
    {
      get(target, key) {
        if (!(key in target)) Reflect.set(target, key, vi.fn());
        return Reflect.get(target, key);
      },
    },
  ) as unknown as SequencerHost;
  return { host, actors };
}

function slot(id: string, outcome = 1, tier = 0): SeqSlot {
  return {
    abilityId: id,
    casterId: 1,
    targetId: 2,
    tier,
    componentOutcomes: outcome,
    physicalSecondary: false,
    spec: WARRIOR_VFX_FULL_SPECS[id],
  } as SeqSlot;
}

function draw(host: SequencerHost, hit: SeqSlot) {
  if (hit.abilityId === 'cleave')
    return drawWarriorAreaContact(
      host,
      hit.abilityId,
      hit.casterId,
      hit.targetId,
      hit.componentOutcomes as 0 | 1 | 2,
      hit.tier,
    );
  if (hit.abilityId === 'breachmaker') return drawBreachmaker(host, hit, 0);
  return drawWarriorBlade(host, hit, 0);
}

function sample(call: Ribbon) {
  const points = Array.from({ length: 25 }, () => new Vector3());
  expect(call[3](points)).toBe(points.length);
  expect(points.every((p) => p.toArray().every(Number.isFinite))).toBe(true);
  return points;
}

function expectPoints(actual: Vector3[], expected: Vector3[]) {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < actual.length; i++)
    expect(actual[i].distanceTo(expected[i])).toBeLessThan(1e-8);
}

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing required contact fixture or emitted effect');
  return value;
}

describe('Battlecraft steel receiving contacts', () => {
  it('keeps a large directional discharge when the atlas pool rejects the contact', () => {
    const { host } = fixture();
    vi.mocked(required(host.bakedAt)).mockReturnValue(false);
    const hit = slot('execute', 1, 1);
    const at = required(host.anchorOf(2, required(meleeImpactProfile(hit.abilityId)).height));
    warriorSteelContact(host, hit, at, 0.8, -1.25, 9, 0.28, true);
    const calls = vi.mocked(host.pathRibbon).mock.calls;
    const discharge = required(calls.find((call) => !call[9]));
    const wound = calls.filter((call) => call[9]);
    expect(wound).toHaveLength(2);
    const path = sample(discharge);
    const woundPath = sample(wound[0]);
    expect(required(path.at(-1)).distanceTo(path[0])).toBeGreaterThan(
      required(woundPath.at(-1)).distanceTo(woundPath[0]) * 2,
    );
    expect(discharge[2]).toBeLessThan(0.3);
    const before = path.map((point) => point.clone());
    Object.assign(at, { x: 99, y: 99, z: 99 });
    Object.assign(hit, slot('slam'), { targetId: 4 });
    expectPoints(sample(discharge), before);
    expect(host.contact).not.toHaveBeenCalled();
  });

  it('retains both wound layers on the original moving, turning recipient after slot reuse', () => {
    const { host, actors } = fixture();
    const hit = slot('mortal_strike');
    const at = required(host.anchorOf(2, required(meleeImpactProfile(hit.abilityId)).height));
    warriorSteelContact(host, hit, at, 0.8, -0.65, 6, 0.24, false);
    const layers = vi.mocked(host.pathRibbon).mock.calls.filter((call) => call[9]);
    expect(layers).toHaveLength(2);
    expect(layers[0][0]).not.toBe(layers[1][0]);
    expect(layers[0][2]).toBeGreaterThan(layers[1][2]);
    const before = layers.map(sample);
    const origin = new Vector3(at.x, at.y, at.z);

    // Another contact reuses the slot and input storage while both callbacks live.
    Object.assign(hit, slot('execute'), { casterId: 3, targetId: 4 });
    Object.assign(at, { x: 100, y: 200, z: 300 });
    warriorSteelContact(host, hit, at, -1.4, 1.2, 8, 0.28, true);
    layers.forEach((call, i) => {
      expectPoints(sample(call), before[i]);
    });

    const recipient = required(actors.get(2));
    const translation = new Vector3(7, -1, 4);
    recipient.x += translation.x;
    recipient.y += translation.y;
    recipient.z += translation.z;
    layers.forEach((call, i) => {
      expectPoints(
        sample(call),
        before[i].map((p) => p.clone().add(translation)),
      );
    });
    const turn = 1.1;
    recipient.yaw += turn;
    const axis = new Vector3(0, 1, 0);
    layers.forEach((call, i) => {
      expectPoints(
        sample(call),
        before[i].map((p) =>
          p.clone().sub(origin).applyAxisAngle(axis, turn).add(origin).add(translation),
        ),
      );
    });
    actors.delete(2);
    for (const call of layers) expect(call[3]([new Vector3(), new Vector3()])).toBe(0);
  });

  it.each(blades)(
    '%s keeps authored paths stable when another invocation overwrites scratch',
    (id) => {
      const { host } = fixture();
      const hit = slot(id);
      draw(host, hit);
      const original = [...vi.mocked(host.pathRibbon).mock.calls];
      expect(original.some((call) => call[9])).toBe(true);
      expect(original.some((call) => !call[9])).toBe(true);
      const before = original.map(sample);
      Object.assign(hit, slot('execute'), { casterId: 3, targetId: 4 });
      draw(host, hit);
      // Evaluate the new fills as the renderer does, not only their registration.
      for (const call of vi.mocked(host.pathRibbon).mock.calls.slice(original.length)) sample(call);
      original.forEach((call, i) => {
        expectPoints(sample(call), before[i]);
      });
    },
  );

  it.each(battlecraft)('%s keeps one real contact in full and reduced detail', (id) => {
    for (const tier of [0, 1]) {
      const { host } = fixture();
      expect(draw(host, slot(id, 1, tier))).toBe(true);
      expect(host.contact).toHaveBeenCalledExactlyOnceWith(
        1,
        2,
        'physical',
        expect.any(Number),
        id,
        0,
      );
      expect(
        vi.mocked(host.flipbookAt).mock.calls.some((call) => call[5] === 'warrior_steel_flash'),
      ).toBe(true);
      expect(vi.mocked(host.pathRibbon).mock.calls.length).toBeGreaterThan(0);
    }
  });

  it.each(battlecraft)(
    '%s does not invent a wound or camera impact on a miss or full absorb',
    (id) => {
      for (const outcome of [0, 2]) {
        const { host } = fixture();
        expect(draw(host, slot(id, outcome))).toBe(true);
        expect(host.contact).not.toHaveBeenCalled();
        expect(host.shakeAt).not.toHaveBeenCalled();
        expect(host.pathRibbon).not.toHaveBeenCalled();
        expect(host.bakedAt).not.toHaveBeenCalled();
        expect(host.burstAt).not.toHaveBeenCalled();
        expect(host.flipbookAt).toHaveBeenCalledTimes(outcome === 2 ? 1 : 0);
        if (outcome === 2)
          expect(vi.mocked(host.flipbookAt).mock.calls[0][5]).toBe('contact_crush');
      }
    },
  );

  it('gives Early Grave a stronger contact sprite than frequent Brute Swing and Redhand', () => {
    const sprites = battlecraft.map((id) => {
      const { host } = fixture();
      draw(host, slot(id));
      const sprite = required(
        vi.mocked(host.flipbookAt).mock.calls.find((call) => call[5] === 'warrior_steel_flash'),
      );
      return { id, size: sprite[3], brightness: sprite[6] };
    });
    const execution = required(sprites.find((sprite) => sprite.id === 'execute'));
    for (const other of sprites.filter((sprite) => sprite.id !== 'execute'))
      expect(execution.size).toBeGreaterThan(other.size);
    for (const id of ['slam', 'overpower'])
      expect(execution.brightness).toBeGreaterThan(
        required(sprites.find((sprite) => sprite.id === id)).brightness,
      );
  });

  it('aligns Maiming Strike blade and retained wound with the receiving contact profile', () => {
    const { host, actors } = fixture();
    draw(host, slot('mortal_strike'));
    const calls = vi.mocked(host.pathRibbon).mock.calls;
    const caster = required(actors.get(1));
    const target = required(actors.get(2));
    const yaw = Math.atan2(target.x - caster.x, target.z - caster.z);
    const a = new Vector3(),
      b = new Vector3();
    const profile = required(meleeImpactProfile('mortal_strike'));
    meleeContactPoint(profile, 0, 0, 0, a);
    meleeContactPoint(profile, 1, 0, 0, b);
    const receivingAxis = b
      .sub(a)
      .applyAxisAngle(new Vector3(0, 1, 0), yaw)
      .normalize();
    const paths = [required(calls.find((call) => !call[9])), ...calls.filter((call) => call[9])];
    expect(paths).toHaveLength(3);
    for (const call of paths) {
      const points = sample(call);
      const cutAxis = required(points.at(-1)).clone().sub(points[0]).normalize();
      // A seam can be sampled in either direction but must share the cut plane.
      expect(Math.abs(cutAxis.dot(receivingAxis))).toBeGreaterThan(0.999);
    }
  });
});
