import { zoneAt } from '../data';
import type { GroundAoE } from '../entity_roster';
import type { SimContext } from '../sim_context';
import { type AbilityEffect, DT, type Entity, type Vec3 } from '../types';

export const TEMPORAL_HOURGLASS_ID = 'temporal_hourglass';

type HourglassEffect = Extract<AbilityEffect, { type: 'temporalHourglass' }>;

function distanceSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function nearestToAim(candidates: Entity[], aim: Vec3): Entity | null {
  candidates.sort((a, b) => distanceSq(a.pos, aim) - distanceSq(b.pos, aim) || a.id - b.id);
  return candidates[0] ?? null;
}

export function isProtectiveTemporalHourglass(entity: Entity): boolean {
  return entity.auras.some((aura) => aura.id === TEMPORAL_HOURGLASS_ID && aura.kind === 'stasis');
}

export function temporalHourglassCooldownDelta(entity: Entity, abilityId: string): number {
  if (abilityId === TEMPORAL_HOURGLASS_ID || !isProtectiveTemporalHourglass(entity)) return DT;
  const aura = entity.auras.find(
    (candidate) => candidate.id === TEMPORAL_HOURGLASS_ID && candidate.kind === 'stasis',
  );
  return DT * (aura?.value ?? 1);
}

export function tickTemporalHourglassHealing(
  ctx: SimContext,
  target: Entity,
  aura: import('../types').Aura,
): void {
  const ticks = aura.temporalHealTicksRemaining ?? 0;
  const remaining = aura.temporalHealRemaining ?? 0;
  if (ticks <= 0 || remaining <= 0) return;

  const planned = Math.ceil(remaining / ticks);
  aura.temporalHealRemaining = Math.max(0, remaining - planned);
  aura.temporalHealTicksRemaining = ticks - 1;
  const healed = Math.min(planned, target.maxHp - target.hp);
  if (healed <= 0) return;

  target.hp += healed;
  ctx.emit({
    type: 'heal2',
    sourceId: aura.sourceId,
    targetId: target.id,
    amount: healed,
    crit: false,
    ability: aura.name,
  });
  const source = ctx.entities.get(aura.sourceId);
  if (source) ctx.healingThreat(source, target, healed);
}

function applyProtectiveStasis(
  ctx: SimContext,
  caster: Entity,
  target: Entity,
  effect: HourglassEffect,
  abilityName: string,
  cooldownRate: number,
): boolean {
  if (target.castingAbility) ctx.cancelCast(target);
  target.autoAttack = false;
  ctx.applyAura(target, {
    id: TEMPORAL_HOURGLASS_ID,
    name: abilityName,
    kind: 'stasis',
    remaining: effect.duration,
    duration: effect.duration,
    value: cooldownRate,
    tickInterval: 1,
    tickTimer: 1,
    sourceId: caster.id,
    school: 'arcane',
    temporalHealRemaining: Math.round(target.maxHp * effect.healMaxHpPct),
    temporalHealTicksRemaining: Math.round(effect.duration),
  });
  return target.auras.some((aura) => aura.id === TEMPORAL_HOURGLASS_ID && aura.kind === 'stasis');
}

function validPartyAlly(ctx: SimContext, caster: Entity, target: Entity): boolean {
  const party = ctx.partyOf(caster.id);
  return Boolean(
    party?.members.includes(target.id) &&
      !ctx.isHostileTo(caster, target) &&
      target.id !== caster.id &&
      target.kind === 'player' &&
      !target.dead &&
      target.hp > 0,
  );
}

function applyHostileSuspension(
  ctx: SimContext,
  caster: Entity,
  target: Entity,
  effect: HourglassEffect,
  abilityName: string,
): boolean {
  // PvP uses the fixed provisional duration requested for this ability. The
  // canonical aura path still enforces control immunity and damage breaking.
  const duration = ctx.pvpController(target)
    ? effect.hostilePvpDuration
    : effect.hostilePveDuration;
  ctx.applyAura(target, {
    id: TEMPORAL_HOURGLASS_ID,
    name: abilityName,
    kind: 'incapacitate',
    remaining: duration,
    duration,
    value: 0,
    sourceId: caster.id,
    school: 'arcane',
    breaksOnDamage: true,
  });
  const applied = target.auras.some(
    (aura) => aura.id === TEMPORAL_HOURGLASS_ID && aura.kind === 'incapacitate',
  );
  if (applied) ctx.enterCombat(caster, target);
  return applied;
}

function spawnGroundHourglass(
  ctx: SimContext,
  caster: Entity,
  aim: Vec3,
  effect: HourglassEffect,
  abilityName: string,
): void {
  ctx.groundAoEs.push({
    sourceId: caster.id,
    pos: { ...aim },
    radius: effect.captureRadius,
    min: 0,
    max: 0,
    remaining: effect.groundDuration,
    interval: effect.groundDuration,
    tickTimer: effect.groundDuration,
    school: 'arcane',
    ability: abilityName,
    temporalHourglass: {
      id: `${caster.id}:${Math.round(ctx.time / DT)}`,
      abilityId: TEMPORAL_HOURGLASS_ID,
      protectiveDuration: effect.duration,
      hostilePveDuration: effect.hostilePveDuration,
      hostilePvpDuration: effect.hostilePvpDuration,
      groundDuration: effect.groundDuration,
      healMaxHpPct: effect.healMaxHpPct,
      selfCooldownRate: effect.selfCooldownRate,
      allyCooldownRate: effect.allyCooldownRate,
      createdTick: ctx.tickCount,
      sourceOrigin: { ...caster.pos },
      sourceZoneId: zoneAt(caster.pos.z).id,
    },
  });
}

function segmentDiskContact(start: Vec3, end: Vec3, center: Vec3, radius: number): number | null {
  const sx = start.x - center.x;
  const sz = start.z - center.z;
  const radiusSq = radius * radius;
  if (sx * sx + sz * sz <= radiusSq) return 0;
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const a = dx * dx + dz * dz;
  if (a <= 0) return null;
  const b = 2 * (sx * dx + sz * dz);
  const c = sx * sx + sz * sz - radiusSq;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

function effectFromGround(effect: GroundAoE): HourglassEffect | null {
  const state = effect.temporalHourglass;
  if (!state) return null;
  return {
    type: 'temporalHourglass',
    duration: state.protectiveDuration,
    hostilePveDuration: state.hostilePveDuration,
    hostilePvpDuration: state.hostilePvpDuration,
    groundDuration: state.groundDuration,
    selfRadius: effect.radius,
    captureRadius: effect.radius,
    healMaxHpPct: state.healMaxHpPct,
    selfCooldownRate: state.selfCooldownRate,
    allyCooldownRate: state.allyCooldownRate,
  };
}

export function tickTemporalHourglassGround(ctx: SimContext, ground: GroundAoE): boolean {
  const source = ctx.entities.get(ground.sourceId);
  const effect = effectFromGround(ground);
  if (!source || source.dead || !effect) return false;
  const createdTick = ground.temporalHourglass?.createdTick;

  const contacts = [...ctx.entities.values()]
    .filter((target) => !target.dead && target.hp > 0 && target.kind !== 'object')
    .flatMap((target) => {
      const start =
        createdTick !== undefined && ctx.tickCount === createdTick + 1
          ? target.pos
          : target.prevPos;
      const contact = segmentDiskContact(start, target.pos, ground.pos, ground.radius);
      return contact === null ? [] : [{ target, contact }];
    })
    .sort((a, b) => a.contact - b.contact || a.target.id - b.target.id);

  for (const { target } of contacts) {
    if (target.id === source.id) {
      if (
        applyProtectiveStasis(ctx, source, source, effect, ground.ability, effect.selfCooldownRate)
      )
        return true;
      continue;
    }
    if (validPartyAlly(ctx, source, target)) {
      if (
        applyProtectiveStasis(ctx, source, target, effect, ground.ability, effect.allyCooldownRate)
      )
        return true;
      continue;
    }
    if (
      ctx.isHostileTo(source, target) &&
      applyHostileSuspension(ctx, source, target, effect, ground.ability)
    )
      return true;
  }
  return false;
}

export function applyTemporalHourglass(
  ctx: SimContext,
  caster: Entity,
  aim: Vec3,
  effect: HourglassEffect,
  abilityName: string,
): void {
  if (distanceSq(caster.pos, aim) <= effect.selfRadius * effect.selfRadius) {
    applyProtectiveStasis(ctx, caster, caster, effect, abilityName, effect.selfCooldownRate);
    return;
  }

  const party = ctx.partyOf(caster.id);
  if (party) {
    const allies = party.members
      .map((id) => ctx.entities.get(id))
      .filter(
        (candidate): candidate is Entity =>
          candidate !== undefined &&
          candidate.id !== caster.id &&
          candidate.kind === 'player' &&
          !candidate.dead &&
          candidate.hp > 0 &&
          !ctx.isHostileTo(caster, candidate) &&
          distanceSq(candidate.pos, aim) <= effect.captureRadius * effect.captureRadius &&
          ctx.hasLineOfSight(caster, candidate),
      );
    const ally = nearestToAim(allies, aim);
    if (ally) {
      applyProtectiveStasis(ctx, caster, ally, effect, abilityName, effect.allyCooldownRate);
      return;
    }
  }

  const hostile = nearestToAim(
    ctx
      .hostilesInRadius(caster, aim, effect.captureRadius)
      .filter(
        (candidate) => !candidate.dead && candidate.hp > 0 && ctx.hasLineOfSight(caster, candidate),
      ),
    aim,
  );
  if (!hostile) {
    spawnGroundHourglass(ctx, caster, aim, effect, abilityName);
    return;
  }
  applyHostileSuspension(ctx, caster, hostile, effect, abilityName);
}
