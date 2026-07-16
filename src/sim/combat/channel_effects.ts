// Deterministic helpers for channel-specific effects. Channel lifecycle code
// owns tick timing and RNG; this module adds no random draws.

import type { SimContext } from '../sim_context';
import type { AbilityDef, AbilityEffect, Entity } from '../types';

/** Scale a channel tick from its one-based ordinal without drawing RNG. */
export function rampedDrainTickDamage(
  firstTickDamage: number,
  rampPct: number | undefined,
  tickNumber: number,
): number {
  const completedSteps = Math.max(0, Math.floor(tickNumber) - 1);
  return Math.round(firstTickDamage * (1 + (rampPct ?? 0) * completedSteps));
}

/** Detonate a fixed final-tick burst around the locked channel target. */
export function detonateChannelFinisher(
  ctx: SimContext,
  source: Entity,
  center: Entity,
  ability: AbilityDef,
  effect: Extract<AbilityEffect, { type: 'channelFinisher' }>,
): void {
  ctx.emit({
    type: 'spellfxAt',
    x: center.pos.x,
    z: center.pos.z,
    school: ability.school,
    fx: 'nova',
    radius: effect.radius,
  });
  for (const hostile of ctx.hostilesInRadius(source, center.pos, effect.radius)) {
    if (!ctx.hasLineOfSight(center, hostile)) continue;
    ctx.dealDamage(
      source,
      hostile,
      effect.amount,
      false,
      ability.school,
      ability.name,
      'hit',
    );
  }
}
