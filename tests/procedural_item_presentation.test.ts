import { describe, expect, it } from 'vitest';
import { PROCEDURAL_LEGENDARY_POWERS } from '../src/sim/content/procedural_legendary_powers';
import { PROCEDURAL_AFFIXES } from '../src/sim/content/procedural_loot/affixes';
import type { ProceduralItemInstance, ProceduralRarity } from '../src/sim/procedural_item';
import type { ItemDef, ItemInstancePayload } from '../src/sim/types';
import { hasTranslation, type TranslationKey } from '../src/ui/i18n';
import {
  isProceduralItemInstance,
  itemPresentationName,
  itemPresentationQuality,
  proceduralAffixPresentations,
  proceduralLegendaryPresentation,
  proceduralRarityLabel,
} from '../src/ui/procedural_item_presentation';

const base: ItemDef = {
  id: 'iron_broadsword',
  name: 'Iron Broadsword',
  kind: 'weapon',
  slot: 'mainhand',
  quality: 'common',
  sellValue: 10,
  weapon: { min: 10, max: 14, speed: 2.4 },
};

function payload(
  rarity: ProceduralRarity,
  overrides: Partial<ProceduralItemInstance> = {},
): ItemInstancePayload {
  return {
    procedural: {
      version: 1,
      uid: `realm:1:${rarity}`,
      baseId: base.id,
      itemLevel: 12,
      rarity,
      affixes: [],
      generatedName: { baseId: base.id },
      seed: 123,
      ...overrides,
    },
  };
}

describe('procedural item presentation', () => {
  it.each([
    ['common', 'common', 'Common'],
    ['magic', 'uncommon', 'Magic'],
    ['rare', 'rare', 'Rare'],
    ['epic', 'epic', 'Epic'],
    ['legendary', 'legendary', 'Legendary'],
    // Mythic is reserved but has no v0.30 frame contract, so it safely keeps
    // the authored base quality while retaining an explicit rarity label.
    ['mythic', 'common', 'Mythic'],
  ] as const)('maps %s to its adopted frame and explicit label', (rarity, quality, label) => {
    const instance = payload(rarity);
    expect(itemPresentationQuality(base, instance)).toBe(quality);
    expect(proceduralRarityLabel(instance)).toBe(label);
  });

  it('keeps ordinary item presentation unchanged', () => {
    expect(itemPresentationQuality(base)).toBe('common');
    expect(itemPresentationName(base)).toBe(base.name);
    expect(proceduralRarityLabel()).toBeUndefined();
    expect(isProceduralItemInstance()).toBe(false);
  });

  it('catalogues every dynamic rarity, name fragment, rare word, and legendary copy key', () => {
    for (const rarity of ['common', 'magic', 'rare', 'epic', 'legendary', 'mythic']) {
      expect(hasTranslation(`itemUi.procedural.rarity.${rarity}` as TranslationKey)).toBe(true);
    }
    for (const definition of Object.values(PROCEDURAL_AFFIXES)) {
      const id = definition.nameFragmentId?.replace('procedural.name.', '');
      if (id)
        expect(hasTranslation(`itemUi.procedural.nameFragment.${id}` as TranslationKey)).toBe(true);
    }
    for (const word of [
      'ashen',
      'blackfen',
      'doom',
      'grave',
      'mire',
      'storm',
      'thorn',
      'wyrm',
      'bite',
      'brand',
      'promise',
      'thread',
      'vigil',
      'ward',
      'whisper',
      'oath',
    ])
      expect(hasTranslation(`itemUi.procedural.rareWord.${word}` as TranslationKey)).toBe(true);
    for (const id of Object.keys(PROCEDURAL_LEGENDARY_POWERS)) {
      expect(hasTranslation(`itemUi.procedural.legendary.${id}.name` as TranslationKey)).toBe(true);
      expect(
        hasTranslation(`itemUi.procedural.legendary.${id}.description` as TranslationKey),
      ).toBe(true);
    }
  });

  it('builds a magic prefix name from the pinned fragment identifier', () => {
    const instance = payload('magic', {
      generatedName: { baseId: base.id, prefixId: 'procedural.name.mighty' },
    });
    expect(itemPresentationName(base, instance)).toBe('Mighty Iron Broadsword');
  });

  it('builds a magic suffix name from the pinned fragment identifier', () => {
    const instance = payload('magic', {
      generatedName: { baseId: base.id, suffixId: 'procedural.name.of_precision' },
    });
    expect(itemPresentationName(base, instance)).toBe('Iron Broadsword of Precision');
  });

  it('builds the stable two-word rare name', () => {
    const instance = payload('rare', {
      generatedName: {
        baseId: base.id,
        rareWordIds: ['procedural.rare.storm', 'procedural.rare.vigil'],
      },
    });
    expect(itemPresentationName(base, instance)).toBe('Storm Vigil');
  });

  it('uses the legendary power name as the unique item name', () => {
    const instance = payload('legendary', {
      legendaryPowerId: 'greyjaws_edge',
      powerRevision: 1,
      legendaryRolls: { potencyPct: 39 },
    });
    expect(itemPresentationName(base, instance)).toBe("Greyjaw's Edge");
    expect(proceduralLegendaryPresentation(instance)).toMatchObject({
      id: 'greyjaws_edge',
      name: "Greyjaw's Edge",
      rolls: { potencyPct: 39 },
      rollDetails: [
        {
          key: 'potencyPct',
          value: 39,
          min: 38,
          max: 40,
          step: 1,
          unit: 'percent',
        },
      ],
    });
  });

  it('sorts implicit and explicit stat lines deterministically', () => {
    const instance = payload('rare', {
      implicits: [
        {
          affixId: 'implicit_armor',
          family: 'implicit.armor',
          position: 'prefix',
          tier: 1,
          revision: 1,
          budget: 1,
          values: { armor: 7 },
          ranges: { armor: { min: 5, max: 8 } },
        },
      ],
      affixes: [
        {
          affixId: 'haste',
          family: 'rating.haste',
          position: 'suffix',
          tier: 2,
          revision: 1,
          budget: 2,
          values: { hasteRating: 8 },
          ranges: { hasteRating: { min: 6, max: 9 } },
        },
        {
          affixId: 'might',
          family: 'primary.strength',
          position: 'prefix',
          tier: 2,
          revision: 1,
          budget: 2,
          values: { str: 4 },
          ranges: { str: { min: 3, max: 5 } },
        },
      ],
    });
    expect(proceduralAffixPresentations(instance).map((line) => line.stat)).toEqual([
      'armor',
      'str',
      'hasteRating',
    ]);
  });

  it('works with a privacy-safe public instance view', () => {
    const full = payload('epic', {
      generatedName: {
        baseId: base.id,
        rareWordIds: ['procedural.rare.wyrm', 'procedural.rare.oath'],
      },
    });
    const fullProcedural = full.procedural;
    expect(fullProcedural).toBeDefined();
    if (!fullProcedural) throw new Error('fixture must include procedural data');
    const publicView = {
      procedural: {
        ...fullProcedural,
        uid: undefined,
        seed: undefined,
        dropContext: undefined,
      },
    };
    expect(itemPresentationName(base, publicView)).toBe('Wyrm Oath');
    expect(isProceduralItemInstance(publicView)).toBe(true);
  });
});
