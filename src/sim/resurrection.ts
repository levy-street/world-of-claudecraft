// Resurrection Sickness (player-facing display name "The Keeper's Toll"): the debuff a
// Pale Keeper resurrection inflicts. Kept in a leaf module (imports only ./types) so every
// death and respawn site (combat/damage, spirit, entity_roster, delves/runs) can share the
// "which auras survive death" predicate and the level-scaled duration WITHOUT an import
// cycle (spirit <-> entity_roster both need it).

import { type Aura, MAX_LEVEL } from './types';

export const RESURRECTION_SICKNESS_ID = 'resurrection_sickness';
// Classic-era rule: no resurrection sickness below this level.
export const RES_SICKNESS_MIN_LEVEL = 10;
// Duration bounds (seconds): the shortest drain at RES_SICKNESS_MIN_LEVEL, up to the full
// 10-minute drain at max level. Classic scales the duration with level.
export const RES_SICKNESS_MIN_DURATION = 60;
export const RES_SICKNESS_DURATION = 600;
// The drain: all attributes to a quarter (a signed fraction; -0.75 = -75%).
export const RES_SICKNESS_STAT_MULT = -0.75;

// Seconds of Resurrection Sickness for a character of the given level. Zero below
// RES_SICKNESS_MIN_LEVEL (classic exempts low levels); otherwise scales linearly from
// RES_SICKNESS_MIN_DURATION at that level to RES_SICKNESS_DURATION at MAX_LEVEL.
export function resSicknessDuration(level: number): number {
  if (level < RES_SICKNESS_MIN_LEVEL) return 0;
  const span = MAX_LEVEL - RES_SICKNESS_MIN_LEVEL;
  const t = span > 0 ? (level - RES_SICKNESS_MIN_LEVEL) / span : 1;
  return Math.round(
    RES_SICKNESS_MIN_DURATION + t * (RES_SICKNESS_DURATION - RES_SICKNESS_MIN_DURATION),
  );
}

// Auras that survive a death / respawn reset: Resurrection Sickness (The Keeper's
// Toll) and the Cauterize lockout ('cauterize_fatigue', combat/fire_mage.ts). Both
// must not be sheddable by dying: res sickness IS the death penalty, and the
// Cauterize fatigue is what stops die-revive-die from earning a second lethal save
// inside the window. Every other aura clears. Used at every player death/respawn
// site so the rule cannot drift.
export function aurasSurvivingDeath(auras: Aura[]): Aura[] {
  return auras.filter((a) => a.id === RESURRECTION_SICKNESS_ID || a.kind === 'cauterize_fatigue');
}
