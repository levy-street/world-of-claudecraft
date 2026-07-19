import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

// Stone Aegis reduces one incoming direct attack and spends one charge. It draws
// no random numbers. Incidental damage is filtered by the damage pipeline before
// this function is called.
export function applyEarthShield(ctx: SimContext, target: Entity, amount: number): number {
  if (amount <= 0) return amount;
  for (let index = target.auras.length - 1; index >= 0; index--) {
    const aura = target.auras[index];
    if (aura.kind !== 'earth_shield' || (aura.charges ?? 0) <= 0) continue;
    const reduced = Math.max(0, Math.round(amount * (1 - aura.value)));
    aura.charges = (aura.charges ?? 0) - 1;
    if (aura.charges <= 0) {
      target.auras.splice(index, 1);
      ctx.emit({ type: 'aura', targetId: target.id, name: aura.name, gained: false });
    }
    return reduced;
  }
  return amount;
}
