import type { SimContext } from '../sim_context';
import type { AuraKind, Entity } from '../types';

function consumeAuraKind(ctx: SimContext, e: Entity, kind: AuraKind): boolean {
  const idx = e.auras.findIndex((a) => a.kind === kind);
  if (idx < 0) return false;
  const [aura] = e.auras.splice(idx, 1);
  ctx.emit({ type: 'aura', targetId: e.id, name: aura.name, gained: false });
  return true;
}

export function hasNextCastFree(e: Entity): boolean {
  return e.auras.some((a) => a.kind === 'next_cast_free');
}

export function consumeNextCastFree(ctx: SimContext, e: Entity): boolean {
  return consumeAuraKind(ctx, e, 'next_cast_free');
}

export function consumeNextCastInstant(ctx: SimContext, e: Entity): boolean {
  return consumeAuraKind(ctx, e, 'next_cast_instant');
}

export function consumeNextAttackCrit(ctx: SimContext, e: Entity): boolean {
  return consumeAuraKind(ctx, e, 'next_attack_crit');
}
