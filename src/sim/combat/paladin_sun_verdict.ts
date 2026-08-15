import type { SimContext } from '../sim_context';
import { stunDrCategory } from '../stun_dr';
import type { AbilityEffect, Aura, Entity } from '../types';

export const PALADIN_SUN_GOD_VERDICT_ID = 'sun_gods_verdict';
export const FINAL_EDICT_ID = 'final_edict';
export const DAWNFALL_ID = 'dawnfall';
const DETONATION_FLASH_DURATION = 0.2;

export type SunGodVerdictEffect = Extract<AbilityEffect, { type: 'sunGodVerdict' }>;
export type SunGodVerdictDetonation = 'singleTarget' | 'area';

export function sunVerdictAbilityGlowActive(
  auras: readonly { kind: Aura['kind']; sourceId?: number }[] | undefined,
  sourceId: number | undefined,
  abilityId: string,
): boolean {
  if (
    auras === undefined ||
    sourceId === undefined ||
    (abilityId !== FINAL_EDICT_ID && abilityId !== DAWNFALL_ID)
  ) {
    return false;
  }
  for (const aura of auras) {
    if (aura.kind === 'sun_verdict' && aura.sourceId === sourceId) return true;
  }
  return false;
}

function isSunVerdictAura(aura: Aura, sourceId: number): boolean {
  return (
    aura.id === PALADIN_SUN_GOD_VERDICT_ID &&
    aura.kind === 'sun_verdict' &&
    aura.sourceId === sourceId
  );
}

export function sunVerdictMarkForHit(target: Entity, sourceId: number): Aura | null {
  return target.auras.find((aura) => isSunVerdictAura(aura, sourceId)) ?? null;
}

export function applySunGodVerdict(
  ctx: SimContext,
  caster: Entity,
  target: Entity,
  effect: SunGodVerdictEffect,
  abilityName: string,
): void {
  stripSunGodVerdicts(ctx, caster.id);
  ctx.applyAura(target, {
    id: PALADIN_SUN_GOD_VERDICT_ID,
    name: abilityName,
    kind: 'sun_verdict',
    remaining: effect.duration,
    duration: effect.duration,
    value: 0,
    sourceId: caster.id,
    school: 'holy',
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: caster.id,
    targetId: target.id,
    school: 'holy',
    fx: 'wardBloom',
  });
  ctx.enterCombat(caster, target);
}

function detonateSingleTarget(
  ctx: SimContext,
  caster: Entity,
  target: Entity,
  effect: SunGodVerdictEffect,
  abilityName: string,
): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: caster.id,
    targetId: target.id,
    school: 'holy',
    fx: 'paladinAscensionImpact',
    ability: PALADIN_SUN_GOD_VERDICT_ID,
    impact: 'offensive',
  });
  if (target.dead) return;
  ctx.dealDamage(
    caster,
    target,
    Math.round(ctx.rng.range(effect.singleTargetMin, effect.singleTargetMax)),
    false,
    'holy',
    abilityName,
    'hit',
    false,
    undefined,
    true,
    false,
    false,
    PALADIN_SUN_GOD_VERDICT_ID,
  );
}

function detonateArea(
  ctx: SimContext,
  caster: Entity,
  target: Entity,
  effect: SunGodVerdictEffect,
  abilityName: string,
): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: caster.id,
    targetId: target.id,
    school: 'holy',
    fx: 'paladinAscensionImpact',
    ability: PALADIN_SUN_GOD_VERDICT_ID,
    impact: 'offensive',
  });
  ctx.emit({
    type: 'spellfxAt',
    x: target.pos.x,
    z: target.pos.z,
    school: 'holy',
    fx: 'nova',
    radius: effect.areaRadius,
  });

  const victims = ctx
    .hostilesInRadius(caster, target.pos, effect.areaRadius)
    .filter((victim) => ctx.hasLineOfSight(caster, victim));
  const capScale = victims.length > effect.areaSoftCap ? effect.areaSoftCap / victims.length : 1;
  for (const victim of victims) {
    const amount = Math.round(ctx.rng.range(effect.areaMin, effect.areaMax) * capScale);
    ctx.dealDamage(
      caster,
      victim,
      amount,
      false,
      'holy',
      abilityName,
      'hit',
      false,
      undefined,
      true,
      false,
      false,
      PALADIN_SUN_GOD_VERDICT_ID,
      true,
    );
    if (victim.dead) continue;
    const duration = ctx.diminishedCrowdControlDuration(
      caster,
      victim,
      stunDrCategory(PALADIN_SUN_GOD_VERDICT_ID),
      effect.stunDuration,
    );
    if (duration === null) continue;
    ctx.applyAura(victim, {
      id: `${PALADIN_SUN_GOD_VERDICT_ID}_stun`,
      name: abilityName,
      kind: 'stun',
      remaining: duration,
      duration,
      value: 0,
      sourceId: caster.id,
      school: 'holy',
    });
  }
}

export function advanceSunGodVerdict(
  ctx: SimContext,
  caster: Entity,
  target: Entity,
  triggeringAbilityId: string,
  mark: Aura,
  effect: SunGodVerdictEffect,
  abilityName: string,
): SunGodVerdictDetonation | null {
  if (
    (triggeringAbilityId !== FINAL_EDICT_ID && triggeringAbilityId !== DAWNFALL_ID) ||
    !isSunVerdictAura(mark, caster.id)
  ) {
    return null;
  }

  // The triggering hit can end a duel or kill the caster through Thorns before
  // control returns here. Both paths strip the live mark, so a captured Aura
  // reference must not pronounce a stale or posthumous verdict. A dead PvE target
  // is the exception: Dawnfall still detonates around the corpse it actually hit.
  if (caster.dead || (!target.dead && !target.auras.includes(mark))) return null;

  // The third charge remains briefly as a render-only flash after its sentence.
  // It is inert, preventing another hit in the same tick from detonating twice.
  if (mark.value >= effect.charges) return null;

  const nextCharge = Math.min(effect.charges, Math.max(0, Math.floor(mark.value)) + 1);
  if (nextCharge < effect.charges) {
    if (target.auras.includes(mark)) {
      mark.value = nextCharge;
      mark.stacks = nextCharge;
      ctx.emit({ type: 'aura', targetId: target.id, name: mark.name, gained: true });
    }
    return null;
  }

  if (target.auras.includes(mark)) {
    mark.value = effect.charges;
    mark.stacks = effect.charges;
    mark.remaining = Math.min(mark.remaining, DETONATION_FLASH_DURATION);
    ctx.emit({ type: 'aura', targetId: target.id, name: mark.name, gained: true });
  }
  if (triggeringAbilityId === FINAL_EDICT_ID) {
    detonateSingleTarget(ctx, caster, target, effect, abilityName);
    return 'singleTarget';
  }
  detonateArea(ctx, caster, target, effect, abilityName);
  return 'area';
}

export function stripSunGodVerdicts(ctx: SimContext, sourceId: number): void {
  for (const entity of ctx.entities.values()) {
    for (let index = entity.auras.length - 1; index >= 0; index--) {
      const aura = entity.auras[index];
      if (!isSunVerdictAura(aura, sourceId)) continue;
      entity.auras.splice(index, 1);
      ctx.emit({ type: 'aura', targetId: entity.id, name: aura.name, gained: false });
    }
  }
}
