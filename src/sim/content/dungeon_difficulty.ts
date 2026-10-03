import { IGNIVAR_FORGE_APPROACH_ID, IGNIVAR_MOLTEN_ASSEMBLY_ID } from '../ignivar_raid_ids';
import type { DungeonDifficulty } from '../types';

// The participation token awarded directly to every eligible player when a
// heroic final boss dies (see awardHeroicMarks in ../instances/dungeons.ts).
// The item record lives in ./items.ts.
export const HEROIC_MARK_ITEM_ID = 'heroic_mark';

// Heroic finale gold: a heroic-claim kill of a dungeon's final boss pays a
// raised money base through LootEntry.heroicCopper (the roller substitutes
// it for the normal copper base on the same single rng draw). Heroic runs
// sit behind the per-dungeon daily lockout, so this rewards the legitimate
// clear while the modest normal-mode bases stay the anti-farm line.
// Five-man finales pay 10g nominal (rolls 6g to 14g); a raid finale
// (Nythraxis, and the Ignivar herald with it) pays 20g nominal (rolls 12g
// to 28g). Full ladder + the daily circuit ceiling:
// docs/design/dungeon-gold.md; pinned by tests/heroic_finale_gold.test.ts.
export const HEROIC_FINALE_COPPER = 100000;
export const NYTHRAXIS_HEROIC_COPPER = 200000;

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
  // Optional per-mob overrides for encounter mechanics that must be decoupled
  // from melee after the level-22 transform.
  mechanicDamageMultiplierByMob?: Record<string, number>;
  burnDamageMultiplierByMob?: Record<string, number>;
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

export type HeroicMobTuning = Omit<HeroicDungeonTuning, 'finalBossId' | 'marksPerParticipant'>;

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
// 600), and the Nythraxis raid boss instead rides its own calibration (see
// the per-mob comment on nythraxis_boss_arena below) with its add waves held
// to the 500 line per mob. Mechanic damage lands RAW (no armor step; see
// aoePulse/stomp in ../mob/locomotion.ts) and scales with the mob's own
// multiplier via mechanicDamageMult; support heals scale with
// mechanicHealMult (= healthMultiplier); both wired in
// ../instances/difficulty.ts. Gravebreaker (the raid boss frontal) derives
// from boss.weapon, so it scales through the template transform on its own.
// Floors are pinned by tests/heroic_difficulty_floors.test.ts.
// Provenance (qr-19-ref-armor-calibration-constant, 2026-09-01): 2861 is a
// PINNED constant, not a live measurement of the catalog. The committed
// max-armour kit pins at 4085 (tests/heroic_difficulty_floors.test.ts), and
// whether 2861 was ever the raw kit armour or a prot-mastery-folded reading is
// UNSETTLED, so it is not re-based here and rides the packet's R5 re-measure.
// The ~39.8% above reads about 32.1% on the 4085 kit.
//
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
  // Optional per-mob health override (the heroic table has the same field): a
  // boss whose health pool is set on its own while the adds keep the shared
  // multiplier (Nythraxis, 2026-09-04).
  healthMultiplierByMob?: Record<string, number>;
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
// Provenance (qr-19-ref-armor-calibration-constant, 2026-09-01): 2861 is a
// PINNED constant, not a live measurement of the catalog. The committed
// max-armour kit pins at 4085 (tests/heroic_difficulty_floors.test.ts), and
// whether 2861 was ever the raw kit armour or a prot-mastery-folded reading is
// UNSETTLED, so it is not re-based here and rides the packet's R5 re-measure.
// The 100 and 200 lines above are measured on 2861, not on the 4085 kit.
export const NORMAL_DUNGEON_TUNING: Record<string, NormalDungeonTuning> = {
  [IGNIVAR_FORGE_APPROACH_ID]: {
    id: IGNIVAR_FORGE_APPROACH_ID,
    difficulty: 'normal',
    healthMultiplier: 1,
    damageMultiplierByMob: {
      derelict_mech: 1.5,
      ignivar_ember_sentinel: 1.5,
      ignivar_crucible_warden: 1.5,
    },
    mechanicDamageMultiplierByMob: {
      derelict_mech: 1.25,
      ignivar_ember_sentinel: 1.5,
      ignivar_crucible_warden: 2,
    },
  },
  [IGNIVAR_MOLTEN_ASSEMBLY_ID]: {
    id: IGNIVAR_MOLTEN_ASSEMBLY_ID,
    difficulty: 'normal',
    healthMultiplier: 1,
    damageMultiplierByMob: {
      derelict_mech: 1.5,
      ignivar_ember_sentinel: 1.5,
      ignivar_crucible_warden: 1.5,
    },
    mechanicDamageMultiplierByMob: {
      derelict_mech: 1.25,
      ignivar_ember_sentinel: 1.5,
      ignivar_crucible_warden: 2,
    },
  },
  // The Ice Tomb rework (docs/design/dungeon-rework/gravewyrm_sanctum.md): the
  // pools come from target fight length x planning party DPS at level 20
  // (about 150): the Sledge Tusker 60 s (about 9,000), Korgath 80 s on his
  // body (about 12,000; phase B adds his four Seal Shackles), Velkhar 100 s
  // (about 15,000), Korzul 160 s on the ground (about 24,000). The new trash
  // swings on the trash floor (100), the non-elite Rime Whelps in the 50 band,
  // the Tusker in the 150 band; every new kit mechanic (the Scaleguard's
  // Cinder Breath among them) is stated LANDED (factor 1).
  gravewyrm_sanctum: {
    id: 'gravewyrm_sanctum',
    difficulty: 'normal',
    healthMultiplier: 2.0,
    healthMultiplierByMob: {
      sledge_tusker: 5.43,
      // Korgath's body about 12,000 (80 s), plus his four Seal Shackles at
      // about 1,500 each (encounters/gravewyrm_sanctum/korgath.ts): about 105 s
      // with all four broken, longer the more chains the group leaves on.
      korgath_the_bound: 5.53,
      sanctum_shackle_hammer: 2,
      sanctum_shackle_tongs: 2,
      sanctum_shackle_anvil: 2,
      sanctum_shackle_bellows: 2,
      grand_necromancer_velkhar: 7.61,
      korzul_the_gravewyrm: 7.83,
    },
    damageMultiplierByMob: {
      sanctum_boneguard: 3.8,
      sanctum_drakonid: 3.7,
      raised_bonewalker: 3.75,
      broodsworn_thawcaller: 3.8,
      broodsworn_goadsmith: 3.8,
      broodsworn_pyre_tender: 3.8,
      rime_whelp: 4,
      ogre_sledge_hauler: 3.4,
      glacier_splinter: 3.7,
      sledge_tusker: 4.8,
      korgath_the_bound: 9.5,
      grand_necromancer_velkhar: 6.6,
      korzul_the_gravewyrm: 8.5,
    },
    mechanicDamageMultiplierByMob: {
      sanctum_drakonid: 1,
      broodsworn_thawcaller: 1,
      broodsworn_goadsmith: 1,
      broodsworn_pyre_tender: 1,
      rime_whelp: 1,
      ogre_sledge_hauler: 1,
      glacier_splinter: 1,
      sledge_tusker: 1,
      // Korgath's chain kit is stated LANDED (KORGATH_TUNING).
      korgath_the_bound: 1,
      // Velkhar's Soulfire Trench and Shadow Volley are stated LANDED.
      grand_necromancer_velkhar: 1,
      // His whole kit (encounters/gravewyrm_sanctum/korzul.ts) is stated
      // LANDED: Grave Breath, the Inferno's pulses, the flights, the water.
      korzul_the_gravewyrm: 1,
    },
  },
  nythraxis_boss_arena: {
    id: 'nythraxis_boss_arena',
    difficulty: 'normal',
    healthMultiplier: 2.0,
    // The boss alone: 160,000 on the 60,000 template (owner call for the
    // mechanics redo, 2026-09-04; was the shared 2.0 for 120,000). Adds and
    // the Bone Spikes keep the shared multiplier; the heroic row's
    // nythraxis_bone_spike override deliberately MIRRORS this 2.0 (same
    // template pool), but since v0.42.2 a spike is a ward whose pool is its
    // HIT COUNT, set at spawn (nythraxis_bone_spike.ts nythraxisBoneSpikeHits);
    // this multiplier no longer decides anything a player sees.
    healthMultiplierByMob: {
      // 120,000 after the first playtest (2026-09-04; the redo tried 160,000).
      nythraxis_scourge_of_thornpeak: 120_000 / 60_000,
    },
    // Boss-only melee retune (2026-09-07): raw swing 257..402, ~90% of
    // normal Ignivar's own boss (286..446, unmultiplied). Skeletons untouched.
    damageMultiplierByMob: {
      nythraxis_scourge_of_thornpeak: 1.132,
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
  // Provenance (qr-19-ref-armor-calibration-constant, 2026-09-01): 2861 is a
  // PINNED constant, not a live measurement of the catalog. The committed
  // max-armour kit pins at 4085 (tests/heroic_difficulty_floors.test.ts), and
  // whether 2861 was ever the raw kit armour or a prot-mastery-folded reading is
  // UNSETTLED, so it is not re-based here and rides the packet's R5 re-measure.
  // The trash 100 / boss 200 bands above are measured on 2861.
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
  // The Sunken Bastion rework (docs/design/dungeon-rework/sunken_bastion.md):
  // a health-only record. The bosses' pools come from target fight length x
  // planning party DPS at levels 12 to 13 (about 75): Olen 80 s (about 6,000),
  // Ossick 85 s (about 6,800), Vael 150 s (about 12,000), and the Turretback
  // Hermit 60 s (about 4,500). Everything else keeps its raw template, so the
  // mechanics land at their authored normal numbers.
  sunken_bastion: {
    id: 'sunken_bastion',
    difficulty: 'normal',
    healthMultiplier: 1,
    healthMultiplierByMob: {
      knight_commander_olen: 6.42,
      gaoler_ossick: 6.84,
      vael_the_mistcaller: 8.05,
      turretback_hermit: 3.66,
      // The gaol's miniboss: 50 s (about 3,600) on the Hermit's template pool.
      gaol_turnkey: 2.93,
    },
    // The crawler and the prisoner carry a heroic-priced base swing (see
    // their templates); normal damps it back to the fodder line.
    damageMultiplierByMob: {
      barnacle_crawler: 0.345,
      shackled_prisoner: 0.345,
    },
    // ...but the damp is melee only: Brine Burst keeps its authored number.
    mechanicDamageMultiplierByMob: {
      barnacle_crawler: 1,
      shackled_prisoner: 1,
    },
  }, // The Drowned Temple rework (docs/design/dungeon-rework/drowned_temple.md):
  // a health-only record. The bosses' pools come from target fight length x
  // planning party DPS at levels 16 to 18 (about 110 to 120): Selthe 90 s
  // (about 9,900), the Tideglass Colossus 100 s (about 11,500), Ysolei 150 s
  // (about 18,000), and the Mere Hydra's three heads about 2,000 each (55 s
  // for the three). Everything else keeps its raw template, so the mechanics
  // land at their authored normal numbers.
  drowned_temple: {
    id: 'drowned_temple',
    difficulty: 'normal',
    healthMultiplier: 1,
    healthMultiplierByMob: {
      choirmother_selthe: 7.97,
      tideglass_colossus: 7.35,
      ysolei: 8.27,
      mere_hydra_head_left: 1.38,
      mere_hydra_head_center: 1.38,
      mere_hydra_head_right: 1.38,
    },
    damageMultiplierByMob: {},
  },

  // The rework (docs/design/dungeon-rework/wildheart_basin.md): the bosses'
  // pools come from target fight length x planning party DPS at level 20
  // (about 150): the Great Saurian 65 s (about 10,000), the Beastmaster and
  // his jaguar 100 s on ONE shared pool (about 15,000, both bodies sized to
  // it: encounters/wildheart_basin/beastmaster.ts), the Gorgebloom 100 s
  // (about 15,000), Zulgar 160 s (about 24,800).
  // The Beastmaster leaves the old 150 rare band for the boss band (200);
  // the jaguar and the Saurian swing in the 150 band, the non-elite raptors
  // (they come in fours) in the 50 band, the rest of the new trash (the
  // Gorgebloom's Thorn Sprouts too) on the trash floor. The kit mechanics,
  // the three bosses' included, are stated LANDED (factor 1).
  wildheart_basin: {
    id: 'wildheart_basin',
    difficulty: 'normal',
    healthMultiplier: 2.0,
    healthMultiplierByMob: {
      great_saurian: 6.04,
      wildheart_beastmaster: 7.82,
      fanglord_jaguar: 9.46,
      the_gorgebloom: 8.47,
      wildheart_high_priest: 7.21,
    },
    damageMultiplierByMob: {
      wildheart_stalker: 3.7,
      wildheart_ravager: 3.15,
      wildheart_hexcaller: 3.9,
      sunbone_totem_binder: 3.75,
      sunbone_totem: 1,
      basin_raptor: 3.45,
      spore_toad: 4,
      vine_lasher: 3.45,
      great_saurian: 4.8,
      howdah_hexcaller: 3.9,
      thorn_sprout: 3.9,
      wildheart_beastmaster: 5.55,
      fanglord_jaguar: 4.6,
      the_gorgebloom: 6.4,
      wildheart_high_priest: 5.65,
    },
    mechanicDamageMultiplierByMob: {
      sunbone_totem_binder: 1,
      sunbone_totem: 1,
      basin_raptor: 1,
      spore_toad: 1,
      vine_lasher: 1,
      great_saurian: 1,
      howdah_hexcaller: 1,
      thorn_sprout: 1,
      wildheart_beastmaster: 1,
      fanglord_jaguar: 1,
      the_gorgebloom: 1,
      wildheart_high_priest: 1,
    },
    rangedDamageMultiplierByMob: {
      wildheart_stalker: 2.7,
      wildheart_hexcaller: 2.5,
      howdah_hexcaller: 2.5,
    },
  },
};

// These rooms support Heroic mob transforms but are not finale instances:
// they must not carry final-boss rewards or lockouts. Keeping them outside
// HEROIC_DUNGEON_TUNING scopes the pressure pass to the two preboss spawn
// lists and prevents Varkhul's encounter summons from inheriting it.
export const HEROIC_MOB_TUNING: Record<string, HeroicMobTuning> = {
  [IGNIVAR_FORGE_APPROACH_ID]: {
    id: IGNIVAR_FORGE_APPROACH_ID,
    difficulty: 'heroic',
    level: 22,
    healthMultiplier: 5 / 3,
    healthMultiplierByMob: {
      ignivar_ember_sentinel: 2,
      ignivar_crucible_warden: 2,
    },
    damageMultiplier: 1,
    addDamageMultiplier: 1,
    damageMultiplierByMob: {
      derelict_mech: 2,
      ignivar_ember_sentinel: 2,
      ignivar_crucible_warden: 2,
    },
    mechanicDamageMultiplierByMob: {
      derelict_mech: 1.75,
      ignivar_ember_sentinel: 2,
      ignivar_crucible_warden: 4,
    },
    burnDamageMultiplierByMob: {
      ignivar_ember_sentinel: 2,
    },
    armorMultiplier: 1.2,
  },
  [IGNIVAR_MOLTEN_ASSEMBLY_ID]: {
    id: IGNIVAR_MOLTEN_ASSEMBLY_ID,
    difficulty: 'heroic',
    level: 22,
    healthMultiplier: 5 / 3,
    healthMultiplierByMob: {
      ignivar_ember_sentinel: 2,
      ignivar_crucible_warden: 2,
    },
    damageMultiplier: 1,
    addDamageMultiplier: 1,
    damageMultiplierByMob: {
      derelict_mech: 2,
      ignivar_ember_sentinel: 2,
      ignivar_crucible_warden: 2,
    },
    mechanicDamageMultiplierByMob: {
      derelict_mech: 1.75,
      ignivar_ember_sentinel: 2,
      ignivar_crucible_warden: 4,
    },
    burnDamageMultiplierByMob: {
      ignivar_ember_sentinel: 2,
    },
    armorMultiplier: 1.2,
  },
};

// Heroic Varkhul, Master's Assembly (the 50% add intermission): the factor on
// the three summoned add pools, on top of the per-role progression below.
// 1 restores the 2026-08-24 tuning that no live raid has cleared; 0.7 is the
// 2026-09 "very difficult, not impossible" line (rationale on the record).
export const VARKHUL_HEROIC_ADD_HEALTH_RETUNE = 0.7;

export const HEROIC_DUNGEON_TUNING: Record<string, HeroicDungeonTuning> = {
  hollow_crypt: {
    id: 'hollow_crypt',
    difficulty: 'heroic',
    level: 22,
    healthMultiplier: 3.8,
    damageMultiplier: 20,
    // The rework's wing bosses summon non-elite adds (Sexton Marrow's
    // restless_bones at his Burial Toll, Rimeweb's hatchlings at her Brood
    // Call): lifted onto the shared 150 summoned-add floor with the other
    // heroics (tests/heroic_difficulty_floors.test.ts).
    addDamageMultiplier: 9.5,
    // Spawn-list trash below the 500 heroic mob floor on the shared factor is
    // lifted onto it on its own: the lighter-swinging casters and cutthroat,
    // and the NON-elite Carrion Crows (no 1.5x elite swing) of the flocks.
    damageMultiplierByMob: {
      crypt_gravecaller_adept: 24,
      crypt_gravecaller_necromancer: 24,
      crypt_crow_caller: 24,
      crypt_ossuary_cutthroat: 23,
      crypt_carrion_crow: 66,
    },
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
    // The rework (docs/design/dungeon-rework/sunken_bastion.md): the bosses'
    // pools set per boss from target fight length x heroic party DPS (about
    // 230): Olen 80 s, Ossick 85 s, Vael 150 s; the Turretback Hermit 60 s.
    healthMultiplierByMob: {
      knight_commander_olen: 12,
      gaoler_ossick: 12.75,
      vael_the_mistcaller: 15.7,
      turretback_hermit: 7.3,
      gaol_turnkey: 5.84,
    },
    // The light trash (the warhound, the ranged arbalest and the ward-casting
    // mistweaver) carry softer templates; lift them to the 500 heroic floor.
    damageMultiplierByMob: {
      bastion_warhound: 19.6,
      fogbound_arbalest: 21.6,
      mistweaver: 21.6,
    },
    // Avoidable mechanics priced apart from the tank-swing floor: a missed
    // trash dodge costs a cloth wearer about 40 percent (1,250 at level 20
    // heroic), a fumbled boss core is lethal, an unavoidable pulse 15 percent.
    mechanicDamageMultiplierByMob: {
      drowned_watchman: 8,
      fogbound_arbalest: 8,
      barnacle_crawler: 8,
      bastion_warhound: 8,
      turretback_hermit: 8,
      knight_commander_olen: 6,
      gaoler_ossick: 6,
      vael_the_mistcaller: 6,
      gaol_turnkey: 6,
    },
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
    // The rework (docs/design/dungeon-rework/drowned_temple.md): the bosses'
    // pools set per boss from target fight length x heroic party DPS (about
    // 230): Selthe 90 s, the Colossus 100 s, Ysolei 150 s, the Hydra's heads
    // 55 s for the three.
    healthMultiplierByMob: {
      choirmother_selthe: 12.9,
      tideglass_colossus: 12.05,
      ysolei: 13.66,
      mere_hydra_head_left: 2.4,
      mere_hydra_head_center: 2.4,
      mere_hydra_head_right: 2.4,
    },
    // The fodder pilgrims and the ranged siren carry softer templates; lift
    // them to the 500 heroic floor.
    damageMultiplierByMob: {
      drowned_pilgrim: 27,
      moonlit_siren: 17.5,
    },
    // Avoidable mechanics priced apart from the tank-swing floor: a missed
    // trash dodge costs a cloth wearer about 40 percent (1,250 at level 20
    // heroic), a fumbled boss core is lethal, an unavoidable pulse 15 percent.
    mechanicDamageMultiplierByMob: {
      drowned_templeguard: 5.5,
      lagoon_snapper: 5.5,
      lagoon_eel: 5.5,
      glimmerscale_lurker: 5.5,
      tidewisp: 5.5,
      mere_hydra_head_left: 6,
      mere_hydra_head_center: 6,
      mere_hydra_head_right: 6,
      choirmother_selthe: 4.5,
      tideglass_colossus: 5,
      ysolei: 5,
    },
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
    // The Ice Tomb rework's pools from target fight length x heroic party DPS
    // (about 230): the Sledge Tusker 60 s, Korgath 105 s, Velkhar 100 s,
    // Korzul 160 s on the ground (phase B retunes them with their cores).
    healthMultiplierByMob: {
      sledge_tusker: 7.69,
      // Korgath's body 80 s (about 18,400) plus four shackles of about 2,300.
      korgath_the_bound: 7.87,
      sanctum_shackle_hammer: 3.07,
      sanctum_shackle_tongs: 3.07,
      sanctum_shackle_anvil: 3.07,
      sanctum_shackle_bellows: 3.07,
      grand_necromancer_velkhar: 10.83,
      korzul_the_gravewyrm: 11.2,
    },
    damageMultiplierByMob: {
      korgath_the_bound: 19,
      grand_necromancer_velkhar: 19,
      korzul_the_gravewyrm: 19,
      // The lighter-swinging cultists and the NON-elite Rime Whelps are lifted
      // onto the 500 floor on their own.
      broodsworn_thawcaller: 16.6,
      broodsworn_pyre_tender: 16.6,
      rime_whelp: 30.5,
    },
    // Avoidable mechanics priced apart from the tank-swing floor: a missed
    // trash dodge costs a heroic cloth wearer about 40 percent, the Tusker's
    // avoidables about 45 percent (the five-man heroic convention).
    mechanicDamageMultiplierByMob: {
      sanctum_drakonid: 3,
      broodsworn_thawcaller: 3,
      broodsworn_goadsmith: 3,
      broodsworn_pyre_tender: 3,
      rime_whelp: 3,
      ogre_sledge_hauler: 3,
      glacier_splinter: 3,
      sledge_tusker: 2.5,
      // Korgath's chain kit: a missed avoidable costs a heroic cloth wearer
      // about 45 percent, a fumbled Strain or Stomp about 55 (the five-man
      // heroic boss convention).
      korgath_the_bound: 2.5,
      // The bosses' telegraphed mechanics on the five-man heroic factor.
      grand_necromancer_velkhar: 2.5,
      // Korzul's landed kit at the five-man heroic boss factor (the
      // quench-water lands 60 x 2.5 = 150 a second, design 6.3).
      korzul_the_gravewyrm: 2.5,
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
    // The kit adds (the Sunbone Totems, the Howdah Hexcaller, the Gorgebloom's
    // Thorn Sprouts) ride the trash kit's spawner, never summonAdds; kept at
    // the half convention.
    addDamageMultiplier: 8.625,
    // The rework's pools from target fight length x heroic party DPS (about
    // 230): the Saurian 65 s, the Beastmaster and his jaguar 100 s on one
    // shared pool (about 23,000), the Gorgebloom 100 s, Zulgar 160 s.
    healthMultiplierByMob: {
      great_saurian: 8.36,
      wildheart_beastmaster: 11.04,
      fanglord_jaguar: 13.34,
      the_gorgebloom: 12.05,
      wildheart_high_priest: 9.98,
    },
    // The non-elite raptors are lifted onto the 500 floor on their own.
    damageMultiplierByMob: {
      basin_raptor: 30.5,
    },
    // Avoidable mechanics priced apart from the tank-swing floor: a missed
    // trash dodge costs a heroic cloth wearer about 40 percent, the Saurian's
    // and the three bosses' avoidables about 45 percent (the five-man heroic
    // convention): their mechanics are stated landed on normal, so 2.5x here.
    mechanicDamageMultiplierByMob: {
      sunbone_totem_binder: 3,
      sunbone_totem: 3,
      basin_raptor: 3,
      spore_toad: 3,
      vine_lasher: 3,
      howdah_hexcaller: 3,
      thorn_sprout: 3,
      great_saurian: 2.5,
      wildheart_beastmaster: 2.5,
      fanglord_jaguar: 2.5,
      the_gorgebloom: 2.5,
      wildheart_high_priest: 2.5,
    },
    armorMultiplier: 1.2,
    finalBossId: 'wildheart_high_priest',
    marksPerParticipant: 1,
  },
  // The 10-player raid arena. The encounter-script add waves are held to the
  // five-man 500 line through the per-mob map, because their base weapon
  // damage spans a 2x spread (the priest add swings less than half as hard as
  // a Royal Guard). The percentage mechanics scale on heroic in the
  // encounter script (Soul Rend 1.5x, Deathless Rage lethal on a failed
  // wardstone channel; see encounters/nythraxis.ts), and Gravebreaker derives
  // from boss.weapon, so both track this table without extra wiring. The
  // attunement dungeon nythraxis_crypt is story content and deliberately has
  // NO heroic record. The daily raid lockout is difficulty-scoped (the
  // :heroic key beside the plain dungeon id): one normal AND one heroic
  // Nythraxis kill per day.
  //
  // Boss-only melee retune (2026-09-07): raw swing 367..573 via its own
  // damageMultiplierByMob entry below, ~90% of heroic Varkhul's own boss
  // (407..637). damageMultiplier (7.25) is no longer read by the boss;
  // percentage mechanics (Dread Curse, Soul Rend, fire patches) stay
  // unchanged. Gravebreaker's splash follows the reduced swing.
  nythraxis_boss_arena: {
    id: 'nythraxis_boss_arena',
    difficulty: 'heroic',
    level: 22,
    healthMultiplier: 3.2,
    damageMultiplier: 7.25,
    // The raid's add waves spawn through the encounter script
    // (encounters/nythraxis.ts), never spawnBossAdds, so this field is inert
    // there; it mirrors damageMultiplier to state that nothing is softened.
    addDamageMultiplier: 7.25,
    // 2026-07 retune: the raid's add waves drop from the five-man 500 line to
    // the summoned 250 floor; their mechanics (Malric's ramping boss heal,
    // Aldren's cleave, Voss's taunt immunity) stay the real threat.
    damageMultiplierByMob: {
      nythraxis_scourge_of_thornpeak: 1.488,
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
      // Bone Spikes are a DPS target-switch check, not a health sponge: the
      // SAME 1,000 pool as normal (owner call, 2026-09-10; the redo shipped
      // 1.5x at 1,500). Heroic already stacks one more victim per cast, a
      // shorter cadence, a faster drain, and level-22 spikes the level-20 raid
      // misses more often, so a bigger pool on top compounded into an
      // overtuned check. The 2.0 mirrors the normal table's shared multiplier
      // instead of falling through to the raid-wide 3.2x.
      nythraxis_bone_spike: 2.0,
      // The boss alone: 192,000 on the 60,000 template (owner call after the
      // first playtest, 2026-09-04; the redo tried 230,000).
      nythraxis_scourge_of_thornpeak: 192_000 / 60_000,
    },
    armorMultiplier: 1.2,
    finalBossId: 'nythraxis_scourge_of_thornpeak',
    marksPerParticipant: 3,
  },
  // Ignivar's development raid tier. This record makes an explicit Heroic
  // claim possible while Normal continues to use the untouched base template.
  // The multipliers remain provisional while full-raid telemetry is gathered.
  // A parse-calibrated full-BiS raid simulation reduced the initial health and
  // damage values, which prevented every tested composition from killing.
  // Damage tuning applies to spawn-time weapon values. Encounter-owned max-HP
  // mechanics keep their authored percentages. The Heart has no attacks, so its
  // add multiplier is currently an inert mirror of the dungeon-wide value.
  ignivar_raid_arena: {
    id: 'ignivar_raid_arena',
    difficulty: 'heroic',
    level: 22,
    healthMultiplier: 1.75,
    damageMultiplier: 2,
    addDamageMultiplier: 2,
    armorMultiplier: 1.2,
    finalBossId: 'ignivar_herald_of_the_last_flame',
    marksPerParticipant: 3,
  },
  ignivar_inner_crucible: {
    id: 'ignivar_inner_crucible',
    difficulty: 'heroic',
    level: 22,
    healthMultiplier: 5 / 3,
    // Boss: 120k -> 200k. Add overrides pin the per-role Heroic progression
    // after the shared level transform (Sentinel +20%, Warden +25%, Artificer
    // +30% over their level-22 pools), then apply the 2026-09 adds-phase retune.
    // The 1200 / 1395 / 2170 figures are pre-elite: createMob multiplies every
    // elite pool by 2.3, so the spawned Heroic adds were 3,312 / 4,011 / 6,488
    // (88,500 HP across the 20 wave adds and 3 Artificers of the Master's
    // Assembly, 1,264 raid DPS with zero downtime inside the 70 s cap).
    // Live raids realize a median 696 DPS on those adds (best pull 865), and
    // no Heroic Varkhul pull has finished the intermission; a Monte Carlo of
    // the shipped encounter (tmp study, 2026-09-06) needed about 1,240 realized
    // add DPS for a coin flip even with perfect beam soaks and interrupts.
    // VARKHUL_HEROIC_ADD_HEALTH_RETUNE scales the three intermission adds to
    // 0.7x (2,318 / 2,807 / 4,542, 61,950 HP, 885 zero-downtime DPS, still
    // above Normal's 824 and still a hard check where Normal's meltdown is
    // survivable). Measured with perfect execution: the raid wiping today
    // clears about one pull in eight, a raid at its Heroic Ignivar output
    // about four in five. Timers, wave count, heat and the meltdown are
    // deliberately untouched: a longer cap alone spawns more Artificers and
    // more heat, and did not help. Pinned by tests/ignivar_varkhul_health.test.ts.
    healthMultiplierByMob: {
      ignivar_ember_sentinel: ((1200 * 1.2) / 1300) * VARKHUL_HEROIC_ADD_HEALTH_RETUNE,
      ignivar_crucible_warden: ((1395 * 1.25) / 1505) * VARKHUL_HEROIC_ADD_HEALTH_RETUNE,
      ignivar_cinder_artificer: ((2170 * 1.3) / 2330) * VARKHUL_HEROIC_ADD_HEALTH_RETUNE,
    },
    damageMultiplier: (251.5 * 1.35) / 272.5,
    addDamageMultiplier: 1,
    damageMultiplierByMob: {
      ignivar_ember_sentinel: (101.8 * 1.25) / 110.2,
      ignivar_crucible_warden: (92.2 * 1.25) / 99.8,
      ignivar_cinder_artificer: 1,
    },
    mechanicDamageMultiplierByMob: {
      ignivar_ember_sentinel: 1.25,
    },
    burnDamageMultiplierByMob: {
      ignivar_ember_sentinel: 1.25,
    },
    armorMultiplier: 1.2,
    finalBossId: 'varkhul_forgefather_of_the_last_flame',
    marksPerParticipant: 3,
  },
};
