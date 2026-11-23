import { HOARD_SUGGESTED_PLAYERS } from '../sim/content/treasure_maps';
import type { ItemDef } from '../sim/types';
import { esc } from './esc';
import { formatNumber, t } from './i18n';

/** The same fixed party size used by the encounter, shown before spending a map. */
export function treasureMapTooltipLine(item: ItemDef): string {
  if (item.use?.type !== 'treasureMap') return '';
  return `<div class="tt-sub">${esc(
    t('questUi.log.suggestedPlayers', {
      count: formatNumber(HOARD_SUGGESTED_PLAYERS[item.use.rarity]),
    }),
  )}</div>`;
}
