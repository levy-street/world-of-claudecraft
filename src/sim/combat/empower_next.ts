import type { SimContext } from '../sim_context';
import type { Aura, AuraKind, Entity } from '../types';

function matches(aura: Aura, abilityId?: string): boolean {
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
  const [aura] = e.auras.splice(idx, 1);
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

export function hasNextExecuteFree(e: Entity, abilityId: string): boolean {
  return e.auras.some(
    (aura) =>
      (aura.kind === 'next_execute_free' && matches(aura, abilityId)) ||
      (abilityId === 'execute' && aura.kind === 'sudden_death'),
  );
}

export function nextCastCheapMultiplier(e: Entity, abilityId?: string): number | null {
  return (
    e.auras.find((aura) => aura.kind === 'next_cast_cheap' && matches(aura, abilityId))?.value ??
    null
  );
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

export function consumeNextCastInstant(ctx: SimContext, e: Entity, abilityId?: string): boolean {
  return consumeAuraKind(ctx, e, 'next_cast_instant', abilityId) !== null;
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
  const aura = consumeAuraKind(ctx, e, 'next_cast_cheap', abilityId);
  return aura?.value ?? null;
}

export function consumeNextAttackCrit(ctx: SimContext, e: Entity): boolean {
  return consumeAuraKind(ctx, e, 'next_attack_crit') !== null;
}
