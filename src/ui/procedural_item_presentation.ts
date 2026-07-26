import { PROCEDURAL_LEGENDARY_POWERS } from '../sim/content/procedural_legendary_powers';
import { PROCEDURAL_AFFIXES } from '../sim/content/procedural_loot/affixes';
import { proceduralQuality, type RolledAffix } from '../sim/procedural_item';
import type { PublicItemInstanceView } from '../sim/procedural_item_public';
import type { ItemDef, ItemInstancePayload } from '../sim/types';
import { type TranslationKey, t } from './i18n';

export type ItemPresentationInstance = ItemInstancePayload | PublicItemInstanceView;

export interface ProceduralAffixPresentation {
  affixId: string;
  family: string;
  stat: string;
  value: number;
  min: number;
  max: number;
  tier: number;
  implicit: boolean;
}

export interface ProceduralLegendaryRollPresentation {
  key: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: 'percent' | 'milliseconds' | 'resource' | 'number';
}

export interface ProceduralLegendaryPresentation {
  id: string;
  name: string;
  description: string;
  rolls: Readonly<Record<string, number>>;
  rollDetails: readonly ProceduralLegendaryRollPresentation[];
}

const STAT_ORDER: Readonly<Record<string, number>> = {
  weaponMin: 0,
  weaponMax: 1,
  armor: 2,
  str: 10,
  agi: 11,
  sta: 12,
  int: 13,
  spi: 14,
  spellPower: 20,
  hitRating: 21,
  critRating: 22,
  hasteRating: 23,
  blockValue: 24,
  healthOnKill: 30,
  manaOnKill: 31,
};

export function itemPresentationQuality(
  item: Pick<ItemDef, 'quality'>,
  instance?: ItemPresentationInstance,
): NonNullable<ItemDef['quality']> {
  const rarity = instance?.procedural?.rarity;
  if (!rarity) return item.quality ?? 'common';
  // Mythic is reserved in the v0.30 data contract but deliberately has no
  // visual-quality contract yet. Falling back to the authored base quality
  // avoids emitting a q-mythic class with no palette, focus, forced-colors, or
  // screenshot definition. The explicit rarity label still says Mythic.
  return proceduralQuality(rarity) ?? item.quality ?? 'common';
}

export function proceduralRarityLabel(instance?: ItemPresentationInstance): string | undefined {
  const rarity = instance?.procedural?.rarity;
  return rarity ? t(`itemUi.procedural.rarity.${rarity}` as TranslationKey) : undefined;
}

function affixFragment(fragmentId: string | undefined): string | undefined {
  if (!fragmentId) return undefined;
  const definition = Object.values(PROCEDURAL_AFFIXES).find(
    (definition) => definition.nameFragmentId === fragmentId,
  );
  if (!definition) return undefined;
  const id = fragmentId.replace('procedural.name.', '');
  return t(`itemUi.procedural.nameFragment.${id}` as TranslationKey);
}

function legendaryCopy(powerId: string, field: 'name' | 'description'): string {
  return t(`itemUi.procedural.legendary.${powerId}.${field}` as TranslationKey);
}

export function itemPresentationName(
  item: Pick<ItemDef, 'name'>,
  instance?: ItemPresentationInstance,
): string {
  const procedural = instance?.procedural;
  if (!procedural) return item.name;
  if (procedural.legendaryPowerId) {
    const power =
      PROCEDURAL_LEGENDARY_POWERS[
        procedural.legendaryPowerId as keyof typeof PROCEDURAL_LEGENDARY_POWERS
      ];
    if (power) return legendaryCopy(power.id, 'name');
  }
  const generated = procedural.generatedName;
  if (generated.rareWordIds) {
    const words = generated.rareWordIds.map((id) =>
      t(`itemUi.procedural.rareWord.${id.replace('procedural.rare.', '')}` as TranslationKey),
    );
    if (words.length === 2) return words.join(' ');
  }
  const prefix = affixFragment(generated.prefixId);
  const suffix = affixFragment(generated.suffixId);
  return [prefix, item.name, suffix].filter(Boolean).join(' ');
}

function affixPresentations(
  affixes: readonly RolledAffix[] | undefined,
  implicit: boolean,
): ProceduralAffixPresentation[] {
  if (!affixes) return [];
  const lines: ProceduralAffixPresentation[] = [];
  for (const affix of affixes) {
    for (const [stat, value] of Object.entries(affix.values)) {
      const range = affix.ranges[stat];
      if (!range) continue;
      lines.push({
        affixId: affix.affixId,
        family: affix.family,
        stat,
        value,
        min: range.min,
        max: range.max,
        tier: affix.tier,
        implicit,
      });
    }
  }
  return lines.sort(
    (a, b) =>
      Number(b.implicit) - Number(a.implicit) ||
      (STAT_ORDER[a.stat] ?? 100) - (STAT_ORDER[b.stat] ?? 100) ||
      a.family.localeCompare(b.family) ||
      a.affixId.localeCompare(b.affixId),
  );
}

export function proceduralAffixPresentations(
  instance?: ItemPresentationInstance,
): ProceduralAffixPresentation[] {
  const procedural = instance?.procedural;
  if (!procedural) return [];
  return [
    ...affixPresentations(procedural.implicits, true),
    ...affixPresentations(procedural.affixes, false),
  ];
}

function legendaryRollUnit(key: string): ProceduralLegendaryRollPresentation['unit'] {
  if (key.endsWith('Pct')) return 'percent';
  if (key.endsWith('Ms')) return 'milliseconds';
  if (key === 'resource') return 'resource';
  return 'number';
}

export function proceduralLegendaryPresentation(
  instance?: ItemPresentationInstance,
): ProceduralLegendaryPresentation | undefined {
  const procedural = instance?.procedural;
  if (!procedural?.legendaryPowerId) return undefined;
  const power =
    PROCEDURAL_LEGENDARY_POWERS[
      procedural.legendaryPowerId as keyof typeof PROCEDURAL_LEGENDARY_POWERS
    ];
  if (!power) return undefined;
  const rolls = { ...(procedural.legendaryRolls ?? {}) };
  return {
    id: power.id,
    name: legendaryCopy(power.id, 'name'),
    description: legendaryCopy(power.id, 'description'),
    rolls,
    rollDetails: Object.entries(power.rolls).flatMap(([key, range]) => {
      const value = rolls[key];
      if (value === undefined) return [];
      return [
        {
          key,
          value,
          min: range.min,
          max: range.max,
          step: range.step,
          unit: legendaryRollUnit(key),
        },
      ];
    }),
  };
}

export function isProceduralItemInstance(instance?: ItemPresentationInstance): boolean {
  return instance?.procedural !== undefined;
}
