import {
  NYTHRAXIS_PROCEDURAL_RAID_PROFILES,
  NYTHRAXIS_RAID_BOSS_ID,
  NYTHRAXIS_RAID_DUNGEON_ID,
} from '../../content/procedural_raid_loot';
import type { ItemDropContext, ProceduralRarity } from '../../procedural_item';
import type { DungeonDifficulty, MobTemplate, PlayerClass } from '../../types';
import { type GeneratedProceduralDrop, generateProceduralItem } from './generate';
import { deriveProceduralItemSeed, deriveSecretProceduralItemSeed, hash32Parts } from './item_seed';

export type ProceduralLootSource = 'world' | 'rare' | 'dungeon' | 'delve' | 'raid';

export interface ProceduralDropProfile {
  source: ProceduralLootSource;
  chance: number;
  basePoolId: string;
  rarityTableId: string;
  forcedItemLevels?: Partial<Record<Exclude<ProceduralRarity, 'mythic'>, number>>;
  legendaryMagnitudeFloor?: number;
  raidForgedLegendary?: true;
}

export interface ProceduralSourceFacts {
  inDungeon: boolean;
  inDelve: boolean;
  dungeonId?: string;
  dungeonDifficulty?: DungeonDifficulty;
}

export interface LiveProceduralDropInput {
  worldSeed: number;
  /** Omitted in deterministic offline/tools; required by the authoritative server. */
  lootSeedSecret?: string;
  sourceEntityId: number;
  sourceSpawnSequence: number;
  lootSlotIndex: number;
  sourceItemLevel: number;
  sourceTemplate: MobTemplate;
  sourceFacts: ProceduralSourceFacts;
  uid: string | (() => string);
  personalLootClass?: PlayerClass;
  lootRecipientClasses?: readonly PlayerClass[];
}

const PROFILE_WORLD: ProceduralDropProfile = {
  source: 'world',
  chance: 0.05,
  basePoolId: 'initial_world',
  rarityTableId: 'initial_world',
};

const PROFILE_RARE: ProceduralDropProfile = {
  source: 'rare',
  chance: 1,
  basePoolId: 'initial_rare',
  rarityTableId: 'initial_rare',
};

const PROFILE_DUNGEON_BOSS: ProceduralDropProfile = {
  source: 'dungeon',
  chance: 1,
  basePoolId: 'initial_dungeon_boss',
  rarityTableId: 'initial_dungeon_boss',
};
const PROFILE_NYTHRAXIS_NORMAL: ProceduralDropProfile = {
  source: 'raid',
  chance: 1,
  basePoolId: 'nythraxis_raid',
  rarityTableId: NYTHRAXIS_PROCEDURAL_RAID_PROFILES.normal.rarityTableId,
  forcedItemLevels: NYTHRAXIS_PROCEDURAL_RAID_PROFILES.normal.itemLevels,
  legendaryMagnitudeFloor: NYTHRAXIS_PROCEDURAL_RAID_PROFILES.normal.legendaryMagnitudeFloor,
};

const PROFILE_NYTHRAXIS_HEROIC: ProceduralDropProfile = {
  source: 'raid',
  chance: 1,
  basePoolId: 'nythraxis_raid',
  rarityTableId: NYTHRAXIS_PROCEDURAL_RAID_PROFILES.heroic.rarityTableId,
  forcedItemLevels: NYTHRAXIS_PROCEDURAL_RAID_PROFILES.heroic.itemLevels,
  legendaryMagnitudeFloor: NYTHRAXIS_PROCEDURAL_RAID_PROFILES.heroic.legendaryMagnitudeFloor,
  raidForgedLegendary: true,
};

const PROFILE_DELVE_BOSS: ProceduralDropProfile = {
  source: 'delve',
  chance: 1,
  basePoolId: 'initial_dungeon_boss',
  rarityTableId: 'initial_dungeon_boss',
};

const PROFILE_DELVE_ELITE: ProceduralDropProfile = {
  source: 'delve',
  chance: 0.2,
  basePoolId: 'initial_rare',
  rarityTableId: 'initial_rare',
};

export function proceduralDropProfile(
  template: MobTemplate,
  facts: ProceduralSourceFacts,
): ProceduralDropProfile | null {
  if (template.worldBoss || template.dummy) return null;
  if (facts.inDelve) {
    if (template.boss) return PROFILE_DELVE_BOSS;
    return template.elite || template.rare ? PROFILE_DELVE_ELITE : null;
  }
  if (
    facts.inDungeon &&
    facts.dungeonId === NYTHRAXIS_RAID_DUNGEON_ID &&
    template.id === NYTHRAXIS_RAID_BOSS_ID
  )
    return facts.dungeonDifficulty === 'heroic'
      ? PROFILE_NYTHRAXIS_HEROIC
      : PROFILE_NYTHRAXIS_NORMAL;
  if (facts.inDungeon) return template.boss ? PROFILE_DUNGEON_BOSS : null;
  if (template.rare || template.boss) return PROFILE_RARE;
  if (template.elite) return null;
  return PROFILE_WORLD;
}

export function proceduralDropChanceRoll(itemSeed: number): number {
  return hash32Parts('procedural-drop-chance-v1', itemSeed) / 0x1_0000_0000;
}

function sourceTags(
  template: MobTemplate,
  profile: ProceduralDropProfile,
  facts: ProceduralSourceFacts,
): string[] {
  return [
    template.family,
    profile.source,
    ...(facts.dungeonDifficulty ? [facts.dungeonDifficulty] : []),
    ...(template.rare ? ['rare'] : []),
    ...(template.elite ? ['elite'] : []),
    ...(template.boss ? ['boss'] : []),
  ];
}

export function generateLiveProceduralDrop(
  input: LiveProceduralDropInput,
): GeneratedProceduralDrop | null {
  if (input.sourceItemLevel < 5) return null;
  const profile = proceduralDropProfile(input.sourceTemplate, input.sourceFacts);
  if (!profile) return null;
  const context: ItemDropContext = {
    source: profile.source,
    sourceEntityId: input.sourceEntityId,
    sourceSpawnSequence: input.sourceSpawnSequence,
    lootSlotIndex: input.lootSlotIndex,
    sourceTemplateId: input.sourceTemplate.id,
    sourceTags: sourceTags(input.sourceTemplate, profile, input.sourceFacts),
  };
  const seed = input.lootSeedSecret
    ? deriveSecretProceduralItemSeed(input.lootSeedSecret, input.worldSeed, context)
    : deriveProceduralItemSeed(input.worldSeed, context);
  if (proceduralDropChanceRoll(seed) >= profile.chance) return null;
  const uid = typeof input.uid === 'function' ? input.uid() : input.uid;
  return generateProceduralItem({
    seed,
    uid,
    context,
    basePoolId: profile.basePoolId,
    rarityTableId: profile.rarityTableId,
    sourceItemLevel: input.sourceItemLevel,
    ...(profile.forcedItemLevels && {
      forcedItemLevels: profile.forcedItemLevels,
    }),
    ...(profile.legendaryMagnitudeFloor !== undefined && {
      legendaryMagnitudeFloor: profile.legendaryMagnitudeFloor,
    }),
    ...(profile.raidForgedLegendary && {
      raidForgedLegendary: true,
    }),
    ...(input.personalLootClass && {
      personalLootClass: input.personalLootClass,
    }),
    ...(input.lootRecipientClasses && {
      lootRecipientClasses: input.lootRecipientClasses,
    }),
  });
}
