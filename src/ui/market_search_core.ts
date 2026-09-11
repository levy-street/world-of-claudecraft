// Pure-core market search-term resolution (host-agnostic).
// Imports no sim/data, no DOM, no i18n — only the narrow inputs it needs.

export interface MarketSearchCoreInput {
  /** The typed search text as-is from the player. */
  query: string;
  /** Current locale tag, e.g. 'en', 'ja_JP', 'tr_TR'. */
  localeTag: string;
  /** All item IDs in the catalog (Object.keys(ITEMS)). */
  itemIds: string[];
  /** Lookup: itemId -> localized display name (from entity_i18n). */
  localizedNameOf: (id: string) => string;
  /** The server's exact matcher (marketItemMatches) — NOT a client copy. */
  englishMatches: (id: string, search: string) => boolean;
  /** Fallback haystack for the untranslated path: `${id} ${englishName}`. */
  englishHaystackOf: (id: string) => string;
}

/**
 * Resolves the player's typed search to the English search string
 * the server will actually use.
 *
 * - Exact localized-name match wins (case-insensitive, locale-aware).
 * - Otherwise, the untranslated path hands the typed text back untouched.
 *   The server filters on English names/ids, so an untranslated query
 *   simply matches nothing — the correct empty result, not a wrong one.
 */
export function resolveMarketSearchTerm(input: MarketSearchCoreInput): string {
  const { query, localeTag, itemIds, localizedNameOf, englishMatches, englishHaystackOf } = input;

  if (!query.trim()) return query;

  const trimmed = query.trim();

  // Rule 1: the English/id matcher already finds something, so nothing changes.
  const englishQuery = trimmed.toLowerCase();
  for (const id of itemIds) {
    if (englishMatches(id, englishQuery)) return query;
  }

  // Rule 2: what does this text name in the player's language?
  // Use locale-aware case folding for the localized match
  const localeForFolding = localeTag.replace('_', '-');
  const localizedQuery = trimmed.toLocaleLowerCase(localeForFolding);
  for (const id of itemIds) {
    const locName = localizedNameOf(id);
    if (locName.toLocaleLowerCase(localeForFolding) === localizedQuery) {
      // Return the English id so the server matcher can use it
      return englishHaystackOf(id).split(' ')[0];
    }
  }

  // No localized match: return the typed text as-is.
  // The server will filter on English names/ids and find nothing.
  // This is the correct empty result, not a wrong substitution.
  return query;
}
