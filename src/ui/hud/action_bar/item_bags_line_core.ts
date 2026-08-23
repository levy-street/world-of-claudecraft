// The tooltip sub-line naming how many of an item the player is carrying. Shared
// by every surface that inspects an item ON an action surface rather than in the
// bags: the desktop hotbar slot and the touch consumables row both answer "do I
// have another one of these?", and the answer is the same sentence in both. Pure
// (esc + the locale table only); registered in tests/architecture.test.ts
// UI_PURE_CORES.

import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';

/** The in-bags line for a carried count, including the none-carried wording. */
export function itemInBagsLine(count: number): string {
  const text =
    count > 0
      ? t('abilityUi.actionBar.itemInBags', {
          count: formatNumber(count, { maximumFractionDigits: 0 }),
        })
      : t('abilityUi.actionBar.itemNoneInBags');
  return `<div class="tt-sub">${esc(text)}</div>`;
}
