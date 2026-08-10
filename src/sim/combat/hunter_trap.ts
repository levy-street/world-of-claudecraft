// Hunter trap (G6, fix/talents2-balance-pass): Rime Snare is a real trap, not
// an aimed nova. Placed at the hunter's feet, it arms after a short delay and
// freezes the FIRST enemy whose movement touches it, then is consumed. One
// trap per hunter at a time (the classic rule). The state rides the existing
// groundAoEs collection as a hunterTrap rider (the Ring of Frost pattern);
// this module owns the spawn and contact rules. Draws no rng.

import type { GroundAoE } from '../entity_roster';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { DT, dist2d } from '../types';
import { hunterBindingPayload, onHunterTrapTriggered } from './hunter_shared';
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

export interface FrostjawTrapEffect {
  radius: number;
  armTime: number;
  lifetime: number;
  rootDuration: number;
  slowMult: number;
  slowDuration: number;
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
    abilityId,
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

export function spawnFrostjawTrap(
  ctx: SimContext,
  source: Entity,
  effect: FrostjawTrapEffect,
  abilityName: string,
  abilityId: string,
  range: number,
): void {
  for (let i = ctx.groundAoEs.length - 1; i >= 0; i--) {
    const existing = ctx.groundAoEs[i];
    if (existing.hunterTrap && existing.sourceId === source.id) ctx.groundAoEs.splice(i, 1);
  }
  const selected = source.targetId === null ? null : ctx.entities.get(source.targetId);
  const center =
    selected &&
    !selected.dead &&
    ctx.isHostileTo(source, selected) &&
    Math.hypot(selected.pos.x - source.pos.x, selected.pos.z - source.pos.z) <= range &&
    ctx.hasLineOfSight(source, selected)
      ? selected.pos
      : source.pos;
  ctx.groundAoEs.push({
    sourceId: source.id,
    abilityId,
    pos: { ...center },
    radius: effect.radius,
    min: 0,
    max: 0,
    remaining: effect.lifetime,
    interval: effect.lifetime,
    tickTimer: effect.lifetime,
    school: 'frost',
    ability: abilityName,
    hunterTrap: {
      abilityId,
      armRemaining: effect.armTime,
      freezeDuration: effect.rootDuration,
      triggered: false,
      rootInstead: true,
      slowMult: effect.slowMult,
      slowDuration: effect.slowDuration,
    },
  });
  ctx.emit({
    type: 'spellfxAt',
    x: center.x,
    z: center.z,
    school: 'frost',
    fx: 'nova',
    radius: effect.radius,
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
      ability: trap.abilityId,
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
    if (trap.rootInstead) {
      const sourceMeta = ctx.players.get(source.id);
      const binding = sourceMeta ? hunterBindingPayload(sourceMeta) : false;
      const nearby = ctx
        .hostilesInRadius(source, effect.pos, effect.radius)
        .filter((enemy) => !enemy.dead)
        .sort((a, b) => dist2d(a.pos, effect.pos) - dist2d(b.pos, effect.pos) || a.id - b.id);
      for (const enemy of nearby) {
        if (binding || enemy.id === target.id) {
          ctx.applyAura(enemy, {
            id: `${trap.abilityId}_freeze`,
            name: effect.ability ?? 'Trap',
            kind: 'root',
            remaining: trap.freezeDuration,
            duration: trap.freezeDuration,
            value: 0,
            sourceId: source.id,
            school: 'frost',
          });
        }
        const slowDuration = (trap.slowDuration ?? 4) + (binding ? trap.freezeDuration : 0);
        ctx.applyAura(enemy, {
          id: `${trap.abilityId}_slow`,
          name: effect.ability ?? 'Trap',
          kind: 'slow',
          remaining: slowDuration,
          duration: slowDuration,
          value: binding ? 0.6 : (trap.slowMult ?? 0.5),
          sourceId: source.id,
          school: 'frost',
        });
      }
      onHunterTrapTriggered(ctx, source, effect.pos);
    } else {
      // The legacy Rime Snare retains its controlled-stun behavior.
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
    }
    ctx.emit({
      type: 'spellfxAt',
      x: effect.pos.x,
      z: effect.pos.z,
      school: 'frost',
      fx: 'nova',
      radius: effect.radius,
      ability: trap.abilityId,
    });
    break;
  }
}
