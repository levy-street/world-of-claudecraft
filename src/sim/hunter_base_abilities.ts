// Hunter base utility kit. The declarative records live in content/classes.ts;
// this module owns the mechanics that do not fit the generic effect vocabulary:
// source-scoped marking, collision-safe Disengage, Turtle's attack lockout,
// percentage healing, threat-dropping Feign Death, and single-trigger traps.

import { applyFixedHeal } from './combat/heal';
import { MOBS } from './data';
import { createGroundObject } from './entity';
import type { GroundAoE } from './entity_roster';
import { GRAVITY, JUMP_VELOCITY } from './player_motion';
import type { SimContext } from './sim_context';
import type { AbilityDef, Entity } from './types';
import { dist2d } from './types';
import { groundHeight } from './world';

export const HUNTERS_MARK_ID = 'hunters_mark';
export const ASPECT_OF_THE_TURTLE_ID = 'aspect_of_the_turtle';
export const FEIGN_DEATH_ID = 'feign_death';
export const HUNTER_FREEZING_TRAP_TEMPLATE = 'hunter_freezing_trap';

export function applyHuntersMark(
  ctx: SimContext,
  hunter: Entity,
  target: Entity | null,
  damageAmp: number,
  duration: number,
  name: string,
): void {
  if (!target || target.dead) return;
  for (const entity of ctx.entities.values()) {
    if (entity.id === target.id) continue;
    const oldMark = entity.auras.find(
      (aura) => aura.kind === 'hunter_mark' && aura.sourceId === hunter.id,
    );
    if (!oldMark) continue;
    entity.auras = entity.auras.filter(
      (aura) => !(aura.kind === 'hunter_mark' && aura.sourceId === hunter.id),
    );
    ctx.emit({ type: 'aura', targetId: entity.id, name: oldMark.name, gained: false });
  }
  ctx.applyAura(target, {
    id: HUNTERS_MARK_ID,
    name,
    kind: 'hunter_mark',
    remaining: duration,
    duration,
    value: damageAmp,
    sourceId: hunter.id,
    school: 'physical',
  });
}

export function huntersMarkDamageMultiplier(source: Entity | null, target: Entity): number {
  if (!source || source.id === target.id) return 1;
  const hunterId = source.kind === 'player' ? source.id : source.ownerId;
  if (hunterId === null) return 1;
  let amp = 0;
  for (const aura of target.auras) {
    if (aura.kind === 'hunter_mark' && aura.sourceId === hunterId) amp = Math.max(amp, aura.value);
  }
  return 1 + amp;
}

export function disengage(_ctx: SimContext, hunter: Entity, distance: number): void {
  // Use the normal airborne movement kernel so the retreat has a visible arc,
  // terrain collision, gravity, and the same authoritative snapshots online.
  const flightSeconds = (2 * JUMP_VELOCITY) / GRAVITY;
  const horizontalSpeed = distance / flightSeconds;
  hunter.vx = -Math.sin(hunter.facing) * horizontalSpeed;
  hunter.vz = -Math.cos(hunter.facing) * horizontalSpeed;
  hunter.vy = JUMP_VELOCITY;
  hunter.onGround = false;
  hunter.jumping = true;
  hunter.fallStartY = hunter.pos.y;
}

export function applyAspectOfTheTurtle(
  ctx: SimContext,
  hunter: Entity,
  reduction: number,
  duration: number,
  name: string,
): void {
  hunter.autoAttack = false;
  hunter.queuedOnSwing = null;
  delete hunter.queuedOnSwingFree;
  ctx.applyAura(hunter, {
    id: ASPECT_OF_THE_TURTLE_ID,
    name,
    kind: 'shield_wall',
    remaining: duration,
    duration,
    value: reduction,
    sourceId: hunter.id,
    school: 'physical',
  });
}

export function isProtectedByTurtle(entity: Entity): boolean {
  return entity.auras.some((aura) => aura.id === ASPECT_OF_THE_TURTLE_ID);
}

const OFFENSIVE_EFFECTS = new Set([
  'weaponDamage',
  'weaponStrike',
  'directDamage',
  'interrupt',
  'finisherDamage',
  'dot',
  'slow',
  'root',
  'stun',
  'incapacitate',
  'polymorph',
  'aoeDamage',
  'chainDamage',
  'groundAoE',
  'aoeAttackSpeed',
  'aoeAttackPower',
  'aoeRoot',
  'applyDebuff',
  'finisherStun',
  'charge',
  'faerieFire',
  'taunt',
  'freezingTrap',
  'explosiveShot',
  'hunterMultiShot',
  'powerfulShot',
]);

export function isOffensiveAbility(ability: AbilityDef): boolean {
  if (ability.requiresTarget && ability.targetType !== 'friendly') return true;
  return ability.effects.some((effect) => OFFENSIVE_EFFECTS.has(effect.type));
}

export function applyPercentMaxHeal(
  ctx: SimContext,
  hunter: Entity,
  percent: number,
  name: string,
): void {
  const amount = Math.round(hunter.maxHp * percent);
  if (amount <= 0 || hunter.hp >= hunter.maxHp) return;
  applyFixedHeal(ctx, hunter, hunter, amount, name);
}

export function isFeigningDeath(entity: Entity): boolean {
  return entity.auras.some((aura) => aura.id === FEIGN_DEATH_ID);
}

export function breakFeignDeath(ctx: SimContext, hunter: Entity): void {
  const index = hunter.auras.findIndex((aura) => aura.id === FEIGN_DEATH_ID);
  if (index < 0) return;
  const [aura] = hunter.auras.splice(index, 1);
  hunter.stealthed = hunter.auras.some((active) => active.kind === 'stealth');
  ctx.emit({ type: 'aura', targetId: hunter.id, name: aura.name, gained: false });
}

export function feignDeath(ctx: SimContext, hunter: Entity, duration: number, name: string): void {
  hunter.autoAttack = false;
  hunter.queuedOnSwing = null;
  delete hunter.queuedOnSwingFree;
  hunter.queuedCastAbility = null;
  hunter.queuedCastAim = null;

  for (const mob of ctx.entities.values()) {
    if (mob.kind !== 'mob' || mob.ownerId !== null || mob.dead) continue;
    const targetedHunter = mob.castTargetId === hunter.id;
    mob.threat.delete(hunter.id);
    if (mob.forcedTargetId === hunter.id) {
      mob.forcedTargetId = null;
      mob.forcedTargetTimer = 0;
    }
    if (targetedHunter && mob.castingAbility) ctx.cancelCast(mob);
    if (mob.aggroTargetId === hunter.id) ctx.retargetMob(mob);
  }

  ctx.applyAura(hunter, {
    id: FEIGN_DEATH_ID,
    name,
    kind: 'feign_death',
    remaining: duration,
    duration,
    value: 0,
    sourceId: hunter.id,
    school: 'physical',
  });
}

export type FreezingTrapGroundAoE = GroundAoE & {
  freezingTrapDuration: number;
  freezingTrapId: string;
  visualEntityId: number;
};

export function isFreezingTrap(effect: GroundAoE): effect is FreezingTrapGroundAoE {
  return effect.freezingTrapDuration !== undefined;
}

export function placeFreezingTrap(
  ctx: SimContext,
  hunter: Entity,
  pos: Entity['pos'],
  radius: number,
  trapDuration: number,
  incapacitateDuration: number,
  name: string,
): void {
  const grounded = { x: pos.x, y: groundHeight(pos.x, pos.z, ctx.cfg.seed), z: pos.z };
  const trap = createGroundObject(ctx.nextId++, '', name, grounded);
  trap.templateId = HUNTER_FREEZING_TRAP_TEMPLATE;
  trap.objectItemId = null;
  trap.lootable = false;
  ctx.addEntity(trap);
  ctx.emit({
    type: 'spellfxAt',
    x: grounded.x,
    z: grounded.z,
    school: 'frost',
    fx: 'nova',
    radius,
  });
  ctx.groundAoEs.push({
    sourceId: hunter.id,
    pos: grounded,
    radius,
    min: 0,
    max: 0,
    remaining: trapDuration,
    interval: 0.05,
    tickTimer: 0.05,
    school: 'frost',
    ability: name,
    freezingTrapDuration: incapacitateDuration,
    freezingTrapId: 'freezing_trap',
    visualEntityId: trap.id,
  });
}

export function triggerFreezingTrap(ctx: SimContext, effect: FreezingTrapGroundAoE): boolean {
  const hunter = ctx.entities.get(effect.sourceId);
  if (!hunter || hunter.dead) return false;
  const trapSource = { ...hunter, pos: effect.pos } as Entity;
  const targets = ctx
    .hostilesInRadius(hunter, effect.pos, effect.radius)
    .filter(
      (target) =>
        !target.dead &&
        ctx.hasLineOfSight(trapSource, target) &&
        !(target.kind === 'mob' && (target.ccImmune || MOBS[target.templateId]?.ccImmune)),
    )
    .sort((a, b) => dist2d(a.pos, effect.pos) - dist2d(b.pos, effect.pos) || a.id - b.id);
  const target = targets[0];
  if (!target) return false;
  ctx.applyAura(target, {
    id: effect.freezingTrapId,
    name: effect.ability,
    kind: 'incapacitate',
    remaining: effect.freezingTrapDuration,
    duration: effect.freezingTrapDuration,
    value: 0,
    sourceId: hunter.id,
    school: 'frost',
    breaksOnDamage: true,
  });
  ctx.enterCombat(hunter, target);
  return true;
}
