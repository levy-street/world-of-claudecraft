// Pure, host-agnostic helpers for the M7B skill smart-cast UX.
//
// World of ClaudeCraft combat is target-based: you select an enemy by tapping it,
// then cast on it. There are no ground-targeted or skillshot spells, so this
// feature is NOT free aiming. It is a mobile quality-of-life layer on the skill
// buttons: pressing an eligible offensive skill casts on your current target, or
// auto-picks the best nearby enemy if you have none (honoring the smart-target
// priority setting), and turns you to face it; holding the button previews the
// ability's range as a ring on the ground. This module owns only the two pure,
// testable decisions the HUD needs -- which abilities qualify, and how big the
// range ring is -- with zero DOM / Three / IWorld deps so a Vitest drives it.

import type { AbilityDef, AbilityEffect } from '../sim/types';

// A pure point-blank AoE (range 0, e.g. Arcane Explosion) has no cast range, so
// its ring falls back to the AoE radius; if even that is unknown we show a small
// default ring so the button still reads as "armed".
export const AIM_DEFAULT_PBAOE_RANGE_YD = 8;

function isOffensiveAoeEffect(e: AbilityEffect): boolean {
  return (
    e.type === 'aoeDamage' ||
    e.type === 'groundAoE' ||
    e.type === 'aoeRoot' ||
    e.type === 'aoeAttackSpeed' ||
    e.type === 'aoeAttackPower'
  );
}

/**
 * Smart cast is offered for OFFENSIVE skills that benefit from a target: any
 * ability with a cast range (single-target: Fireball, Frostbolt, Arcane Shot,
 * ...) plus point-blank offensive AoEs (Arcane Explosion, Consecration, Thunder
 * Clap, ...). Friendly / self casts (heals, party buffs) are excluded: they never
 * target an enemy, so auto-acquiring one would be wrong.
 */
export function isAimEligibleAbility(def: AbilityDef): boolean {
  if (def.targetType === 'friendly') return false;
  if (def.range > 0) return true;
  return def.effects.some(isOffensiveAoeEffect);
}

/** Widest AoE radius declared by an ability's effects, or 0 if none. */
function maxAoeRadius(def: AbilityDef): number {
  let r = 0;
  for (const e of def.effects) {
    const radius = (e as { radius?: number }).radius;
    if (typeof radius === 'number' && radius > r) r = radius;
  }
  return r;
}

/**
 * The ring radius to draw for an eligible ability: its cast range when it has
 * one, else the AoE radius, else a small default so the ring still shows.
 */
export function aimRangeFor(def: AbilityDef): number {
  if (def.range > 0) return def.range;
  const r = maxAoeRadius(def);
  return r > 0 ? r : AIM_DEFAULT_PBAOE_RANGE_YD;
}
