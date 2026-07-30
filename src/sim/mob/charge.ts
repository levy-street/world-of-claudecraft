// Heroic anti-kite charge (MobTemplate.charge): the warrior/guard melee mobs of
// the four heroic five-mans open with an Onrush-style gap closer so a ranged
// kiter cannot hold them at range forever. The template field is inert until
// applyDungeonMobTuning stamps Entity.chargeEnabled on a HEROIC spawn, so a
// normal spawn of the same template never charges.
//
// Determinism: every branch in this module draws ZERO rng (a fixed stun, a
// fixed-speed dash via ctx.moveToward), so for any mob without chargeEnabled it
// is a pure no-op and cannot perturb the parity gate's draw order.

import { MOBS } from '../data';
import type { SimContext } from '../sim_context';
import { type Aura, DT, dist2d, type Entity, MELEE_RANGE, steadyAngleTo } from '../types';

// Mirrors the player Onrush dash tuning (the CHARGE_* consts atop sim.ts).
const MOB_CHARGE_SPEED_MULT = 3; // dash runs at 3x the mob's move speed
const MOB_CHARGE_ARRIVE_RANGE = MELEE_RANGE - 1; // stop inside melee range
const MOB_CHARGE_MAX_DURATION = 3; // seconds before an unfinished dash gives up

// The stun aura id. Deliberately NOT 'charge_stun': the player Onrush stun
// (effect_dispatch's `${ability.id}_stun`) already owns that id and the two
// must never collide in the aura replacement rules.
export const MOB_CHARGE_STUN_ID = 'mob_charge_stun';

// Trigger check, called once per engaged tick from the locomotion chase/attack
// hook (next to the aoeSlow snare pulse: mid-chase is the kite case charge
// exists for). Fires when the heroic-stamped mob has its live aggro target in
// the charge band, the cooldown is spent, and the mob is free to act; the stun
// lands the SAME tick (like the player Onrush pairing of stun + dash) and the
// dash then owns movement on the following ticks via updateMobChargeDash.
export function tryStartMobCharge(ctx: SimContext, mob: Entity): void {
  if (!mob.chargeEnabled) return;
  const charge = MOBS[mob.templateId]?.charge;
  if (!charge) return;
  if (mob.mobChargeTargetId != null) return; // already mid-charge
  if ((mob.mobChargeCooldown ?? 0) > 0) return;
  if (!mob.inCombat) return;
  const target = mob.aggroTargetId !== null ? ctx.entities.get(mob.aggroTargetId) : null;
  if (!target || target.dead) return;
  // The same control predicates the rest of the mob AI gates on: isStunned
  // covers every total lockout (stun/stasis/incapacitate/polymorph, and fear
  // applies the incapacitate-kind fear_incap), isRooted adds root.
  if (ctx.isStunned(mob) || ctx.isRooted(mob)) return;
  const d = dist2d(mob.pos, target.pos);
  if (d < charge.minRange || d > charge.maxRange) return;
  mob.mobChargeCooldown = charge.cooldown;
  mob.mobChargeTargetId = target.id;
  mob.mobChargeTimeLeft = MOB_CHARGE_MAX_DURATION;
  const school = (charge.school ?? 'physical') as Aura['school'];
  // Mirrors the stomp announce exactly: the same "unleashes" line, gated on
  // quietMechanics, localized client-side by the sim_i18n bossUnleashes rule.
  if (!MOBS[mob.templateId]?.quietMechanics)
    ctx.emit({
      type: 'log',
      text: `${mob.name} unleashes ${charge.name}!`,
      color: '#ff9933',
      entityId: mob.id,
    });
  // The stun lands immediately, same tick, and takes no diminishing returns
  // (matching stomp's stomp_stun).
  ctx.applyAura(target, {
    id: MOB_CHARGE_STUN_ID,
    name: charge.name,
    kind: 'stun',
    remaining: charge.stunDuration,
    duration: charge.stunDuration,
    value: 0,
    sourceId: mob.id,
    school,
  });
}

// Dash in flight: forced movement toward the charge victim at 3x move speed.
// Returns true while it owns the mob's movement this tick (the locomotion
// chase/attack arm then skips the normal combat-profile runner, mirroring the
// player's updateChargeMovement early return). Also ticks the charge cooldown,
// so the cooldown advances exactly once per engaged tick whether dashing or not.
export function updateMobChargeDash(ctx: SimContext, mob: Entity): boolean {
  if ((mob.mobChargeCooldown ?? 0) > 0)
    mob.mobChargeCooldown = Math.max(0, (mob.mobChargeCooldown ?? 0) - DT);
  if (mob.mobChargeTargetId == null) return false;
  const target = ctx.entities.get(mob.mobChargeTargetId);
  mob.mobChargeTimeLeft = (mob.mobChargeTimeLeft ?? 0) - DT;
  const done = (): boolean => {
    cancelMobChargeDash(mob);
    if (target && !target.dead) mob.facing = steadyAngleTo(mob.pos, target.pos, mob.facing);
    return true;
  };
  if (!target || target.dead || (mob.mobChargeTimeLeft ?? 0) <= 0) return done();
  // A stun or root breaks the dash. The stun arm here is a backstop: a stunned
  // mob never reaches this call (locomotion's isStunned branch returns early
  // and cancels the dash itself via cancelMobChargeDash).
  if (ctx.isStunned(mob) || ctx.isRooted(mob)) return done();
  if (dist2d(mob.pos, target.pos) <= MOB_CHARGE_ARRIVE_RANGE) return done();
  // moveToward slides around props/water exactly like normal mob pursuit.
  ctx.moveToward(mob, target.pos, mob.moveSpeed * MOB_CHARGE_SPEED_MULT);
  return true;
}

// Pure state clear (no rng, no emits): used by the dash end itself, by the
// locomotion stun branch (a stun mid-dash kills the dash even though updateMob
// never reaches the dash step while stunned), and by the evade/respawn resets.
export function cancelMobChargeDash(mob: Entity): void {
  mob.mobChargeTargetId = null;
  mob.mobChargeTimeLeft = 0;
}

// Evade-home / respawn reset: a fresh pull opens with the charge READY (cooldown
// 0), unlike the telegraphed pulse timers that reseed to one full interval; the
// on-pull opener is the whole anti-kite point.
export function resetMobCharge(mob: Entity): void {
  mob.mobChargeCooldown = 0;
  cancelMobChargeDash(mob);
}
