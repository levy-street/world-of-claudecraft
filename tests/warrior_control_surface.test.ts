import { Vector3 } from 'three';
import { expect, it, vi } from 'vitest';
import type { SequencerHost } from '../src/render/ability_vfx/sequencer';
import { drawWarriorControlSuccess } from '../src/render/ability_vfx/warrior_control';

const sizes = [
  { height: 0.8, armor: 0.18, jaw: 0.18 },
  { height: 2, armor: 0.28, jaw: 0.38 },
  { height: 4, armor: 0.56, jaw: 0.65 },
  { height: 8, armor: 0.65, jaw: 0.65 },
] as const;

function fixture(height: number, base: number, facing: number) {
  const target = { x: 7, y: base, z: -4 };
  const source = {
    x: target.x - Math.sin(facing) * 4,
    y: base,
    z: target.z - Math.cos(facing) * 4,
  };
  const anchor = vi.fn<SequencerHost['anchorOf']>((id, fraction, out) => {
    if (!out) throw new Error('Contact anchors require caller-owned scratch');
    const actor = id === 1 ? source : target;
    return Object.assign(out, {
      x: actor.x,
      y: actor.y + fraction * (id === 1 ? 2 : height),
      z: actor.z,
    });
  });
  const host = new Proxy(
    { anchorOf: anchor, groundYAt: () => -20 },
    {
      get(object, key) {
        if (!(key in object)) Reflect.set(object, key, vi.fn());
        return Reflect.get(object, key);
      },
    },
  ) as unknown as SequencerHost;
  return { host, target, anchor };
}

it.each(['sunder_armor', 'pummel'] as const)(
  '%s uses the actual receiving body surface at every size, orientation and elevation',
  (id) => {
    for (const size of sizes)
      for (const base of [0, 8, -3])
        for (const facing of [0, 1.3, -2.2]) {
          const { host, target, anchor } = fixture(size.height, base, facing);
          drawWarriorControlSuccess(host, id, 1, 2, 0);
          const calls = vi.mocked(host.flipbookAt).mock.calls;
          expect(calls).toHaveLength(1);
          const at = calls[0];
          const displacement = id === 'sunder_armor' ? size.armor : size.jaw;
          expect(at[0]).toBeCloseTo(target.x - Math.sin(facing) * displacement, 9);
          expect(at[1]).toBeCloseTo(base + size.height * (id === 'sunder_armor' ? 0.52 : 0.78), 9);
          expect(at[2]).toBeCloseTo(target.z - Math.cos(facing) * displacement, 9);
          expect(anchor).toHaveBeenCalledWith(2, 0, expect.any(Object));
          expect(host.contact).not.toHaveBeenCalled();
          expect(host.pulseLight).not.toHaveBeenCalled();
          expect(host.abilityAudio).toHaveBeenCalledTimes(1);
          if (!host.abilityAudio) throw new Error('Control audio fixture missing');
          const audio = vi.mocked(host.abilityAudio).mock.calls[0];
          expect(audio.slice(3, 6)).toEqual(at.slice(0, 3));
          expect(audio[6]?.abilityId).toBe(id);
          expect(vi.mocked(host.burstAt).mock.calls.every((call) => call[6] === 'sparks')).toBe(
            true,
          );
        }
  },
);

it.each([0, 1])(
  'retains the crisp material impact without invented injuries at tier %s',
  (tier) => {
    for (const id of ['sunder_armor', 'pummel'] as const) {
      const { host } = fixture(2, 5, 0.7);
      drawWarriorControlSuccess(host, id, 1, 2, tier);
      const flash = vi.mocked(host.flipbookAt).mock.calls[0];
      expect(flash[3]).toBe(id === 'sunder_armor' ? 7.2 : 7);
      expect(flash[5]).toBe(id === 'sunder_armor' ? 'warrior_steel_flash' : 'warrior_crush_flash');
      expect(flash[7]).toBe(id === 'sunder_armor' ? 0.27 : 0.25);
      // The principal catch reads as steel, without the old brown/red bias.
      expect((flash[4] >> 16) & 255).toBeLessThanOrEqual(flash[4] & 255);
      if (id === 'sunder_armor') {
        expect(host.fragmentsAt).toHaveBeenCalledTimes(2);
        if (!host.fragmentsAt) throw new Error('Control fragment fixture missing');
        const chips = vi.mocked(host.fragmentsAt).mock.calls;
        if (tier === 0) expect(chips[0][5]).not.toBe(chips[1][5]);
        expect(chips[0][6]).not.toBe(chips[1][6]);
        expect(chips.reduce((sum, group) => sum + group[5], 0)).toBe(tier === 0 ? 16 : 8);
        expect(host.pathRibbon).not.toHaveBeenCalled();
      } else {
        const paths = vi.mocked(host.pathRibbon).mock.calls;
        expect(paths).toHaveLength(2);
        for (const path of paths) {
          const points = Array.from({ length: 25 }, () => new Vector3());
          expect(path[3](points)).toBe(points.length);
          expect(points.every((point) => point.toArray().every(Number.isFinite))).toBe(true);
        }
      }
      expect(host.contact).not.toHaveBeenCalled();
      expect(host.bakedAt).not.toHaveBeenCalled();
      expect(vi.mocked(host.burstAt).mock.calls.every((call) => call[6] !== 'blood')).toBe(true);
    }
  },
);
