import { describe, expect, it } from 'vitest';
import { CHOICE_ROW_LEVELS, CHOICE_ROWS } from '../src/sim/content/choice_rows';
import { WARRIOR_CLASSIC_CHOICE_ROWS } from '../src/sim/content/choice_rows_classic';
import {
  computeModifiersWithRows,
  emptyRowPicks,
  ROW_COUNT,
  ROW_TREES,
  rowTreeFor,
  validateRowTree,
} from '../src/sim/content/talent_rows';
import { TALENTS } from '../src/sim/content/talents';
import { WARRIOR_ROWS } from '../src/sim/content/warrior_rows';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, MAX_LEVEL, type PlayerClass } from '../src/sim/types';
import { buildTalentRowsView } from '../src/ui/talent_rows_view';

// The old-model -> row-tree bridge (choice_row_tree_bridge.ts): every class the
// warrior overhaul left without an authored RowTree gets its fully-authored
// CHOICE_ROWS content converted 1:1, so the talents window's Choices tab (which
// renders only when rowTreeFor(cls) returns a tree) works for all ten classes.

describe('choice-row tree bridge', () => {
  it('gives every class a row tree post-bridge', () => {
    for (const cls of ALL_CLASSES) {
      expect(rowTreeFor(cls), `no row tree for ${cls}`).not.toBeNull();
      expect(TALENTS[cls], `no talents entry for ${cls}`).toBeDefined();
    }
  });

  it('every registered tree passes validateRowTree', () => {
    for (const [cls, tree] of Object.entries(ROW_TREES)) {
      expect(validateRowTree(tree), `invalid tree for ${cls}`).toEqual([]);
    }
  });

  it('keeps the warrior AUTHORED tree (the bridge never overrides it)', () => {
    expect(ROW_TREES.warrior).toBe(WARRIOR_ROWS);
    expect(rowTreeFor('warrior')?.[0]?.options.map((o) => o.id)).toEqual([
      'war_row_double_charge',
      'war_row_pursuit',
      'war_row_crushing_charge',
    ]);
  });

  it('bridges warrior_classic from its own classic rows', () => {
    const tree = rowTreeFor('warrior_classic');
    expect(tree?.[0]?.options.map((o) => o.id)).toEqual(
      WARRIOR_CLASSIC_CHOICE_ROWS.rows[0].options.map((o) => o.id),
    );
  });

  it('conversion preserves id, name, description, and the effect reference per option', () => {
    for (const cls of ALL_CLASSES) {
      if (cls === 'warrior') continue; // authored, not bridged
      const source = CHOICE_ROWS[cls];
      const tree = rowTreeFor(cls);
      expect(tree, `no tree for ${cls}`).not.toBeNull();
      if (!tree) continue;
      expect(tree.map((row) => row.level)).toEqual([...CHOICE_ROW_LEVELS]);
      tree.forEach((row, i) => {
        const sourceRow = source.rows.find((r) => r.level === row.level);
        expect(sourceRow, `${cls}: no source row at level ${row.level}`).toBeDefined();
        expect(row.options.map((o) => o.id)).toEqual(sourceRow?.options.map((o) => o.id));
        row.options.forEach((opt, j) => {
          const src = sourceRow?.options[j];
          expect(opt.name).toBe(src?.name);
          expect(opt.description).toBe(src?.description);
          // Same object: the new fold reads the exact effect the old fold read.
          expect(opt.effect).toBe(src?.effect);
        });
        expect(row.level).toBe(CHOICE_ROW_LEVELS[i]);
      });
    }
  });

  it('renders a full, pickable Choices view for all ten classes (no pending pills)', () => {
    for (const cls of ALL_CLASSES) {
      if (cls === 'warrior') continue; // the authored tree carries its own live-marker suite
      const vm = buildTalentRowsView(rowTreeFor(cls), emptyRowPicks(), MAX_LEVEL);
      expect(vm.rows.length, `${cls}: row count`).toBe(ROW_COUNT);
      expect(vm.unlockedCount, `${cls}: unlocked at max level`).toBe(ROW_COUNT);
      for (const row of vm.rows) {
        expect(row.options.length, `${cls} row ${row.index}: option count`).toBe(3);
        for (const opt of row.options) {
          expect(opt.pending, `${cls} ${opt.id}: bridged option must be live`).toBe(false);
        }
      }
    }
  });

  it('accepts a row pick through the Sim for every class', () => {
    for (const cls of ALL_CLASSES) {
      const sim = new Sim({ seed: 3, playerClass: cls, autoEquip: true });
      sim.setPlayerLevel(MAX_LEVEL);
      const first = rowTreeFor(cls)?.[0]?.options[0];
      expect(first, `${cls}: no first option`).toBeDefined();
      if (!first) continue;
      expect(sim.pickRowTalent(0, first.id), `${cls}: pick rejected`).toBe(true);
      expect(sim.rowPicks[0]).toBe(first.id);
    }
  });
});

describe('double-apply guard (old alloc.rows vs new rowPicks)', () => {
  const cls: PlayerClass = 'mage';
  // mag_r5_impulse: Fire Blast gains one bonus charge. A double-fold would grant two.
  const impulse = 'mag_r5_impulse';
  const firestarter = 'mag_r5_firestarter';

  it('the same option in BOTH models folds exactly once', () => {
    const picks = [impulse, null, null, null, null, null];
    const both = computeModifiersWithRows(cls, { spec: null, rows: { 5: impulse } }, picks, 20);
    const pickOnly = computeModifiersWithRows(cls, { spec: null, rows: {} }, picks, 20);
    expect(both).toEqual(pickOnly);
    expect(both.abilities.fire_blast?.bonusCharges).toBe(1);
  });

  it('a proc option in BOTH models registers one proc, not two', () => {
    const picks = [firestarter, null, null, null, null, null];
    const both = computeModifiersWithRows(cls, { spec: null, rows: { 5: firestarter } }, picks, 20);
    expect(both.procs.filter((p) => p.id === 'mag_firestarter')).toHaveLength(1);
  });

  it('a new pick supersedes a DIFFERENT old option in the same row (one option per row)', () => {
    const picks = [impulse, null, null, null, null, null];
    const mods = computeModifiersWithRows(cls, { spec: null, rows: { 5: firestarter } }, picks, 20);
    expect(mods.abilities.fire_blast?.bonusCharges).toBe(1);
    expect(mods.procs.some((p) => p.id === 'mag_firestarter')).toBe(false);
  });

  it('old saved rows without a new pick keep applying (legacy saves stay whole)', () => {
    const oldOnly = computeModifiersWithRows(
      cls,
      { spec: null, rows: { 5: impulse } },
      emptyRowPicks(),
      20,
    );
    expect(oldOnly.abilities.fire_blast?.bonusCharges).toBe(1);
    // And rows the new model does not cover are untouched by a pick elsewhere.
    const mixed = computeModifiersWithRows(
      cls,
      { spec: null, rows: { 5: impulse } },
      [null, 'mag_r8_quick_wits', null, null, null, null],
      20,
    );
    expect(mixed.abilities.fire_blast?.bonusCharges).toBe(1);
  });

  it('applies the effect once end to end on a live Sim with both models populated', () => {
    const sim = new Sim({ seed: 5, playerClass: cls, autoEquip: true });
    sim.setPlayerLevel(MAX_LEVEL);
    expect(sim.applyTalents({ spec: null, rows: { 5: impulse } })).toBe(true);
    expect(sim.pickRowTalent(0, impulse)).toBe(true);
    const meta = sim.meta(sim.playerId);
    expect(meta?.talentMods.abilities.fire_blast?.bonusCharges).toBe(1);
  });
});
