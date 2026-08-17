import { MELEE_RANGE } from './types';

export type MobCombatProfile = {
  meleeRange: number;
  desiredRange: number;
  chaseSpeedMult: number;
  canLeash: boolean;
  swingWhilePursuing: boolean;
  immediateSwingOnEnterRange: boolean;
  movingRangeBonus: number;
};

// Every melee mob fights hit-and-run: it swings from effective reach while
// continuing to close to desiredRange (80% of reach), so it tracks a moving
// target fluidly instead of stopping at max reach to trade blows. The chase
// speed stays 1 (pursuit is about swinging mid-step, not a speed buff) and the
// stationary walk-past fix is preserved via movingRangeBonus.
export const DEFAULT_MOB_COMBAT_PROFILE: MobCombatProfile = {
  meleeRange: MELEE_RANGE,
  desiredRange: MELEE_RANGE * 0.8,
  chaseSpeedMult: 1,
  canLeash: true,
  swingWhilePursuing: true,
  immediateSwingOnEnterRange: true,
  movingRangeBonus: 1,
};

export const NYTHRAXIS_BOSS_COMBAT_PROFILE: MobCombatProfile = {
  meleeRange: 8,
  desiredRange: 5,
  chaseSpeedMult: 1.5,
  canLeash: false,
  swingWhilePursuing: true,
  immediateSwingOnEnterRange: true,
  movingRangeBonus: 0,
};

export const NYTHRAXIS_ADD_COMBAT_PROFILE: MobCombatProfile = {
  meleeRange: 6,
  desiredRange: 4.5,
  chaseSpeedMult: 1.45,
  canLeash: false,
  swingWhilePursuing: true,
  immediateSwingOnEnterRange: true,
  movingRangeBonus: 0,
};

export function scaledDefaultMobMeleeRange(scale: number): number {
  return MELEE_RANGE + Math.max(0, scale - 1) * 3;
}

// Thunzharr is rendered oversized (scale 8 in zone3.ts) so he reads as a world boss, but
// his melee reach must NOT follow that visual scale (a scale-8 body would swing far past
// its model and reach kiters, trivializing the Howling Gale anti-kite snare). Pin his
// reach to a scale-5 body (~17yd): visual size and combat reach are decoupled.
const THUNZHARR_REACH_SCALE = 5;

// Mob AI reads the profile several times per engaged mob per tick (the threat
// scan in updateMobTarget, the lookup that opens updateMobCombatProfile, and
// each melee-range probe in the pursuit/caster loops), and every non-hardcoded
// branch below built a fresh object literal on every read. A profile is a pure
// function of (templateId, scale), so cache it: bounded by the small number of
// distinct template/scale pairs actually spawned. Safe because no caller
// mutates the returned object, only reads its fields.
//
// scale is not always a small fixed set: rift.ts jitters it with
// `rng.range(0.92, 1.12)` per spawn, so an unbounded map would grow by one
// entry per rift mob for the life of the process. Cap the cache and evict the
// oldest entry (Map iterates in insertion order) past the cap so a long
// session of rift churn can't leak memory; a bounded miss just rebuilds the
// same value, it never changes behavior.
export const MAX_COMBAT_PROFILE_CACHE_ENTRIES = 2048;
const combatProfileCache = new Map<string, MobCombatProfile>();

export function combatProfileForMob(templateId: string, scale: number): MobCombatProfile {
  const key = `${templateId}:${scale}`;
  const cached = combatProfileCache.get(key);
  if (cached) return cached;
  const profile = buildCombatProfileForMob(templateId, scale);
  if (combatProfileCache.size >= MAX_COMBAT_PROFILE_CACHE_ENTRIES) {
    const oldestKey = combatProfileCache.keys().next().value;
    if (oldestKey !== undefined) combatProfileCache.delete(oldestKey);
  }
  combatProfileCache.set(key, profile);
  return profile;
}

/** Test-only: the live entry count, so a bound regression fails a test instead of a live process. */
export function combatProfileCacheSizeForTest(): number {
  return combatProfileCache.size;
}

function buildCombatProfileForMob(templateId: string, scale: number): MobCombatProfile {
  if (templateId === 'nythraxis_scourge_of_thornpeak') return NYTHRAXIS_BOSS_COMBAT_PROFILE;
  if (templateId === 'nythraxis_skeleton_warrior') return NYTHRAXIS_ADD_COMBAT_PROFILE;
  if (templateId === 'wildheart_ravager')
    return {
      ...DEFAULT_MOB_COMBAT_PROFILE,
      // The scale-2 default settles at desiredRange 6.4 and swings out to 9,
      // so real landed hits read as whiffs into the ether. Keep the scaled
      // reach but close to visual contact before trading, the Nythraxis
      // meleeRange 8 / desiredRange 5 pattern.
      meleeRange: scaledDefaultMobMeleeRange(2),
      desiredRange: 5,
    };
  // The grown dragonkin (the broodlords at scale 2.25, Cindraleth at 2.85):
  // reach follows the body per the wildheart lesson (a big model on stock
  // reach swings through thin air), while desiredRange stays close so the
  // trade reads as contact, not ranged pawing.
  if (templateId === 'drakemaw_broodlord')
    return {
      ...DEFAULT_MOB_COMBAT_PROFILE,
      meleeRange: scaledDefaultMobMeleeRange(2.25),
      desiredRange: 5,
    };
  if (templateId === 'cindraleth_maw_matriarch')
    return {
      ...DEFAULT_MOB_COMBAT_PROFILE,
      meleeRange: scaledDefaultMobMeleeRange(2.85),
      desiredRange: 5.5,
    };
  // Grubjaw the Glutton at scale 2.275: same treatment as the grown
  // dragonkin, so the big body's swings land at visual contact instead of
  // pawing from stock humanoid reach.
  if (templateId === 'grubjaw')
    return {
      ...DEFAULT_MOB_COMBAT_PROFILE,
      meleeRange: scaledDefaultMobMeleeRange(2.275),
      desiredRange: 5,
    };
  if (templateId === 'wildheart_beastmaster')
    return {
      ...DEFAULT_MOB_COMBAT_PROFILE,
      // Same whiff geometry as the ravager, one size up (scale 2.35 settles
      // at 7.24): the pack-leader bruiser also closes to contact. Zulgar is
      // deliberately left on the scale default, the boss fight is built on
      // knockback/pulse spacing and his reach reads as boss presence.
      meleeRange: scaledDefaultMobMeleeRange(2.35),
      desiredRange: 5.5,
    };
  if (templateId === 'thunzharr_waking_peak')
    return {
      ...DEFAULT_MOB_COMBAT_PROFILE,
      meleeRange: scaledDefaultMobMeleeRange(THUNZHARR_REACH_SCALE),
      desiredRange: scaledDefaultMobMeleeRange(THUNZHARR_REACH_SCALE) * 0.8,
    };
  return {
    ...DEFAULT_MOB_COMBAT_PROFILE,
    meleeRange: scaledDefaultMobMeleeRange(scale),
    desiredRange: scaledDefaultMobMeleeRange(scale) * 0.8,
  };
}

// Closing-distance grace. A 20 Hz tick samples positions discretely, so a mob that
// is genuinely closing on its target can perpetually fall a fraction of a yard short
// of a strict range check. To bridge that, a mob that *moved this tick* (i.e. is
// pursuing) gets a small reach bonus. A stationary mob gets none: it is not closing,
// so a player merely walking past must only be struck from the mob's true melee
// range, never the inflated reach the old target-movement gate produced. This is the
// fix for "excessive melee range" - hits landing while the player seems out of reach
// when walking past packed camps.
export function effectiveMobMeleeRange(profile: MobCombatProfile, mobMoved: boolean): number {
  if (!mobMoved) return profile.meleeRange;
  return profile.meleeRange + profile.movingRangeBonus;
}
