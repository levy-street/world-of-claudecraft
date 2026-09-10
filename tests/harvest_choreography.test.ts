import { Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { harvestBeat } from '../src/render/ability_vfx/harvest_choreography';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import { WARRIOR_VFX_FULL_SPECS } from '../src/render/warrior_vfx_specs';

function fixture(available = true) {
  const ribbons: Vector3[][] = [];
  const host = new Proxy(
    {
      anchorOf: (id: number, frac: number, out: { x: number; y: number; z: number }) =>
        Object.assign(out, { x: id === 1 ? 0 : 4, y: frac * 2, z: 2 }),
      bakedAt: vi.fn(() => available),
      crestAt: vi.fn(() => available),
      pathRibbon: vi.fn(
        (_colour: number, _width: number, _life: number, fill: (p: Vector3[]) => number) => {
          const points = Array.from({ length: 24 }, () => new Vector3());
          fill(points);
          ribbons.push(points);
          return true;
        },
      ),
    },
    {
      get(target, key) {
        if (!(key in target)) Reflect.set(target, key, vi.fn());
        return Reflect.get(target, key);
      },
    },
  ) as unknown as SequencerHost;
  const slot = {
    abilityId: 'red_harvest',
    casterId: 1,
    targetId: 2,
    tier: 0,
    componentOutcomes: 21,
    spec: WARRIOR_VFX_FULL_SPECS.red_harvest,
  } as SeqSlot;
  return { host, slot, ribbons };
}

describe('Red Harvest impact composition', () => {
  it('keeps full-height extraction when the shared sculpture and sprite pools are saturated', () => {
    const { host, slot, ribbons } = fixture(false);
    harvestBeat(host, slot, 2);
    expect(host.crestAt).toHaveBeenCalledTimes(1);
    expect(ribbons).toHaveLength(4);
    for (const ribbon of ribbons.slice(0, 2)) {
      expect(ribbon.every((p) => p.toArray().every(Number.isFinite))).toBe(true);
      const heights = ribbon.map((p) => p.y);
      expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(7.5);
    }
    expect(host.contact).toHaveBeenCalledTimes(1);
    expect(host.ringAt).not.toHaveBeenCalled();
  });
  it('does not duplicate the towering performance on cleave recipients', () => {
    const { host, slot } = fixture(false);
    slot.physicalSecondary = true;
    harvestBeat(host, slot, 2);
    expect(host.crestAt).not.toHaveBeenCalled();
    expect(host.pathRibbon).toHaveBeenCalledTimes(2);
    expect(host.contact).toHaveBeenCalledTimes(1);
    expect(host.shakeAt).not.toHaveBeenCalled();
  });
  it.each([0, 2])('never fabricates blood or an eruption for outcome %s', (outcome) => {
    const { host, slot } = fixture();
    slot.componentOutcomes = outcome << 4;
    harvestBeat(host, slot, 2);
    expect(host.bakedAt).not.toHaveBeenCalled();
    expect(host.crestAt).not.toHaveBeenCalled();
    expect(host.contact).not.toHaveBeenCalled();
    expect(host.burstAt).not.toHaveBeenCalled();
    expect(host.shakeAt).not.toHaveBeenCalled();
    expect(host.flipbookAt).toHaveBeenCalledTimes(outcome === 2 ? 1 : 0);
  });
});
