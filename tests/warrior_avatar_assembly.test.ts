import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  WARRIOR_POWER_COUNTS,
  type WarriorPowerIntent,
  type WarriorPowerPiece,
  warriorPowerPiece,
} from '../src/render/warrior_power_core';

const intents = [0, 1, 2] as const;
const ages = [0, 0.01, 0.04, 0.08, 0.12, 0.18, 0.24, 0.3, 0.35, 0.36, 1, 12];
const colors = [0xc6cecc, 0xd2bdbe, 0xbbc9d2];
function sample(intent: WarriorPowerIntent, part: number, age: number, reduced = false) {
  return warriorPowerPiece({} as WarriorPowerPiece, 0, intent, part, age, reduced, true);
}
function distance(a: WarriorPowerPiece, b: WarriorPowerPiece) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
function settled(intent: WarriorPowerIntent, part: number): WarriorPowerPiece {
  return {
    x: 0,
    y: part < 3 ? 0 : -0.15,
    z: part < 3 ? 0 : -0.085,
    yaw: part === 2 ? (Math.PI * 13) / 18 : part < 3 ? 0 : Math.PI,
    roll: 0,
    sx: part < 3 ? 1 : 0.9,
    sy: part < 3 ? 1 : 0.14,
    sz: part < 3 ? 1 : 0.65,
    color: colors[intent],
  };
}

it('assembles all five native Avatar plates without stretching any dimension', () => {
  expect(WARRIOR_POWER_COUNTS[0]).toBe(5);
  for (const intent of intents)
    for (let part = 0; part < 5; part++) {
      const final = settled(intent, part);
      for (const age of ages) {
        const actual = sample(intent, part, age);
        expect(Object.values(actual).every(Number.isFinite)).toBe(true);
        expect(
          [actual.sx, actual.sy, actual.sz],
          `intent ${intent}, part ${part}, age ${age}`,
        ).toEqual([final.sx, final.sy, final.sz]);
        expect(actual.color).toBe(final.color);
      }
    }
});

it('approaches each final bone position monotonically with staggered plates settled by .36s', () => {
  for (const intent of intents) {
    const earlyDistances: number[] = [];
    for (let part = 0; part < 5; part++) {
      const final = settled(intent, part);
      let previous = distance(sample(intent, part, 0), final);
      expect(previous, `part ${part} starts displaced`).toBeGreaterThan(0);
      earlyDistances.push(distance(sample(intent, part, 0.08), final));
      for (const age of ages) {
        const next = distance(sample(intent, part, age), final);
        expect(next).toBeLessThanOrEqual(previous + 1e-12);
        previous = next;
      }
      for (const age of [0.36, 1, 12, 100, 0.36, 100])
        expect(sample(intent, part, age)).toEqual(final);
    }
    expect(new Set(earlyDistances.map((value) => value.toFixed(9))).size).toBeGreaterThan(1);
  }
});

it('holds the exact settled native transforms and specialization colors from age zero in reduced motion', () => {
  for (const intent of intents)
    for (let part = 0; part < 5; part++)
      for (const age of ages)
        expect(sample(intent, part, age, true)).toEqual(settled(intent, part));
});

it('preserves the pre-assembly-change fallback Avatar and Recklessness transforms', () => {
  // Baseline of the unaffected branches, including animated roll, both motion
  // modes, every specialization, and every part. Native Avatar is excluded.
  const baseline: WarriorPowerPiece[] = [];
  for (const kind of [0, 1] as const)
    for (const nativeBone of [false, true]) {
      if (kind === 0 && nativeBone) continue;
      for (const intent of intents)
        for (let part = 0; part < WARRIOR_POWER_COUNTS[kind]; part++)
          for (const reduced of [false, true])
            for (const age of ages)
              baseline.push(
                warriorPowerPiece(
                  {} as WarriorPowerPiece,
                  kind,
                  intent,
                  part,
                  age,
                  reduced,
                  nativeBone,
                ),
              );
    }
  expect(createHash('sha256').update(JSON.stringify(baseline)).digest('hex')).toBe(
    '9fac37376737717a196abc42874ba122d57d5227442f1148c3e1ad864b80730f',
  );
});
