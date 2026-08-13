import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export const RADIANT_RESONANCE_KIND = 'paladin_radiant_resonance' as const;
export const RADIANT_RESONANCE_DURATION = 10;
export const RADIANT_RESONANCE_DAWN_CAST_TIME = 1.5;
export const RADIANT_RESONANCE_DAWN_COST_MULTIPLIER = 0.5;

// The two abilities Radiant Resonance empowers: Mending Light becomes instant
// (consumeNextCastInstant) and Dawn's Embrace costs half and casts in 1.5 sec
// (nextCastCheapMultiplier / radiantResonanceCastTime).
export const RADIANT_RESONANCE_CONSUMERS: ReadonlySet<string> = new Set([
  'holy_light',
  'dawns_embrace',
]);

interface RadiantResonanceAuraOwner {
  auras: readonly { kind: string }[];
}

export function hasRadiantResonance(entity: Entity): boolean {
  return entity.auras.some((aura) => aura.kind === RADIANT_RESONANCE_KIND);
}

// The action bar's read: the same predicate the combat path uses, so the slot can
// never glow for an ability the proc would not actually empower (and vice versa).
export function radiantResonanceAbilityGlowActive(
  owner: RadiantResonanceAuraOwner,
  abilityId: string,
): boolean {
  return (
    RADIANT_RESONANCE_CONSUMERS.has(abilityId) &&
    owner.auras.some((aura) => aura.kind === RADIANT_RESONANCE_KIND)
  );
}

export function reserveRadiantResonance(entity: Entity, abilityId: string): void {
  if (abilityId === 'dawns_embrace' && hasRadiantResonance(entity)) {
    entity.castRadiantResonance = true;
  }
}

export function clearRadiantResonanceReservation(entity: Entity): void {
  if (entity.castRadiantResonance !== undefined) {
    entity.castRadiantResonance = undefined;
  }
}

export function grantRadiantResonance(
  ctx: SimContext,
  paladin: Entity,
  effectiveTargets: number,
): boolean {
  if (effectiveTargets < 2) return false;
  ctx.applyAura(paladin, {
    id: 'radiant_resonance',
    name: 'Radiant Resonance',
    kind: RADIANT_RESONANCE_KIND,
    value: RADIANT_RESONANCE_DAWN_COST_MULTIPLIER,
    remaining: RADIANT_RESONANCE_DURATION,
    duration: RADIANT_RESONANCE_DURATION,
    sourceId: paladin.id,
    school: 'holy',
  });
  return true;
}

export function radiantResonanceCastTime(
  entity: Entity,
  abilityId: string,
  castTime: number,
): number {
  if (
    abilityId !== 'dawns_embrace' ||
    (!hasRadiantResonance(entity) && entity.castRadiantResonance !== true) ||
    castTime <= RADIANT_RESONANCE_DAWN_CAST_TIME
  ) {
    return castTime;
  }
  return RADIANT_RESONANCE_DAWN_CAST_TIME;
}
