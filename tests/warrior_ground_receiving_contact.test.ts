import { Vector3 } from 'three';
import { expect, it, vi } from 'vitest';
import { drawIronguard } from '../src/render/ability_vfx/ironguard';
import type { SeqPoint, SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import { drawReapingArc, drawWarriorAreaContact } from '../src/render/ability_vfx/warrior_area';

const abilities = ['thunder_clap', 'faultline', 'heroic_leap'];

function harness() {
  const actors = new Map<number, SeqPoint>([
    [1, { x: 0, y: 0, z: 0 }],
    [2, { x: 0, y: 1, z: 3 }],
    [3, { x: 12, y: 2, z: -8 }],
    [4, { x: 30, y: 4, z: 20 }],
  ]);
  const yaw = new Map([[2, 0.6]]);
  const calls = {
    anchorOf: vi.fn((id: number, _height: number, out?: SeqPoint) => {
      if (!out) throw new Error('Contact anchors must use owned scratch');
      const actor = actors.get(id);
      return actor ? Object.assign(out, actor) : null;
    }),
    facingAt: (id: number) => yaw.get(id) ?? 0,
    pathRibbon: vi.fn(() => true),
    flipbookAt: vi.fn(),
    fragmentsAt: vi.fn(),
    contact: vi.fn(),
    countPrimitive: vi.fn(),
    crestAt: vi.fn(),
    bakedAt: vi.fn(),
    shockRing: vi.fn(),
    decalXZ: vi.fn(),
    groundYAt: vi.fn(() => 0),
    shakeAt: vi.fn(),
  };
  return { actors, yaw, host: calls as unknown as SequencerHost, calls };
}

function sample(fill: Parameters<SequencerHost['pathRibbon']>[3]): Vector3[] {
  const points = Array.from({ length: 25 }, () => new Vector3());
  expect(fill(points)).toBe(points.length);
  return points;
}

it.each(['revenge', 'thunder_clap', 'faultline'])(
  '%s keeps its cast footprint fixed across concurrent casts and moving casters',
  (id) => {
    const h = harness();
    const slot = { abilityId: id, casterId: 1, tier: 0, physicalSecondary: false } as SeqSlot;
    drawIronguard(h.host, slot, 0);
    const paths = [...vi.mocked(h.host.pathRibbon).mock.calls];
    const original = paths.map((path) => sample(path[3]));
    drawIronguard(h.host, { ...slot, casterId: 4 }, 0);
    h.actors.set(1, { x: 40, y: 3, z: -20 });
    paths.forEach((path, i) => {
      expect(sample(path[3])).toEqual(original[i]);
    });
  },
);

for (const tier of [0, 1])
  it.each(abilities)(
    `%s retains each recipient's own seam through other hits, movement and removal at tier ${tier}`,
    (id) => {
      const h = harness();
      expect(drawWarriorAreaContact(h.host, id, 1, 2, 1, tier)).toBe(true);
      const path = vi.mocked(h.host.pathRibbon).mock.calls[0];
      const original = sample(path[3]);
      expect(path.slice(6)).toEqual([true, 0, null, true]);

      // A different caster and recipient must not move an already-live seam.
      drawWarriorAreaContact(h.host, id, 4, 3, 1, tier);
      sample(vi.mocked(h.host.pathRibbon).mock.calls[1][3]);
      expect(sample(path[3])).toEqual(original);

      const target = h.actors.get(2)!;
      const translation = new Vector3(7, 2, -4);
      target.x += translation.x;
      target.y += translation.y;
      target.z += translation.z;
      const moved = sample(path[3]);
      moved.forEach((point, i) => {
        expect(point.distanceTo(original[i].clone().add(translation))).toBeLessThan(1e-6);
      });
      h.yaw.set(2, 0.6 + Math.PI / 2);
      const origin = new Vector3(target.x, target.y, target.z);
      sample(path[3]).forEach((point, i) => {
        const expected = moved[i]
          .clone()
          .sub(origin)
          .applyAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
          .add(origin);
        expect(point.distanceTo(expected)).toBeLessThan(1e-6);
      });
      h.actors.delete(2);
      expect(path[3](Array.from({ length: 25 }, () => new Vector3()))).toBe(0);
      // Refilling changes geometry only, never the impact count or area footprint.
      expect(h.calls.contact).toHaveBeenCalledTimes(2);
      expect(h.calls.flipbookAt).toHaveBeenCalledTimes(2);
      expect(h.calls.pathRibbon).toHaveBeenCalledTimes(2);
      expect(h.calls.countPrimitive.mock.calls).toEqual([
        [id, tier === 0 ? 3 : 2],
        [id, tier === 0 ? 3 : 2],
      ]);
      expect(h.calls.fragmentsAt).toHaveBeenCalledTimes(tier === 0 ? 2 : 0);
      expect(h.calls.crestAt).not.toHaveBeenCalled();
      expect(h.calls.bakedAt).not.toHaveBeenCalled();
      expect(h.calls.shockRing).not.toHaveBeenCalled();
      expect(h.calls.decalXZ).not.toHaveBeenCalled();
      expect(h.calls.groundYAt).not.toHaveBeenCalled();
    },
  );

it('Quaking Blow has a short larger compression followed by one dark body seam and bounded grit', () => {
  const h = harness();
  drawWarriorAreaContact(h.host, 'thunder_clap', 1, 2, 1, 0);
  const flash = vi.mocked(h.host.flipbookAt).mock.calls[0];
  const path = vi.mocked(h.host.pathRibbon).mock.calls[0];
  expect(flash[3]).toBe(4.1);
  expect(flash[5]).toBe('contact_crush');
  expect(flash[7]).toBe(0.07);
  expect(flash[9]).toBe(0.68);
  expect(path.slice(0, 3)).toEqual([0x334650, 0.34, 0.2]);
  const points = sample(path[3]);
  expect(Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x))).toBeLessThan(2);
  expect(points[12].y).toBeLessThan(points[0].y);
  expect(h.calls.fragmentsAt).toHaveBeenCalledWith(
    'stone_chip',
    0,
    1,
    2.74,
    0x9da4a7,
    8,
    1.2,
    0,
    1,
    0.22,
    true,
  );
});

it.each(['heroic_leap'])('%s preserves its existing receiving dimensions', (id) => {
  const h = harness();
  drawWarriorAreaContact(h.host, id, 1, 2, 1, 0);
  expect(h.calls.flipbookAt).toHaveBeenCalledWith(
    0,
    1,
    3,
    2.8,
    0xc4c9c9,
    'contact_crush',
    1.7,
    0.21,
    0.3,
    1,
  );
  expect(vi.mocked(h.host.pathRibbon).mock.calls[0].slice(0, 3)).toEqual([0xa8b3b5, 0.18, 0.2]);
  expect(h.calls.fragmentsAt).toHaveBeenCalledWith(
    'stone_chip',
    0,
    1,
    3,
    0x9da4a7,
    8,
    0.9,
    0,
    1,
    0.22,
    true,
  );
});

it('Faultline delivers the larger lower-body compression without replaying its ground area', () => {
  const h = harness();
  drawWarriorAreaContact(h.host, 'faultline', 1, 2, 1, 0);
  expect(h.calls.flipbookAt).toHaveBeenCalledWith(
    0,
    1,
    2.74,
    5.6,
    0xe1eaf0,
    'contact_crush',
    1.7,
    0.085,
    0,
    0.82,
  );
  expect(h.calls.pathRibbon.mock.calls[0].slice(0, 3)).toEqual([0x334650, 0.46, 0.2]);
  expect(h.calls.fragmentsAt).toHaveBeenCalledWith(
    'stone_chip',
    0,
    1,
    2.74,
    0x9da4a7,
    8,
    1.6,
    0,
    1,
    0.22,
    true,
  );
  expect(h.calls.contact).toHaveBeenCalledTimes(1);
  expect(h.calls.crestAt).not.toHaveBeenCalled();
  expect(h.calls.bakedAt).not.toHaveBeenCalled();
  expect(h.calls.shockRing).not.toHaveBeenCalled();
});

it.each(abilities)(
  '%s creates no real-hit imprint for misses, absorbs, self hits or absent recipients',
  (id) => {
    const h = harness();
    expect(drawWarriorAreaContact(h.host, id, 1, 2, 0, 0)).toBe(true);
    expect(drawWarriorAreaContact(h.host, id, 1, 1, 1, 0)).toBe(true);
    expect(drawWarriorAreaContact(h.host, id, 1, 99, 1, 0)).toBe(false);
    expect(h.calls.flipbookAt).not.toHaveBeenCalled();
    expect(drawWarriorAreaContact(h.host, id, 1, 2, 2, 0)).toBe(true);
    expect(h.calls.flipbookAt).toHaveBeenCalledTimes(1);
    expect(h.calls.flipbookAt).toHaveBeenCalledWith(
      0,
      1,
      3,
      2.4,
      0xcadce8,
      'contact_crush',
      1.7,
      0.21,
      0.3,
    );
    expect(h.calls.pathRibbon).not.toHaveBeenCalled();
    expect(h.calls.fragmentsAt).not.toHaveBeenCalled();
    expect(h.calls.contact).not.toHaveBeenCalled();
    expect(h.calls.countPrimitive).not.toHaveBeenCalled();
  },
);

it.each(abilities)(
  '%s still leaves a finite receiving seam when the source is no longer present',
  (id) => {
    const h = harness();
    h.actors.delete(1);
    expect(drawWarriorAreaContact(h.host, id, 1, 2, 1, 1)).toBe(true);
    const points = sample(vi.mocked(h.host.pathRibbon).mock.calls[0][3]);
    expect(points.every((point) => point.toArray().every(Number.isFinite))).toBe(true);
    expect(h.calls.contact).toHaveBeenCalledTimes(1);
  },
);

it.each([0, 1])(
  'a full ribbon pool preserves the real Quaking contact and existing tier %s budget',
  (tier) => {
    const h = harness();
    h.calls.pathRibbon.mockReturnValue(false);
    drawWarriorAreaContact(h.host, 'thunder_clap', 1, 2, 1, tier);
    expect(vi.mocked(h.host.pathRibbon).mock.calls[0].slice(6, 8)).toEqual([true, 0]);
    expect(h.calls.pathRibbon).toHaveBeenCalledTimes(1);
    expect(h.calls.flipbookAt).toHaveBeenCalledTimes(1);
    expect(h.calls.contact).toHaveBeenCalledTimes(1);
    expect(h.calls.countPrimitive).toHaveBeenCalledWith('thunder_clap', tier === 0 ? 3 : 2);
    expect(h.calls.fragmentsAt).toHaveBeenCalledTimes(tier === 0 ? 1 : 0);
  },
);

it.each([0, 1])(
  'Reaping Arc keeps its cast origin when another cast overwrites scratch at tier %s',
  (tier) => {
    const h = harness();
    const slot = { abilityId: 'cleave', casterId: 1, tier, physicalSecondary: false } as SeqSlot;
    expect(drawReapingArc(h.host, slot, 0)).toBe(true);
    const oldPaths = [...vi.mocked(h.host.pathRibbon).mock.calls];
    const before = oldPaths.map((path) => sample(path[3]));
    slot.casterId = 4;
    drawReapingArc(h.host, slot, 0);
    drawWarriorAreaContact(h.host, 'thunder_clap', 4, 3, 1, tier);
    h.actors.set(1, { x: -20, y: 10, z: 8 });
    h.yaw.set(1, Math.PI);
    oldPaths.forEach((path, i) => {
      expect(sample(path[3])).toEqual(before[i]);
    });
    expect(h.calls.crestAt).toHaveBeenCalledTimes(2);
    expect(oldPaths).toHaveLength(tier === 0 ? 3 : 1);
  },
);
