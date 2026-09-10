import type { PlayerClass } from '../sim/types';
import { tEntity } from './entity_i18n';
import { formatNumber, t } from './i18n';

export function classDisplayDescription(className: PlayerClass): string {
  return tEntity({ kind: 'class', id: className, field: 'description' });
}

export function formatClassDetailNumber(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 1 });
}

export function classDetailAmountRange(min: number, max: number): string {
  if (min === max) return formatClassDetailNumber(min);
  return t('abilityUi.tooltip.damageRange', {
    min: formatClassDetailNumber(min),
    max: formatClassDetailNumber(max),
  });
}
