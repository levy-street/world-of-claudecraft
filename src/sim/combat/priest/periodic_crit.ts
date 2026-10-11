import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';

export function shadowPeriodicHit(
  ctx: SimContext,
  source: Entity | null,
  abilityId: string,
  amount: number,
): { amount: number; crit: boolean } {
  // Gate before drawing: other specs and periodic effects retain their RNG order.
  if (
    (abilityId !== 'shadow_word_pain' &&
      abilityId !== 'mind_flay' &&
      abilityId !== 'vampiric_touch') ||
    source?.kind !== 'player' ||
    amount <= 0
  ) {
    return { amount, crit: false };
  }
  const meta = ctx.players.get(source.id);
  if (meta?.cls !== 'priest' || meta.talents.spec !== 'shadow') {
    return { amount, crit: false };
  }
  const crit = ctx.rng.chance(ctx.spellCrit(source));
  return {
    amount: crit ? Math.round(amount * (1.5 + source.critDmgSpellBonus)) : amount,
    crit,
  };
}
