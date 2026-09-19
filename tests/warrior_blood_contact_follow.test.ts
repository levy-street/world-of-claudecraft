import { Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { bloodlettingBeat } from '../src/render/ability_vfx/bloodletting_choreography';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import { twinstrikeBeat } from '../src/render/ability_vfx/twinstrike_choreography';
import { WARRIOR_VFX_FULL_SPECS } from '../src/render/warrior_vfx_specs';

type Ribbon = Parameters<SequencerHost['pathRibbon']>;
const contacts = [
  { id: 'raging_gale', beat: 0, delay: 0.015, clear: 0.2, size: 5.2, life: 0.2, shake: 0.12 },
  { id: 'raging_gale', beat: 1, delay: 0.022, clear: 0.2, size: 5.8, life: 0.2, shake: 0.18 },
  { id: 'bloodthirst', beat: 0, delay: 0.02, clear: 0.27, size: 6.2, life: 0.23, shake: 0.15 },
] as const;

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing required contact fixture or emitted effect');
  return value;
}

function fixture(available = true) {
  const actors = new Map([
    [1, { x: -3, y: 1, z: -4, yaw: 0.6, height: 2 }],
    [2, { x: 4, y: 2, z: 6, yaw: -0.5, height: 2.6 }],
    [3, { x: -16, y: 5, z: 20, yaw: 2, height: 1.2 }],
    [4, { x: 25, y: 8, z: -19, yaw: -2, height: 3.4 }],
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
      crestAt: vi.fn(() => available),
      bakedAt: vi.fn(() => available),
      pathRibbon: vi.fn((..._args: Ribbon) => true),
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

function slot(id: string, outcome = 1, secondary = false): SeqSlot {
  return {
    abilityId: id,
    casterId: 1,
    targetId: 2,
    tier: 0,
    componentOutcomes: id === 'raging_gale' ? outcome | (outcome << 2) : outcome,
    physicalSecondary: secondary,
    spec: WARRIOR_VFX_FULL_SPECS[id],
  } as SeqSlot;
}

function draw(host: SequencerHost, hit: SeqSlot, beat: number) {
  return hit.abilityId === 'raging_gale'
    ? twinstrikeBeat(host, hit, beat)
    : bloodlettingBeat(host, hit, beat);
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

describe.each(contacts)('$id contact $beat', ({ id, beat, delay, clear, size, life, shake }) => {
  it.each([true, false])(
    'follows the original recipient through movement, turning, pooling and removal (ready=%s)',
    (available) => {
      const { host, actors } = fixture(available);
      const hit = slot(id);
      draw(host, hit, beat);
      const calls = [...vi.mocked(host.pathRibbon).mock.calls];
      expect(calls).toHaveLength(2);
      expect(calls.filter((call) => call[9])).toHaveLength(available ? 2 : 1);
      const before = calls.map(sample);
      const actor = required(actors.get(2));
      const pivot = new Vector3(actor.x, actor.y, actor.z);

      Object.assign(hit, slot(id), { casterId: 3, targetId: 4 });
      draw(host, hit, id === 'raging_gale' ? 1 - beat : 0);
      for (const call of vi.mocked(host.pathRibbon).mock.calls.slice(2)) sample(call);
      calls.forEach((call, i) => {
        expectPoints(sample(call), before[i]);
      });

      const translation = new Vector3(6, -1, 3);
      actor.x += translation.x;
      actor.y += translation.y;
      actor.z += translation.z;
      actor.yaw += 1.2;
      for (let i = 0; i < calls.length; i++) {
        const expected = calls[i][9]
          ? before[i].map((p) =>
              p
                .clone()
                .sub(pivot)
                .applyAxisAngle(new Vector3(0, 1, 0), 1.2)
                .add(pivot)
                .add(translation),
            )
          : before[i];
        expectPoints(sample(calls[i]), expected);
      }
      // Refilling geometry cannot create damage, extraction, audio, or camera beats.
      for (const effect of [host.contact, host.burstAt, host.bakedAt, host.shakeAt])
        expect(effect).toHaveBeenCalledTimes(2);
      expect(host.abilityAudio).toHaveBeenCalledTimes(id === 'raging_gale' ? 2 : 0);
      actors.delete(2);
      for (const call of calls.filter((entry) => entry[9]))
        expect(call[3]([new Vector3(), new Vector3()])).toBe(0);
    },
  );

  it('preserves the bite sprite and blood clear time while separating extraction from crunch', () => {
    const { host, actors } = fixture();
    draw(host, slot(id), beat);
    const blood = vi.mocked(host.burstAt).mock.calls;
    expect(blood).toHaveLength(1);
    expect(blood[0][6]).toBe('blood');
    expect(blood[0][8]).toBeCloseTo(delay);
    expect(required(blood[0][7]) + required(blood[0][8])).toBeCloseTo(clear);
    const baked = vi.mocked(required(host.bakedAt)).mock.calls;
    expect(baked).toHaveLength(1);
    expect(baked[0][0]).toBe(id === 'raging_gale' ? 'harvest_impact' : 'warrior_bite');
    expect(baked[0][4]).toBe(size);
    expect(baked[0][7]).toBe(life);
    expect(baked[0][8]).toBe(0);
    expect(host.contact).toHaveBeenCalledExactlyOnceWith(
      1,
      2,
      'physical',
      expect.any(Number),
      id,
      beat,
    );
    const actor = required(actors.get(2));
    expect(host.shakeAt).toHaveBeenCalledExactlyOnceWith(
      actor.x,
      expect.any(Number),
      actor.z,
      shake,
      true,
    );
  });

  it.each([0, 2])('cannot emit receiving wounds or crunch for outcome %s', (outcome) => {
    const { host } = fixture();
    draw(host, slot(id, outcome), beat);
    for (const effect of [
      host.contact,
      host.burstAt,
      host.bakedAt,
      host.crestAt,
      host.pathRibbon,
      host.shakeAt,
      host.abilityAudio,
    ])
      expect(effect).not.toHaveBeenCalled();
    expect(host.flipbookAt).toHaveBeenCalledTimes(outcome === 2 ? 1 : 0);
    if (outcome === 2) expect(vi.mocked(host.flipbookAt).mock.calls[0][5]).toBe('contact_crush');
  });

  it('keeps secondary receiving ribbons attached without another primary camera or sculpture', () => {
    const { host, actors } = fixture(false);
    draw(host, slot(id, 1, true), beat);
    expect(host.contact).toHaveBeenCalledTimes(1);
    expect(host.shakeAt).not.toHaveBeenCalled();
    expect(host.crestAt).not.toHaveBeenCalled();
    const calls = vi.mocked(host.pathRibbon).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call[9] === true)).toBe(true);
    const before = calls.map(sample);
    required(actors.get(2)).x += 4;
    calls.forEach((call, i) => {
      expectPoints(
        sample(call),
        before[i].map((p) => p.clone().add(new Vector3(4, 0, 0))),
      );
    });
    expect(host.contact).toHaveBeenCalledTimes(1);
    expect(host.burstAt).toHaveBeenCalledTimes(1);
  });
});

it.each([0, 2])('Twinstrike independently confirms its two component outcomes (%s)', (avoided) => {
  for (const confirmedBeat of [0, 1]) {
    const { host } = fixture();
    const hit = slot('raging_gale');
    hit.componentOutcomes = confirmedBeat === 0 ? 1 | (avoided << 2) : avoided | (1 << 2);
    twinstrikeBeat(host, hit, 0);
    twinstrikeBeat(host, hit, 1);
    twinstrikeBeat(host, hit, 2);
    expect(host.contact).toHaveBeenCalledExactlyOnceWith(
      1,
      2,
      'physical',
      expect.any(Number),
      'raging_gale',
      confirmedBeat,
    );
    expect(host.burstAt).toHaveBeenCalledTimes(1);
    expect(host.shakeAt).toHaveBeenCalledTimes(1);
  }
});

it('Bloodletting cannot turn follow-through into a second hit or extraction', () => {
  const { host } = fixture();
  const hit = slot('bloodthirst');
  bloodlettingBeat(host, hit, 0);
  bloodlettingBeat(host, hit, 1);
  bloodlettingBeat(host, hit, 2);
  expect(host.contact).toHaveBeenCalledTimes(1);
  expect(host.burstAt).toHaveBeenCalledTimes(1);
  expect(host.bakedAt).toHaveBeenCalledTimes(1);
  expect(host.shakeAt).toHaveBeenCalledTimes(1);
});
