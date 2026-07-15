import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export function hasSureCritAura(entity: Entity): boolean {
  return entity.auras.some((aura) => aura.kind === 'sure_crit');
}

export function consumeSureCritCharge(ctx: SimContext, entity: Entity): void {
  const index = entity.auras.findIndex((aura) => aura.kind === 'sure_crit');
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
