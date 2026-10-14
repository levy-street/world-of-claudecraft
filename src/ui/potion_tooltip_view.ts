// The potion "Use:" lines of the item tooltip (flat health, percent-of-maximum
// health, mana), moved out of Hud.itemTooltip beside its elixir, feast and
// faction-reward siblings. Pure string builder: t() + esc here, no DOM, no Hud
// state. The numbers come straight from the def.

import type { ItemDef } from '../sim/types';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { itemNumber } from './item_instance_tooltip';

function desc(text: string): string {
  return `<div class="tt-desc">${esc(text)}</div>`;
}

/** Every potion restore the def carries, one line each, or '' for none. */
export function potionTooltipLines(
  item: Pick<ItemDef, 'potionHp' | 'potionHpPctMax' | 'potionMana'>,
): string {
  let html = '';
  if (item.potionHp)
    html += desc(t('itemUi.tooltip.useHealingPotion', { amount: itemNumber(item.potionHp) }));
  if (item.potionHpPctMax)
    html += desc(
      t('itemUi.tooltip.useHealingPotionPct', { percent: formatNumber(item.potionHpPctMax * 100) }),
    );
  if (item.potionMana)
    html += desc(t('itemUi.tooltip.useManaPotion', { amount: itemNumber(item.potionMana) }));
  return html;
}
