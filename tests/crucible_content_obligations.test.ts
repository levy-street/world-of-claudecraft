import { describe, expect, it } from 'vitest';
import {
  CRUCIBLE_COLLECTION_ITEMS,
  CRUCIBLE_COLLECTION_PATTERNS,
  CRUCIBLE_COLLECTIONS,
  CRUCIBLE_SIGNATURE_TEXT,
} from '../src/sim/content/crucible_collections';
import { CRUCIBLE_PROFESSION_ITEMS } from '../src/sim/content/crucible_professions';
import { en } from '../src/ui/i18n.catalog';
import { ja_JP } from '../src/ui/i18n.locales/ja_JP';
import { ko_KR } from '../src/ui/i18n.locales/ko_KR';
import { ru_RU } from '../src/ui/i18n.locales/ru_RU';
import { zh_CN } from '../src/ui/i18n.locales/zh_CN';
import { zh_TW } from '../src/ui/i18n.locales/zh_TW';

const NEW_ITEMS = [
  ...Object.values(CRUCIBLE_COLLECTION_ITEMS),
  ...Object.values(CRUCIBLE_COLLECTION_PATTERNS),
  CRUCIBLE_PROFESSION_ITEMS.formula_lastflame_zeal,
];
const NON_LATIN: Record<string, Record<string, string | undefined>> = {
  zh_CN,
  zh_TW,
  ja_JP,
  ko_KR,
  ru_RU,
};

describe('Crucible profession content localization', () => {
  it('registers all forty-five new item names against their actual content', () => {
    expect(NEW_ITEMS).toHaveLength(45);
    const names = en.entities.items as Record<string, { name: string }>;
    for (const item of NEW_ITEMS) expect(names[item.id]?.name, item.id).toBe(item.name);
  });

  it('keeps all collection names and sole bonus text connected to the live source', () => {
    for (const collection of CRUCIBLE_COLLECTIONS) {
      const row = en.entities.itemSets[collection.id];
      expect(row.name).toBe(collection.name);
      expect(row.bonus2).toBe(CRUCIBLE_SIGNATURE_TEXT[collection.role]);
      expect(row.bonus3).toBeUndefined();
    }
  });

  it('fills every new item and collection name and bonus in all five non-Latin locales', () => {
    const leaves = [
      ...NEW_ITEMS.map((item) => [`entities.items.${item.id}.name`, item.name]),
      ...CRUCIBLE_COLLECTIONS.flatMap((collection) => [
        [`entities.itemSets.${collection.id}.name`, collection.name],
        [`entities.itemSets.${collection.id}.bonus2`, CRUCIBLE_SIGNATURE_TEXT[collection.role]],
      ]),
    ];
    expect(leaves).toHaveLength(67);
    for (const [language, overlay] of Object.entries(NON_LATIN)) {
      for (const [key, english] of leaves) {
        expect(overlay[key], `${language}: ${key}`).toBeTruthy();
        expect(overlay[key], `${language}: ${key}`).not.toBe(english);
      }
    }
  });
});
