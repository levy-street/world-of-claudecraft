// Spell avoidance, classic-era semantics: a spell can never "miss" the way a
// physical attack does; instead a target can fully RESIST it. The chance of a
// full resist is the complement of the level-based spell-hit chance
// (`spellHitChance` in types.ts), so a higher-level target resists a caster's
// spells exactly as often as it would have made them "miss" before. Shared by
// the player cast path (combat/casting_lifecycle.ts) and the pet ranged-spell
// path (sim.ts) so both label the outcome the same way.

import { spellHitChance } from '../types';

// Probability in [0,1] that a target fully resists a spell from this caster.
export function spellResistChance(casterLevel: number, targetLevel: number): number {
  return 1 - spellHitChance(casterLevel, targetLevel);
}

// Whether a cast is resisted (does no damage and applies no effect). Draws
// exactly one value from the shared rng via `chance(spellHitChance(...))`, so
// the global draw order is identical to the previous spell-hit roll: only the
// emitted event label changes from 'miss' to 'resist'.
export function isSpellResisted(
  rng: { chance(p: number): boolean },
  casterLevel: number,
  targetLevel: number,
): boolean {
  return !rng.chance(spellHitChance(casterLevel, targetLevel));
}
