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
  // Per-mob HEALTH override (same shape as the damage map): a mob listed here
  // takes this factor instead of the dungeon-wide healthMultiplier. Added for
  // the 2026-07-24 heroic Nythraxis nerf (skeleton waves at 1.2x their
  // NORMAL-mode pool instead of the raid-wide 3.2x).
  healthMultiplierByMob?: Record<string, number>;
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
// so a boss's aoePulse/stomp scale with its own melee (../instances/difficulty.ts),
// UNLESS the mob has a mechanicDamageMultiplierByMob override: that decouples an
// AVOIDABLE telegraphed mechanic from the unavoidable tank-swing calibration, so
// a skill check can stay lethal while melee intake is priced for the fresh tank.
export interface NormalDungeonTuning {
  id: string;
  difficulty: Extract<DungeonDifficulty, 'normal'>;
  healthMultiplier: number;
  damageMultiplierByMob: Record<string, number>;
  // Optional per-mob override for mechanicDamageMult only (aoePulse, stomp,
  // infernoChannel); a mob absent here falls back to its damageMultiplierByMob
  // factor. Keys must be a subset of damageMultiplierByMob (pinned by
  // tests/gravewyrm_normal_tuning.test.ts).
  mechanicDamageMultiplierByMob?: Record<string, number>;
  // Optional per-mob multiplier for a mob's RANGED petSpell nuke. Needed
  // because damageMultiplierByMob moves dmgBase/dmgPerLevel, which is MELEE
  // only, while a petSpell caster stands at spell range and casts instead of
  // swinging (mob/combat_profile.ts updateCasterCombat: "the chase-arm melee
  // probes are dead in practice"). For such a mob the melee factor is inert and
  // this is the factor that actually prices it. Rolled damage is unmitigated by
  // armor, so its floor is measured on the raw hit, not the tank's intake.
  // Keys must be a subset of damageMultiplierByMob, and every key must name a
  // template that actually HAS a petSpell (pinned by
  // tests/wildheart_normal_tuning.test.ts).
  rangedDamageMultiplierByMob?: Record<string, number>;
}

// Fresh-group retune (v0.30), pressure pass (2026-07-26): the first v0.30
// calibration (trash 90 / bosses 200 / adds 50 floors) fixed the unclearable
// v0.29 economy floors, but overshot soft: a fresh THREE-player group cleared
// the dungeon without pressure, because its Monte Carlo bench modeled the
// worst-case healer (autopilot, no cooldowns) and priced the floors so that
// worst case barely survived. This pass raises the minimum non-crit swing on
// the reference warrior (level-20 prot in the max-armor kit, 2861 armor,
// Defensive Stance) to at least 100 (trash, lands 103+) and 200 (bosses:
// Korgath 301 / Korzul 280, ~29-31% of a fresh tank pool per average swing;
// Velkhar is UNCHANGED at the 200 line, ~21%, because he was already the
// peak fight: he swings at 2.0s and layers his summon waves on top for a
// ~305 dtps wave-window peak), with the summoned bonewalkers still at 50
// (wave pressure, not extra bosses). Korgath and Korzul rise to MEET
// Velkhar: boss dtps on a fresh tank now runs ~179-193, pressed above a
// fresh healer's sustain so the tank loses ground without cooldowns; tanks
// are crit-immune since v0.29.1, so no swing can spike past the 1.25x roll
// cap (~38% of pool). Korzul's melee sits below Korgath's per-multiplier
// because he also carries the guaranteed inferno channel (the 50% hp gate)
// on top of his 30% enrage.
// Korzul additionally carries a mechanicDamageMultiplierByMob override: his
// Grave Inferno channel is fully avoidable (rooted boss, no melee during it,
// true-radius telegraph), so it prices at 15x, lethal to a ~1000hp fresh
// melee pool that stands all four pulses (1050-1350 raw) while pulse one
// stays a scratch; his melee stays on the tank calibration above. The
// DOUBLED health stays: the economy lever is clear time, not lethality.
// Pinned by tests/gravewyrm_normal_tuning.test.ts, which also pins the
// heroic transform literals so a base-template edit cannot slip through
// unnoticed.
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
      sanctum_boneguard: 3.8,
      sanctum_drakonid: 3.7,
      raised_bonewalker: 3.75,
      korgath_the_bound: 9.5,
      grand_necromancer_velkhar: 6.6,
      korzul_the_gravewyrm: 8.5,
    },
    mechanicDamageMultiplierByMob: {
      korzul_the_gravewyrm: 15,
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
  // Wildheart Basin shipped with a heroic record but NO normal one, so its
  // normal mode ran the raw base templates: trash swung 26-32 post-mitigation
  // on the reference warrior and Zulgar 35, against the Sanctum's 103-112 and
  // 200-301. That is 3.5x under on trash and 6-8x under on the boss, for a
  // dungeon whose loot and level sit in the same endgame band. This record puts
  // normal Wildheart on the SANCTUM NORMAL calibration: the same DOUBLED health
  // and the same reference warrior (level-20 prot, 2861 armor, Defensive
  // Stance), floored per band at trash 100 / boss 200.
  //
  // Two Wildheart-specific departures from the Sanctum table, both forced by
  // the roster rather than chosen:
  // 1. A third band at 150 for wildheart_beastmaster. It is a rare, ccImmune
  //    pack-leader that spawns TWICE and carries warcry + wardAllies + stomp,
  //    so it out-presses trash, but it is not the final boss and must not read
  //    as a third Zulgar. Nythraxis set the same precedent (its own 600/300
  //    bands rather than the five-man 500/250).
  // 2. rangedDamageMultiplierByMob for the two petSpell casters. HALF the
  //    20-spawn roster (stalker x6, hexcaller x4) is a ranged caster that never
  //    melees, so its damageMultiplierByMob factor is inert and its real output
  //    is a petSpell nuke no other knob reaches. Priced to the same 100 minimum
  //    hit as trash melee: unmitigated by armor and landable on any group
  //    member, which is what makes them the priority kill the content brief
  //    calls for. Their melee factors are still solved to the 100 floor so a
  //    caster cornered in melee range (the chase arm) is on-model too.
  //
  // Mechanics ride each mob's own melee factor with NO override, which is the
  // Sanctum default: Zulgar's Wildheart Pulse lands 170-243 raw every 9s
  // against Korgath's Shuddering Stomp at 190-285 every 12s, and the
  // beastmaster's Beast Pit Quake 88-130. Support scales on mechanicHealMult
  // (= healthMultiplier), so the hexcaller's Ancestral Sap heals 72-100 and
  // Thickhide Ward absorbs 140, both keeping pace with the doubled pools.
  // Pinned by tests/wildheart_normal_tuning.test.ts.
  wildheart_basin: {
    id: 'wildheart_basin',
    difficulty: 'normal',
    healthMultiplier: 2.0,
    damageMultiplierByMob: {
      wildheart_stalker: 3.7,
      wildheart_ravager: 3.15,
      wildheart_hexcaller: 3.9,
      wildheart_beastmaster: 4.2,
      wildheart_high_priest: 5.65,
    },
    rangedDamageMultiplierByMob: {
      wildheart_stalker: 2.7,
      wildheart_hexcaller: 2.5,
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
    // No hollow_crypt boss summons adds; inert, but rides the v0.30 40% add
    // nerf with the other heroics so a future summoner starts on-model.
    addDamageMultiplier: 6,
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
    // Vael's drowned_thrall summons are non-elite. v0.30: boss-summoned adds
    // hit 40% softer across every heroic five-man (the 250 floor drops to
    // 150); a tanked triple wave stacked on the boss was still overwhelming
    // healers after the 2026-07 retune.
    addDamageMultiplier: 9.75,
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
    // Ysolei's moonspawn summons are non-elite; 40% add nerf (v0.30), the
    // summoned floor drops from 250 to 150.
    addDamageMultiplier: 9.15,
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
    // Velkhar's raised_bonewalker summons are non-elite; 40% add nerf
    // (v0.30), the summoned floor drops from 250 to 150.
    addDamageMultiplier: 8.55,
    // The Sanctum bosses must out-hit their retuned NORMAL selves (normal
    // floors them at 200-301 post-mitigation since the v0.30 fresh-group
    // pressure pass): 19x lands 652-708, comfortably above.
    damageMultiplierByMob: {
      korgath_the_bound: 19,
      grand_necromancer_velkhar: 19,
      korzul_the_gravewyrm: 19,
    },
    armorMultiplier: 1.2,
    finalBossId: 'korzul_the_gravewyrm',
    marksPerParticipant: 1,
  },
  // Palmreach's open-field five-man. The broad route and two rare elites use
  // the same level-22 Heroic pin as the other endgame leveling dungeons.
  wildheart_basin: {
    id: 'wildheart_basin',
    difficulty: 'heroic',
    level: 22,
    healthMultiplier: 4.0,
    // Solved at the basin's weakest spawn-list mob (wildheart_hexcaller,
    // 455 post-mitigation at 15.5x): the open-field roster sits between
    // Orkadia's casters and the Sanctum band.
    damageMultiplier: 17.25,
    // No Wildheart boss summons adds; kept at the half convention, inert.
    addDamageMultiplier: 8.625,
    armorMultiplier: 1.2,
    finalBossId: 'wildheart_high_priest',
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
    // 2026-07-24 nerf: 7.25 lands the boss floor at ~1016 (was 8.75 / 1227).
    // The launch calibration one-shot tanks through the whole progression;
    // at 1000 the bench raid reaches phase 2 at 46-60% boss with worst-case
    // scripted play. Further nerfs, if live raids still cannot clear, come
    // as a morning hotfix from HERE, not from 1200.
    damageMultiplier: 7.25,
    // The raid's add waves spawn through the encounter script
    // (encounters/nythraxis.ts), never spawnBossAdds, so this field is inert
    // there; it mirrors damageMultiplier to state that nothing is softened.
    addDamageMultiplier: 7.25,
    // 2026-07 retune: the raid's add waves drop from the five-man 500 line to
    // the summoned 250 floor; their mechanics (Malric's ramping boss heal,
    // Aldren's cleave, Voss's taunt immunity) stay the real threat.
    damageMultiplierByMob: {
      nythraxis_skeleton_warrior: 3.75,
      nythraxis_heroic_warrior_add: 3.75,
      nythraxis_heroic_priest_add: 8,
      nythraxis_heroic_rogue_add: 6,
    },
    // Skeleton waves at 1.2x their NORMAL-mode pool (3,768 vs 3,137): phase 1
    // must stop out-massing the boss (a six-wave phase 1 at the raid-wide 3.2x
    // carried more add HP than the 30% boss push it gated). The heroic court
    // trio deliberately keeps the full 3.2x: measured off the critical path,
    // and its respawn gate (only after the previous court dies) self-limits.
    healthMultiplierByMob: {
      nythraxis_skeleton_warrior: 2.22,
    },
    armorMultiplier: 1.2,
    finalBossId: 'nythraxis_scourge_of_thornpeak',
    marksPerParticipant: 3,
  },
};
