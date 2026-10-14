// The Skull Bag's item tooltip line (the faction_reward_tooltip_view.ts shape):
// what owning it does, in the mechanic's own terms. Pure string builder: t() +
// esc here, no DOM, so tests drive it directly.

import { WORLD_PVP_SKULL_BAG_ITEM_ID } from '../../../sim/pvp/world_pvp_trophy';
import type { ItemDef } from '../../../sim/types';
import { esc } from '../../esc';
import { t } from '../../i18n';

/** The Skull Bag's use line, or '' for any other item. */
export function skullBagTooltipLines(item: Pick<ItemDef, 'id'>): string {
  if (item.id !== WORLD_PVP_SKULL_BAG_ITEM_ID) return '';
  return `<div class="tt-desc">${esc(t('hudChrome.skullBag.tooltip'))}</div>`;
}
