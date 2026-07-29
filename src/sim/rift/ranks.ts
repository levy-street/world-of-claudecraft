// Rift rank (C/B/A/S) tuning: the one place a rift's baseLevel is turned into
// rank-driven difficulty. Every consumer (the floor generator's mob levels, the
// spawn-time stat transform, the boss mechanic budget, the one-shot
// hazard gate) derives the SAME rank from the descriptor's baseLevel, so the
// authoritative sim, the offline sim, and the headless env all regenerate
// identical difficulty from the wire descriptor. Natural portals map tier ->
// baseLevel via RIFT_RANK_BASE_LEVEL (portals.ts reads it back), and a /dev
// portal picks its rank implicitly through the level it was opened at.
//
// Pure leaf: no SimContext; a Vitest imports it directly.

import { MOBS } from '../data';
import type { Entity, MobTemplate, RiftTier } from '../types';

/** Canonical rank -> portal baseLevel map (portals.ts RIFT_TIER_INFO consumes
 * this, and riftRankForBaseLevel inverts it). */
export const RIFT_RANK_BASE_LEVEL: Record<RiftTier, number> = { C: 20, B: 22, A: 25, S: 28 };

/** The rank a descriptor baseLevel encodes (inverse of RIFT_RANK_BASE_LEVEL,
 * banded so a /dev portal at any level lands in the nearest rank). */
export function riftRankForBaseLevel(baseLevel: number): RiftTier {
  if (baseLevel >= RIFT_RANK_BASE_LEVEL.S) return 'S';
  if (baseLevel >= RIFT_RANK_BASE_LEVEL.A) return 'A';
  if (baseLevel >= RIFT_RANK_BASE_LEVEL.B) return 'B';
  return 'C';
}

// Mob levels by rank. C ramps from its baseLevel (20) and stays inside the
// classic fairness cap (22, two above the level-20 player cap, matching the
// heroic dungeon pin). B, A, and S all hold the 22 cap; their additional
// difficulty comes from the heroic stat transform below. S is additionally
// nudged to flat 23 on every floor, one step above the fairness cap, to
// signal that S-rank is the hardest tier while keeping its mobs at a level
// where the heroic stat transform does the heavy lifting. Giantslayer (+5-level
// kill) is no longer earnable inside S-rank rifts as a result (the maintainer
// explicitly accepted this in v0.23.0 rank retune).
export const RIFT_LEVEL_CAP = 22;
export const RIFT_S_LEVEL = 23;
/** The highest level any rift mob can spawn at (flat S-rank level). Also the
 * game-wide creditable-mob ceiling pinned by deeds (MAX_CREDITABLE_MOB_LEVEL). */
export const RIFT_MAX_MOB_LEVEL = 23;

/** Mob level for a floor: C ramps baseLevel + floorIndex under cap 22;
 * B and A hold a flat 22; S holds a flat 23 on every floor. */
export function riftFloorLevel(baseLevel: number, floorIndex: number): number {
  const rounded = Math.round(baseLevel);
  if (riftRankForBaseLevel(rounded) === 'S') {
    return RIFT_S_LEVEL;
  }
  return Math.max(1, Math.min(RIFT_LEVEL_CAP, rounded + floorIndex));
}

/** How many of a boss template's `rankMechanics` are live per rank. */
export const RIFT_RANK_MECHANIC_BUDGET: Record<RiftTier, number> = { C: 1, B: 2, A: 3, S: 4 };

// The set of driver keys that rank-gating governs. Any key in this set that a
// kit-carrying boss does NOT list in rankMechanics is treated as suppressed at
// all ranks (the displaced-mechanic budget escape fix). Keys absent from this
// set (enrage, knockback, cleave, passive on-hits) are never gated.
const GATED_DRIVER_KEYS = new Set([
  'aoePulse',
  'aoeSlow',
  'bigCast',
  'stoneskin',
  'stomp',
  'terrify',
  'summonAdds',
  'desperateHeal',
  'deathZoneCast',
  'deathZoneStrike',
  'infernoChannel',
]);

export function riftMechanicSuppressed(mob: Entity, key: string): boolean {
  const limit = mob.riftMechanicLimit;
  if (limit === undefined) return false;
  const order = MOBS[mob.templateId]?.rankMechanics;
  if (!order) return false;
  const index = order.indexOf(key);
  // Listed keys: suppressed when beyond the budget index.
  if (index >= 0) return index >= limit;
  // Unlisted driver keys on a kit-carrying boss are suppressed at all ranks
  // (budget escape fix: displaced template mechanics must not fire at C/B when
  // the kill-zones slots fill the high indices).
  return GATED_DRIVER_KEYS.has(key);
}

// Every heroic-rift mob moves at least this fast (player RUN_SPEED is 7), the
// same anti-kite floor heroic dungeons use (instances/difficulty.ts).
export const RIFT_HEROIC_MIN_MOVE_SPEED = 8;

// Rank difficulty is a spawn-time stat transform (the same shape as
// instances/difficulty.ts mobTemplateForDungeonDifficulty) plus the per-entity
// mechanicDamageMult/mechanicHealMult applied at each mechanic fire site AFTER
// the rng draw (draw count and order stay identical across ranks).
//
// Calibration (2026-07-26 recalibration onto the v0.30 dungeon ladder). The
// INPUT is a target per mob class, stated in the reference-warrior units the
// dungeon floors use (minimum non-crit swing post-mitigation on a level-20 prot
// warrior in the max-armor kit, 2861 armor, Defensive Stance, so ~39.8% of a
// level-22 raw swing passes); the multipliers below are the OUTPUT, solved at
// the WEAKEST template of each class so the target is a floor the whole roster
// clears. Targets, decided 2026-07-26:
//
//   C  a NORMAL dungeon: normal Gravewyrm Sanctum's own line
//      (trash >= 100, boss >= 280, summoned adds >= 50, final boss >= 6,100 hp)
//   B  the heroic five-man line 1.0x (trash >= 500, boss >= 708, adds >= 150,
//      final boss >= 20,000 hp)
//   A  1.2x heroic (trash >= 600, boss >= 850, adds >= 180, boss >= 40,000 hp)
//   S  1.33x heroic (trash >= 665, boss >= 942, adds >= 200, boss >= 60,000 hp)
//
// Health and damage are split by MOB CLASS (trash / boss / summoned add), the
// granularity both dungeon tables already carry (NORMAL_DUNGEON_TUNING is
// per-mob; HEROIC_DUNGEON_TUNING has damageMultiplierByMob and
// healthMultiplierByMob). One multiplier per rank cannot serve two classes at
// once here: at S the boss pool needs 13.34x to reach 60,000 while trash wants
// 6.1x to stay in the heroic trash band, and 13.34x on trash would put roughly
// 868,000 hp of trash in an average 56-mob rift. At C the same conflict lands
// on damage instead (trash needs 3.7x for the 100 line, the boss 7.05x for the
// 280 line), which is exactly why normal Sanctum's table is per-mob.
//
// Within a class one multiplier is enough: rift spawn-list trash spans only
// 1.22x in base weapon damage, so solving at the weakest lands the whole roster
// inside a 22% band. (The wider spread in an earlier review came from counting
// rift_bonewalker, which is a boss-SUMMONED add and never a spawn-list mob.)
//
// The shared gate riftHeroicTuningFor still means "B, A or S" and drives
// boulder lethality and citadel exclusion (C-only content); the stat transform
// reads riftRankTuningFor, which is non-null at every rank. See the C-rank
// note on RIFT_NORMAL_TUNING below.
export interface RiftRankTuning {
  // Spawn-list trash, including the two dais guards flanking a boss.
  healthMultiplier: number;
  damageMultiplier: number;
  // The floor boss and the authored citadel miniboss. Rift boss templates carry
  // a heavier base line than rift trash (a boss auto is 1.48x a trash auto at
  // the same multiplier), so the boss DAMAGE multiplier lands slightly BELOW
  // the trash one at B/A/S: both are solved at their own target, and the boss
  // target is 1.42x the trash floor rather than 1.48x.
  bossHealthMultiplier: number;
  bossDamageMultiplier: number;
  // Boss-summoned add waves land on top of the boss's own output, so they take
  // their own softer multiplier (the heroic addDamageMultiplier precedent:
  // wave pressure, not extra bosses). Their health rides healthMultiplier.
  addDamageMultiplier: number;
  armorMultiplier: number;
  // Anti-kite move-speed floor (player RUN_SPEED is 7), the same one heroic
  // dungeons use. 0 keeps each template's own speed: C is a normal dungeon and
  // stays kiteable.
  minMoveSpeed: number;
}

/** Which multiplier pair a spawn takes. Mirrors HeroicSpawnRole in
 * instances/difficulty.ts. */
export type RiftSpawnRole = 'trash' | 'boss' | 'add';

// C rank: the NORMAL-dungeon rung, tuned as normal Gravewyrm Sanctum is tuned.
// Kept as its OWN table rather than a C entry in RIFT_HEROIC_TUNING, because
// riftHeroicTuningFor(baseLevel) === null is the "is C rank" predicate two
// other behaviors gate on: the 2-floor authored Infernal Citadel is C-only
// content (rift_gen.ts isSetPieceRift), and C boulders chip instead of
// executing (runs.ts tickRiftRollers). Giving C a non-null heroic tuning would
// silently close the citadel forever and make C boulders lethal, neither of
// which any test caught before tests/rift_difficulty_floors.test.ts. (The loot
// rung reads riftRankForBaseLevel directly, so it is unaffected either way.)
//
// Numbers match normal Sanctum's OUTPUT, not its multipliers: rift base
// templates are heavier (a rift boss is ~4,982 hp at level 22 against Korzul's
// ~3,064 base), so transplanting Sanctum's uniform 2.0 health would put a C
// boss at ~9,964, over half way to B. Health therefore INVERTS here relative to
// B/A/S: rift trash is lighter than Sanctum trash (2.4x to reach its 2,199
// line) while rift bosses are heavier than Korzul (1.4x to reach his 6,127).
export const RIFT_NORMAL_TUNING: RiftRankTuning = {
  healthMultiplier: 2.4,
  damageMultiplier: 3.7,
  bossHealthMultiplier: 1.4,
  bossDamageMultiplier: 7.05,
  addDamageMultiplier: 3.4,
  armorMultiplier: 1,
  minMoveSpeed: 0,
};

export const RIFT_HEROIC_TUNING: Partial<Record<RiftTier, RiftRankTuning>> = {
  // B: the heroic five-man line, 1.0x. Trash lands 500-610 (the heroic spawn
  // floor), the boss 709-798 (heroic Korzul's 708), summoned adds 150-161 (the
  // v0.30 40%-nerfed add floor). Trash health lands 4,243-6,009, inside the
  // heroic five-man trash band (4,108-6,219); the boss reaches 20,081-24,228,
  // a ~22s kill at the modeled best-in-slot five-man dps of 900, against heroic
  // Korzul's ~15s. Trash and boss health coincide at 4.6 here; they diverge at
  // A and S.
  B: {
    healthMultiplier: 4.6,
    damageMultiplier: 18.6,
    bossHealthMultiplier: 4.6,
    bossDamageMultiplier: 17.85,
    addDamageMultiplier: 10.3,
    armorMultiplier: 1.12,
    minMoveSpeed: RIFT_HEROIC_MIN_MOVE_SPEED,
  },
  // A: 1.2x heroic damage, double B's boss pool. Trash 600-732, boss 851-958,
  // adds 180-192, boss pool 40,031-48,298 (~44s at 900 group dps). Trash health
  // rises only 1.2x with the damage line (5,073-7,185): the rank's extra length
  // lives in the BOSS, not in a longer trash grind.
  A: {
    healthMultiplier: 5.5,
    damageMultiplier: 22.3,
    bossHealthMultiplier: 9.17,
    bossDamageMultiplier: 21.4,
    addDamageMultiplier: 12.3,
    armorMultiplier: 1.25,
    minMoveSpeed: RIFT_HEROIC_MIN_MOVE_SPEED,
  },
  // S: 1.33x heroic damage and a 60,000 boss (~67s at 900 group dps, the real
  // difference between S and B: the same swing class held three times as long
  // is a healer mana race, not a bigger number). Mobs spawn at level 23,
  // so the multipliers are solved against that level. Non-lethal mechanics stay
  // survivable from full hp through capRiftNonLethalMechanicDamage; the lethal
  // pressure still comes from the telegraphed death zones, the boulder and S
  // lava, which are guaranteed kills by design and are NOT scaled here.
  S: {
    healthMultiplier: 6.1,
    damageMultiplier: 23.3,
    bossHealthMultiplier: 13.34,
    bossDamageMultiplier: 22.4,
    addDamageMultiplier: 12.85,
    armorMultiplier: 1.4,
    minMoveSpeed: RIFT_HEROIC_MIN_MOVE_SPEED,
  },
};

/** heroic_s death-zone tempo: at S rank the lethal telegraphed zones cast (and
 * therefore detonate) this much faster AND recycle this much sooner, so the
 * boss fight stays in constant motion ("make the red circle faster", playtest
 * 2026-07-21). A radius-9 zone at 0.7 tempo still leaves ~1.8s+ to step out at
 * player run speed 7, so every zone remains fully dodgeable from its centre. */
export const RIFT_S_ZONE_TEMPO = 0.7;

/** Non-dodgeable rift mechanic damage (aoePulse, stomp, bigCast: raw numbers
 * with no ground telegraph to step out of) may be VERY threatening but never a
 * one-shot from full health: a single hit is capped below the target's max HP.
 * Dodgeable mechanics (death zones, the boulder, S lava) stay guaranteed kills
 * by design; this cap deliberately does not apply to them. */
export const RIFT_NONLETHAL_MECHANIC_CAP_PCT = 0.9;

export function capRiftNonLethalMechanicDamage(dmg: number, targetMaxHp: number): number {
  return Math.min(dmg, Math.max(1, Math.floor(targetMaxHp * RIFT_NONLETHAL_MECHANIC_CAP_PCT)));
}

/** The HEROIC rift tuning for a descriptor baseLevel, or null at C. Still the
 * "is this a B/A/S rank" predicate: boulder lethality (runs.ts) and citadel
 * exclusion (rift_gen.ts) gate on it. Use riftRankTuningFor for the stat
 * transform, which needs a tuning at C too. */
export function riftHeroicTuningFor(baseLevel: number): RiftRankTuning | null {
  return RIFT_HEROIC_TUNING[riftRankForBaseLevel(baseLevel)] ?? null;
}

/** The tuning for a descriptor baseLevel at EVERY rank (C falls back to the
 * normal-dungeon table). Never null: every rift mob takes a stat transform. */
export function riftRankTuningFor(baseLevel: number): RiftRankTuning {
  return RIFT_HEROIC_TUNING[riftRankForBaseLevel(baseLevel)] ?? RIFT_NORMAL_TUNING;
}

/** The damage multiplier a spawn of this role takes. Also the multiplier the
 * spawner stamps as mechanicDamageMult, so a mob's aoePulse/stomp/bigCast scale
 * with its own melee line (../instances/difficulty.ts does the same). */
export function riftRoleDamageMultiplier(tuning: RiftRankTuning, role: RiftSpawnRole): number {
  if (role === 'boss') return tuning.bossDamageMultiplier;
  if (role === 'add') return tuning.addDamageMultiplier;
  return tuning.damageMultiplier;
}

/** The health multiplier a spawn of this role takes. Summoned adds ride the
 * trash pool: they are wave pressure, not extra bosses. */
export function riftRoleHealthMultiplier(tuning: RiftRankTuning, role: RiftSpawnRole): number {
  return role === 'boss' ? tuning.bossHealthMultiplier : tuning.healthMultiplier;
}

/** The spawn-time stat transform for a rift mob at any rank. Mirrors
 * mobTemplateForDungeonDifficulty (stats only; levels come from
 * riftFloorLevel, and mechanics still read the base MOBS table at fire time,
 * scaled by the per-entity multipliers the spawner sets alongside this). */
export function riftRankTemplate(
  template: MobTemplate,
  tuning: RiftRankTuning,
  role: RiftSpawnRole,
): MobTemplate {
  const hp = riftRoleHealthMultiplier(tuning, role);
  const dmg = riftRoleDamageMultiplier(tuning, role);
  return {
    ...template,
    hpBase: template.hpBase * hp,
    hpPerLevel: template.hpPerLevel * hp,
    dmgBase: template.dmgBase * dmg,
    dmgPerLevel: template.dmgPerLevel * dmg,
    armorPerLevel: template.armorPerLevel * tuning.armorMultiplier,
    moveSpeed: Math.max(template.moveSpeed, tuning.minMoveSpeed),
  };
}
