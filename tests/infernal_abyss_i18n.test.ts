import { describe, expect, it } from 'vitest';
import {
  INFERNAL_ABYSS_DUNGEON_DEFS,
  INFERNAL_ABYSS_ITEMS,
  INFERNAL_ABYSS_MOBS,
  INFERNAL_ABYSS_QUESTS,
} from '../src/sim/content/infernal_abyss';
import type { TranslationKey } from '../src/ui/i18n.catalog';
import { itemNames } from '../src/ui/i18n.catalog/items';
import { ja_JP } from '../src/ui/i18n.locales/ja_JP';
import { ko_KR } from '../src/ui/i18n.locales/ko_KR';
import { ru_RU } from '../src/ui/i18n.locales/ru_RU';
import { zh_CN } from '../src/ui/i18n.locales/zh_CN';
import { zh_TW } from '../src/ui/i18n.locales/zh_TW';
import { worldEntityText } from '../src/ui/world_entity_i18n';

const ITEM_IDS = [
  'infernal_slag',
  'charred_legion_tablet',
  'brands_of_the_first_flame',
  'forgekeepers_ledger',
  'azazels_broken_covenant',
  'emberforged_vambraces',
  'cinderthread_mantle',
  'hellstalker_boots',
  'forgekeepers_warhammer',
  'forgekeepers_runestaff',
  'forgekeepers_fang',
  'azazels_ruinblade',
  'azazels_soulstaff',
  'azazels_emberfang',
  'hellforged_bulwark',
  'cinderseer_raiment',
  'abysswalker_harness',
] as const;

const MOB_IDS = [
  'abyssal_legionnaire',
  'cinder_magus',
  'molten_hellhound',
  'flamebound_smith',
  'abyssal_gladiator',
  'infernal_cinderling',
  'forgekeeper',
  'pyre_golem',
  'azazel_infernal_lord',
] as const;

const QUEST_IDS = [
  'q_infernal_abyss_echoes',
  'q_infernal_abyss_covenant',
  'q_infernal_abyss_azazel',
] as const;

const NON_LATIN_LOCALES = { zh_CN, zh_TW, ja_JP, ko_KR, ru_RU };

function normalizeSourceText(text: string): string {
  return text.replace(/\$N/g, '{playerName}').replace(/\$C/g, '{className}');
}

function tokens(value: string): string[] {
  return [...value.matchAll(/\{[A-Za-z][A-Za-z0-9]*\}/g)].map(([token]) => token).sort();
}

describe('Infernal Abyss localization', () => {
  it('registers every canonical English item name', () => {
    for (const itemId of ITEM_IDS) {
      expect(itemNames.en.entities.items[itemId].name).toBe(INFERNAL_ABYSS_ITEMS[itemId].name);
    }
  });

  it('registers the canonical English dungeon content', () => {
    const english = worldEntityText.en.entities;

    for (const mobId of MOB_IDS) {
      expect(english.mobs[mobId].name).toBe(INFERNAL_ABYSS_MOBS[mobId].name);
    }

    for (const questId of QUEST_IDS) {
      const source = INFERNAL_ABYSS_QUESTS[questId];
      const registered = english.quests[questId];
      expect(registered.title).toBe(source.name);
      expect(registered.text).toBe(normalizeSourceText(source.text));
      expect(registered.completion).toBe(normalizeSourceText(source.completionText));
      for (const [index, objective] of source.objectives.entries()) {
        expect(registered.objectives[index].label).toBe(objective.label);
      }
    }

    const sourceDungeon = INFERNAL_ABYSS_DUNGEON_DEFS.infernal_abyss;
    expect(english.dungeons.infernal_abyss).toEqual({
      name: sourceDungeon.name,
      enterText: sourceDungeon.enterText,
      leaveText: sourceDungeon.leaveText,
    });
  });

  it('fills every new entity field in the five required non-Latin locales', () => {
    const english = worldEntityText.en.entities;
    const englishByKey = new Map<string, string>();

    for (const itemId of ITEM_IDS) {
      englishByKey.set(`entities.items.${itemId}.name`, itemNames.en.entities.items[itemId].name);
    }
    for (const mobId of MOB_IDS) {
      englishByKey.set(`entities.mobs.${mobId}.name`, english.mobs[mobId].name);
    }
    for (const questId of QUEST_IDS) {
      const quest = english.quests[questId];
      englishByKey.set(`entities.quests.${questId}.title`, quest.title);
      englishByKey.set(`entities.quests.${questId}.text`, quest.text);
      englishByKey.set(`entities.quests.${questId}.completion`, quest.completion);
      for (const [index, objective] of Object.entries(quest.objectives)) {
        englishByKey.set(`entities.quests.${questId}.objectives.${index}.label`, objective.label);
      }
    }
    const dungeon = english.dungeons.infernal_abyss;
    englishByKey.set('entities.dungeons.infernal_abyss.name', dungeon.name);
    englishByKey.set('entities.dungeons.infernal_abyss.enterText', dungeon.enterText);
    englishByKey.set('entities.dungeons.infernal_abyss.leaveText', dungeon.leaveText);

    for (const [localeName, overlay] of Object.entries(NON_LATIN_LOCALES)) {
      for (const [rawKey, englishValue] of englishByKey) {
        const translated = overlay[rawKey as TranslationKey];
        expect(translated, `${localeName} is missing ${rawKey}`).toBeTypeOf('string');
        expect(translated, `${localeName} left ${rawKey} in English`).not.toBe(englishValue);
        expect(tokens(translated ?? ''), `${localeName} changed tokens in ${rawKey}`).toEqual(
          tokens(englishValue),
        );
      }
    }
  });
});
