import { FACTION_CURRENCY_IDS, type FactionId } from '../sim/factions';

export const CURRENCY_IMAGE_IDS: ReadonlySet<string> = new Set([
  'coin_gold',
  'coin_silver',
  'coin_copper',
  'woc_token',
  'honor',
  'delve_mark',
  'rift_watch_mark',
  'church_order_crest',
  'automaton_cog',
]);

const CURRENCY_ICON_DIR = '/ui/currency';
const HEROIC_MARK_IMAGE_URL = '/ui/items/heroic_mark.webp';

export function currencyImageUrl(id: string): string | null {
  return CURRENCY_IMAGE_IDS.has(id) ? `${CURRENCY_ICON_DIR}/${id}.webp` : null;
}

/** A faction's emblem art. The factions have no dedicated crest image, so the
 *  emblem is the faction's own currency art (the Rift Watch Mark, the Church
 *  Order Crest, the Automaton Cog), which callers set inside a crest frame. The
 *  one resolver for it: the Reputation tab and the world quest card both read it. */
export function factionEmblemImageUrl(factionId: FactionId): string | null {
  return currencyImageUrl(FACTION_CURRENCY_IDS[factionId]);
}

/** Decorative inline art for balances whose surrounding localized text owns
 *  the accessible currency name and amount. */
export function currencyIconHtml(id: string): string {
  const url = currencyImageUrl(id);
  return url
    ? `<img class="currency-inline currency-${id}" src="${url}" alt="" draggable="false">`
    : '';
}

export function heroicMarkIconHtml(): string {
  return `<img class="currency-inline currency-heroic-mark" src="${HEROIC_MARK_IMAGE_URL}" alt="" draggable="false">`;
}
