// Hunter trap (G6, fix/talents2-balance-pass): Rime Snare is a real trap, not
// an aimed nova. Placed at the hunter's feet, it arms after a short delay and
// freezes the FIRST enemy whose movement touches it, then is consumed. One
// trap per hunter at a time (the classic rule). The state rides the existing
// groundAoEs collection as a hunterTrap rider (the Ring of Frost pattern);
// this module owns the spawn and contact rules. Draws no rng.

import type { GroundAoE } from '../entity_roster';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { DT } from '../types';
import { segmentTouchesAnnulus } from './ring_of_frost';

// Hostile query padding so a fast mover cannot tunnel past the contact sweep.
const SWEEP_QUERY_PADDING = 30;
// Armed-trap ground indicator cadence and size (a subtle frost ring).
const SHIMMER_EVERY_TICKS = 40;
const SHIMMER_RADIUS = 1.2;

export interface HunterTrapEffect {
  duration: number;
  radius: number;
  trap: { armTime: number; lifetime: number };
}

export function spawnHunterTrap(
  ctx: SimContext,
  source: Entity,
  effect: HunterTrapEffect,
  abilityName: string,
  abilityId: string,
): void {
  // One trap at a time: a new trap replaces the owner's previous one.
  for (let i = ctx.groundAoEs.length - 1; i >= 0; i--) {
    const existing = ctx.groundAoEs[i];
    if (existing.hunterTrap && existing.sourceId === source.id) ctx.groundAoEs.splice(i, 1);
  }
  ctx.groundAoEs.push({
    sourceId: source.id,
    pos: { ...source.pos },
    radius: effect.radius,
    min: 0,
    max: 0,
    remaining: effect.trap.lifetime,
    interval: effect.trap.lifetime,
    tickTimer: effect.trap.lifetime,
    school: 'frost',
    ability: abilityName,
    hunterTrap: {
      abilityId,
      armRemaining: effect.trap.armTime,
      freezeDuration: effect.duration,
      triggered: false,
    },
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: source.id,
    targetId: source.id,
    school: 'frost',
    fx: 'wardBloom',
  });
}

export function tickHunterTrap(ctx: SimContext, effect: GroundAoE): void {
  const trap = effect.hunterTrap;
  if (!trap || trap.triggered) return;
  if (trap.armRemaining > 0) {
    trap.armRemaining -= DT;
    return;
  }
  const source = ctx.entities.get(effect.sourceId);
  if (!source) return;
  // The maintainer's ground indicator: an armed trap shimmers every 2 sec (a
  // small frost ring on the existing spellfxAt channel, interest-scoped like
  // every event, so offline and online render identically). Deterministic.
  if (ctx.tickCount % SHIMMER_EVERY_TICKS === 0) {
    ctx.emit({
      type: 'spellfxAt',
      x: effect.pos.x,
      z: effect.pos.z,
      school: 'frost',
      fx: 'nova',
      radius: SHIMMER_RADIUS,
    });
  }
  for (const target of ctx.hostilesInRadius(
    source,
    effect.pos,
    effect.radius + SWEEP_QUERY_PADDING,
  )) {
    if (target.dead) continue;
    if (!segmentTouchesAnnulus(target.prevPos, target.pos, effect.pos, 0, effect.radius)) continue;
    trap.triggered = true;
    ctx.enterCombat(source, target);
    // The single-target freeze mirrors the old aoeRoot stun payload: unable
    // to move or act, on the controlled-stun DR bucket.
    const duration = ctx.diminishedCrowdControlDuration(
      source,
      target,
      'controlledStun',
      trap.freezeDuration,
    );
    if (duration !== null) {
      ctx.applyAura(target, {
        id: `${trap.abilityId}_freeze`,
        name: effect.ability ?? 'Trap',
        kind: 'stun',
        remaining: duration,
        duration,
        value: 0,
        sourceId: source.id,
        school: 'frost',
      });
    }
    ctx.emit({
      type: 'spellfxAt',
      x: effect.pos.x,
      z: effect.pos.z,
      school: 'frost',
      fx: 'nova',
      radius: effect.radius,
    });
    break;
  }
}
