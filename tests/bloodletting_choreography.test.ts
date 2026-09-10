import { Vector3 } from 'three';
import { expect, it, vi } from 'vitest';
import { bloodlettingBeat } from '../src/render/ability_vfx/bloodletting_choreography';
import { buildBloodlettingShape } from '../src/render/ability_vfx/bloodletting_shape';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import { WARRIOR_VFX_FULL_SPECS } from '../src/render/warrior_vfx_specs';

function fixture(available = true) {
  const paths: Vector3[][] = [];
  const host = new Proxy(
    {
      anchorOf: (id: number, fraction: number, out: Vector3) =>
        Object.assign(out, { x: id === 1 ? 0 : 4, y: fraction * 2, z: 0 }),
      crestAt: vi.fn(() => available),
      bakedAt: vi.fn(() => available),
      pathRibbon: vi.fn((_c, _w, _d, fill) => {
        const points = Array.from({ length: 24 }, () => new Vector3());
        fill(points);
        paths.push(points);
        return true;
      }),
    },
    {
      get(target, key) {
        if (!(key in target)) Reflect.set(target, key, vi.fn());
        return Reflect.get(target, key);
      },
    },
  ) as unknown as SequencerHost;
  const slot = {
    abilityId: 'bloodthirst',
    casterId: 1,
    targetId: 2,
    tier: 0,
    componentOutcomes: 1,
    spec: WARRIOR_VFX_FULL_SPECS.bloodthirst,
  } as SeqSlot;
  return { host, slot, paths };
}

it('lands one bite on its victim without an extraction hit or a healing claim', () => {
  const { host, slot } = fixture();
  bloodlettingBeat(host, slot, 0);
  bloodlettingBeat(host, slot, 1);
  expect(host.contact).toHaveBeenCalledTimes(1);
  expect(vi.mocked(host.contact!).mock.calls[0].slice(0, 3)).toEqual([1, 2, 'physical']);
  expect(host.bakedAt).toHaveBeenCalledTimes(1);
  expect(vi.mocked(host.bakedAt!).mock.calls[0][1]).toBeGreaterThan(3);
  expect(host.ringAt).not.toHaveBeenCalled();
});

it.each([0, 2])('keeps missed or absorbed outcome %s free of wounds', (outcome) => {
  const { host, slot } = fixture();
  slot.componentOutcomes = outcome;
  bloodlettingBeat(host, slot, 0);
  expect(host.contact).not.toHaveBeenCalled();
  expect(host.burstAt).not.toHaveBeenCalled();
  expect(host.crestAt).not.toHaveBeenCalled();
  expect(host.bakedAt).not.toHaveBeenCalled();
  expect(host.shakeAt).not.toHaveBeenCalled();
  expect(host.flipbookAt).toHaveBeenCalledTimes(outcome === 2 ? 1 : 0);
});

it('keeps a full-size incision when the optional sculpture and sprite pools are busy', () => {
  const { host, slot, paths } = fixture(false);
  bloodlettingBeat(host, slot, 0);
  expect(paths).toHaveLength(2);
  expect(paths[0][0].distanceTo(paths[0].at(-1)!)).toBeGreaterThan(5);
  for (const path of paths)
    for (const point of path) expect(point.toArray().every(Number.isFinite)).toBe(true);
  expect(host.pathRibbon).toHaveBeenCalledWith(
    expect.any(Number),
    expect.any(Number),
    expect.any(Number),
    expect.any(Function),
    true,
    null,
    false,
    1,
  );
  expect(host.contact).toHaveBeenCalledTimes(1);
});

it('gives an actual secondary recipient contact without duplicating the caster performance', () => {
  const { host, slot } = fixture();
  slot.physicalSecondary = true;
  bloodlettingBeat(host, slot, 0);
  expect(host.contact).toHaveBeenCalledTimes(1);
  expect(host.crestAt).not.toHaveBeenCalled();
  expect(host.shakeAt).not.toHaveBeenCalled();
  expect(host.bakedAt).toHaveBeenCalledTimes(1);
});

it('has a broad non-planar tearing surface with finite geometry', () => {
  const geometry = buildBloodlettingShape();
  try {
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new Vector3());
    expect(size.x).toBeGreaterThan(5);
    expect(size.y).toBeGreaterThan(1.3);
    expect(size.z).toBeGreaterThan(0.4);
    expect([...geometry.getAttribute('position').array].every(Number.isFinite)).toBe(true);
    expect([...geometry.getAttribute('normal').array].every(Number.isFinite)).toBe(true);
  } finally {
    geometry.dispose();
  }
});
