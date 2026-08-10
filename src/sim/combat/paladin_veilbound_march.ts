import { grantAbilityDevotion } from '../paladin_devotion';
import type { SimContext } from '../sim_context';
import { type AbilityEffect, type Aura, CAST_COMPLETE_EPS, DT, type Entity } from '../types';
import { isUnbreakableControlAura } from './cc';
import { relocateSwept } from './heroic_leap';
import { isVeilboundMarchActive, VEILBOUND_MARCH_ID } from './paladin_veilbound_state';

export const VEILBOUND_MARK_ID = 'veilbound_mark';
export const VEILBOUND_MARK_NAME = 'Veil Mark';

type VeilboundMarchEffect = Extract<AbilityEffect, { type: 'veilboundMarch' }>;

function marchAura(entity: Entity): Aura | null {
  return entity.auras.find((aura) => aura.id === VEILBOUND_MARCH_ID) ?? null;
}

export function veilboundMarchBlocksAura(target: Entity, aura: Aura): boolean {
  return (
    aura.sourceId !== target.id &&
    (aura.kind === 'root' || aura.kind === 'slow') &&
    isVeilboundMarchActive(target)
  );
}

export function veilboundMarkDamageMultiplier(source: Entity | null, target: Entity): number {
  if (!source || source.id === target.id) return 1;
  return source.auras.some((aura) => aura.id === VEILBOUND_MARK_ID && aura.sourceId === target.id)
    ? 0.8
    : 1;
}

function removeMovementControl(ctx: SimContext, caster: Entity): void {
  for (let index = caster.auras.length - 1; index >= 0; index--) {
    const aura = caster.auras[index];
    if ((aura.kind !== 'root' && aura.kind !== 'slow') || isUnbreakableControlAura(aura)) continue;
    caster.auras.splice(index, 1);
    ctx.emit({ type: 'aura', targetId: caster.id, name: aura.name, gained: false });
  }
}

export function activateVeilboundMarch(
  ctx: SimContext,
  caster: Entity,
  effect: VeilboundMarchEffect,
  abilityName: string,
): void {
  removeMovementControl(ctx, caster);
  ctx.applyAura(caster, {
    id: VEILBOUND_MARCH_ID,
    name: abilityName,
    kind: 'buff_speed',
    remaining: effect.duration,
    duration: effect.duration,
    value: effect.speedMult,
    value2: effect.ascended ? 1 : 0,
    value3: 0,
    stacks: 0,
    sourceId: caster.id,
    school: 'holy',
  });
  ctx.applyAura(caster, {
    id: `${VEILBOUND_MARCH_ID}_armor`,
    name: abilityName,
    kind: 'buff_armor_pct',
    remaining: effect.duration,
    duration: effect.duration,
    value: effect.armorPct,
    sourceId: caster.id,
    school: 'holy',
  });
}

function distanceSqToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq <= 1e-8) return (px - ax) ** 2 + (pz - az) ** 2;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq));
  const nearestX = ax + dx * t;
  const nearestZ = az + dz * t;
  return (px - nearestX) ** 2 + (pz - nearestZ) ** 2;
}

export function updateVeilboundMarchMovement(ctx: SimContext, caster: Entity): void {
  const active = marchAura(caster);
  if (!active) return;
  const fromX = caster.prevPos.x;
  const fromZ = caster.prevPos.z;
  const toX = caster.pos.x;
  const toZ = caster.pos.z;
  const travel = Math.hypot(toX - fromX, toZ - fromZ);
  const contactRadius = 1.1;
  const midpoint = { x: (fromX + toX) * 0.5, y: caster.pos.y, z: (fromZ + toZ) * 0.5 };
  const candidates = ctx
    .hostilesInRadius(caster, midpoint, travel * 0.5 + contactRadius)
    .filter(
      (target) =>
        !target.dead &&
        distanceSqToSegment(target.pos.x, target.pos.z, fromX, fromZ, toX, toZ) <=
          contactRadius ** 2,
    )
    .sort((left, right) => left.id - right.id);

  for (const target of candidates) {
    if (target.auras.some((aura) => aura.id === VEILBOUND_MARK_ID && aura.sourceId === caster.id))
      continue;
    ctx.applyAura(target, {
      id: VEILBOUND_MARK_ID,
      name: VEILBOUND_MARK_NAME,
      kind: 'dot',
      remaining: 6,
      duration: 6,
      value: 12,
      tickInterval: 1,
      tickTimer: 1,
      threatMult: 3,
      sourceId: caster.id,
      school: 'holy',
    });
    // Marking is a ghost-walk touch, not an attack: it must NOT flip an idle
    // mob into chase (owner ruling 2026-08-08). Combat entry comes from the
    // mark's own damage ticks through the normal damage path, so a marked mob
    // that never takes a tick stays where it stands.
    if ((active.value3 ?? 0) === 0) {
      active.value3 = 1;
      grantAbilityDevotion(caster, 1);
    }
  }
}

function pullMarkedEnemy(ctx: SimContext, caster: Entity, target: Entity, distance: number): void {
  if (isVeilboundMarchActive(target)) return;
  const dx = target.pos.x - caster.pos.x;
  const dz = target.pos.z - caster.pos.z;
  const current = Math.hypot(dx, dz);
  if (current <= 1e-6) return;
  const nextDistance = Math.max(1, current - distance);
  relocateSwept(ctx, target, {
    x: caster.pos.x + (dx / current) * nextDistance,
    y: target.pos.y,
    z: caster.pos.z + (dz / current) * nextDistance,
  });
  ctx.grid.update(target);
  if (target.kind === 'player') ctx.playerGrid.update(target);
}

export function completeVeilboundMarch(ctx: SimContext, caster: Entity): void {
  const active = marchAura(caster);
  if (!active || active.remaining > DT + CAST_COMPLETE_EPS || (active.stacks ?? 0) > 0) return;
  active.stacks = 1;
  const ascended = (active.value2 ?? 0) > 0;
  const amount = ascended ? 54 : 36;
  const marked = [...ctx.entities.values()]
    .filter(
      (target) =>
        !target.dead &&
        target.auras.some((aura) => aura.id === VEILBOUND_MARK_ID && aura.sourceId === caster.id) &&
        Math.hypot(target.pos.x - caster.pos.x, target.pos.z - caster.pos.z) <= 10,
    )
    .sort((left, right) => left.id - right.id);
  for (const target of marked) {
    ctx.dealDamage(
      caster,
      target,
      amount,
      false,
      'holy',
      'Veilbound March',
      'hit',
      false,
      { mult: 3 },
      true,
      false,
      false,
      VEILBOUND_MARCH_ID,
      true,
    );
    if (ascended && !target.dead) pullMarkedEnemy(ctx, caster, target, 2);
  }
  ctx.emit({
    type: 'spellfxAt',
    x: caster.pos.x,
    z: caster.pos.z,
    school: 'holy',
    fx: 'nova',
    radius: 10,
  });
}
