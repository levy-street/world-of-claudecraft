// The two post-recovery sicknesses and the rules they share.
//
//  - Resurrection Sickness (player-facing display name "The Keeper's Toll"): the debuff a
//    Pale Keeper resurrection inflicts, up to 10 minutes.
//  - Unstuck Sickness: the debuff a completed /unstuck inflicts, up to 5 minutes. Unstuck
//    no longer kills or routes through the Pale Keeper, so this is the whole price it
//    charges for skipping the walk.
//
// Both are the same mechanic (a level-scaled whole-stat-block drain that cannot be shed by
// dying or relogging) with different ceilings, so they share one leaf module. It imports
// only ./types, so every death and respawn site (combat/damage, spirit, entity_roster,
// delves/runs) can share the "which auras survive death" predicate and the level-scaled
// duration WITHOUT an import cycle (spirit <-> entity_roster both need it).

import { type Aura, MAX_LEVEL } from './types';

export const RESURRECTION_SICKNESS_ID = 'resurrection_sickness';
export const UNSTUCK_SICKNESS_ID = 'unstuck_sickness';
// Classic-era rule: no resurrection sickness below this level. Unstuck Sickness follows it,
// so a brand-new character is never punished for using the recovery command.
export const RES_SICKNESS_MIN_LEVEL = 10;
export const UNSTUCK_SICKNESS_MIN_LEVEL = RES_SICKNESS_MIN_LEVEL;
// Duration bounds (seconds): the shortest drain at the minimum level, up to the full drain
// at max level. Classic scales the duration with level.
export const RES_SICKNESS_MIN_DURATION = 60;
export const RES_SICKNESS_DURATION = 600;
export const UNSTUCK_SICKNESS_MIN_DURATION = RES_SICKNESS_MIN_DURATION;
// Half the Pale Keeper's ceiling: 5 minutes at max level, which is exactly the /unstuck
// success cooldown, so the debuff runs out as the command becomes available again.
export const UNSTUCK_SICKNESS_DURATION = 300;
// The drain: all attributes to a quarter (a signed fraction; -0.75 = -75%). Shared, so the
// two sicknesses always weigh the same and differ only in how long they last.
export const RES_SICKNESS_STAT_MULT = -0.75;
export const UNSTUCK_SICKNESS_STAT_MULT = RES_SICKNESS_STAT_MULT;

// The two sickness aura ids. They are mutually exclusive on a player (see
// applySickness in ./spirit): both are `buff_allstats_pct`, and the stat block
// multiplies every such aura in turn, so two at once would compound to -93.75%.
export const SICKNESS_AURA_IDS: ReadonlySet<string> = new Set([
  RESURRECTION_SICKNESS_ID,
  UNSTUCK_SICKNESS_ID,
]);

// Seconds of sickness for a character of the given level. Zero below minLevel (classic
// exempts low levels); otherwise scales linearly from minDuration at that level to
// maxDuration at MAX_LEVEL.
function levelScaledSicknessDuration(
  level: number,
  minLevel: number,
  minDuration: number,
  maxDuration: number,
): number {
  if (level < minLevel) return 0;
  const span = MAX_LEVEL - minLevel;
  const t = span > 0 ? (level - minLevel) / span : 1;
  return Math.round(minDuration + t * (maxDuration - minDuration));
}

/** Seconds of Resurrection Sickness (The Keeper's Toll) for a character of this level. */
export function resSicknessDuration(level: number): number {
  return levelScaledSicknessDuration(
    level,
    RES_SICKNESS_MIN_LEVEL,
    RES_SICKNESS_MIN_DURATION,
    RES_SICKNESS_DURATION,
  );
}

/** Seconds of Unstuck Sickness for a character of this level. */
export function unstuckSicknessDuration(level: number): number {
  return levelScaledSicknessDuration(
    level,
    UNSTUCK_SICKNESS_MIN_LEVEL,
    UNSTUCK_SICKNESS_MIN_DURATION,
    UNSTUCK_SICKNESS_DURATION,
  );
}

// Auras that survive a death / respawn reset: both sicknesses (The Keeper's Toll
// and Unstuck Sickness), the Cauterize lockout ('cauterize_fatigue',
// combat/fire_mage.ts), and encounter-owned unbreakable control. None may be shed
// by dying; the encounter script remains responsible for releasing its own control.
// Every other aura clears. Used at every player death/respawn site so the rule
// cannot drift.
export function aurasSurvivingDeath(auras: Aura[]): Aura[] {
  return auras.filter(
    (a) =>
      SICKNESS_AURA_IDS.has(a.id) ||
      a.kind === 'cauterize_fatigue' ||
      a.unbreakableControl === true,
  );
}
