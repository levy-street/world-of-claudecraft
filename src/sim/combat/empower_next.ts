import type { SimContext } from '../sim_context';
import type { AuraKind, Entity } from '../types';

function consumeAuraKind(ctx: SimContext, e: Entity, kind: AuraKind): boolean {
  const idx = e.auras.findIndex((a) => a.kind === kind);
  if (idx < 0) return false;
  const [aura] = e.auras.splice(idx, 1);
  ctx.emit({ type: 'aura', targetId: e.id, name: aura.name, gained: false });
  return true;
}

function canConsumeNextCastFreeAura(aura: { id: string }, baseCastTime?: number): boolean {
  return aura.id !== 'hot_streak_free' || (baseCastTime ?? 0) > 0;
}

export function hasNextCastFree(e: Entity, baseCastTime?: number): boolean {
  return e.auras.some(
    (a) => a.kind === 'next_cast_free' && canConsumeNextCastFreeAura(a, baseCastTime),
  );
}

export function consumeNextCastFree(ctx: SimContext, e: Entity, baseCastTime?: number): boolean {
  const idx = e.auras.findIndex(
    (a) => a.kind === 'next_cast_free' && canConsumeNextCastFreeAura(a, baseCastTime),
  );
  if (idx < 0) return false;
  const [aura] = e.auras.splice(idx, 1);
  ctx.emit({ type: 'aura', targetId: e.id, name: aura.name, gained: false });
  return true;
}

export function consumeNextCastInstant(ctx: SimContext, e: Entity): boolean {
  return consumeAuraKind(ctx, e, 'next_cast_instant');
}

export function consumeNextAttackCrit(ctx: SimContext, e: Entity): boolean {
  return consumeAuraKind(ctx, e, 'next_attack_crit');
}
