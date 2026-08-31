// Localized Browse search for the World Market, resolved at the UI BOUNDARY.
//
// The market's search is authoritative and paginated server-side: the client
// sends one `search` string and the server filters the whole book with
// src/sim/market_query.ts marketItemMatches, which matches the item's ENGLISH
// def name and its id. That is correct for the sim (it stays language-agnostic)
// and wrong for the player: someone playing in German types "Schwert" and the
// market says there is nothing there.
//
// The client is the only side that knows the player's language, so the
// translation happens here, on the string the client is about to send. This
// module never decides what matches; it decides what to ASK, and it only
// substitutes a query it can PROVE selects exactly the same items the localized
// query names.
//
// The soundness rule, and it is the whole design:
//
//   1. If the typed text already matches something in English or by id, send it
//      UNCHANGED. Today's behavior is never disturbed, and an English-speaking
//      player's search is byte-identical to what it was.
//   2. Otherwise, resolve the text against the localized catalog. Nothing
//      matched means nothing to improve on: send it unchanged, and the empty
//      result is the honest answer.
//   3. Otherwise, build candidate ENGLISH searches and emit the first one that
//      is VERIFIED to select exactly the localized set, using the same
//      English matcher the server will run. A candidate that would select more
//      or fewer items is rejected rather than shipped, so this can never turn a
//      localized search into a subtly wrong result set.
//   4. If no candidate verifies, send the typed text unchanged. The player gets
//      the old empty result, never a wrong one.
//
// The bound that follows from rule 3, stated because it is a real limit and not
// an oversight: a localized query whose item set has no shared English word and
// more than one member is not expressible in a single search string, so it stays
// unanswered. Closing that needs an id-list axis on the browse query rather than
// a cleverer string, which is a wire change and deliberately not this module's.
//
// Pure and DOM-free (registered in tests/architecture.test.ts UI_PURE_CORES):
// the catalog, the localized resolver, and the English matcher all arrive
// injected, so a Vitest drives it with a handful of fake items.

/** Resolve an item id to the name the player sees in their language. */
export type LocalizedItemName = (itemId: string) => string;

/** Does the SERVER's English/id matcher accept this item for this search? The
 *  caller passes the real one (src/sim/market_query.ts), so a change to the
 *  authority's matching rule cannot leave this module verifying against a stale
 *  copy of it. */
export type EnglishSearchMatch = (itemId: string, search: string) => boolean;

export interface LocalizedMarketSearchInput {
  /** The raw text in the search box. */
  query: string;
  /** Every item id the market can list. */
  itemIds: readonly string[];
  localizedNameOf: LocalizedItemName;
  englishMatches: EnglishSearchMatch;
  /** The item's English haystack (its id plus def name), for candidate words.
   *  Injected rather than read off a catalog so this module imports no data. */
  englishHaystackOf: (itemId: string) => string;
}

/** Words of at least this many characters are candidate searches. Two-letter
 *  fragments select half the catalog and would essentially never verify, so
 *  trying them is wasted work rather than a missed opportunity. */
const MIN_CANDIDATE_WORD_LENGTH = 3;

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(a);
  return b.every((id) => seen.has(id));
}

/** The lowercase words of an English haystack, de-duplicated. */
function wordsOf(haystack: string): string[] {
  const out = new Set<string>();
  for (const word of haystack.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length >= MIN_CANDIDATE_WORD_LENGTH) out.add(word);
  }
  return [...out];
}

/**
 * The search string to actually send for `query`. Returns the input unchanged
 * whenever it cannot prove a better one (see the four rules in the header).
 */
export function localizedMarketSearch(input: LocalizedMarketSearchInput): string {
  const q = input.query.trim().toLowerCase();
  if (!q) return input.query;

  // Rule 1: the English/id matcher already finds something, so nothing changes.
  for (const id of input.itemIds) {
    if (input.englishMatches(id, q)) return input.query;
  }

  // Rule 2: what does this text name in the player's language?
  const localized = input.itemIds.filter((id) =>
    input.localizedNameOf(id).toLowerCase().includes(q),
  );
  if (localized.length === 0) return input.query;

  // Rule 3: candidates, most specific first. A single match is named by its own
  // id, which the server matches directly; a family is named by a word its
  // members' English haystacks share, longest first so the most specific shared
  // word is tried before a generic one.
  const candidates: string[] = [];
  if (localized.length === 1) candidates.push(localized[0].toLowerCase());
  else {
    let shared: Set<string> | null = null;
    for (const id of localized) {
      const words = new Set(wordsOf(input.englishHaystackOf(id)));
      if (shared === null) shared = words;
      else for (const word of [...shared]) if (!words.has(word)) shared.delete(word);
      if (shared.size === 0) break;
    }
    candidates.push(
      ...[...(shared ?? [])].sort((a, b) => b.length - a.length || a.localeCompare(b)),
    );
  }

  for (const candidate of candidates) {
    const selected = input.itemIds.filter((id) => input.englishMatches(id, candidate));
    if (sameSet(selected, localized)) return candidate;
  }

  // Rule 4: nothing verified. The old empty result, never a wrong one.
  return input.query;
}
