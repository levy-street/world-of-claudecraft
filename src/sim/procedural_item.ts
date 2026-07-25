import type { ItemDef, ItemInstancePayload } from './types';

export type ProceduralRarity = 'common' | 'magic' | 'rare' | 'epic' | 'legendary' | 'mythic';

export type ItemTag =
  | 'weapon'
  | 'armor'
  | 'held_offhand'
  | 'jewelry'
  | 'shield'
  | 'caster'
  | 'melee'
  | 'ranged'
  | 'onehand'
  | 'twohand'
  | 'cloth'
  | 'leather'
  | 'mail'
  | 'heavy_slot'
  | 'light_slot';

export type ProceduralAffixPosition = 'prefix' | 'suffix';

export interface RolledAffixRange {
  min: number;
  max: number;
}

export interface RolledAffix {
  affixId: string;
  family: string;
  position: ProceduralAffixPosition;
  tier: number;
  revision: 1;
  budget: number;
  values: Record<string, number>;
  ranges: Record<string, RolledAffixRange>;
}

export interface GeneratedItemName {
  prefixId?: string;
  baseId: string;
  suffixId?: string;
  rareWordIds?: [string, string];
  legendaryNameId?: string;
}

export interface ItemDropContext {
  source: 'world' | 'rare' | 'dungeon' | 'delve' | 'raid' | 'dev';
  sourceEntityId: number;
  sourceSpawnSequence: number;
  lootSlotIndex: number;
  recipientId?: number;
  sourceTemplateId?: string;
  sourceTags?: string[];
}

export interface ProceduralItemInstance {
  version: 1;
  uid: string;
  baseId: string;
  itemLevel: number;
  rarity: ProceduralRarity;
  affixes: RolledAffix[];
  implicits?: RolledAffix[];
  legendaryPowerId?: string;
  powerRevision?: number;
  legendaryRolls?: Record<string, number>;
  generatedName: GeneratedItemName;
  seed: number;
  dropContext?: ItemDropContext;
}

const PROCEDURAL_QUALITY: Record<
  Exclude<ProceduralRarity, 'mythic'>,
  NonNullable<ItemDef['quality']>
> = {
  common: 'common',
  magic: 'uncommon',
  rare: 'rare',
  epic: 'epic',
  legendary: 'legendary',
};

export function proceduralQuality(
  rarity: ProceduralRarity,
): NonNullable<ItemDef['quality']> | null {
  return rarity === 'mythic' ? null : PROCEDURAL_QUALITY[rarity];
}

export function cloneRolledAffix(affix: RolledAffix): RolledAffix {
  return {
    ...affix,
    values: { ...affix.values },
    ranges: Object.fromEntries(
      Object.entries(affix.ranges).map(([key, range]) => [key, { ...range }]),
    ),
  };
}

export function cloneProceduralItemInstance(item: ProceduralItemInstance): ProceduralItemInstance {
  return {
    ...item,
    affixes: item.affixes.map(cloneRolledAffix),
    ...(item.implicits && { implicits: item.implicits.map(cloneRolledAffix) }),
    ...(item.legendaryRolls && { legendaryRolls: { ...item.legendaryRolls } }),
    generatedName: {
      ...item.generatedName,
      ...(item.generatedName.rareWordIds && {
        rareWordIds: [...item.generatedName.rareWordIds] as [string, string],
      }),
    },
    ...(item.dropContext && {
      dropContext: {
        ...item.dropContext,
        ...(item.dropContext.sourceTags && {
          sourceTags: [...item.dropContext.sourceTags],
        }),
      },
    }),
  };
}

export function cloneProceduralPayload(payload: ItemInstancePayload): ItemInstancePayload {
  return {
    ...payload,
    ...(payload.charges && { charges: { ...payload.charges } }),
    ...(payload.rolled && {
      rolled: {
        ...payload.rolled,
        ...(payload.rolled.stats && { stats: { ...payload.rolled.stats } }),
      },
    }),
    ...(payload.procedural && {
      procedural: cloneProceduralItemInstance(payload.procedural),
    }),
  };
}

export function allProceduralAffixes(item: ProceduralItemInstance): readonly RolledAffix[] {
  return item.implicits ? [...item.implicits, ...item.affixes] : item.affixes;
}
