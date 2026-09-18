import type { AbilityEffect } from '../sim/types';
import { formatNumber } from './i18n';

/** Shared by live tooltips and the class preview. Combat rounds the combined
 * stack damage, so retain the contribution, including level-scaled mastery. */
export function formatAbilityImbueDamage(
  effect: Extract<AbilityEffect, { type: 'imbue' }>,
): string {
  return effect.coat?.rider === 'stackDot'
    ? formatNumber(effect.coat.perTick, { maximumFractionDigits: 2 })
    : formatNumber(effect.bonus, { maximumFractionDigits: 1 });
}
