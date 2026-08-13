import type { SimContext } from '../sim_context';
import type { Aura, AuraKind, Entity } from '../types';
import {
  RADIANT_RESONANCE_DAWN_COST_MULTIPLIER,
  RADIANT_RESONANCE_KIND,
} from './paladin_radiant_resonance';

function matches(aura: { empowerAbilities?: readonly string[] }, abilityId?: string): boolean {
  if (!aura.empowerAbilities) return true;
  return abilityId !== undefined && aura.empowerAbilities.includes(abilityId);
}

// The aura kinds whose consumption marks the cast as empowered for the castNth
// guard in talent_procs.ts (Entity.castConsumedEmpower). Deliberately excludes
// the warrior bespoke kinds (battle_trance, sudden_death, revenge_free) and
// next_attack_crit: those bill on swings, not casts.
const EMPOWER_CAST_KINDS: ReadonlySet<string> = new Set([
  'next_cast_free',
  'next_execute_free',
  'next_cast_instant',
  'next_cast_cheap',
  RADIANT_RESONANCE_KIND,
]);

export function consumeAuraKind(
  ctx: SimContext,
  e: Entity,
  kind: AuraKind,
  abilityId?: string,
): Aura | null {
  const idx = e.auras.findIndex((aura) => aura.kind === kind && matches(aura, abilityId));
  if (idx < 0) return null;
  if (EMPOWER_CAST_KINDS.has(kind)) e.castConsumedEmpower = true;
  const aura = e.auras[idx];
  if ((aura.charges ?? 1) > 1) {
    aura.charges = (aura.charges ?? 1) - 1;
    return aura;
  }
  e.auras.splice(idx, 1);
  ctx.emit({
    type: 'aura',
    targetId: e.id,
    name: aura.name,
    gained: false,
    auraKind: aura.kind,
  });
  return aura;
}

export function hasNextCastFree(e: Entity, abilityId?: string): boolean {
  return e.auras.some(
    (aura) =>
      (aura.kind === 'next_cast_free' || aura.kind === 'next_execute_free') &&
      matches(aura, abilityId),
  );
}

/** The movement-cast aura eligible for this exact ability. Unscoped Ice
 *  Floes and Wayfarer Grace remain universal; Flowing Elements names its two
 *  allowed casts. */
export function iceFloesAuraForAbility(e: Entity, abilityId: string): Aura | undefined {
  return e.auras.find((aura) => aura.kind === 'ice_floes' && matches(aura, abilityId));
}

export function hasNextExecuteFree(e: Entity, abilityId: string): boolean {
  return e.auras.some(
    (aura) =>
      (aura.kind === 'next_execute_free' && matches(aura, abilityId)) ||
      (abilityId === 'execute' && aura.kind === 'sudden_death'),
  );
}

export function nextCastCheapMultiplierFromAuras(
  auras: readonly {
    kind: string;
    value?: number;
    empowerAbilities?: readonly string[];
  }[],
  abilityId?: string,
): number | null {
  return (
    auras.find((aura) => aura.kind === 'next_cast_cheap' && matches(aura, abilityId))?.value ?? null
  );
}

export function nextCastCheapMultiplier(e: Entity, abilityId?: string): number | null {
  if (
    abilityId === 'dawns_embrace' &&
    (e.castRadiantResonance === true ||
      e.auras.some((aura) => aura.kind === RADIANT_RESONANCE_KIND))
  ) {
    return RADIANT_RESONANCE_DAWN_COST_MULTIPLIER;
  }
  return nextCastCheapMultiplierFromAuras(e.auras, abilityId);
}

export const BATTLE_TRANCE_ABILITIES: ReadonlySet<string> = new Set([
  'heroic_strike',
  'mortal_strike',
]);

export const REVENGE_FREE_ABILITIES: ReadonlySet<string> = new Set(['revenge']);

export function freeCostAuraActive(
  auras: readonly { kind: string; empowerAbilities?: readonly string[] }[],
  abilityId: string,
): boolean {
  for (const aura of auras) {
    if (
      (aura.kind === 'next_cast_free' || aura.kind === 'next_execute_free') &&
      (aura.empowerAbilities === undefined || aura.empowerAbilities.includes(abilityId))
    ) {
      return true;
    }
    if (aura.kind === 'battle_trance' && BATTLE_TRANCE_ABILITIES.has(abilityId)) return true;
    if (aura.kind === 'revenge_free' && REVENGE_FREE_ABILITIES.has(abilityId)) return true;
    if (aura.kind === 'sudden_death' && abilityId === 'execute') return true;
  }
  return false;
}

export function hasFreeCostFor(e: Entity, abilityId: string): boolean {
  return freeCostAuraActive(e.auras, abilityId);
}

export function consumeNextCastFree(ctx: SimContext, e: Entity, abilityId?: string): boolean {
  return (
    consumeAuraKind(ctx, e, 'next_cast_free', abilityId) !== null ||
    consumeAuraKind(ctx, e, 'next_execute_free', abilityId) !== null
  );
}

export function consumeFreeCostFor(ctx: SimContext, e: Entity, abilityId: string): boolean {
  if (consumeNextCastFree(ctx, e, abilityId)) return true;
  if (BATTLE_TRANCE_ABILITIES.has(abilityId) && consumeAuraKind(ctx, e, 'battle_trance') !== null) {
    return true;
  }
  if (abilityId === 'execute' && consumeAuraKind(ctx, e, 'sudden_death') !== null) return true;
  return REVENGE_FREE_ABILITIES.has(abilityId) && consumeAuraKind(ctx, e, 'revenge_free') !== null;
}

export function consumeNextCastInstantAura(
  ctx: SimContext,
  e: Entity,
  abilityId?: string,
): Aura | null {
  const instant = consumeAuraKind(ctx, e, 'next_cast_instant', abilityId);
  if (instant !== null) return instant;
  // Radiant Resonance also makes Mending Light instant. It lives on this
  // aura-returning variant, not on the boolean wrapper below, because the cast
  // path calls THIS one (it needs the aura to spot a Stormcast charge).
  if (abilityId === 'holy_light') return consumeAuraKind(ctx, e, RADIANT_RESONANCE_KIND, abilityId);
  return null;
}

export function consumeNextCastInstant(ctx: SimContext, e: Entity, abilityId?: string): boolean {
  return consumeNextCastInstantAura(ctx, e, abilityId) !== null;
}

export function hasScopedNextCastInstant(e: Entity, abilityId: string): boolean {
  return e.auras.some(
    (aura) =>
      aura.kind === 'next_cast_instant' &&
      aura.empowerAbilities !== undefined &&
      aura.empowerAbilities.includes(abilityId),
  );
}

export function consumeNextCastCheap(
  ctx: SimContext,
  e: Entity,
  abilityId?: string,
): number | null {
  if (
    abilityId === 'dawns_embrace' &&
    (e.castRadiantResonance === true ||
      e.auras.some((aura) => aura.kind === RADIANT_RESONANCE_KIND))
  ) {
    e.castRadiantResonance = undefined;
    consumeAuraKind(ctx, e, RADIANT_RESONANCE_KIND, abilityId);
    return RADIANT_RESONANCE_DAWN_COST_MULTIPLIER;
  }
  const aura = consumeNextCastCheapAura(ctx, e, abilityId);
  return aura?.value ?? null;
}

export function consumeRadiantResonanceForDawn(
  ctx: SimContext,
  e: Entity,
  abilityId?: string,
): boolean {
  if (abilityId !== 'dawns_embrace') return false;
  const reserved = e.castRadiantResonance === true;
  e.castRadiantResonance = undefined;
  return consumeAuraKind(ctx, e, RADIANT_RESONANCE_KIND, abilityId) !== null || reserved;
}

export function consumeNextCastCheapAura(
  ctx: SimContext,
  e: Entity,
  abilityId?: string,
): Aura | null {
  return consumeAuraKind(ctx, e, 'next_cast_cheap', abilityId);
}

export function consumeNextAttackCrit(ctx: SimContext, e: Entity): boolean {
  return consumeAuraKind(ctx, e, 'next_attack_crit') !== null;
}
