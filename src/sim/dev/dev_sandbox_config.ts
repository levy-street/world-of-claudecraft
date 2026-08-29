// The /dev sandbox scenario's authored numbers and roster (data-as-code,
// the dev_kit_roles pattern): where the dummy and the practice bots stand
// relative to the caster, how many bots spawn, and the roomy started-low
// pool a healer can visibly climb. Consumed by Sim.startDevSandbox; a
// testing convenience, never a balance statement.
import type { PlayerClass } from '../types';

export const DEV_SANDBOX_CFG = {
  dummyX: -3,
  dummyZ: 4,
  bots: 5,
  botZ: 2,
  botX0: 2,
  botGap: 1.5,
  maxHp: 10_000,
  hp: 0.15,
} as const;

// A mixed party rather than all-mages (owner 2026-07-13): a rotating spread
// of classes so the practice allies read like a real group
// (tank/healer/melee/etc.), each with its own class HP pool and armor.
export const DEV_SANDBOX_CLASSES: readonly PlayerClass[] = [
  'warrior',
  'priest',
  'rogue',
  'hunter',
  'shaman',
  'warlock',
  'druid',
  'paladin',
  'mage',
];
