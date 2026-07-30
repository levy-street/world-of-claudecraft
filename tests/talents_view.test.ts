import { describe, expect, it } from 'vitest';
import {
  cloneAllocation,
  emptyAllocation,
  ROW_LEVELS,
  ROW_TREES,
  type TalentAllocation,
  validateAllocation,
} from '../src/sim/content/talents';
import { ALL_CLASSES, type PlayerClass } from '../src/sim/types';
import { buildTalentsView } from '../src/ui/talents_view';

function optionId(cls: PlayerClass, rowIndex: number, optionIndex = 0): string {
  return ROW_TREES[cls][rowIndex].options[optionIndex].id;
}

describe('Talents V2 row view', () => {
  it('projects all six rows and three exclusive options for every playable class', () => {
    expect(ALL_CLASSES).toHaveLength(9);
    for (const cls of ALL_CLASSES) {
      const view = buildTalentsView(emptyAllocation(), cls, 20);
      expect(view.hasRows, cls).toBe(true);
      expect(view.specs, cls).toHaveLength(3);
      expect(view.rows, cls).toHaveLength(6);
      expect(
        view.rows.map((row) => row.level),
        cls,
      ).toEqual(ROW_LEVELS);
      expect(
        view.rows.every((row) => row.options.length === 3),
        cls,
      ).toBe(true);
      expect(view.unlockedCount, cls).toBe(6);
      expect(view.pickedCount, cls).toBe(0);
      expect(view.valid, cls).toBe(true);
    }
  });

  it('marks locked, selected, clear, and select states from the canonical allocation', () => {
    const allocation: TalentAllocation = {
      spec: 'arms',
      rows: {
        5: optionId('warrior', 0, 1),
        8: optionId('warrior', 1, 2),
      },
    };
    const view = buildTalentsView(allocation, 'warrior', 8);

    expect(view.specs.map((entry) => [entry.spec.id, entry.selected, entry.action])).toEqual([
      ['arms', true, 'navigate'],
      ['fury', false, 'commit'],
      ['prot', false, 'commit'],
    ]);
    expect(view.unlockedCount).toBe(2);
    expect(view.pickedCount).toBe(2);
    expect(view.rows[0].options.map((option) => [option.picked, option.action])).toEqual([
      [false, 'select'],
      [true, 'clear'],
      [false, 'select'],
    ]);
    expect(view.rows[2].unlocked).toBe(false);
    expect(view.rows[2].options.every((option) => option.disabled)).toBe(true);
  });

  it('uses player level for unlocks and the same canonical validator for validity', () => {
    const locked: TalentAllocation = {
      spec: 'arms',
      rows: { 20: optionId('warrior', 5) },
    };
    const view = buildTalentsView(locked, 'warrior', 19);

    expect(view.unlockedCount).toBe(5);
    expect(view.valid).toBe(validateAllocation('warrior', locked, 19).ok);
    expect(view.valid).toBe(false);
  });

  it('is a pure projection and does not mutate the canonical allocation', () => {
    const allocation: TalentAllocation = {
      spec: 'fury',
      rows: { 5: optionId('warrior', 0, 2), 14: optionId('warrior', 3, 1) },
    };
    const before = cloneAllocation(allocation);

    expect(buildTalentsView(allocation, 'warrior', 20)).toEqual(
      buildTalentsView(cloneAllocation(allocation), 'warrior', 20),
    );
    expect(allocation).toEqual(before);
  });

  it('returns an empty defensive view for an unknown class id', () => {
    const view = buildTalentsView(emptyAllocation(), 'monk' as PlayerClass, 20);
    expect(view.hasRows).toBe(false);
    expect(view.specs).toEqual([]);
    expect(view.rows).toEqual([]);
  });
});
