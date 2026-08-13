// Ranking core for the Developer Command Center's item picker.
//
// The picker used to be a native <select> holding every one of the ~672 ITEMS. It
// rendered taller than the viewport, covered the window it belonged to, and was
// sorted alphabetically with no way to narrow it, so finding one item meant
// scrolling a wall of names. Worse, 57 display names are shared by exactly two ids
// each (a base piece and its generated heroic variant), so the visible label alone
// cannot tell them apart.
//
// This core turns a query into a short ranked list. It is deliberately DOM-free and
// i18n-free: the painter resolves localized names via tEntity and hands them in as
// `name`, the same shape deeds_view.ts uses for its search. That keeps the ranking
// unit-testable in Node with no HUD and no locale loaded.

// One searchable item. `name` is ALREADY localized by the caller; `id` is the stable
// content id the /dev give command actually takes.
export interface DevItemCandidate {
  id: string;
  name: string;
  // Equip slot when the item has one; undefined for consumables, reagents, quest
  // items and other non-equippables.
  slot?: string;
  quality?: string;
  // True when this id is a generated heroic variant (ItemDef.heroicOf is set). This
  // is the ONLY thing distinguishing the 57 duplicate-name pairs, so a row that
  // hides it is genuinely ambiguous.
  heroic?: boolean;
}

export interface DevItemMatch {
  item: DevItemCandidate;
  // Which signal matched, so the painter can show why a row is present and tests can
  // assert ordering by cause rather than by index alone.
  reason: 'exactId' | 'namePrefix' | 'idPrefix' | 'nameContains' | 'idContains';
}

export interface DevItemPickerResult {
  matches: readonly DevItemMatch[];
  // Total matches BEFORE the cap, so the painter can say "showing 12 of 84".
  total: number;
  // True when the query is empty: the picker shows nothing rather than all 672,
  // which is the whole point of the change.
  idle: boolean;
}

// How many rows the dropdown may show. The cap is load-bearing, not cosmetic: the
// bug this picker replaced was a list that grew past the viewport and swallowed
// its own window. Sized with the CSS max-height so the full cap fits WITHOUT a
// scrollbar (a scrollbar in an anchored listbox is a trap: grabbing it blurs the
// input, and the blur teardown drops the list mid-drag).
export const DEV_ITEM_PICKER_LIMIT = 14;

// Rank order. Lower sorts first. An exact id match wins outright because a tester
// pasting a known id must never have it buried under fuzzy name hits.
const REASON_RANK: Record<DevItemMatch['reason'], number> = {
  exactId: 0,
  namePrefix: 1,
  idPrefix: 2,
  nameContains: 3,
  idContains: 4,
};

function classify(item: DevItemCandidate, query: string): DevItemMatch['reason'] | null {
  const id = item.id.toLowerCase();
  const name = item.name.toLowerCase();
  if (id === query) return 'exactId';
  if (name.startsWith(query)) return 'namePrefix';
  if (id.startsWith(query)) return 'idPrefix';
  if (name.includes(query)) return 'nameContains';
  if (id.includes(query)) return 'idContains';
  return null;
}

/**
 * Rank `items` against `query`, capped at `limit`.
 *
 * Matching runs over BOTH the localized name and the raw id, so "ashstalker" and
 * "heroic_" are both useful queries: the first is how a tester thinks about an item,
 * the second is how the content tables group them.
 *
 * Ordering is fully deterministic: reason rank, then name, then id. The trailing id
 * tie-break is what keeps a duplicate-name pair in a stable order instead of
 * flipping between renders.
 */
export function rankDevItems(
  items: readonly DevItemCandidate[],
  query: string,
  limit: number = DEV_ITEM_PICKER_LIMIT,
): DevItemPickerResult {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === '') return { matches: [], total: 0, idle: true };

  const scored: DevItemMatch[] = [];
  for (const item of items) {
    const reason = classify(item, trimmed);
    if (reason) scored.push({ item, reason });
  }

  scored.sort(
    (a, b) =>
      REASON_RANK[a.reason] - REASON_RANK[b.reason] ||
      a.item.name.localeCompare(b.item.name) ||
      a.item.id.localeCompare(b.item.id),
  );

  return {
    matches: limit >= 0 ? scored.slice(0, limit) : scored,
    total: scored.length,
    idle: false,
  };
}

/**
 * Resolve a raw field value to the item it names, or null.
 *
 * The picker's input doubles as the command field, so a tester may type a bare id
 * instead of picking a row. This is what lets the painter confirm "that id is real"
 * (and show which item it is) before the command is ever sent.
 */
export function resolveDevItem(
  items: readonly DevItemCandidate[],
  value: string,
): DevItemCandidate | null {
  const id = value.trim().toLowerCase();
  if (id === '') return null;
  return items.find((item) => item.id.toLowerCase() === id) ?? null;
}
