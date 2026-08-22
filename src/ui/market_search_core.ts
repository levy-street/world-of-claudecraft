// Pure localized-search projection for the World Market. The caller injects the
// exact display-name resolver used to paint item rows, keeping locale and heroic
// fallback behavior in the UI while the sim receives only stable catalog ids.

import { ITEMS } from '../sim/data';
import { encodeMarketLocalizedItemMask, normalizeMarketSearch } from '../sim/market_query';
import type { ItemDef } from '../sim/types';

const MARKET_SEARCH_ITEMS = Object.values(ITEMS);

export interface MarketSearchCandidate {
  readonly id: string;
}

export type MarketSearchDisplayNameResolver<T extends MarketSearchCandidate> = (
  candidate: T,
) => string;

/**
 * Encode every candidate whose displayed name contains the effective search.
 *
 * `normalizeMarketSearch` owns the shared 40-character, trim, and case-folding
 * rule. Empty searches deliberately return no hint: the authoritative canonical
 * matcher already treats an empty search as "show everything", so a full-catalog
 * localized mask would only waste command bandwidth.
 */
export function marketLocalizedItemMask<T extends MarketSearchCandidate>(
  rawSearch: string,
  candidates: readonly T[],
  displayNameOf: MarketSearchDisplayNameResolver<T>,
): string {
  const search = normalizeMarketSearch(rawSearch);
  if (!search) return '';

  const matchedIds = new Set<string>();
  for (const candidate of candidates) {
    if (displayNameOf(candidate).toLowerCase().includes(search)) matchedIds.add(candidate.id);
  }
  return encodeMarketLocalizedItemMask([...matchedIds]);
}

/** Production catalog adapter: localization stays injected, item data stays out of the painter. */
export function marketLocalizedCatalogItemMask(
  rawSearch: string,
  displayNameOf: (item: ItemDef) => string,
): string {
  return marketLocalizedItemMask(rawSearch, MARKET_SEARCH_ITEMS, displayNameOf);
}
