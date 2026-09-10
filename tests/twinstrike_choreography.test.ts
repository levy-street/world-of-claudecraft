import { Vector3 } from 'three';
import { expect, it, vi } from 'vitest';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import { twinstrikeBeat } from '../src/render/ability_vfx/twinstrike_choreography';
import { buildTwinstrikeShape } from '../src/render/ability_vfx/twinstrike_shape';
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
    abilityId: 'raging_gale',
    casterId: 1,
    targetId: 2,
    tier: 0,
    componentOutcomes: 5,
    spec: WARRIOR_VFX_FULL_SPECS.raging_gale,
  } as SeqSlot;
  return { host, slot, paths };
}

it('opposes the two blade planes and gives the second confirmed contact more weight', () => {
  const { host, slot } = fixture();
  twinstrikeBeat(host, slot, 0);
  twinstrikeBeat(host, slot, 1);
  const crests = vi.mocked(host.crestAt!).mock.calls;
  expect(crests).toHaveLength(2);
  expect(crests[0][10] * crests[1][10]).toBeLessThan(0);
  const contacts = vi.mocked(host.contact!).mock.calls;
  expect(contacts.map((c) => c[5])).toEqual([0, 1]);
  expect(contacts[1][3]).toBeGreaterThan(contacts[0][3]);
  expect(host.ringAt).not.toHaveBeenCalled();
});

it.each([0, 2])('never invents a wound for either component with outcome %s', (outcome) => {
  const { host, slot } = fixture();
  slot.componentOutcomes = outcome | (outcome << 2);
  twinstrikeBeat(host, slot, 0);
  twinstrikeBeat(host, slot, 1);
  for (const draw of [host.contact, host.burstAt, host.crestAt, host.bakedAt, host.shakeAt])
    expect(draw).not.toHaveBeenCalled();
  expect(host.flipbookAt).toHaveBeenCalledTimes(outcome === 2 ? 2 : 0);
});

it('preserves the blade span and both actual contacts when optional pools refuse admission', () => {
  const { host, slot, paths } = fixture(false);
  twinstrikeBeat(host, slot, 0);
  twinstrikeBeat(host, slot, 1);
  expect(paths).toHaveLength(4);
  for (const path of [paths[0], paths[2]]) {
    expect(path[0].distanceTo(path.at(-1)!)).toBeGreaterThan(5);
    expect(path.every((p) => p.toArray().every(Number.isFinite))).toBe(true);
  }
  expect(host.contact).toHaveBeenCalledTimes(2);
});

it('keeps secondary receiving wounds without a second caster performance', () => {
  const { host, slot } = fixture();
  slot.physicalSecondary = true;
  twinstrikeBeat(host, slot, 0);
  twinstrikeBeat(host, slot, 1);
  expect(host.contact).toHaveBeenCalledTimes(2);
  expect(host.crestAt).not.toHaveBeenCalled();
  expect(host.shakeAt).not.toHaveBeenCalled();
  expect(host.bakedAt).toHaveBeenCalledTimes(2);
});

it('builds a finite open cutting surface with separate material identities for its folds', () => {
  const geometry = buildTwinstrikeShape();
  try {
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.getSize(new Vector3()).x).toBeGreaterThan(5);
    for (const attribute of ['position', 'normal', 'uv'])
      expect([...geometry.getAttribute(attribute).array].every(Number.isFinite)).toBe(true);
    const uv = geometry.getAttribute('uv');
    expect(new Set(Array.from({ length: uv.count }, (_, i) => Math.floor(uv.getY(i) / 2)))).toEqual(
      new Set([0, 1, 2, 3]),
    );
  } finally {
    geometry.dispose();
  }
});
