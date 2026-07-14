import { describe, expect, it } from 'vitest';
import { WEAPON_SKIN_LIST } from '../src/sim/content/weapon_skins';
import {
  badgeLabel,
  localizeWeaponSkin,
  rarityLabel,
  weaponSkinCollectionLabel,
  weaponTypeLabel,
} from '../src/ui/armory_labels';
import { armorySkinStrings } from '../src/ui/i18n.catalog/armory';

describe('armory labels', () => {
  it('resolves catalog discriminators through localized keys', () => {
    expect(weaponTypeLabel('sword')).toBe('Sword');
    expect(rarityLabel('legendary')).toBe('Legendary');
    expect(badgeLabel('flagship')).toBe('Flagship');
  });

  it('resolves every fixed catalog name, collection, look, and lore through i18n keys', () => {
    for (const skin of WEAPON_SKIN_LIST) {
      const copy = localizeWeaponSkin(skin);
      const english = armorySkinStrings[skin.id as keyof typeof armorySkinStrings];
      expect(copy.name, skin.id).toBe(english.name);
      expect(copy.look, skin.id).toBe(english.look);
      expect(copy.lore, skin.id).toBe(english.lore);
      expect(copy.collection, skin.id).not.toBe(skin.collection);
      expect(weaponSkinCollectionLabel(skin.collection)).toBe(copy.collection);
    }
  });
});
