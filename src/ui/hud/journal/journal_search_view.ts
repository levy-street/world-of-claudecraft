// Pure search model of the Adventure Journal's boss search (the field at the
// top of the instance list): which boss pages a typed query finds, in what
// order, and where the arrow keys move the highlighted result. DOM-free and
// i18n-free: the window hands in every page's names already localized in the
// current language, so a query matches what the player reads on screen.
//
// Matching folds case and accents both ways ("ignazhar" finds "Ignazhar",
// "aurora" finds "Auróra", "Ä" finds "a"), collapses runs of spaces, and
// finds a page by any of its names (a council's own title or either member's
// name) or by its instance's name (every page of that instance then shows).
// The best match comes first: a name that starts with the query, then a word
// in it that does, then a name that contains it, then an instance match; ties
// keep the journal's own list order.

/** One boss page as the search reads it, names localized by the caller. */
export interface JournalSearchPage {
  instanceId: string;
  bossKey: string;
  /** The page's display name (a council's title, else its boss). */
  name: string;
  /** Every other name the page answers to (a council's members). */
  aliases: readonly string[];
  instanceName: string;
  portraitUrl: string;
}

export interface JournalSearchResult extends JournalSearchPage {
  /** How the query matched (lower is better): 0 a name starts with it, 1 a
   *  word in a name starts with it, 2 a name contains it, 3 the instance's
   *  name contains it. */
  rank: 0 | 1 | 2 | 3;
}

/** The search's own spelling of a text: no accents, lower case, single
 *  spaces, trimmed. */
export function foldJournalSearch(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      // Locale-free: a Turkish host must not fold "I" to a dotless "i".
      .toLowerCase()
      .replace(/\s+/gu, ' ')
      .trim()
  );
}

function nameRank(name: string, query: string): 0 | 1 | 2 | null {
  const folded = foldJournalSearch(name);
  if (folded.startsWith(query)) return 0;
  const at = folded.indexOf(query);
  if (at < 0) return null;
  // A word boundary: the query begins right after a space or a punctuation
  // mark ("the unquenchable", "Hrothmar and Velmira").
  for (let i = at; i >= 0; i = folded.indexOf(query, i + 1)) {
    if (i > 0 && /[\s\p{P}]/u.test(folded[i - 1])) return 1;
  }
  return 2;
}

/** Every page matching `query`, best first. An empty query finds nothing
 *  (the list shows instead). `limit` caps the result list. */
export function journalSearch(
  pages: readonly JournalSearchPage[],
  query: string,
  limit = Number.POSITIVE_INFINITY,
): JournalSearchResult[] {
  const folded = foldJournalSearch(query);
  if (!folded) return [];
  const hits: { result: JournalSearchResult; order: number }[] = [];
  pages.forEach((page, order) => {
    let rank: JournalSearchResult['rank'] | null = null;
    for (const name of [page.name, ...page.aliases]) {
      const own = nameRank(name, folded);
      if (own !== null && (rank === null || own < rank)) rank = own;
    }
    if (rank === null && foldJournalSearch(page.instanceName).includes(folded)) rank = 3;
    if (rank !== null) hits.push({ result: { ...page, rank }, order });
  });
  hits.sort((a, b) => a.result.rank - b.result.rank || a.order - b.order);
  return hits.slice(0, limit).map((hit) => hit.result);
}

/** Where the highlighted result moves on a key: Down and Up step and wrap;
 *  null for any other key (Home and End stay the text field's own caret
 *  keys) or when there is nothing to highlight. `current` -1 means nothing
 *  is highlighted yet (Down lands on the first, Up on the last). */
export function journalSearchCursor(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : (current + 1) % count;
    case 'ArrowUp':
      return current <= 0 ? count - 1 : current - 1;
    default:
      return null;
  }
}
