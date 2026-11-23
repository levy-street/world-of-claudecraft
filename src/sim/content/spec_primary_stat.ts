// The one primary stat each specialization's power scales with: the single source
// for "what does this spec want". Read it, never a genre default or a stat-weight
// table. Derived from recalcPlayerStats in src/sim/entity.ts:
//   - warrior, paladin, shaman and druid melee attack power is 2 per Strength and
//     never reads Agility (Enhancement and Feral are Strength specs; a bear gains
//     only 1.5 attack power per Agility, a cat none);
//   - rogue melee attack power is Strength plus Agility, and Agility adds crit;
//   - hunter ranged attack power is 2 per Agility;
//   - spell power is Intellect, for every caster and healer (Arcane is a healer).
// tests/spec_primary_stat.test.ts re-derives every physical row from the live stat
// path and checks every per-spec gear and weight table against this one.

import type { PlayerClass } from '../types';

export type SpecPrimaryStat = 'str' | 'agi' | 'int';

export const SPEC_PRIMARY_STAT: Readonly<
  Record<PlayerClass, Readonly<Record<string, SpecPrimaryStat>>>
> = {
  warrior: { arms: 'str', fury: 'str', prot: 'str' },
  paladin: { holy: 'int', protection: 'str', retribution: 'str' },
  hunter: { beast_mastery: 'agi', marksmanship: 'agi', survival: 'agi' },
  rogue: { assassination: 'agi', combat: 'agi', subtlety: 'agi' },
  priest: { discipline: 'int', holy: 'int', shadow: 'int' },
  shaman: { elemental: 'int', enhancement: 'str', restoration: 'int' },
  mage: { arcane: 'int', fire: 'int', frost: 'int' },
  warlock: { affliction: 'int', demonology: 'int', destruction: 'int' },
  druid: { balance: 'int', feral: 'str', restoration: 'int' },
};
