// Marksmanship Hunter mechanics that need more than the generic ability vocabulary.
// Content values stay in content/classes.ts; this module owns delayed ammunition,
// target-centred Multi-Shot, Trick Shots ricochets, Trueshot recovery, and the
// server-authoritative Powershot geometry and Hunter-specific procs.

import { recalcPlayerStats } from './entity';
import type { PlayerMeta, ResolvedAbility } from './sim';
import type { SimContext } from './sim_context';
import { abilityScalingPower, directHitBonus } from './spell_scaling';
import type { Aura, Entity } from './types';
import { armorReduction, dist2d } from './types';

export const TRUESHOT_ID = 'trueshot';
export const TRICK_SHOTS_ID = 'hunter_trick_shots';
export const DEATHBLOW_ID = 'deathblow';
const RAPID_FIRE_TRICK_SHOTS_ID = 'rapid_fire_trick_shots';

function physicalShotDamage(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  res: ResolvedAbility,
  min: number,
  max: number,
  aoe = false,
  multiplier = 1,
  attackAnimationStarted = false,
): number {
  let amount =
    (ctx.rng.range(min, max) +
      directHitBonus(abilityScalingPower(source, res.def), res.def, res.castTime, aoe)) *
    multiplier;
  const crit = ctx.rng.chance(source.critChance);
  if (crit) amount *= 2 + source.critDmgPhysBonus;
  amount *= 1 - armorReduction(ctx.effectiveArmor(target), source.level);
  const rounded = Math.max(1, Math.round(amount));
  ctx.dealDamage(
    source,
    target,
    rounded,
    crit,
    'physical',
    res.def.name,
    'hit',
    false,
    {
      flat: res.threatFlat,
      mult: res.threatMult,
    },
    true,
    attackAnimationStarted,
  );
  return rounded;
}

function ricochetTargets(
  ctx: SimContext,
  source: Entity,
  primary: Entity,
  radius: number,
  jumps = 2,
): Entity[] {
  return ctx
    .hostilesInRadius(source, primary.pos, radius)
    .filter(
      (target) => target.id !== primary.id && !target.dead && ctx.hasLineOfSight(primary, target),
    )
    .sort((a, b) => dist2d(a.pos, primary.pos) - dist2d(b.pos, primary.pos) || a.id - b.id)
    .slice(0, jumps);
}

export function applyTrueshot(
  ctx: SimContext,
  hunter: Entity,
  meta: PlayerMeta,
  duration: number,
  critChance: number,
  critDamage: number,
  name: string,
): void {
  ctx.applyAura(hunter, {
    id: TRUESHOT_ID,
    name,
    kind: 'trueshot',
    remaining: duration,
    duration,
    value: critChance,
    value2: critDamage,
    sourceId: hunter.id,
    school: 'physical',
  });
  recalcPlayerStats(hunter, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
}

export function hunterCooldownRecoveryRate(hunter: Entity, abilityId: string): number {
  if (!hunter.auras.some((aura) => aura.id === TRUESHOT_ID)) return 1;
  if (abilityId === 'aimed_shot') return 1.4;
  if (abilityId === 'rapid_fire') return 1.6;
  return 1;
}

export function applyExplosiveShot(
  ctx: SimContext,
  hunter: Entity,
  target: Entity | null,
  duration: number,
  name: string,
): void {
  if (!target || target.dead) return;
  ctx.enterCombat(hunter, target);
  ctx.applyAura(target, {
    id: 'explosive_shot',
    name,
    kind: 'explosive_shot',
    remaining: duration,
    duration,
    value: 0,
    sourceId: hunter.id,
    school: 'fire',
  });
}

export function detonateExplosiveShot(ctx: SimContext, target: Entity, aura: Aura): void {
  const hunter = ctx.entities.get(aura.sourceId);
  if (!hunter || hunter.dead) return;
  const resolved = ctx.resolvedAbility('explosive_shot', hunter.id);
  const effect = resolved?.effects.find((candidate) => candidate.type === 'explosiveShot');
  if (!resolved || !effect) return;
  ctx.emit({
    type: 'spellfxAt',
    x: target.pos.x,
    z: target.pos.z,
    school: 'fire',
    fx: 'nova',
    radius: effect.radius,
  });
  for (const enemy of ctx.hostilesInRadius(hunter, target.pos, effect.radius)) {
    if (!ctx.hasLineOfSight(target, enemy)) continue;
    physicalShotDamage(ctx, hunter, enemy, resolved, effect.min, effect.max, true);
  }
}

export function fireHunterMultiShot(
  ctx: SimContext,
  hunter: Entity,
  target: Entity | null,
  res: ResolvedAbility,
  min: number,
  max: number,
  radius: number,
  softCap: number,
): void {
  if (!target || target.dead) return;
  const targets = ctx
    .hostilesInRadius(hunter, target.pos, radius)
    .filter((enemy) => !enemy.dead && ctx.hasLineOfSight(hunter, enemy))
    .sort((a, b) => a.id - b.id);
  const multiplier = targets.length > softCap ? softCap / targets.length : 1;
  for (const enemy of targets) {
    ctx.emit({
      type: 'spellfx',
      sourceId: hunter.id,
      targetId: enemy.id,
      school: 'physical',
      fx: 'projectile',
      abilityId: 'multi_shot',
      attackAnimation: 'ranged-shot',
      projectileStyle: 'hunter-arrow',
    });
    physicalShotDamage(ctx, hunter, enemy, res, min, max, true, multiplier, true);
  }
  if (targets.length >= 2) {
    ctx.applyAura(hunter, {
      id: TRICK_SHOTS_ID,
      name: 'Trick Shots',
      kind: 'hunter_ricochet',
      remaining: 20,
      duration: 20,
      value: 0.7,
      sourceId: hunter.id,
      school: 'physical',
    });
  }
}

function consumeTrickShots(ctx: SimContext, hunter: Entity): Aura | null {
  const index = hunter.auras.findIndex((aura) => aura.id === TRICK_SHOTS_ID);
  if (index < 0) return null;
  const [aura] = hunter.auras.splice(index, 1);
  ctx.emit({
    type: 'aura',
    targetId: hunter.id,
    name: aura.name,
    gained: false,
  });
  return aura;
}

export function aimedShotRicochet(
  ctx: SimContext,
  hunter: Entity,
  primary: Entity,
  dealt: number,
  abilityName: string,
): void {
  const trick = consumeTrickShots(ctx, hunter);
  if (!trick) return;
  for (const enemy of ricochetTargets(ctx, hunter, primary, 10)) {
    ctx.emit({
      type: 'spellfx',
      sourceId: primary.id,
      targetId: enemy.id,
      school: 'physical',
      fx: 'projectile',
    });
    ctx.dealDamage(
      hunter,
      enemy,
      Math.max(1, Math.round(dealt * trick.value)),
      false,
      'physical',
      abilityName,
      'hit',
    );
  }
}

export function maybeProcDeathblow(ctx: SimContext, hunter: Entity): void {
  const meta = ctx.resolve(hunter.id)?.meta;
  if (meta?.talents.spec !== 'marksmanship' || !ctx.rng.chance(0.1)) return;
  ctx.applyAura(hunter, {
    id: DEATHBLOW_ID,
    name: 'Deathblow',
    kind: 'hunter_execute_override',
    remaining: 20,
    duration: 20,
    value: 0,
    sourceId: hunter.id,
    school: 'physical',
  });
}

export function maybeProcLockAndLoad(ctx: SimContext, hunter: Entity): void {
  const meta = ctx.resolve(hunter.id)?.meta;
  if (meta?.talents.spec !== 'marksmanship' || !ctx.rng.chance(0.1)) return;
  ctx.applyAura(hunter, {
    id: 'lock_and_load',
    name: 'Lock and Load',
    kind: 'next_cast_free_instant',
    remaining: 20,
    duration: 20,
    value: 0,
    sourceId: hunter.id,
    school: 'physical',
    empowerAbilities: ['aimed_shot'],
  });
}

export function hasDeathblow(hunter: Entity): boolean {
  return hunter.auras.some((aura) => aura.id === DEATHBLOW_ID);
}

export function consumeDeathblow(ctx: SimContext, hunter: Entity): boolean {
  const index = hunter.auras.findIndex((aura) => aura.id === DEATHBLOW_ID);
  if (index < 0) return false;
  const [aura] = hunter.auras.splice(index, 1);
  ctx.emit({
    type: 'aura',
    targetId: hunter.id,
    name: aura.name,
    gained: false,
  });
  return true;
}

export function rapidFireRicochet(
  ctx: SimContext,
  hunter: Entity,
  primary: Entity,
  dealt: number,
  abilityName: string,
): void {
  let active = hunter.auras.find((aura) => aura.id === RAPID_FIRE_TRICK_SHOTS_ID);
  if (!active) {
    const trick = consumeTrickShots(ctx, hunter);
    if (!trick) return;
    ctx.applyAura(hunter, {
      ...trick,
      id: RAPID_FIRE_TRICK_SHOTS_ID,
      name: 'Trick Shots: Rapid Fire',
      kind: 'hunter_ricochet',
      remaining: 5,
      duration: 5,
    });
    active = hunter.auras.find((aura) => aura.id === RAPID_FIRE_TRICK_SHOTS_ID);
  }
  if (!active) return;
  for (const enemy of ricochetTargets(ctx, hunter, primary, 10))
    ctx.dealDamage(
      hunter,
      enemy,
      Math.max(1, Math.round(dealt * active.value)),
      false,
      'physical',
      abilityName,
      'hit',
    );
}

export function firePowerfulShot(
  ctx: SimContext,
  hunter: Entity,
  res: ResolvedAbility,
  fraction: number,
): void {
  const effect = res.effects.find((candidate) => candidate.type === 'powerfulShot');
  if (!effect) return;
  const charge = Math.max(0, Math.min(1, fraction));
  const length = effect.minLength + (effect.maxLength - effect.minLength) * charge;
  const width = effect.minWidth + (effect.maxWidth - effect.minWidth) * charge;
  const forwardX = Math.sin(hunter.facing);
  const forwardZ = Math.cos(hunter.facing);
  const candidates = ctx
    .hostilesInRadius(hunter, hunter.pos, Math.hypot(length, width / 2))
    .map((target) => {
      const dx = target.pos.x - hunter.pos.x;
      const dz = target.pos.z - hunter.pos.z;
      return {
        target,
        forward: dx * forwardX + dz * forwardZ,
        lateral: Math.abs(dx * forwardZ - dz * forwardX),
      };
    })
    .filter(({ forward, lateral }) => forward > 0 && forward <= length && lateral <= width / 2)
    .sort((a, b) => a.forward - b.forward || a.target.id - b.target.id);
  ctx.emit({
    type: 'powerfulShotFx',
    sourceId: hunter.id,
    x: hunter.pos.x + forwardX * length,
    z: hunter.pos.z + forwardZ * length,
  });
  const damageScale =
    effect.minDamageScale + (effect.maxDamageScale - effect.minDamageScale) * charge;
  for (const { target } of candidates)
    physicalShotDamage(ctx, hunter, target, res, effect.min, effect.max, false, damageScale);
}
