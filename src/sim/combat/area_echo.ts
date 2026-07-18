import type { SimContext } from '../sim_context';
import type { AbilityDef, AbilityEffect, Entity } from '../types';

export const AOE_ECHO_RADIUS = 8;
export const AOE_ECHO_MULT = 0.4;
export const AOE_ECHO_MAX_TARGETS = 4;
export const SWEEP_MULT = 1;

export function abilityQualifiesForAreaEcho(effects: readonly AbilityEffect[]): boolean {
  const singleTarget = effects.some(
    (effect) => effect.type === 'weaponStrike' || effect.type === 'directDamage',
  );
  return (
    singleTarget &&
    !effects.some(
      (effect) =>
        effect.type === 'aoeDamage' || effect.type === 'aoeRoot' || effect.type === 'groundAoE',
    )
  );
}

export function hasAreaEchoAura(entity: Entity): boolean {
  return entity.auras.some((aura) => aura.kind === 'aoe_echo');
}

export function hasSweepingStrikes(entity: Entity): boolean {
  return entity.auras.some((aura) => aura.kind === 'sweeping_strikes');
}

function replayDamage(
  ctx: SimContext,
  source: Entity,
  primary: Entity,
  amount: number,
  multiplier: number,
  maxTargets: number,
  school: AbilityDef['school'],
  abilityName: string,
  threat: { flat?: number; mult?: number },
): void {
  const replayed = Math.max(1, Math.round(amount * multiplier));
  let targets = 0;
  for (const hostile of ctx.hostilesInRadius(source, primary.pos, AOE_ECHO_RADIUS)) {
    if (hostile.id === primary.id || !ctx.hasLineOfSight(source, hostile)) continue;
    ctx.dealDamage(source, hostile, replayed, false, school, abilityName, 'hit', false, threat);
    targets += 1;
    if (targets >= maxTargets) return;
  }
}

export function echoAreaDamage(
  ctx: SimContext,
  source: Entity,
  primary: Entity,
  amount: number,
  school: AbilityDef['school'],
  abilityName: string,
  threat: { flat?: number; mult?: number },
): void {
  replayDamage(
    ctx,
    source,
    primary,
    amount,
    AOE_ECHO_MULT,
    AOE_ECHO_MAX_TARGETS,
    school,
    abilityName,
    threat,
  );
}

export function sweepStrikeDamage(
  ctx: SimContext,
  source: Entity,
  primary: Entity,
  amount: number,
  school: AbilityDef['school'],
  abilityName: string,
  threat: { flat?: number; mult?: number },
): void {
  replayDamage(ctx, source, primary, amount, SWEEP_MULT, 1, school, abilityName, threat);
}

export function consumeAreaEchoCharge(ctx: SimContext, entity: Entity): void {
  const index = entity.auras.findIndex((aura) => aura.kind === 'aoe_echo');
  if (index < 0) return;
  const aura = entity.auras[index];
  const remaining = (aura.charges ?? 1) - 1;
  if (remaining <= 0) {
    entity.auras.splice(index, 1);
    ctx.emit({ type: 'aura', targetId: entity.id, name: aura.name, gained: false });
    return;
  }
  aura.charges = remaining;
}
