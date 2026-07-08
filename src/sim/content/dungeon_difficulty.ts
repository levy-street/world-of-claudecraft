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

// Tuning model follows classic-era (TBC) heroics: measured database pairs put
// the heroic raw-damage jump at ~3.0-3.5x flat across leveling and endgame
// dungeons (Gargolmar 3.00x, Nazan 3.28x, Omor 3.42x, cap-level Kargath
// Bladefist 3.50x), with health following the cap-band level jump. The
// damage multipliers below are calibrated against a GEARED level-20 roster
// (endgame blues: tank ~1150 hp at 33% armor DR, cloth ~640 hp at 18%),
// reproducing the TBC-heroic EXPERIENCE: a final boss chews a tank for
// ~18-28% of max hp per swing (healers must actively pump), trash melee
// takes ~30-55% of a clothie per hit, and boss melee on cloth is close to a
// two-shot. That lands the raw heroic-vs-normal ratios above TBC's 3.5x
// because this game's mitigation and hp pools are proportionally larger at
// the cap; the EFFECTIVE severity is the calibration target. Recompute the
// bands with the level-20 pin included (Hollow Crypt L10 mobs already gain
// ~1.6x health and ~1.8x damage from the level bump alone). Mechanic damage
// and support heals scale with the same multipliers
// (mechanicDamageMult/mechanicHealMult in ../instances/difficulty.ts).
export const HEROIC_DUNGEON_TUNING: Record<string, HeroicDungeonTuning> = {
  hollow_crypt: {
    id: 'hollow_crypt',
    difficulty: 'heroic',
    level: 20,
    healthMultiplier: 1.9,
    damageMultiplier: 3.4,
    armorMultiplier: 1.3,
    finalBossId: 'morthen',
    marksPerParticipant: 1,
  },
  sunken_bastion: {
    id: 'sunken_bastion',
    difficulty: 'heroic',
    level: 20,
    healthMultiplier: 2.0,
    damageMultiplier: 3.8,
    armorMultiplier: 1.3,
    finalBossId: 'vael_the_mistcaller',
    marksPerParticipant: 1,
  },
  drowned_temple: {
    id: 'drowned_temple',
    difficulty: 'heroic',
    level: 20,
    healthMultiplier: 2.6,
    damageMultiplier: 4.2,
    armorMultiplier: 1.25,
    finalBossId: 'ysolei',
    marksPerParticipant: 1,
  },
  gravewyrm_sanctum: {
    id: 'gravewyrm_sanctum',
    difficulty: 'heroic',
    level: 20,
    healthMultiplier: 2.0,
    damageMultiplier: 4.6,
    armorMultiplier: 1.2,
    finalBossId: 'korzul_the_gravewyrm',
    marksPerParticipant: 1,
  },
  // The 10-player raid arena. Normal Nythraxis already swings ~3.7x harder
  // than Korzul, so the raid's heroic multiplier is small in RELATIVE terms
  // while landing the hardest absolute hits in the game: the boss chews a
  // geared tank for ~47% of max hp per 2.6s swing (a raid brings two or
  // three healers), and add waves hit cloth for ~50%. The percentage
  // mechanics scale on heroic in the encounter script (Soul Rend 1.5x,
  // Deathless Rage lethal on a failed wardstone channel; see
  // encounters/nythraxis.ts). The attunement dungeon nythraxis_crypt is
  // story content and deliberately has NO heroic record. The daily raid
  // lockout is keyed by dungeon id, so it is SHARED across difficulties:
  // one Nythraxis kill per day, normal or heroic.
  nythraxis_boss_arena: {
    id: 'nythraxis_boss_arena',
    difficulty: 'heroic',
    level: 20,
    healthMultiplier: 1.6,
    damageMultiplier: 2.0,
    armorMultiplier: 1.2,
    finalBossId: 'nythraxis_scourge_of_thornpeak',
    marksPerParticipant: 3,
  },
};
