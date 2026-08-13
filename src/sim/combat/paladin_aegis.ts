import type { ResolvedAbility } from '../sim';
import type { SimContext } from '../sim_context';
import { channelTickBonus, directHealBonus } from '../spell_scaling';
import type { AbilityEffect, Entity } from '../types';

export const PALADIN_AEGIS_ID = 'aegis_first_dawn';
const PROTECTION_REFRESH_SECONDS = 0.15;

type AegisEffect = Extract<AbilityEffect, { type: 'paladinAegis' }>;

function effectOf(res: ResolvedAbility): AegisEffect | null {
  return (
    res.effects.find((effect): effect is AegisEffect => effect.type === 'paladinAegis') ?? null
  );
}

function protectionId(casterId: number): string {
  return `${PALADIN_AEGIS_ID}_dr:${casterId}`;
}

function eligibleAllies(ctx: SimContext, caster: Entity, radius: number): Entity[] {
  return ctx
    .friendliesInRadius(caster, caster.pos, radius)
    .filter((ally) => ally.kind === 'player' && ctx.hasLineOfSight(caster, ally));
}

function removeProtectionFrom(ctx: SimContext, target: Entity, casterId: number): void {
  const id = protectionId(casterId);
  for (let index = target.auras.length - 1; index >= 0; index--) {
    const aura = target.auras[index];
    if (aura.id !== id || aura.sourceId !== casterId) continue;
    target.auras.splice(index, 1);
    ctx.emit({ type: 'aura', targetId: target.id, name: aura.name, gained: false });
  }
}

export function syncPaladinAegisProtection(
  ctx: SimContext,
  caster: Entity,
  res: ResolvedAbility,
): boolean {
  const effect = effectOf(res);
  if (!effect) return false;

  const id = protectionId(caster.id);
  const inside = new Set(eligibleAllies(ctx, caster, effect.radius).map((ally) => ally.id));
  for (const entity of ctx.entities.values()) {
    if (!inside.has(entity.id)) removeProtectionFrom(ctx, entity, caster.id);
  }
  for (const ally of eligibleAllies(ctx, caster, effect.radius)) {
    const active = ally.auras.find((aura) => aura.id === id && aura.sourceId === caster.id);
    if (active) {
      active.remaining = PROTECTION_REFRESH_SECONDS;
      active.duration = PROTECTION_REFRESH_SECONDS;
      active.value = effect.damageReduction;
      continue;
    }
    ctx.applyAura(ally, {
      id,
      name: res.def.name,
      kind: 'shield_wall',
      remaining: PROTECTION_REFRESH_SECONDS,
      duration: PROTECTION_REFRESH_SECONDS,
      value: effect.damageReduction,
      sourceId: caster.id,
      school: 'holy',
    });
  }
  return true;
}

export function startPaladinAegis(ctx: SimContext, caster: Entity, res: ResolvedAbility): void {
  syncPaladinAegisProtection(ctx, caster, res);
}

export function tickPaladinAegis(ctx: SimContext, caster: Entity, res: ResolvedAbility): boolean {
  const effect = effectOf(res);
  if (!effect) return false;

  const spellPowerBonus = channelTickBonus(caster.spellPower, res.def);
  for (const ally of eligibleAllies(ctx, caster, effect.radius)) {
    const amount = ctx.rng.range(effect.tickMin, effect.tickMax) + spellPowerBonus;
    ctx.applyHeal(caster, ally, amount, res.def.name, res.def.id);
  }
  ctx.emit({
    type: 'spellfxAt',
    x: caster.pos.x,
    z: caster.pos.z,
    school: 'holy',
    fx: 'nova',
    radius: effect.radius,
  });
  return true;
}

export function cleanupPaladinAegis(ctx: SimContext, casterId: number): void {
  for (const entity of ctx.entities.values()) removeProtectionFrom(ctx, entity, casterId);
}

export function completePaladinAegis(
  ctx: SimContext,
  caster: Entity,
  res: ResolvedAbility,
): boolean {
  const effect = effectOf(res);
  if (!effect) return false;

  const finalBonus = directHealBonus(caster.spellPower, 0, true);
  for (const ally of eligibleAllies(ctx, caster, effect.radius)) {
    const amount = ctx.rng.range(effect.finalMin, effect.finalMax) + finalBonus;
    ctx.applyHeal(caster, ally, amount, res.def.name, res.def.id);
    ctx.applyAura(ally, {
      id: `${PALADIN_AEGIS_ID}_speed`,
      name: res.def.name,
      kind: 'buff_speed',
      remaining: effect.speedDuration,
      duration: effect.speedDuration,
      value: effect.speedMult,
      sourceId: caster.id,
      school: 'holy',
    });
  }
  cleanupPaladinAegis(ctx, caster.id);
  ctx.emit({
    type: 'spellfxAt',
    x: caster.pos.x,
    z: caster.pos.z,
    school: 'holy',
    fx: 'nova',
    radius: effect.radius,
  });
  return true;
}
