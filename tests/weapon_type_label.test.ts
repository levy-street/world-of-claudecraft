import { describe, expect, it } from 'vitest';
import { type ItemWeaponType, WEAPON_TYPE_BY_ITEM } from '../src/sim/content/weapon_skin_rules';
import { t } from '../src/ui/i18n';
import { weaponTypeLabelKey } from '../src/ui/weapon_type_label';

// The full set of weapon types the tooltip must be able to label. Kept explicit
// (not derived) so a type added to ItemWeaponType without a label wired here
// fails this list rather than silently passing.
const ALL_TYPES: readonly ItemWeaponType[] = [
  'sword',
  'axe',
  'mace',
  'dagger',
  'staff',
  'wand',
  'bow',
  'crossbow',
  'polearm',
];

describe('weaponTypeLabelKey', () => {
  it('every weapon type (including polearm) has a non-empty catalog label', () => {
    for (const type of ALL_TYPES) {
      // t() throws on an untracked key in test, so a missing catalog entry (the
      // polearm regression) fails loudly right here.
      expect(t(`hudChrome.wocStore.wtype.${type}`).length).toBeGreaterThan(0);
    }
  });

  it('classifies each weapon item id that exists to its own type label', () => {
    // bow/crossbow are hunter-only cosmetic skin types with no weapon ITEM, so
    // only the seven item-backed types appear in the map; drive the accessor with
    // a real item for each, exercising id -> type -> label-key end to end.
    const itemTypes = new Set(Object.values(WEAPON_TYPE_BY_ITEM));
    for (const type of itemTypes) {
      const exampleId = Object.keys(WEAPON_TYPE_BY_ITEM).find(
        (id) => WEAPON_TYPE_BY_ITEM[id] === type,
      );
      expect(exampleId, `no item classifies as ${type}`).toBeDefined();
      expect(weaponTypeLabelKey(exampleId)).toBe(`hudChrome.wocStore.wtype.${type}`);
    }
    // Polearm is item-backed (spears/scythes) even though no skin targets it.
    expect(itemTypes.has('polearm')).toBe(true);
  });

  it('resolves known example weapons to their type label', () => {
    // Fang of Korzul is the canonical rogue dagger; a staff and a polearm cover
    // the added-label case.
    expect(weaponTypeLabelKey('fang_of_korzul')).toBe('hudChrome.wocStore.wtype.dagger');
    expect(weaponTypeLabelKey('gnarled_staff')).toBe('hudChrome.wocStore.wtype.staff');
    expect(weaponTypeLabelKey('tidereaver_gaff')).toBe('hudChrome.wocStore.wtype.polearm');
    expect(t('hudChrome.wocStore.wtype.polearm')).toBe('Polearm');
    expect(t('hudChrome.wocStore.wtype.dagger')).toBe('Dagger');
  });

  it('is heroic-aware (strips the heroic_ prefix like the sim accessor)', () => {
    expect(weaponTypeLabelKey('heroic_fang_of_korzul')).toBe('hudChrome.wocStore.wtype.dagger');
  });

  it('returns null for non-weapon and unclassified ids', () => {
    expect(weaponTypeLabelKey('apprentice_robe')).toBeNull();
    expect(weaponTypeLabelKey('not_a_real_item')).toBeNull();
    expect(weaponTypeLabelKey(null)).toBeNull();
    expect(weaponTypeLabelKey(undefined)).toBeNull();
  });
});
