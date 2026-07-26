import type { DungeonDifficulty } from '../types';

export const NYTHRAXIS_RAID_DUNGEON_ID = 'nythraxis_boss_arena';
export const NYTHRAXIS_RAID_BOSS_ID = 'nythraxis_scourge_of_thornpeak';
export const DEATHLESS_FRAGMENT_ITEM_ID = 'deathless_fragment';

export type NythraxisRaidDifficulty = Extract<DungeonDifficulty, 'normal' | 'heroic'>;

export interface NythraxisProceduralRaidProfile {
  difficulty: NythraxisRaidDifficulty;
  rarityTableId: 'nythraxis_raid_normal' | 'nythraxis_raid_heroic';
  itemLevels: Readonly<{ rare: number; epic: number; legendary: number }>;
  legendaryMagnitudeFloor: number;
  fragmentsPerParticipant: number;
}

/** One shared procedural item is appended to every eligible Nythraxis corpse. */
export const NYTHRAXIS_PROCEDURAL_RAID_PROFILES = {
  normal: {
    difficulty: 'normal',
    rarityTableId: 'nythraxis_raid_normal',
    itemLevels: { rare: 27, epic: 28, legendary: 32 },
    legendaryMagnitudeFloor: 0,
    fragmentsPerParticipant: 1,
  },
  heroic: {
    difficulty: 'heroic',
    rarityTableId: 'nythraxis_raid_heroic',
    itemLevels: { rare: 31, epic: 32, legendary: 36 },
    // Heroic named powers remap into the upper half of their authored range.
    legendaryMagnitudeFloor: 0.5,
    fragmentsPerParticipant: 3,
  },
} as const satisfies Record<NythraxisRaidDifficulty, NythraxisProceduralRaidProfile>;

export const NYTHRAXIS_FORGE_COSTS = {
  normalProceduralEpic: { fragments: 20, heroicMarks: 0 },
  heroicProceduralEpic: { fragments: 24, heroicMarks: 24 },
  heroicAuthoredEpic: { fragments: 36, heroicMarks: 27 },
  heroicAuthoredLegendary: { fragments: 60, heroicMarks: 45 },
  raidForgedSignature: { fragments: 60, heroicMarks: 45 },
  legendaryPowerTune: { fragments: 6, heroicMarks: 6 },
} as const;

export type NythraxisAuthoredForgeQuality = 'epic' | 'legendary';

export interface NythraxisAuthoredForgeOffer {
  offerId: string;
  itemId: string;
  quality: NythraxisAuthoredForgeQuality;
}

/** Exact Heroic rewards with a long deterministic acquisition path. */
export const NYTHRAXIS_AUTHORED_FORGE_OFFERS = [
  { offerId: 'authored:deathless_greatblade', itemId: 'deathless_greatblade', quality: 'epic' },
  {
    offerId: 'authored:scepter_of_the_deathless_court',
    itemId: 'scepter_of_the_deathless_court',
    quality: 'epic',
  },
  { offerId: 'authored:stormcallers_focus', itemId: 'stormcallers_focus', quality: 'epic' },
  {
    offerId: 'authored:heroic_deathless_heartwood',
    itemId: 'heroic_deathless_heartwood',
    quality: 'legendary',
  },
  {
    offerId: 'authored:heroic_kingsbane_last_oath',
    itemId: 'heroic_kingsbane_last_oath',
    quality: 'legendary',
  },
] as const satisfies readonly NythraxisAuthoredForgeOffer[];

export function nythraxisProceduralRaidProfile(
  difficulty: DungeonDifficulty,
): NythraxisProceduralRaidProfile {
  return NYTHRAXIS_PROCEDURAL_RAID_PROFILES[difficulty];
}

export function nythraxisAuthoredForgeOffer(
  offerId: string,
): NythraxisAuthoredForgeOffer | undefined {
  return NYTHRAXIS_AUTHORED_FORGE_OFFERS.find((offer) => offer.offerId === offerId);
}
