import { describe, expect, it } from 'vitest';
import { crucibleCollectionForItem } from '../src/sim/content/crucible_collections';
import { ITEMS } from '../src/sim/data';
import { itemInstanceLevel, itemLevel } from '../src/sim/item_level';
import { wornTooltipInstance } from '../src/ui/item_instance_tooltip';

describe('Crucible collection per-copy item level', () => {
  it('prices exactly the 33 new pieces at 35 until Perfected, then 38', () => {
    const pieces = Object.values(ITEMS).filter((item) => crucibleCollectionForItem(item.id));
    expect(pieces).toHaveLength(33);
    for (const item of pieces) {
      expect(itemLevel(item), item.id).toBe(35);
      expect(itemInstanceLevel(item), item.id).toBe(35);
      for (const perfecting of [0, 1, 2, 3]) {
        expect(itemInstanceLevel(item, { perfecting }), `${item.id} rank ${perfecting}`).toBe(35);
      }
      expect(itemInstanceLevel(item, { perfected: true }), item.id).toBe(38);
      expect(
        itemInstanceLevel(item, { perfected: true, rolled: { quality: 'legendary' } }),
        item.id,
      ).toBe(38);
      expect(
        itemInstanceLevel(item, { perfectingBound: true, rolled: { quality: 'legendary' } }),
        item.id,
      ).toBe(35);
    }
  });

  it('agrees for the owner and public worn projection using only the public Perfected stamp', () => {
    const item = ITEMS.crucible_str_mail_chest;
    const worn = wornTooltipInstance({
      perfected: true,
      perfectingBonus: { str: 1 },
      perfectingBound: true,
    });
    expect(worn).toEqual({ perfected: true });
    expect(itemInstanceLevel(item, worn)).toBe(38);
  });

  it('does not reprice legacy Masterwrought or other ordinary gear from an instance stamp', () => {
    const legacy = Object.values(ITEMS).filter(
      (item) => item.masterwrought && !crucibleCollectionForItem(item.id),
    );
    expect(legacy).toHaveLength(17);
    for (const item of legacy)
      expect(itemInstanceLevel(item, { perfected: true })).toBe(itemLevel(item));
    expect(itemInstanceLevel(ITEMS.greyjaw_pelt_cloak, { perfected: true })).toBe(
      itemLevel(ITEMS.greyjaw_pelt_cloak),
    );
    expect(itemInstanceLevel(ITEMS.conjured_water, { perfected: true })).toBeUndefined();
  });
});
