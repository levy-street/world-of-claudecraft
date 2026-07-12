// The choice-row talents tab's pure view core: unlock gating by level, the
// picked flag, counts for the tab badge, and null-tree safety. The inputs are
// plain data mirrored identically by Sim and ClientWorld, so one fixture covers
// both hosts (same-input-same-output pinned by the determinism case).

import { describe, expect, it } from 'vitest';
import { emptyRowPicks } from '../src/sim/content/talent_rows';
import { WARRIOR_ROWS } from '../src/sim/content/warrior_rows';
import { buildTalentRowsView } from '../src/ui/talent_rows_view';

describe('buildTalentRowsView', () => {
  it('returns an empty model for a class with no row tree', () => {
    expect(buildTalentRowsView(null, emptyRowPicks(), 20)).toEqual({
      rows: [],
      pickedCount: 0,
      unlockedCount: 0,
    });
  });

  it('gates rows by level: level 11 unlocks the first three tiers only', () => {
    const vm = buildTalentRowsView(WARRIOR_ROWS, emptyRowPicks(), 11);
    expect(vm.rows.map((r) => r.unlocked)).toEqual([true, true, true, false, false, false]);
    expect(vm.unlockedCount).toBe(3);
    expect(vm.pickedCount).toBe(0);
  });

  it('marks the picked option and counts it for the badge', () => {
    const picks = emptyRowPicks();
    picks[0] = 'war_row_crushing_charge';
    picks[3] = 'war_row_anger_management';
    const vm = buildTalentRowsView(WARRIOR_ROWS, picks, 20);
    expect(vm.pickedCount).toBe(2);
    const row0 = vm.rows[0];
    expect(row0.options.map((o) => o.picked)).toEqual([false, false, true]);
    expect(row0.options[2].id).toBe('war_row_crushing_charge');
    expect(row0.options[2].name.length).toBeGreaterThan(0);
  });

  it('a pick in a LOCKED row neither highlights nor counts', () => {
    const picks = emptyRowPicks();
    picks[5] = 'war_row_bladestorm'; // level-20 row
    const vm = buildTalentRowsView(WARRIOR_ROWS, picks, 10);
    expect(vm.pickedCount).toBe(0);
    expect(vm.rows[5].options.every((o) => !o.picked)).toBe(true);
  });

  it('flags empty-effect options as pending (none left in the live warrior tree)', () => {
    // Every warrior option is live now: nothing renders the Coming-soon badge.
    const vm = buildTalentRowsView(WARRIOR_ROWS, emptyRowPicks(), 20);
    expect(vm.rows.flatMap((r) => r.options).filter((o) => o.pending)).toEqual([]);
    // The mechanism itself stays pinned via a synthetic placeholder row.
    const synthetic = [
      {
        level: 5,
        options: [
          { id: 'a', name: 'A', description: 'x', effect: {} },
          { id: 'b', name: 'B', description: 'x', effect: { global: { threatPct: 0.1 } } },
          { id: 'c', name: 'C', description: 'x', effect: { grant: { ability: 'slam' } } },
        ],
      },
    ];
    const svm = buildTalentRowsView(synthetic as never, emptyRowPicks(), 5);
    expect(svm.rows[0].options.map((o) => o.pending)).toEqual([true, false, false]);
  });

  it('is deterministic: same inputs give the same model', () => {
    const picks = emptyRowPicks();
    picks[0] = 'war_row_pursuit';
    const run = () => buildTalentRowsView(WARRIOR_ROWS, picks, 20);
    expect(run()).toEqual(run());
  });
});
