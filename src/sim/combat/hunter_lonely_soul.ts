// Lonely Soul (hunter level-8 choice row, formerly Beastguard; the row id
// 'hun_r8_beastguard' is frozen). With a living pet, the generic pet damage
// share (petDmgSharePct, folded in combat/damage.ts) redirects 30% of damage
// taken, never taking the pet below 20% health. Without a living pet, the
// hunter deals 10% more damage (break-even with the pet for Fieldcraft and
// Marksmanship, so neither choice outdamages the other). The row also grants
// Tactical Camo to every hunter spec; the cast itself is refused while a pet
// lives (requiresNoPet) and tacticalCamoPetTick below ends it if one appears.
// Pure reads over ctx, draws no rng.

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { hasHunterTalent } from './hunter_shared';

export const LONELY_SOUL_ROW_ID = 'hun_r8_beastguard';
/** The redirect never takes the pet below this fraction of its maximum health. */
export const LONELY_SOUL_PET_FLOOR_PCT = 0.2;
/** Extra damage dealt while the hunter has no living pet. */
export const LONELY_SOUL_NO_PET_DAMAGE_PCT = 0.1;

export function hasLonelySoul(ctx: SimContext, hunter: Entity): boolean {
  if (hunter.kind !== 'player') return false;
  const meta = ctx.players.get(hunter.id);
  return !!meta && hasHunterTalent(meta, LONELY_SOUL_ROW_ID);
}

/** Health the redirect must leave on the pet (0 without the talent). */
export function lonelySoulPetFloor(ctx: SimContext, hunter: Entity, pet: Entity): number {
  return hasLonelySoul(ctx, hunter) ? Math.ceil(pet.maxHp * LONELY_SOUL_PET_FLOOR_PCT) : 0;
}

/** Outgoing damage multiplier for a Lonely Soul hunter with no living pet. */
export function lonelySoulDamageMult(ctx: SimContext, source: Entity): number {
  if (!hasLonelySoul(ctx, source)) return 1;
  const pet = ctx.petOf(source.id);
  return pet && !pet.dead ? 1 : 1 + LONELY_SOUL_NO_PET_DAMAGE_PCT;
}

export const TACTICAL_CAMO_ID = 'tactical_camo';

/** Ticks between two pet checks for a camouflaged hunter (once a second). */
export const TACTICAL_CAMO_PET_CHECK_TICKS = 20;

/** Tactical Camo is the petless hunter's stealth: a living pet ends it. Summoning
 *  or reviving one is an ability use and already breaks it; this catches a pet
 *  that comes back without a cast (a revive in place, a match return). petOf
 *  walks the roster and, with no pet out, walks all of it, so the check runs
 *  once a second per hunter (staggered by id), not every tick; it bails on the
 *  cached stealth flag first. */
export function tacticalCamoPetTick(ctx: SimContext, hunter: Entity): void {
  if (!hunter.stealthed) return;
  if ((ctx.tickCount + hunter.id) % TACTICAL_CAMO_PET_CHECK_TICKS !== 0) return;
  if (!hunter.auras.some((a) => a.id === TACTICAL_CAMO_ID && a.kind === 'stealth')) return;
  if (ctx.petOf(hunter.id)) ctx.breakStealth(hunter);
}

/** Attacking breaks Tactical Camo at once: engaging an auto-attack (Auto Shot
 *  or a melee swing) ends it on the press, not when the first hit lands, so a
 *  hunter cannot hold Camo through an arrow's windup and flight. Ability use
 *  and damage already break it through the shared stealth rules. */
export function breakTacticalCamoOnAttack(ctx: SimContext, hunter: Entity): void {
  if (!hunter.stealthed) return;
  if (hunter.auras.some((a) => a.id === TACTICAL_CAMO_ID && a.kind === 'stealth')) {
    ctx.breakStealth(hunter);
  }
}
