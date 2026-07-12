import type { SimContext } from '../sim_context';
import type { Aura, AuraKind, Entity } from '../types';

// An empowerment aura may be ability-scoped (talent procs set empowerAbilities);
// an unscoped aura (item sets, fiesta powerups) matches any cast.
function matches(a: Aura, abilityId?: string): boolean {
  if (!a.empowerAbilities) return true;
  return abilityId !== undefined && a.empowerAbilities.includes(abilityId);
}

function consumeAuraKind(
  ctx: SimContext,
  e: Entity,
  kind: AuraKind,
  abilityId?: string,
): Aura | null {
  const idx = e.auras.findIndex((a) => a.kind === kind && matches(a, abilityId));
  if (idx < 0) return null;
  const [aura] = e.auras.splice(idx, 1);
  ctx.emit({ type: 'aura', targetId: e.id, name: aura.name, gained: false, auraKind: aura.kind });
  return aura;
}

export function hasNextCastFree(e: Entity, abilityId?: string): boolean {
  return e.auras.some(
    (a) => (a.kind === 'next_cast_free' || a.kind === 'next_execute_free') && matches(a, abilityId),
  );
}

export function hasNextExecuteFree(e: Entity, abilityId: string): boolean {
  return e.auras.some((a) => a.kind === 'next_execute_free' && matches(a, abilityId));
}

/** Returns a matching cheap-cast multiplier without consuming its aura. */
export function nextCastCheapMultiplier(e: Entity, abilityId?: string): number | null {
  const aura = e.auras.find((a) => a.kind === 'next_cast_cheap' && matches(a, abilityId));
  return aura?.value ?? null;
}

export function consumeNextCastFree(ctx: SimContext, e: Entity, abilityId?: string): boolean {
  return (
    consumeAuraKind(ctx, e, 'next_cast_free', abilityId) !== null ||
    consumeAuraKind(ctx, e, 'next_execute_free', abilityId) !== null
  );
}

export function consumeNextCastInstant(ctx: SimContext, e: Entity, abilityId?: string): boolean {
  return consumeAuraKind(ctx, e, 'next_cast_instant', abilityId) !== null;
}

// Unscoped instant-cast effects remain spell-only, but a talent proc that names a
// specific physical cast-time ability (Long Draw) is allowed to empower it.
export function hasScopedNextCastInstant(e: Entity, abilityId: string): boolean {
  return e.auras.some(
    (a) =>
      a.kind === 'next_cast_instant' &&
      a.empowerAbilities !== undefined &&
      a.empowerAbilities.includes(abilityId),
  );
}

/** Returns the cost multiplier (e.g. 0.5) or null when no cheap charge matches. */
export function consumeNextCastCheap(
  ctx: SimContext,
  e: Entity,
  abilityId?: string,
): number | null {
  const aura = consumeAuraKind(ctx, e, 'next_cast_cheap', abilityId);
  return aura ? aura.value : null;
}

export function consumeNextAttackCrit(ctx: SimContext, e: Entity): boolean {
  return consumeAuraKind(ctx, e, 'next_attack_crit') !== null;
}
