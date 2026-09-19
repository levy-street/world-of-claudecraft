import type { Vector3 } from 'three';
import { expect, it, vi } from 'vitest';
import { bloodlettingBeat } from '../src/render/ability_vfx/bloodletting_choreography';
import { harvestBeat } from '../src/render/ability_vfx/harvest_choreography';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import { twinstrikeBeat } from '../src/render/ability_vfx/twinstrike_choreography';
import { WARRIOR_VFX_FULL_SPECS } from '../src/render/warrior_vfx_specs';

it.each([0, 1])('keeps Bloodrush coherent and its finisher largest at tier %s', (tier) => {
  const host = new Proxy(
    {
      anchorOf: (id: number, fraction: number, out: Vector3) =>
        Object.assign(out, { x: id === 1 ? 0 : 4, y: fraction * 2, z: 0 }),
      groundYAt: () => 0,
      facingAt: () => 0,
      bakedAt: vi.fn(() => true),
      crestAt: vi.fn(() => true),
      pathRibbon: vi.fn(() => true),
    },
    {
      get(target, key) {
        if (!(key in target)) Reflect.set(target, key, vi.fn());
        return Reflect.get(target, key);
      },
    },
  ) as unknown as SequencerHost;
  const sizes = new Map<string, number[]>();
  for (const [id, draw, beats, outcomes] of [
    ['raging_gale', twinstrikeBeat, 2, 5],
    ['bloodthirst', bloodlettingBeat, 1, 1],
    ['red_harvest', harvestBeat, 3, 21],
  ] as const) {
    const slot = {
      abilityId: id,
      casterId: 1,
      targetId: 2,
      tier,
      componentOutcomes: outcomes,
      spec: WARRIOR_VFX_FULL_SPECS[id],
    } as SeqSlot;
    vi.mocked(host.bakedAt!).mockClear();
    vi.mocked(host.contact!).mockClear();
    for (let beat = 0; beat < beats; beat++) draw(host, slot, beat);
    const sprays = vi
      .mocked(host.bakedAt!)
      .mock.calls.filter((call) => call[0] === 'harvest_impact');
    expect(sprays).toHaveLength(beats);
    expect(host.contact).toHaveBeenCalledTimes(beats);
    for (const spray of sprays) {
      expect(spray.slice(5, 7)).toEqual([0xffffff, 0xff8990]);
      expect(spray[1]).toBeGreaterThan(3);
      expect(spray[4]).toBeGreaterThanOrEqual(5);
      expect(spray[4]).toBeLessThanOrEqual(9);
      expect(spray[13] ?? 1).toBeLessThanOrEqual(2);
      expect(spray[7] + (spray[8] ?? 0)).toBeLessThan(0.3);
    }
    sizes.set(
      id,
      sprays.map((call) => call[4] * (call[13] ?? 1)),
    );
  }
  const twin = sizes.get('raging_gale')!;
  const harvest = sizes.get('red_harvest')!;
  expect(twin[0]).toBeGreaterThanOrEqual(6);
  expect(twin[1]).toBeGreaterThan(twin[0]);
  expect(harvest[1]).toBeGreaterThan(harvest[0]);
  expect(harvest[2]).toBeGreaterThan(Math.max(...twin, ...sizes.get('bloodthirst')!));
  for (const crest of vi.mocked(host.crestAt!).mock.calls)
    expect(crest.slice(5, 7)).toEqual([0x590719, 0xd9233d]);
  expect(host.ringAt).not.toHaveBeenCalled();
});
