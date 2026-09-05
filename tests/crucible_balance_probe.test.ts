import { describe, expect, it } from 'vitest';
import {
  CRUCIBLE_BALANCE_PROFILES,
  CRUCIBLE_CRAFTED_PAIRS,
  crucibleBalanceLoadout,
} from '../scripts/crucible_professions_balance_probe';
import { ITEMS, ITEM_SETS } from '../src/sim/data';
import { canEquipItem } from '../src/sim/equipment_rules';

describe('controlled Crucible profession balance fixtures', () => {
  it('covers every collection, with all three two-piece slot choices', () => {
    expect(CRUCIBLE_BALANCE_PROFILES).toHaveLength(11);
    expect(new Set(CRUCIBLE_BALANCE_PROFILES.map((row) => row.collection)).size).toBe(11);
    expect(CRUCIBLE_CRAFTED_PAIRS).toEqual([
      ['chest', 'waist'], ['chest', 'feet'], ['waist', 'feet'],
    ]);
  });

  it('keeps six legal armor pieces and exact old6, old4+crafted2, raid4+crafted2 breakpoints', () => {
    for (const profile of CRUCIBLE_BALANCE_PROFILES) {
      for (const pair of CRUCIBLE_CRAFTED_PAIRS) {
        for (const stage of ['old6', 'mixed', 'raid'] as const) {
          const loadout = crucibleBalanceLoadout(profile, stage, pair);
          const defs = Object.values(loadout).map((id) => ITEMS[id]);
          expect(defs, `${profile.collection}/${stage}/${pair}`).toHaveLength(6);
          for (const def of defs) {
            expect(canEquipItem(profile.cls, def), def.id).toBe(true);
            expect(loadout[def.slot!]).toBe(def.id);
          }
          const lineage = defs.filter((def) => def.set && ITEM_SETS[def.set]?.lineage).length;
          expect(lineage).toBe(stage === 'old6' ? 6 : stage === 'mixed' ? 4 : 0);
          expect(defs.filter((def) => def.set === profile.collection)).toHaveLength(stage === 'old6' ? 0 : 2);
          expect(defs.filter((def) => def.set === profile.raid)).toHaveLength(stage === 'raid' ? 4 : 0);
        }
      }
    }
  });
});
