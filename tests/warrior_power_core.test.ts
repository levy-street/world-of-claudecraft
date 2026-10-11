import { expect, it } from 'vitest';
import {
  WARRIOR_POWER_COUNTS,
  type WarriorPowerPiece,
  warriorPowerIntent,
  warriorPowerKind,
  warriorPowerPiece,
} from '../src/render/warrior_power_core';
import { ITEMS } from '../src/sim/data';
import { isShieldItem } from '../src/sim/equipment_rules';

it('requires the actual live power aura and rejects unrelated or invalid state', () => {
  expect(warriorPowerKind({ id: 'avatar', kind: 'buff_avatar', remaining: 20 })).toBe(0);
  expect(warriorPowerKind({ id: 'recklessness', kind: 'buff_reckless', remaining: 12 })).toBe(1);
  for (const remaining of [0, -1, NaN, Infinity, undefined])
    expect(warriorPowerKind({ id: 'avatar', kind: 'buff_avatar', remaining })).toBeNull();
  expect(warriorPowerKind({ id: 'avatar', kind: 'absorb', remaining: 20 })).toBeNull();
  expect(warriorPowerKind({ id: 'enrage', kind: 'buff_reckless', remaining: 12 })).toBeNull();
  expect(
    warriorPowerKind({ id: 'berserker_rage', kind: 'buff_reckless', remaining: 12 }),
  ).toBeNull();
});

it('uses authoritative local specialization before remote equipment intent', () => {
  const shield = Object.values(ITEMS).find(isShieldItem);
  if (!shield) throw Error('Canonical shield fixture missing');
  expect(warriorPowerIntent('arms', null, shield.id)).toBe(0);
  expect(warriorPowerIntent('fury', null, shield.id)).toBe(1);
  expect(warriorPowerIntent('prot', null, null)).toBe(2);
  expect(warriorPowerIntent(null, null, shield.id)).toBe(2);
  expect(warriorPowerIntent(null, null, null)).toBe(0);
});

it('reuses positive finite transforms and keeps reduced-motion held shapes still', () => {
  const scratch = {} as WarriorPowerPiece;
  for (const kind of [0, 1] as const)
    for (const intent of [0, 1, 2] as const)
      for (let index = 0; index < WARRIOR_POWER_COUNTS[kind]; index++) {
        const held = { ...warriorPowerPiece(scratch, kind, intent, index, 3, true) };
        expect(warriorPowerPiece(scratch, kind, intent, index, 12, true)).toBe(scratch);
        expect(scratch).toEqual(held);
        for (const age of [0, 0.05, 0.15, 0.32, 12]) {
          warriorPowerPiece(scratch, kind, intent, index, age, false);
          expect(Object.values(scratch).every(Number.isFinite)).toBe(true);
          expect(Math.min(scratch.sx, scratch.sy, scratch.sz)).toBeGreaterThan(0);
        }
      }
});
