import { describe, expect, it } from 'vitest';
import { CRUCIBLE_COLLECTIONS } from '../src/sim/content/crucible_collections';
import { ITEMS } from '../src/sim/data';
import { isUniqueEquipped } from '../src/sim/equipment_rules';
import { publicInstanceView } from '../src/sim/item_instance_transfer';

describe('Crucible promotion uniqueness on inspected rank-zero copies', () => {
  it('retains the public unique-equipped fact without disclosing private binding proof', () => {
    const publicCopy = publicInstanceView({
      perfectingBound: true,
      boundTo: 1,
      rolled: { quality: 'legendary' },
    });
    expect(publicCopy).not.toHaveProperty('perfectingBound');
    expect(isUniqueEquipped(ITEMS.crucible_str_mail_chest, publicCopy)).toBe(true);
    expect(isUniqueEquipped(ITEMS.wyrmfall_pendant, publicCopy)).toBe(false);
  });

  it('pins static crafted-set membership to exactly the new collection roster', () => {
    const expected = CRUCIBLE_COLLECTIONS.flatMap((collection) => collection.itemIds).sort();
    expect(expected).toHaveLength(33);
    const classified = Object.values(ITEMS)
      .filter((item) => item.masterwrought === true && !!item.set)
      .map((item) => item.id)
      .sort();
    expect(classified).toEqual(expected);
    for (const id of expected) {
      expect(isUniqueEquipped(ITEMS[id], { rolled: { quality: 'legendary' } }), id).toBe(true);
      expect(isUniqueEquipped(ITEMS[id], { rolled: { quality: 'epic' } }), id).toBe(false);
      expect(isUniqueEquipped(ITEMS[id]), id).toBe(false);
    }
  });

  it('does not capture legacy legendary rolls or ordinary raid sets', () => {
    const legacy = Object.values(ITEMS).filter((item) => item.masterwrought === true && !item.set);
    expect(legacy).toHaveLength(17);
    for (const item of legacy) {
      expect(isUniqueEquipped(item, { rolled: { quality: 'legendary' } }), item.id).toBe(false);
    }
    const raidSets = Object.values(ITEMS).filter(
      (item) => item.set && !item.masterwrought && item.quality !== 'legendary',
    );
    expect(raidSets.length).toBeGreaterThan(0);
    for (const item of raidSets) {
      expect(isUniqueEquipped(item, { rolled: { quality: 'legendary' } }), item.id).toBe(false);
    }
    expect(
      isUniqueEquipped(
        { ...ITEMS.wyrmfall_pendant, set: '' },
        { rolled: { quality: 'legendary' } },
      ),
    ).toBe(false);
  });
});
