import type { DungeonDifficulty } from '../types';

// The participation token awarded directly to every eligible player when a
// heroic final boss dies (see awardHeroicMarks in ../instances/dungeons.ts).
// The item record lives in ./items.ts.
export const HEROIC_MARK_ITEM_ID = 'heroic_mark';

export interface HeroicDungeonTuning {
  id: string;
  difficulty: Extract<DungeonDifficulty, 'heroic'>;
  level: number;
  healthMultiplier: number;
  damageMultiplier: number;
  // Boss-SUMMONED add waves (MobTemplate.summonAdds, spawned through
  // spawnBossAdds) use this damage multiplier instead of the dungeon-wide one.
  // Summoned adds are NON-ELITE (no 1.5x elite swing multiplier), so hitting
  // the same 500 per-swing floor as elite trash needs a LARGER multiplier
  // here, not a softer one. Trash spawned from the dungeon spawn list
  // (including the guards flanking a boss) stays on damageMultiplier.
  addDamageMultiplier: number;
  // Per-mob overrides, taking precedence over both multipliers above (and
  // over mechanicDamageMult stamping). Used where one dungeon-wide value
  // cannot hit each mob's floor without wild overshoot elsewhere: the Sanctum
  // bosses (which must out-hit the retuned NORMAL Sanctum bosses) and the
  // Nythraxis encounter-script adds (spawned with NO summonedAdd role, and
  // spanning a 2x spread in base weapon damage).
  damageMultiplierByMob?: Record<string, number>;
  armorMultiplier: number;
  // The dungeon's last boss: killing it in a heroic instance awards Heroic
  // Marks for every eligible participant.
  finalBossId: string;
  // Marks awarded directly to each eligible participant at kill time.
  marksPerParticipant: number;
}

// Tuning model (economy retune, 2026-07): every heroic mob is pinned to LEVEL
// 22 (two above the level-20 player cap). The calibration target is a FLOOR,
// not an average: the minimum non-crit swing of EVERY heroic mob (spawn-list
// trash, boss-summoned adds, and the Nythraxis encounter waves) lands at
// least 500 post-mitigation on the maximum-mitigation reference warrior, a
// level-20 prot in the max-armor kit (full heroic plate + shield, prot
// mastery: 2861 armor) standing in Defensive Stance (takes 10% less), who
// receives ~39.8% of a raw level-22 swing. Health is DOUBLED versus the
// previous heroic calibration across the board. Solving the 500 floor at each
// dungeon's WEAKEST spawn-list mob inverts the multiplier ladder (harder
// dungeons carry bigger base weapon damage, so hollow_crypt needs the largest
// multiplier and gravewyrm_sanctum the smallest); bosses ride the same
// dungeon-wide multiplier and land their natural premium above trash.
// Exceptions via damageMultiplierByMob: the three Sanctum bosses are lifted
// so heroic Sanctum out-hits its retuned NORMAL mode (which floors bosses at
// 600), and the Nythraxis raid boss floors at 1200 with its add waves held to
// the 500 line per mob. Mechanic damage lands RAW (no armor step; see
// aoePulse/stomp in ../mob/locomotion.ts) and scales with the mob's own
// multiplier via mechanicDamageMult; support heals scale with
// mechanicHealMult (= healthMultiplier); both wired in
// ../instances/difficulty.ts. Gravebreaker (the raid boss frontal) derives
// from boss.weapon, so it scales through the template transform on its own.
// Floors are pinned by tests/heroic_difficulty_floors.test.ts.
// NORMAL-difficulty retunes. Normal spawns default to the raw base templates;
// a dungeon appears here only when its normal mode needs its own calibration.
// Unlike the heroic table this one is PER MOB, because the floor-style targets
// below need different factors for trash, non-elite adds (no 1.5x elite swing
// multiplier), and bosses. The per-mob factor also drives mechanicDamageMult,
// so a boss's aoePulse/stomp scale with its own melee (../instances/difficulty.ts).
export interface NormalDungeonTuning {
  id: string;
  difficulty: Extract<DungeonDifficulty, 'normal'>;
  healthMultiplier: number;
  damageMultiplierByMob: Record<string, number>;
}

// Economy retune (v0.29): soloable normal Sanctum runs were printing up to 6
// gold per clear. Calibration target: every mob's health DOUBLES, and the
// minimum non-crit swing lands at least 300 (trash) / 600 (bosses) on the
// maximum-mitigation reference warrior: level-20 prot in the max-armor kit
// (full heroic plate + shield, prot mastery), 2861 armor, in Defensive Stance
// (takes 10% less), i.e. only ~37-38% of a raw swing gets through. Solving the
// floor per mob at its minimum spawn level gives the ladder below; the
// non-elite raised_bonewalker needs roughly double the trash factor because it
// lacks the 1.5x elite swing multiplier. Pinned by
// tests/gravewyrm_normal_tuning.test.ts, which also pins the heroic transform
// literals so a base-template edit cannot slip through unnoticed.
//
// Normal Nythraxis gets the same treatment (2x health, boss floor 600,
// skeleton waves floor 300, both landing at their level-20 spawns): the boss
// spawns from the arena spawn list and the waves through spawnNythraxisAdds,
// both of which pass this seam. Pinned by
// tests/heroic_difficulty_floors.test.ts.
export const NORMAL_DUNGEON_TUNING: Record<string, NormalDungeonTuning> = {
  gravewyrm_sanctum: {
    id: 'gravewyrm_sanctum',
    difficulty: 'normal',
    healthMultiplier: 2.0,
    damageMultiplierByMob: {
      sanctum_boneguard: 11.5,
      sanctum_drakonid: 11,
      raised_bonewalker: 23,
      korgath_the_bound: 19.5,
      grand_necromancer_velkhar: 20.5,
      korzul_the_gravewyrm: 19,
    },
  },
  nythraxis_boss_arena: {
    id: 'nythraxis_boss_arena',
    difficulty: 'normal',
    healthMultiplier: 2.0,
    damageMultiplierByMob: {
      nythraxis_scourge_of_thornpeak: 5,
      nythraxis_skeleton_warrior: 5,
    },
  },
};

export const HEROIC_DUNGEON_TUNING: Record<string, HeroicDungeonTuning> = {
  hollow_crypt: {
    id: 'hollow_crypt',
    difficulty: 'heroic',
    level: 22,
    healthMultiplier: 3.8,
    damageMultiplier: 20,
    // No hollow_crypt boss summons adds; kept at the half convention, inert.
    addDamageMultiplier: 10,
    armorMultiplier: 1.3,
    finalBossId: 'morthen',
    marksPerParticipant: 1,
  },
  sunken_bastion: {
    id: 'sunken_bastion',
    difficulty: 'heroic',
    level: 22,
    healthMultiplier: 4.0,
    damageMultiplier: 18,
    // Vael's drowned_thrall summons are non-elite: 32.5x lands their 500.
    addDamageMultiplier: 32.5,
    armorMultiplier: 1.3,
    finalBossId: 'vael_the_mistcaller',
    marksPerParticipant: 1,
  },
  drowned_temple: {
    id: 'drowned_temple',
    difficulty: 'heroic',
    level: 22,
    healthMultiplier: 5.2,
    damageMultiplier: 16.5,
    // Ysolei's moonspawn summons are non-elite: 30.5x lands their 500.
    addDamageMultiplier: 30.5,
    armorMultiplier: 1.25,
    finalBossId: 'ysolei',
    marksPerParticipant: 1,
  },
  gravewyrm_sanctum: {
    id: 'gravewyrm_sanctum',
    difficulty: 'heroic',
    level: 22,
    healthMultiplier: 4.0,
    damageMultiplier: 15.5,
    // Velkhar's raised_bonewalker summons are non-elite: 29x lands their 500.
    addDamageMultiplier: 29,
    // The Sanctum bosses must out-hit their retuned NORMAL selves (normal
    // floors them at 600 post-mitigation): 19x lands 652-708 versus the
    // dungeon-wide 15.5x, which would leave them at 532-578, UNDER normal.
    damageMultiplierByMob: {
      korgath_the_bound: 19,
      grand_necromancer_velkhar: 19,
      korzul_the_gravewyrm: 19,
    },
    armorMultiplier: 1.2,
    finalBossId: 'korzul_the_gravewyrm',
    marksPerParticipant: 1,
  },
  // The 10-player raid arena. The boss floors at 1200 post-mitigation on the
  // reference warrior (roughly 43% of his hp per 2.6s swing; a raid brings
  // two or three healers) via the dungeon-wide multiplier; the encounter-
  // script add waves are held to the five-man 500 line through the per-mob
  // map, because their base weapon damage spans a 2x spread (the priest add
  // swings less than half as hard as a Royal Guard). The percentage
  // mechanics scale on heroic in the encounter script (Soul Rend 1.5x,
  // Deathless Rage lethal on a failed wardstone channel; see
  // encounters/nythraxis.ts), and Gravebreaker derives from boss.weapon, so
  // both track this table without extra wiring. The attunement dungeon
  // nythraxis_crypt is story content and deliberately has NO heroic record.
  // The daily raid lockout is difficulty-scoped (the :heroic key beside the
  // plain dungeon id): one normal AND one heroic Nythraxis kill per day.
  nythraxis_boss_arena: {
    id: 'nythraxis_boss_arena',
    difficulty: 'heroic',
    level: 22,
    healthMultiplier: 3.2,
    damageMultiplier: 8.75,
    // The raid's add waves spawn through the encounter script
    // (encounters/nythraxis.ts), never spawnBossAdds, so this field is inert
    // there; it mirrors damageMultiplier to state that nothing is softened.
    addDamageMultiplier: 8.75,
    damageMultiplierByMob: {
      nythraxis_skeleton_warrior: 7.5,
      nythraxis_heroic_warrior_add: 7.5,
      nythraxis_heroic_priest_add: 16,
      nythraxis_heroic_rogue_add: 12.5,
    },
    armorMultiplier: 1.2,
    finalBossId: 'nythraxis_scourge_of_thornpeak',
    marksPerParticipant: 3,
  },
};
