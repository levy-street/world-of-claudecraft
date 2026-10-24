// Optional extra pay for a World Quest played beyond its base objective (a hard
// profile, a bonus level). Coin only: never an item, never XP, so the base reward
// table in content/world_quests.ts stays the one source of what a quest is worth
// and a bonus can never outpace it. The loot line reuses the exact wording the base
// copper reward emits, so the client matcher relocalizes it the same way.

import { formatMoney } from './format_money';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';

/** Pure: the bonus purse for a given character level. */
export function worldQuestBonusCopper(base: number, perLevel: number, level: number): number {
  const safeLevel = Math.max(1, Math.floor(level));
  return Math.max(0, Math.round(base + perLevel * safeLevel));
}

export function awardWorldQuestBonusCopper(
  ctx: SimContext,
  meta: PlayerMeta,
  amount: number,
): void {
  if (!(amount > 0)) return;
  meta.copper += amount;
  ctx.emit({
    type: 'loot',
    text: `You receive ${formatMoney(amount)}.`,
    pid: meta.entityId,
  });
}

/** The hard maze pays a purse on top of the daily reward. */
export const WISP_MAZE_HARD_BONUS = { base: 1_500, perLevel: 100 } as const;
