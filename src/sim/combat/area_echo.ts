// Bladed Echo (aura kind 'aoe_echo'): after casting Bladed Gyre (whirlwind),
// the caster's next AOE-echo charges' worth of single-target damaging ability
// CASTS also strike every OTHER hostile enemy within AOE_ECHO_RADIUS yards of
// their primary target, for the same resolved amounts.
//
// Determinism contract: the echo reuses each strike's ALREADY-ROLLED damage
// (post hit table, crit, and armor: the exact number the primary dealDamage
// call received) and draws NO rng of its own. The fan-out is the deterministic
// hostilesInRadius grid order, and every echoed hit routes through
// ctx.dealDamage (threat, combat entry, death) exactly like the aoeDamage case
// in effect_dispatch.ts, including its line-of-sight gate.
//
// Consumption is per ABILITY CAST, not per effect: casting_lifecycle's
// applyAbility resolves eligibility ONCE per cast (a worn aoe_echo aura plus
// abilityQualifiesForAreaEcho over the resolved effects) and hands runEffects
// the flag; runEffects echoes each weaponStrike/directDamage hit and then
// consumes ONE charge, only if the cast actually dealt single-target hostile
// damage. A cast that fails validation or whiffs entirely consumes nothing,
// and an already-AoE ability (whirlwind itself included) never qualifies.
//
// `src/sim`-pure: sibling types + the SimContext seam only, no rng of its own
// (enforced by tests/architecture.test.ts).

import type { SimContext } from '../sim_context';
import type { AbilityDef, AbilityEffect, Entity } from '../types';

// How far around the PRIMARY target the echo reaches (yards).
export const AOE_ECHO_RADIUS = 8;

// Fraction of the primary hit each ECHOED target takes (owner 2026-07-09: the echo
// used to replay the full 100%; the extra targets now take 65%, like a cleave).
export const AOE_ECHO_MULT = 0.65;

/** Does this cast's resolved effect list make it a single-target damaging
 *  ability? Needs at least one weaponStrike/directDamage and no area damage
 *  effect (an already-AoE ability neither echoes nor consumes); heals and
 *  buffs have no single-target damage effect and fall out naturally. */
export function abilityQualifiesForAreaEcho(effects: readonly AbilityEffect[]): boolean {
  const hasSingleTargetDamage = effects.some(
    (e) => e.type === 'weaponStrike' || e.type === 'directDamage',
  );
  if (!hasSingleTargetDamage) return false;
  return !effects.some(
    (e) => e.type === 'aoeDamage' || e.type === 'aoeRoot' || e.type === 'groundAoE',
  );
}

/** Is the echo armed on this entity? */
export function hasAreaEchoAura(e: Entity): boolean {
  return e.auras.some((a) => a.kind === 'aoe_echo');
}

/** Fan one resolved single-target hit out to every OTHER hostile enemy near
 *  the primary target. `amount` is the already-rolled number: no re-roll. */
export function echoAreaDamage(
  ctx: SimContext,
  p: Entity,
  primary: Entity,
  amount: number,
  school: AbilityDef['school'],
  abilityName: string,
  threatOpts: { flat?: number; mult?: number },
): void {
  const scaled = Math.max(1, Math.round(amount * AOE_ECHO_MULT));
  for (const m of ctx.hostilesInRadius(p, primary.pos, AOE_ECHO_RADIUS)) {
    if (m.id === primary.id) continue; // never onto the primary target twice
    if (!ctx.hasLineOfSight(p, m)) continue; // mirror the aoeDamage LoS gate
    ctx.dealDamage(p, m, scaled, false, school, abilityName, 'hit', false, threatOpts);
  }
}

// Sweeping Strikes (Arms restructure 2026-07-08, aura kind 'sweeping_strikes'):
// a 12s WINDOW (no charges) where each single-target strike also clips ONE
// nearby enemy for a reduced fraction. Same determinism contract as the echo:
// it replays the already-rolled amount (scaled), draws no rng, and routes
// through ctx.dealDamage. Qualifies the same single-target casts as the echo.
export function hasSweepingStrikes(e: Entity): boolean {
  return e.auras.some((a) => a.kind === 'sweeping_strikes');
}

/** Clip ONE nearby hostile (the first in deterministic grid order) for
 *  `amount * mult`, reusing the resolved primary-hit amount. No re-roll. */
export function sweepStrikeDamage(
  ctx: SimContext,
  p: Entity,
  primary: Entity,
  amount: number,
  mult: number,
  school: AbilityDef['school'],
  abilityName: string,
  threatOpts: { flat?: number; mult?: number },
): void {
  const scaled = Math.max(1, Math.round(amount * mult));
  for (const m of ctx.hostilesInRadius(p, primary.pos, AOE_ECHO_RADIUS)) {
    if (m.id === primary.id) continue;
    if (!ctx.hasLineOfSight(p, m)) continue;
    ctx.dealDamage(p, m, scaled, false, school, abilityName, 'hit', false, threatOpts);
    return; // one extra target only
  }
}

/** Spend one echo charge after a qualifying cast dealt damage; the aura drops
 *  (with its fade event for the buff bar) when the last charge is spent. */
export function consumeAreaEchoCharge(ctx: SimContext, e: Entity): void {
  const idx = e.auras.findIndex((a) => a.kind === 'aoe_echo');
  if (idx < 0) return;
  const aura = e.auras[idx];
  const left = (aura.charges ?? 1) - 1;
  if (left <= 0) {
    e.auras.splice(idx, 1);
    ctx.emit({ type: 'aura', targetId: e.id, name: aura.name, gained: false });
    return;
  }
  aura.charges = left;
}
