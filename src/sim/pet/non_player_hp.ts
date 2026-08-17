import type { Aura } from '../types';

function flatHpBonus(aura: Pick<Aura, 'kind' | 'value'>): number {
  if (aura.kind === 'buff_sta' || aura.kind === 'buff_allstats') return aura.value * 10;
  return 0;
}

/** Applies or reverses one non-player stamina aura against a max-health pool. */
export function nonPlayerMaxHpAfterAura(
  maxHp: number,
  aura: Pick<Aura, 'kind' | 'value'>,
  direction: 1 | -1,
): number {
  let delta = flatHpBonus(aura) * direction;
  if (aura.kind === 'buff_sta_pct' || aura.kind === 'buff_stats_pct') {
    const pct = aura.value / 100;
    delta = direction === 1 ? Math.round(maxHp * pct) : -Math.round((maxHp / (1 + pct)) * pct);
  }
  return Math.max(1, maxHp + delta);
}

/** Rebuilds the health pool produced by the currently active non-player stat auras. */
export function nonPlayerMaxHpWithAuras(
  baseMaxHp: number,
  auras: readonly Pick<Aura, 'kind' | 'value'>[],
): number {
  let maxHp = Math.max(1, baseMaxHp);
  for (const aura of auras) maxHp = nonPlayerMaxHpAfterAura(maxHp, aura, 1);
  return maxHp;
}
