import { describe, expect, it } from 'vitest';
import {
  CRUCIBLE_BALANCE_PROFILES,
  CRUCIBLE_CRAFTED_PAIRS,
  crucibleBalanceLoadout,
  crucibleBalanceStatRows,
} from '../scripts/crucible_professions_balance_probe';
import { ITEM_SETS, ITEMS } from '../src/sim/data';
import { canEquipItem } from '../src/sim/equipment_rules';
import type { EquipSlot } from '../src/sim/types';

describe('controlled Crucible profession balance fixtures', () => {
  it('covers every collection, with all three two-piece slot choices', () => {
    expect(CRUCIBLE_BALANCE_PROFILES).toHaveLength(11);
    expect(new Set(CRUCIBLE_BALANCE_PROFILES.map((row) => row.collection)).size).toBe(11);
    expect(CRUCIBLE_CRAFTED_PAIRS).toEqual([
      ['chest', 'waist'],
      ['chest', 'feet'],
      ['waist', 'feet'],
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
            expect(loadout[def.slot as EquipSlot]).toBe(def.id);
          }
          const lineage = defs.filter((def) => def.set && ITEM_SETS[def.set]?.lineage).length;
          expect(lineage).toBe(stage === 'old6' ? 6 : stage === 'mixed' ? 4 : 0);
          expect(defs.filter((def) => def.set === profile.collection)).toHaveLength(
            stage === 'old6' ? 0 : 2,
          );
          expect(defs.filter((def) => def.set === profile.raid)).toHaveLength(
            stage === 'raid' ? 4 : 0,
          );
        }
      }
    }
  });

  it('reports every raw tier and Perfecting variant without silently disabling the set', () => {
    const rows = crucibleBalanceStatRows();
    expect(rows).toHaveLength(143);
    for (const row of rows) {
      expect(row.control).toBe('full');
      expect(row.crafted).toBe(row.stage === 'old6' ? null : row.profile);
      if (!row.perfected) continue;
      const base = rows.find(
        (candidate) =>
          candidate.profile === row.profile &&
          candidate.stage === row.stage &&
          candidate.pair === row.pair &&
          !candidate.perfected,
      );
      expect(base).toBeDefined();
      if (!base) throw new Error('missing matching base fixture');
      const delta = (['str', 'agi', 'sta', 'int', 'spi'] as const).reduce(
        (sum, key) => sum + row.stats[key] - base.stats[key],
        0,
      );
      expect(delta).toBe(row.pair.some((slot) => slot === 'feet') ? 3 : 4);
      // No flat armor bonus, but every additional Agility still grants its
      // normal two derived armor points through the real stat fold.
      expect(row.stats.armor - base.stats.armor).toBe(2 * (row.stats.agi - base.stats.agi));
    }
  });
});
