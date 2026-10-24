// Hunter trap (G6, fix/talents2-balance-pass): Rime Snare is a real trap, not
// an aimed nova. Placed at the hunter's feet, it arms after a short delay and
// freezes the FIRST enemy whose movement touches it, then is consumed. One
// trap per hunter at a time (the classic rule). The state rides the existing
// groundAoEs collection as a hunterTrap rider (the Ring of Frost pattern);
// this module owns the spawn and contact rules. Draws no rng.
//
// Fieldcraft rework (PR 4488): Frostjaw Trap and Bear Trap are thrown at an
// aimed ground point, one of each kind per hunter, and stay hidden from enemy
// players: their placement and armed shimmer are concealed events that the
// server delivers only to the hunter and their group. The trap springing is
// public.

import type { GroundAoE } from '../entity_roster';
import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';
import { DT, dist2d } from '../types';
import { hunterBindingPayload, onHunterTrapTriggered } from './hunter_shared';
import { hunterTrapBleedAmounts } from './hunter_trap_bleed';
import { segmentTouchesAnnulus } from './ring_of_frost';

// Hostile query padding so a fast mover cannot tunnel past the contact sweep.
const SWEEP_QUERY_PADDING = 30;
// Armed-trap ground indicator cadence and size (a subtle frost ring).
const SHIMMER_EVERY_TICKS = 40;
const SHIMMER_RADIUS = 1.2;
// Binding Payload's root when a Bear Trap springs (Frostjaw's authored 3 sec).
const BINDING_ROOT_DURATION = 3;

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

export interface BearTrapEffect {
  radius: number;
  armTime: number;
  lifetime: number;
  bleedTotal: number;
  bleedDuration: number;
  bleedInterval: number;
  rangedPowerCoeff: number;
  slowMult: number;
  slowDuration: number;
}

// One trap of each kind at a time: a new Frostjaw replaces the owner's previous
// Frostjaw, but leaves a Bear Trap they placed (and the reverse).
function clearOwnTrap(ctx: SimContext, source: Entity, abilityId: string): void {
  for (let i = ctx.groundAoEs.length - 1; i >= 0; i--) {
    const existing = ctx.groundAoEs[i];
    if (existing.hunterTrap?.abilityId === abilityId && existing.sourceId === source.id) {
      ctx.groundAoEs.splice(i, 1);
    }
  }
}

// Thrown traps land where the hunter aimed (castAim, already clamped to range by
// castAbility, the Hourglass of Suspension rule), or at their feet without aim.
function trapCenter(source: Entity): Entity['pos'] {
  return source.castAim ?? source.pos;
}

// The placement burst rides the concealed channel: only the hunter and their
// group see where the trap went down.
function emitPlacement(
  ctx: SimContext,
  source: Entity,
  center: Entity['pos'],
  school: string,
  radius: number,
  abilityId: string,
): void {
  ctx.emit({
    type: 'spellfxAt',
    x: center.x,
    z: center.z,
    school,
    fx: 'nova',
    radius,
    ability: abilityId,
    sourceId: source.id,
    concealedFromHostiles: true,
  });
}

export function spawnFrostjawTrap(
  ctx: SimContext,
  source: Entity,
  effect: FrostjawTrapEffect,
  abilityName: string,
  abilityId: string,
): void {
  clearOwnTrap(ctx, source, abilityId);
  const center = trapCenter(source);
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
      concealed: true,
    },
  });
  emitPlacement(ctx, source, center, 'frost', effect.radius, abilityId);
}

export function spawnBearTrap(
  ctx: SimContext,
  source: Entity,
  effect: BearTrapEffect,
  abilityName: string,
  abilityId: string,
): void {
  clearOwnTrap(ctx, source, abilityId);
  const center = trapCenter(source);
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
    school: 'physical',
    ability: abilityName,
    hunterTrap: {
      abilityId,
      armRemaining: effect.armTime,
      // A Bear Trap only roots under Binding Payload, for Frostjaw's 3 sec.
      freezeDuration: BINDING_ROOT_DURATION,
      triggered: false,
      slowMult: effect.slowMult,
      slowDuration: effect.slowDuration,
      concealed: true,
      bleed: {
        total: effect.bleedTotal + source.rangedPower * effect.rangedPowerCoeff,
        duration: effect.bleedDuration,
        interval: effect.bleedInterval,
      },
    },
  });
  emitPlacement(ctx, source, center, 'physical', effect.radius, abilityId);
}

// Bear Trap: the jaws close on the one enemy that stepped in. It bleeds (a
// physical DoT, refreshed by a later trap rather than stacked) and is slowed.
function springBearTrap(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  effect: GroundAoE,
  bleed: { total: number; duration: number; interval: number },
): void {
  const trap = effect.hunterTrap;
  if (!trap) return;
  const { perTick } = hunterTrapBleedAmounts(bleed);
  ctx.applyAura(target, {
    id: `${trap.abilityId}_bleed`,
    name: effect.ability ?? 'Bear Trap',
    kind: 'dot',
    remaining: bleed.duration,
    duration: bleed.duration,
    value: perTick,
    tickInterval: bleed.interval,
    tickTimer: bleed.interval,
    sourceId: source.id,
    school: 'physical',
  });
}

// Without Binding Payload, only the Bear Trap's victim is slowed.
function slowTrapVictim(ctx: SimContext, source: Entity, target: Entity, effect: GroundAoE): void {
  const trap = effect.hunterTrap;
  if (!trap) return;
  const slowDuration = trap.slowDuration ?? 4;
  ctx.applyAura(target, {
    id: `${trap.abilityId}_slow`,
    name: effect.ability ?? 'Trap',
    kind: 'slow',
    remaining: slowDuration,
    duration: slowDuration,
    value: trap.slowMult ?? 0.5,
    sourceId: source.id,
    school: effect.school as Aura['school'],
  });
}

// Frostjaw's root-and-slow, which Binding Payload extends to every trap: the
// victim (with Binding Payload, every enemy in the trigger area) is rooted for
// freezeDuration and every enemy in the area is slowed. Binding Payload's 40%
// slow outlasts the root by the trap's full slow duration.
function bindTrapArea(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  effect: GroundAoE,
  binding: boolean,
): void {
  const trap = effect.hunterTrap;
  if (!trap) return;
  const school = effect.school as Aura['school'];
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
        school,
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
      school,
    });
  }
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
      school: effect.school,
      fx: 'nova',
      radius: SHIMMER_RADIUS,
      ability: trap.abilityId,
      ...(trap.concealed ? { sourceId: source.id, concealedFromHostiles: true } : {}),
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
    // The trap talents (Binding Payload, Trapcraft, Chain Reaction) work on
    // "your traps": Frostjaw and Bear Trap alike.
    const sourceMeta = ctx.players.get(source.id);
    const binding = sourceMeta ? hunterBindingPayload(sourceMeta) : false;
    if (trap.bleed) {
      springBearTrap(ctx, source, target, effect, trap.bleed);
      if (binding) bindTrapArea(ctx, source, target, effect, true);
      else slowTrapVictim(ctx, source, target, effect);
      onHunterTrapTriggered(ctx, source, effect.pos);
    } else if (trap.rootInstead) {
      bindTrapArea(ctx, source, target, effect, binding);
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
    // The trap springing is visible to everyone nearby, concealed or not.
    ctx.emit({
      type: 'spellfxAt',
      x: effect.pos.x,
      z: effect.pos.z,
      school: effect.school,
      fx: 'nova',
      radius: effect.radius,
      ability: trap.abilityId,
    });
    break;
  }
}
