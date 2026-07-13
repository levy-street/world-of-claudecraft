// The Pandaria-style choice-row talent framework (src/sim/content/talent_rows.ts):
// 6 tiers gated at levels 5/8/11/14/17/20, pick one of three per tier. This pins
// the load-time validator, the level-unlock math, and that a picked option's effect
// folds into the flat TalentModifiers through the shared effect engine.

import { describe, expect, it } from 'vitest';
import type { RowTree } from '../src/sim/content/talent_rows';
import {
  computeRowModifiers,
  emptyRowPicks,
  OPTIONS_PER_ROW,
  ROW_COUNT,
  ROW_LEVELS,
  rowsUnlockedAt,
  validateRowTree,
} from '../src/sim/content/talent_rows';
import type { TalentEffect } from '../src/sim/content/talents';

// A well-formed fixture tree: stat options plus one that layers root + slow onto
// the existing Charge ability (the container-agnostic effect path, addEffects).
function fixture(): RowTree {
  const stat = (id: string, effect: TalentEffect) => ({ id, name: id, description: id, effect });
  return [
    {
      level: 5,
      options: [
        stat('f_crit', { stats: { crit: 0.05 } }),
        stat('f_dodge', { stats: { dodge: 0.05 } }),
        stat('f_charge', {
          ability: [
            {
              ability: 'charge',
              addEffects: [
                { type: 'root', duration: 4 },
                { type: 'slow', mult: 0.5, duration: 15 },
              ],
            },
          ],
        }),
      ],
    },
    {
      level: 8,
      options: [
        stat('f_ap', { stats: { ap: 10 } }),
        stat('f_sta', { stats: { sta: 8 } }),
        stat('f_armor', { stats: { armorPct: 0.05 } }),
      ],
    },
    { level: 11, options: [stat('f_a', {}), stat('f_b', {}), stat('f_c', {})] },
    { level: 14, options: [stat('f_d', {}), stat('f_e', {}), stat('f_f', {})] },
    { level: 17, options: [stat('f_g', {}), stat('f_h', {}), stat('f_i', {})] },
    { level: 20, options: [stat('f_j', {}), stat('f_k', {}), stat('f_l', {})] },
  ];
}

describe('choice-row framework: shape constants', () => {
  it('is 6 tiers of 3 gated at 5/8/11/14/17/20', () => {
    expect(ROW_COUNT).toBe(6);
    expect(OPTIONS_PER_ROW).toBe(3);
    expect([...ROW_LEVELS]).toEqual([5, 8, 11, 14, 17, 20]);
  });
});

describe('validateRowTree', () => {
  it('accepts a well-formed tree', () => {
    expect(validateRowTree(fixture())).toEqual([]);
  });

  it('rejects the wrong number of rows', () => {
    const t = fixture().slice(0, 5);
    expect(validateRowTree(t).length).toBeGreaterThan(0);
  });

  it('rejects a wrong tier level', () => {
    const t = fixture();
    t[2].level = 12;
    expect(validateRowTree(t).some((e) => e.includes('level'))).toBe(true);
  });

  it('rejects a row without exactly three options', () => {
    const t = fixture();
    t[0].options = t[0].options.slice(0, 2);
    expect(validateRowTree(t).some((e) => e.includes('option'))).toBe(true);
  });

  it('rejects a duplicate option id', () => {
    const t = fixture();
    t[1].options[0].id = 'f_crit';
    expect(validateRowTree(t).some((e) => e.includes('duplicate'))).toBe(true);
  });
});

describe('rowsUnlockedAt', () => {
  it('unlocks one row per gate as you level', () => {
    expect(rowsUnlockedAt(4)).toBe(0);
    expect(rowsUnlockedAt(5)).toBe(1);
    expect(rowsUnlockedAt(7)).toBe(1);
    expect(rowsUnlockedAt(11)).toBe(3);
    expect(rowsUnlockedAt(20)).toBe(6);
    expect(rowsUnlockedAt(999)).toBe(6);
  });
});

describe('computeRowModifiers', () => {
  it('no picks yields empty modifiers', () => {
    const m = computeRowModifiers(fixture(), emptyRowPicks());
    expect(m.stats.crit).toBe(0);
    expect(m.stats.dodge).toBe(0);
    expect(Object.keys(m.abilities)).toEqual([]);
  });

  it('folds a picked stat option into the flat stats', () => {
    const picks = emptyRowPicks();
    picks[0] = 'f_crit';
    picks[1] = 'f_ap';
    const m = computeRowModifiers(fixture(), picks);
    expect(m.stats.crit).toBe(0.05);
    expect(m.stats.ap).toBe(10);
  });

  it('folds an ability-modifying option (root + slow onto Charge)', () => {
    const picks = emptyRowPicks();
    picks[0] = 'f_charge';
    const m = computeRowModifiers(fixture(), picks);
    const add = m.abilities.charge?.addEffects ?? [];
    expect(add).toHaveLength(2);
    expect(add.some((e) => e.type === 'root' && e.duration === 4)).toBe(true);
    expect(add.some((e) => e.type === 'slow' && e.mult === 0.5 && e.duration === 15)).toBe(true);
  });

  it('ignores an unknown pick id without throwing', () => {
    const picks = emptyRowPicks();
    picks[0] = 'does_not_exist';
    const m = computeRowModifiers(fixture(), picks);
    expect(m.stats.crit).toBe(0);
  });

  it('is deterministic: same picks give the same modifiers', () => {
    const picks = emptyRowPicks();
    picks[0] = 'f_crit';
    picks[3] = 'f_d';
    const run = () => computeRowModifiers(fixture(), picks);
    expect(run()).toEqual(run());
  });
});
