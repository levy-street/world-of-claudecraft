// Spell avoidance, classic-era semantics: a spell can never "miss" the way a
// physical attack does; instead a target can fully RESIST it. The chance of a
// full resist is the complement of the level-based spell-hit chance
// (`spellHitChance` in types.ts), so a higher-level target resists a caster's
// spells exactly as often as it would have made them "miss" before. Shared by
// the player cast path (combat/casting_lifecycle.ts), the pet ranged-spell
// path (sim.ts), and the player pet bolt path (pet/pet_ai.ts petRangedAttack)
// so all three label the outcome the same way.

import type { SimContext } from '../sim_context';
import { creditAbilityDrill } from '../tutorial/ability_drill';
import { type AbilityDef, type Entity, MOB_VS_PLAYER_MAX_MISS, spellHitChance } from '../types';

// Effective spell-hit chance including the caster's gear Hit rating (hitBonus, a
// fraction that reduces resist). Capped at 1. hitBonus defaults to 0, so a caster
// with no hit gear is byte-identical to the level-only chance.
export function effectiveSpellHit(casterLevel: number, targetLevel: number, hitBonus = 0): number {
  return Math.min(1, spellHitChance(casterLevel, targetLevel) + hitBonus);
}

// Probability in [0,1] that a target fully resists a spell from this caster.
export function spellResistChance(casterLevel: number, targetLevel: number, hitBonus = 0): number {
  return 1 - effectiveSpellHit(casterLevel, targetLevel, hitBonus);
}

// Whether a cast is resisted (does no damage and applies no effect). Draws
// exactly one value from the shared rng via `chance(effectiveSpellHit(...))`, so
// the global draw order is identical to the previous spell-hit roll: only the
// emitted event label changes from 'miss' to 'resist'. With hitBonus 0 the
// argument equals spellHitChance(...) exactly, keeping the ungeared draw identical.
export function isSpellResisted(
  rng: { chance(p: number): boolean },
  casterLevel: number,
  targetLevel: number,
  hitBonus = 0,
): boolean {
  return !rng.chance(effectiveSpellHit(casterLevel, targetLevel, hitBonus));
}

// Enemy mobs' spells always land at least this often against a player (or
// player-owned pet), mirroring MOB_VS_PLAYER_MAX_MISS's melee-swing floor (same
// value, same directional guard): the above-level penalty folded into
// spellHitChance is an anti-power-level deterrent for casters attacking something
// above their level, and would otherwise also strangle a low-level mob's spell
// damage against a higher-level player toward nothing.
export const MOB_VS_PLAYER_MAX_RESIST = MOB_VS_PLAYER_MAX_MISS;

// Directional resist roll for the mob-vs-player-side ranged/spell path (mob/
// hunter-pet updateRangedPetAttack in sim.ts) and the player pet bolt path
// (pet/pet_ai.ts petRangedAttack). A player-owned pet as caster takes the
// UNFLOORED branch: mobAttacker requires ownerId === null, so the floor below
// never binds and the pet keeps the full above-level resist scaling, exactly
// like a player cast. Mirrors swingMissChance's
// hostile-mob / player-side guard: a hostile wild mob (or its ranged attack)
// casting at a player or player-owned pet has its resist chance floored so it
// still hits at least (1 - MOB_VS_PLAYER_MAX_RESIST) of the time; player/pet ->
// mob keeps the full above-level resist scaling untouched. Draws exactly one rng
// value, same as isSpellResisted, so the global draw order is unchanged.
//
// Unlike mobArmorReduction, this cap is NOT further gated on caster.level <
// target.level: spellHitChance already returns >= 96% whenever the caster is at or
// above the target's level (diff <= 0), which always clears the 80% floor on its
// own, so the Math.max below is a no-op there and an explicit level check would be
// redundant. If spellHitChance's at-or-above-level branch is ever tuned below 80%,
// re-check this comment: the cap would start binding above-level too.
export function isMobSpellResisted(
  rng: { chance(p: number): boolean },
  caster: Entity,
  target: Entity,
  hitBonus = 0,
): boolean {
  const hit = effectiveSpellHit(caster.level, target.level, hitBonus);
  const mobAttacker = caster.kind === 'mob' && caster.hostile && caster.ownerId === null;
  const playerSide = target.kind === 'player' || target.ownerId !== null;
  const flooredHit = mobAttacker && playerSide ? Math.max(hit, 1 - MOB_VS_PLAYER_MAX_RESIST) : hit;
  return !rng.chance(flooredHit);
}

// The one resist resolution both hostile-spell delivery arms in
// combat/casting_lifecycle.ts share (a bolt resolving on impact, an instant
// resolving at cast completion), so an ability's delivery flag can never opt it
// out of avoidance. True means the cast was resisted: its effects must not run.
export function resolveHostileSpellResist(
  ctx: SimContext,
  src: Entity,
  tgt: Entity,
  ability: AbilityDef,
): boolean {
  if (!isSpellResisted(ctx.rng, src.level, tgt.level, src.hitBonus)) return false;
  ctx.emit({
    type: 'damage',
    sourceId: src.id,
    targetId: tgt.id,
    amount: 0,
    crit: false,
    school: ability.school,
    ability: ability.name,
    kind: 'resist',
  });
  // A resisted cast never reaches runEffects, but the player still pressed the
  // button the island asked for, so the drill credits here too. Without this the
  // lesson stalls on an unlucky roll and the coach keeps asking for a press that
  // already happened.
  creditAbilityDrill(ctx, src, tgt, ability.id);
  ctx.enterCombat(src, tgt);
  return true;
}
