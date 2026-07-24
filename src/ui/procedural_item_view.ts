import {
  type ResolvedItemStats,
  resolvedItemStats,
  resolvedWeaponDps,
} from '../sim/equipment/resolved_item';
import {
  type GeneratedItemName,
  type ProceduralItemInstance,
  type ProceduralRarity,
  proceduralQuality,
  type RolledAffix,
} from '../sim/procedural_item';
import type { ItemDef, ItemInstancePayload } from '../sim/types';

export interface ProceduralNameView {
  kind: 'base' | 'affixed' | 'rare' | 'legendary';
  baseId: string;
  prefixId?: string;
  suffixId?: string;
  rareWordIds?: [string, string];
  legendaryNameId?: string;
}

export interface ProceduralAffixLineView {
  affixId: string;
  family: string;
  stat: string;
  value: number;
  min: number;
  max: number;
  category: 'implicit' | 'offensive' | 'defensive' | 'resource' | 'utility';
  order: number;
}

export interface ProceduralTooltipView {
  uid: string;
  baseId: string;
  rarity: ProceduralRarity;
  quality: NonNullable<ItemDef['quality']> | null;
  itemLevel: number;
  name: ProceduralNameView;
  implicits: ProceduralAffixLineView[];
  affixes: ProceduralAffixLineView[];
  legendaryPowerId?: string;
  legendaryRolls?: Record<string, number>;
}

export interface ResolvedItemDelta {
  stat:
    | 'weaponMin'
    | 'weaponMax'
    | 'weaponDps'
    | 'armor'
    | 'str'
    | 'agi'
    | 'sta'
    | 'int'
    | 'spi'
    | 'spellPower'
    | 'critRating'
    | 'hasteRating'
    | 'hitRating'
    | 'healthOnKill'
    | 'manaOnKill'
    | 'blockValue';
  delta: number;
}

const STAT_LINE_ORDER: Record<string, number> = {
  weaponMin: 0,
  weaponMax: 1,
  armor: 2,
  str: 10,
  agi: 11,
  sta: 12,
  int: 13,
  spi: 14,
  spellPower: 20,
  critRating: 21,
  hasteRating: 22,
  hitRating: 23,
  healthOnKill: 30,
  manaOnKill: 31,
};

function categoryForStat(stat: string): ProceduralAffixLineView['category'] {
  if (stat === 'armor' || stat === 'sta') return 'defensive';
  if (stat === 'healthOnKill' || stat === 'manaOnKill') return 'resource';
  if (
    stat === 'str' ||
    stat === 'agi' ||
    stat === 'int' ||
    stat === 'spi' ||
    stat === 'spellPower' ||
    stat.endsWith('Rating')
  )
    return 'offensive';
  return 'utility';
}

function affixLines(
  affixes: readonly RolledAffix[] | undefined,
  implicit: boolean,
): ProceduralAffixLineView[] {
  if (!affixes) return [];
  const lines: ProceduralAffixLineView[] = [];
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
        category: implicit ? 'implicit' : categoryForStat(stat),
        order: STAT_LINE_ORDER[stat] ?? 100,
      });
    }
  }
  return lines.sort(
    (a, b) =>
      a.order - b.order || a.family.localeCompare(b.family) || a.affixId.localeCompare(b.affixId),
  );
}

export function proceduralNameView(name: GeneratedItemName): ProceduralNameView {
  if (name.legendaryNameId)
    return {
      kind: 'legendary',
      baseId: name.baseId,
      legendaryNameId: name.legendaryNameId,
    };
  if (name.rareWordIds)
    return {
      kind: 'rare',
      baseId: name.baseId,
      rareWordIds: [...name.rareWordIds],
    };
  if (name.prefixId || name.suffixId)
    return {
      kind: 'affixed',
      baseId: name.baseId,
      ...(name.prefixId && { prefixId: name.prefixId }),
      ...(name.suffixId && { suffixId: name.suffixId }),
    };
  return { kind: 'base', baseId: name.baseId };
}

export function proceduralTooltipView(item: ProceduralItemInstance): ProceduralTooltipView {
  return {
    uid: item.uid,
    baseId: item.baseId,
    rarity: item.rarity,
    quality: proceduralQuality(item.rarity),
    itemLevel: item.itemLevel,
    name: proceduralNameView(item.generatedName),
    implicits: affixLines(item.implicits, true),
    affixes: affixLines(item.affixes, false),
    ...(item.legendaryPowerId && {
      legendaryPowerId: item.legendaryPowerId,
    }),
    ...(item.legendaryRolls && {
      legendaryRolls: { ...item.legendaryRolls },
    }),
  };
}

function delta(
  out: ResolvedItemDelta[],
  stat: ResolvedItemDelta['stat'],
  candidate: number,
  equipped: number,
): void {
  const value = candidate - equipped;
  if (Math.abs(value) > 1e-9) out.push({ stat, delta: Number(value.toFixed(4)) });
}

export function resolvedItemDeltas(
  candidateDefinition: ItemDef,
  candidateInstance: ItemInstancePayload | undefined,
  equippedDefinition: ItemDef,
  equippedInstance: ItemInstancePayload | undefined,
): ResolvedItemDelta[] {
  const candidate = resolvedItemStats(candidateDefinition, candidateInstance);
  const equipped = resolvedItemStats(equippedDefinition, equippedInstance);
  const out: ResolvedItemDelta[] = [];
  delta(out, 'weaponMin', candidate.weapon?.min ?? 0, equipped.weapon?.min ?? 0);
  delta(out, 'weaponMax', candidate.weapon?.max ?? 0, equipped.weapon?.max ?? 0);
  delta(out, 'weaponDps', resolvedWeaponDps(candidate), resolvedWeaponDps(equipped));
  delta(out, 'armor', candidate.stats.armor, equipped.stats.armor);
  delta(out, 'str', candidate.stats.str, equipped.stats.str);
  delta(out, 'agi', candidate.stats.agi, equipped.stats.agi);
  delta(out, 'sta', candidate.stats.sta, equipped.stats.sta);
  delta(out, 'int', candidate.stats.int, equipped.stats.int);
  delta(out, 'spi', candidate.stats.spi, equipped.stats.spi);
  delta(out, 'spellPower', candidate.spellPower, equipped.spellPower);
  delta(out, 'critRating', candidate.critRating, equipped.critRating);
  delta(out, 'hasteRating', candidate.hasteRating, equipped.hasteRating);
  delta(out, 'hitRating', candidate.hitRating, equipped.hitRating);
  delta(out, 'healthOnKill', candidate.healthOnKill, equipped.healthOnKill);
  delta(out, 'manaOnKill', candidate.manaOnKill, equipped.manaOnKill);
  delta(out, 'blockValue', candidate.blockValue, equipped.blockValue);
  return out;
}

export function activeLegendaryPower(stats: readonly ResolvedItemStats[]): string | undefined {
  return stats.find((entry) => entry.legendaryPowerId)?.legendaryPowerId;
}
