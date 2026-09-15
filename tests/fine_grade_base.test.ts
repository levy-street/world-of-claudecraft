// The ordinary-twin lookup (src/sim/professions/fine_grade_base.ts): one
// answer over BOTH fine ladders, derived here from the live tables so a new
// node grade or farm crop cannot ship a fine id the crafting note cannot name.
import { describe, expect, it } from 'vitest';
import { FARM_CROPS } from '../src/sim/content/farm_crops';
import { ITEMS } from '../src/sim/data';
import { ordinaryGradeFor } from '../src/sim/professions/fine_grade_base';
import { MATERIAL_GRADES } from '../src/sim/professions/material_grades';

describe('ordinaryGradeFor', () => {
  it('maps every node fine grade to its MATERIAL_GRADES base', () => {
    const rows = Object.entries(MATERIAL_GRADES);
    expect(rows).toHaveLength(9);
    for (const [base, row] of rows) expect(ordinaryGradeFor(row.fineItemId)).toBe(base);
  });

  it('maps every farm fine twin to its plain produce, and both are real items', () => {
    const crops = Object.values(FARM_CROPS);
    expect(crops).toHaveLength(12);
    for (const crop of crops) {
      expect(ordinaryGradeFor(crop.fineProduceItemId), crop.id).toBe(crop.produceItemId);
      expect(ITEMS[crop.produceItemId], crop.produceItemId).toBeDefined();
    }
    expect(ordinaryGradeFor('fine_vale_wheat')).toBe('vale_wheat');
  });

  it('answers undefined for every other id, plain grades and prototype keys included', () => {
    for (const id of ['vale_wheat', 'copper_ore', 'garden_hoe', 'not_an_item', '']) {
      expect(ordinaryGradeFor(id), id).toBeUndefined();
    }
    expect(ordinaryGradeFor('__proto__')).toBeUndefined();
    expect(ordinaryGradeFor('constructor')).toBeUndefined();
  });
});
