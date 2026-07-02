import { describe, expect, it } from 'vitest';
import { buildChoiceRowsView, hasChoiceRows } from '../src/ui/choice_rows_view';

describe('choice rows view model', () => {
  it('derives lock state from player level and picked state from the allocation', () => {
    const view = buildChoiceRowsView('mage', 11, { 5: 'mag_r5_firestarter' });
    expect(view.rows).toHaveLength(6);
    expect(view.rows.map((r) => r.level)).toEqual([5, 8, 11, 14, 17, 20]);
    expect(view.unlocked).toBe(3); // 5, 8, 11 at level 11
    expect(view.picked).toBe(1);
    const r5 = view.rows[0];
    expect(r5.unlocked).toBe(true);
    expect(r5.pickedId).toBe('mag_r5_firestarter');
    expect(r5.options.filter((o) => o.picked).map((o) => o.option.id)).toEqual([
      'mag_r5_firestarter',
    ]);
    const r20 = view.rows[5];
    expect(r20.unlocked).toBe(false);
    expect(r20.pickedId).toBeNull();
  });

  it('every row carries exactly three options for the pilot classes', () => {
    for (const cls of ['warrior', 'mage'] as const) {
      for (const row of buildChoiceRowsView(cls, 20, {}).rows) {
        expect(row.options).toHaveLength(3);
      }
    }
  });

  it('hasChoiceRows gates the tab: pilot classes on, pre-wave classes off', () => {
    expect(hasChoiceRows('warrior')).toBe(true);
    expect(hasChoiceRows('mage')).toBe(true);
    expect(hasChoiceRows('priest')).toBe(false); // until Wave B1 lands
  });
});
