import type { DungeonDifficulty } from '../types';

// The participation token every eligible player can loot once from a heroic
// final-boss corpse (a personalFor slot per participant; see awardHeroicMarks
// in ../instances/dungeons.ts). The item record lives in ./items.ts.
export const HEROIC_MARK_ITEM_ID = 'heroic_mark';

export interface HeroicDungeonTuning {
  id: string;
  difficulty: Extract<DungeonDifficulty, 'heroic'>;
  level: number;
  healthMultiplier: number;
  damageMultiplier: number;
  armorMultiplier: number;
  // The dungeon's last boss: killing it in a heroic instance drops Heroic
  // Marks for every eligible participant.
  finalBossId: string;
  // Marks each participant can loot from the final-boss corpse (one
  // personalFor slot per mark, so a single loot click takes them all).
  marksPerParticipant: number;
}

// Tuning model: every heroic mob is pinned to LEVEL 22 (two above the level-20
// player cap) and the four five-mans are damage-EQUALIZED, so a heroic feels
// the same whichever one you run. The calibration target is an average elite
// TRASH swing landing ~300 post-mitigation on the reference GEARED shaman
// (full heroic mail: 2142 armor, 1493 hp, 48.55% DR vs a level-22 attacker),
// i.e. ~20% of max hp per hit, with final bosses ~22-24%. Solving each dungeon
// for that target INVERTS the multiplier ladder, because the harder dungeons
// already carry bigger base weapon damage: hollow_crypt needs the largest
// multiplier, gravewyrm_sanctum the smallest. Gear-band reference points at
// these constants: full-heroic mail lands ~300 trash / ~330-350 boss per hit;
// endgame blues tank (~1150 hp, ~31% DR at L22) ~35% trash / ~40% boss; blues
// cloth (~640 hp, ~17% DR) ~76% per trash hit and a trash CRIT one-shots, so
// heroics are gear-gated by design. Mechanic damage lands RAW (no armor step;
// see aoePulse/stomp in ../mob/locomotion.ts) and scales with the same
// per-dungeon multiplier via mechanicDamageMult; support heals scale with
// mechanicHealMult (= healthMultiplier); both wired in
// ../instances/difficulty.ts.
export const HEROIC_DUNGEON_TUNING: Record<string, HeroicDungeonTuning> = {
  hollow_crypt: {
    id: 'hollow_crypt',
    difficulty: 'heroic',
    level: 22,
    healthMultiplier: 1.9,
    damageMultiplier: 6.8,
    armorMultiplier: 1.3,
    finalBossId: 'morthen',
    marksPerParticipant: 1,
  },
  sunken_bastion: {
    id: 'sunken_bastion',
    difficulty: 'heroic',
    level: 22,
    healthMultiplier: 2.0,
    damageMultiplier: 6.2,
    armorMultiplier: 1.3,
    finalBossId: 'vael_the_mistcaller',
    marksPerParticipant: 1,
  },
  drowned_temple: {
    id: 'drowned_temple',
    difficulty: 'heroic',
    level: 22,
    healthMultiplier: 2.6,
    damageMultiplier: 5.7,
    armorMultiplier: 1.25,
    finalBossId: 'ysolei',
    marksPerParticipant: 1,
  },
  gravewyrm_sanctum: {
    id: 'gravewyrm_sanctum',
    difficulty: 'heroic',
    level: 22,
    healthMultiplier: 2.0,
    damageMultiplier: 5.4,
    armorMultiplier: 1.2,
    finalBossId: 'korzul_the_gravewyrm',
    marksPerParticipant: 1,
  },
  // The 10-player raid arena. Normal Nythraxis already swings ~3.7x harder
  // than Korzul, so the raid's heroic multiplier is small in RELATIVE terms
  // while landing the hardest absolute hits in the game: at the level-22
  // heroic pin (matching the 5-mans) the boss chews a geared tank for ~54%
  // of max hp per 2.6s swing (a raid brings two or three healers), and add
  // waves hit cloth for ~57%. The percentage
  // mechanics scale on heroic in the encounter script (Soul Rend 1.5x,
  // Deathless Rage lethal on a failed wardstone channel; see
  // encounters/nythraxis.ts). The attunement dungeon nythraxis_crypt is
  // story content and deliberately has NO heroic record. The daily raid
  // lockout is keyed by dungeon id, so it is SHARED across difficulties:
  // one Nythraxis kill per day, normal or heroic.
  nythraxis_boss_arena: {
    id: 'nythraxis_boss_arena',
    difficulty: 'heroic',
    level: 22,
    healthMultiplier: 1.6,
    damageMultiplier: 2.0,
    armorMultiplier: 1.2,
    finalBossId: 'nythraxis_scourge_of_thornpeak',
    marksPerParticipant: 3,
  },
};
