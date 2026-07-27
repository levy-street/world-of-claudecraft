import type { DungeonDifficulty } from '../types';

export const NYTHRAXIS_RAID_DUNGEON_ID = 'nythraxis_boss_arena';
export const NYTHRAXIS_RAID_BOSS_ID = 'nythraxis_scourge_of_thornpeak';

export type NythraxisRaidDifficulty = Extract<DungeonDifficulty, 'normal' | 'heroic'>;

export interface NythraxisProceduralRaidProfile {
  difficulty: NythraxisRaidDifficulty;
  rarityTableId: 'nythraxis_raid_normal' | 'nythraxis_raid_heroic';
  itemLevels: Readonly<{ rare: number; epic: number; legendary: number }>;
  legendaryMagnitudeFloor: number;
}

/** One shared procedural item is appended to every eligible Nythraxis corpse. */
export const NYTHRAXIS_PROCEDURAL_RAID_PROFILES = {
  normal: {
    difficulty: 'normal',
    rarityTableId: 'nythraxis_raid_normal',
    itemLevels: { rare: 27, epic: 28, legendary: 32 },
    legendaryMagnitudeFloor: 0,
  },
  heroic: {
    difficulty: 'heroic',
    rarityTableId: 'nythraxis_raid_heroic',
    itemLevels: { rare: 31, epic: 32, legendary: 36 },
    // Heroic named powers remap into the upper half of their authored range.
    legendaryMagnitudeFloor: 0.5,
  },
} as const satisfies Record<NythraxisRaidDifficulty, NythraxisProceduralRaidProfile>;

export function nythraxisProceduralRaidProfile(
  difficulty: DungeonDifficulty,
): NythraxisProceduralRaidProfile {
  return NYTHRAXIS_PROCEDURAL_RAID_PROFILES[difficulty];
}
