import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { SeqPoint, SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import { drawWarriorGyre } from '../src/render/ability_vfx/warrior_gyre';

type Fill = Parameters<SequencerHost['pathRibbon']>[3];

function sample(fill: Fill) {
  const points = Array.from({ length: 33 }, () => new THREE.Vector3());
  expect(fill(points)).toBe(points.length);
  return points;
}

function fixture() {
  const casters = new Map([
    [1, { x: 4, y: 2, z: -9, facing: 0.2 }],
    [2, { x: -13, y: 6, z: 11, facing: 1.1 }],
  ]);
  const ribbons = vi.fn<SequencerHost['pathRibbon']>();
  const count = vi.fn();
  const host = {
    anchorOf: (id: number, _height: number, out: SeqPoint) => {
      const caster = casters.get(id);
      return caster ? Object.assign(out, { x: caster.x, y: caster.y, z: caster.z }) : null;
    },
    facingAt: (id: number) => casters.get(id)?.facing ?? 0,
    groundYAt: () => 0,
    pathRibbon: ribbons,
    countPrimitive: count,
  } as unknown as SequencerHost;
  return { host, casters, ribbons, count };
}

it.each([0, 1])('keeps both retained Gyre paths owned by their cast at tier %s', (tier) => {
  const f = fixture();
  const slot = { abilityId: 'whirlwind', casterId: 1, tier } as SeqSlot;
  expect(drawWarriorGyre(f.host, slot, 0)).toBe(true);
  const firstFills = f.ribbons.mock.calls.map((call) => call[3]);
  expect(firstFills).toHaveLength(2);
  const firstPaths = firstFills.map(sample);

  expect(drawWarriorGyre(f.host, { ...slot, casterId: 2 }, 0)).toBe(true);
  const secondFills = f.ribbons.mock.calls.slice(2).map((call) => call[3]);
  expect(secondFills).toHaveLength(2);
  const secondPaths = secondFills.map(sample);
  expect(firstFills.map(sample)).toEqual(firstPaths);

  // Each cast uses the same two shapes transformed into its own world frame.
  // This checks translation, elevation and yaw without duplicating curve math.
  const firstOrigin = new THREE.Vector3(4, 2, -9);
  const secondOrigin = new THREE.Vector3(-13, 6, 11);
  for (let blade = 0; blade < 2; blade++) {
    expect(secondPaths[blade]).not.toEqual(firstPaths[blade]);
    for (let point = 0; point < firstPaths[blade].length; point++) {
      const expected = firstPaths[blade][point]
        .clone()
        .sub(firstOrigin)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), 1.1 - 0.2)
        .add(secondOrigin);
      expect(secondPaths[blade][point].distanceTo(expected)).toBeLessThan(1e-10);
    }
  }

  f.casters.set(1, { x: 22, y: -3, z: 31, facing: -0.8 });
  expect(drawWarriorGyre(f.host, slot, 0)).toBe(true);
  expect(firstFills.map(sample)).toEqual(firstPaths);
  expect(secondFills.map(sample)).toEqual(secondPaths);
  expect(f.count.mock.calls).toEqual(
    Array.from({ length: 3 }, () => ['whirlwind', tier === 0 ? 7 : 5]),
  );
});

it.each([
  { abilityId: 'cleave', casterId: 1, beat: 0, secondary: false, claimed: false },
  { abilityId: 'whirlwind', casterId: 99, beat: 0, secondary: false, claimed: true },
  { abilityId: 'whirlwind', casterId: 1, beat: 1, secondary: false, claimed: true },
  { abilityId: 'whirlwind', casterId: 1, beat: 0, secondary: true, claimed: true },
])('does not emit paths outside the primary live-source cast: %j', (entry) => {
  const f = fixture();
  const slot = {
    abilityId: entry.abilityId,
    casterId: entry.casterId,
    physicalSecondary: entry.secondary,
    tier: 0,
  } as SeqSlot;
  expect(drawWarriorGyre(f.host, slot, entry.beat)).toBe(entry.claimed);
  expect(f.ribbons).not.toHaveBeenCalled();
  expect(f.count).not.toHaveBeenCalled();
});
