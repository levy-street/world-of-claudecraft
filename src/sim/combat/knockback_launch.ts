// Airborne knockback (Typhoon): instead of the instantaneous grounded shove in
// knockback.ts, an enemy PLAYER is thrown along a low ballistic arc through
// the shared movement kernel (player_motion.ts), the same way Trailbreak
// launches the hunter, straight away from the source. On level or falling
// ground it is the flat hop (crests about a yard, covers the full distance on
// level ground); Trailbreak's planner (hunter_trailbreak_arc.ts) lifts it over
// rising ground and cuts it short at a wall. Because the body is really
// airborne, a throw that crosses a ledge keeps flying in its straight line
// past the edge and falls, and the kernel's ordinary fall damage applies on
// landing.
//
// While the throw is in flight the body carries `launchedBy`:
//   - the kernel turns air steering off, so the victim cannot curl the throw
//     back onto the ledge (the line stays straight), and clears the field once
//     the body has stood settled for a step (a touchdown on a steep lip keeps
//     it: the slide off the edge that follows is still the throw) or after
//     LAUNCH_FALL_CREDIT_SECONDS of steps; death and teleports clear it too;
//   - a fall that lands inside the credit window is dealt BY the source
//     (`launchFallCredit`, read by the Sim's fall-damage binding), so a fatal
//     fall is the druid's kill: kill credit, the death recap, honor and the
//     world-PvP gold stake all follow the ordinary killer path in
//     combat/damage.ts handleDeath.
//
// Mobs, pets, swimmers, ferry passengers and bodies already in a scripted or
// forced movement mode (charge, leap, climb, follow, fear) keep the grounded
// shove: none of them run the player kernel's free-flight arm. Draws no rng.
//
// Online, the field is not wired: the victim's display-only self extrapolator
// (src/render/self_motion.ts) predicts the throw with steering on and is
// glided back onto the authoritative straight line, the same correction it
// applies to every server-driven displacement (charge, knockback).

import { ABILITIES } from '../data';
import { knockbackDistanceAfterGuards } from '../knockback';
import { isSwimming } from '../player_motion';
import type { SimContext } from '../sim_context';
import { type DamageEventKind, DT, type Entity } from '../types';
import { isFearAura } from './cc';
import { trailbreakLaunchFor } from './hunter_trailbreak_arc';

/** The longest a throw stays live, in seconds of the victim's own movement
 *  steps: a long drop off a cliff is airborne for a few seconds, so past this
 *  the body has long since landed somewhere and any later fall is its own. */
export const LAUNCH_FALL_CREDIT_SECONDS = 10;

/** Can this body take the airborne arc, or must it take the grounded shove? */
function launchable(ctx: SimContext, target: Entity): boolean {
  if (target.kind !== 'player' || target.dead) return false;
  const meta = ctx.players.get(target.id);
  if (!meta || meta.vehicle) return false;
  if (target.ferryRide || target.leap || target.climb || target.valkyrsCalling) return false;
  if (target.chargeTargetId !== null || target.followTargetId !== null) return false;
  // A feared body is walked by the fear driver, never the kernel, so a launch
  // would sit frozen in it until the fear ended and then fire seconds late.
  const feared = (abilityId: string) => ABILITIES[abilityId]?.fearDr === true;
  if (target.auras.some((aura) => isFearAura(aura, feared))) return false;
  return !isSwimming(target, ctx.cfg.seed);
}

/**
 * Knock `target` up to `distance` yards straight away from `source`. Players
 * are launched into the air (see the header); everything else takes the
 * grounded shove. Returns the yards the throw is planned to cover (0 when an
 * immunity or resistance held the target in place).
 */
export function applyLaunchKnockback(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  distance: number,
): number {
  if (!launchable(ctx, target)) return ctx.applyKnockback(source, target, distance);
  const yards = knockbackDistanceAfterGuards(ctx, source, target, distance);
  if (yards <= 0) return 0;
  let dx = target.pos.x - source.pos.x;
  let dz = target.pos.z - source.pos.z;
  if (Math.hypot(dx, dz) < 1e-4) {
    // Exactly overlapping: throw along the source's facing, as the grounded
    // shove does, so the direction is stable.
    dx = Math.sin(source.facing);
    dz = Math.cos(source.facing);
  }
  // The planner leaps along the BACK of a facing f, (-sin f, -cos f), so the
  // facing whose back points away from the source is the reverse heading.
  const facing = Math.atan2(-dx, -dz);
  // Airborne BEFORE the plan, as Trailbreak does: the sweep resolves the body
  // with the mantle lift the kernel grants a flying body.
  target.onGround = false;
  // Trailbreak's own launch (hunter_trailbreak_arc.ts planTrailbreakLaunch):
  // the fixed flat hop over level or falling ground, so a victim thrown off a
  // ledge keeps its speed and sails on past it in the same straight line and
  // drops the full height; the planner's lifted or shortened arc where rising
  // ground or a wall is in the way.
  const launch = trailbreakLaunchFor(ctx, target, yards, facing);
  target.vx = launch.vx;
  target.vz = launch.vz;
  target.vy = launch.vy;
  target.jumping = true;
  target.fallStartY = target.pos.y;
  target.launchedBy = {
    sourceId: source.id,
    ticksLeft: Math.round(LAUNCH_FALL_CREDIT_SECONDS / DT),
  };
  return launch.distance;
}

/**
 * Who a fall that is landing right now should be credited to: the source of
 * the launch the body is still riding, while that launch is inside its credit
 * window, the source is still in the world and alive, and the two are still
 * hostile (a duel that ended mid-air credits nobody). Null for every ordinary
 * fall, which stays sourceless environmental damage.
 */
export function launchFallCredit(ctx: SimContext, target: Entity): Entity | null {
  const launch = target.launchedBy;
  if (!launch || launch.ticksLeft <= 0) return null;
  const source = ctx.entities.get(launch.sourceId);
  if (!source || source.dead || source.id === target.id) return null;
  return ctx.isHostileTo(source, target) ? source : null;
}

/**
 * The Sim's binding for the movement kernel's one damage call (fall damage,
 * player_motion.ts). An ordinary fall stays exactly what it always was: a
 * sourceless direct hit. A fall the target is still riding a hostile launch
 * into is dealt BY the launcher (`launchFallCredit`), so kill credit, honor
 * and the gold stake follow the normal killer path; it is passed as incidental
 * (not direct) damage whose amount is already final, so the launcher's own
 * damage modifiers never scale a fall.
 *
 * Deliberately, the credited fall IS the launcher's damage everywhere past
 * that: the victim's defenses against the launcher (PvP defense, damage
 * reduction, wards) apply, it holds both in combat, and a duel clamps a
 * lethal one to the duel's end like any other blow.
 */
export function dealKernelDamage(
  ctx: SimContext,
  source: Entity | null,
  target: Entity,
  amount: number,
  crit: boolean,
  school: string,
  ability: string | null,
  kind: DamageEventKind,
  noRage: boolean,
): void {
  const by = source === null && ability === 'Falling' ? launchFallCredit(ctx, target) : null;
  if (by === null) {
    ctx.dealDamage(source, target, amount, crit, school, ability, kind, noRage);
    return;
  }
  ctx.dealDamage(
    by,
    target,
    amount,
    crit,
    school,
    ability,
    kind,
    noRage,
    undefined,
    false,
    false,
    true,
  );
}
