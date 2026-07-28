// Earth Shield (Stone Aegis): a charge-limited damage-taken reduction, the
// Enhancement shaman's core tanking mitigation. Each incoming DIRECT attack on
// the shielded entity is reduced by the aura's fraction and spends one charge;
// the aura drops once its charges are gone, so the shaman recasts to renew it.
// Kept as a small module so the damage pipeline stays a thin caller and a Vitest
// can pin the charge-consume rule without standing up a live Sim. Draws NO rng.
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

// Reduce one incoming direct hit by the target's Earth Shield aura, spend a
// charge, and drop the aura (emitting the loss) once it is fully spent. Returns
// the post-reduction amount, unchanged when no Earth Shield is active. Only one
// Earth Shield aura mitigates a given hit (they never stack on one entity).
export function applyEarthShield(ctx: SimContext, target: Entity, amount: number): number {
  if (amount <= 0) return amount;
  for (let i = target.auras.length - 1; i >= 0; i--) {
    const a = target.auras[i];
    if (a.kind !== 'earth_shield') continue;
    if (a.charges !== undefined && a.charges <= 0) continue;
    amount = Math.max(0, Math.round(amount * (1 - a.value)));
    if (a.charges !== undefined) {
      a.charges -= 1;
      if (a.charges <= 0) {
        target.auras.splice(i, 1);
        ctx.emit({ type: 'aura', targetId: target.id, name: a.name, gained: false });
      }
    }
    break;
  }
  return amount;
}
