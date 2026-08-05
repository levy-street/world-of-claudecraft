// Pure-core pins for the bag grid's fine-grade material mark. The painter
// (bags_window) consumes bagFineMark through bag_corner_mark_view for the
// .bag-fine class and corner seal; these tests own the on/off decision only
// (DOM/CSS contracts live next to the instance-marker suite).
import { describe, expect, it } from 'vitest';
import { MATERIAL_GRADES } from '../src/sim/professions/material_grades';
import { bagFineMark } from '../src/ui/bag_fine_mark_view';

describe('bag_fine_mark_view: fine grade mark', () => {
  it('marks every fine grade id from MATERIAL_GRADES', () => {
    // Literal anchor plus a table floor first: the loops below derive their
    // expectations from the same table the core reads, so without these an
    // emptied or renamed table would pass vacuously.
    expect(bagFineMark('fine_copper_ore')).toBe(true);
    expect(Object.keys(MATERIAL_GRADES).length).toBeGreaterThanOrEqual(9);
    for (const row of Object.values(MATERIAL_GRADES)) {
      expect(bagFineMark(row.fineItemId), row.fineItemId).toBe(true);
    }
  });

  it('returns false for every base material id', () => {
    for (const baseId of Object.keys(MATERIAL_GRADES)) {
      expect(bagFineMark(baseId), baseId).toBe(false);
    }
  });

  it('returns false for non-material and empty ids', () => {
    for (const id of [
      'boar_hide',
      'apprentice_staff',
      'mudfin_scale',
      'copper_pick',
      '',
      'Fine_copper_ore',
      'FINE_COPPER_ORE',
      'fine_copper_ore_extra',
    ]) {
      expect(bagFineMark(id), id).toBe(false);
    }
  });

  it('does not invent marks from a fine-looking prefix alone', () => {
    // Only reverse-index ids from material_grades count; a future free-form
    // fine_* content row without a MATERIAL_GRADES pairing stays unmarked.
    expect(bagFineMark('fine_not_a_real_material')).toBe(false);
  });
});
