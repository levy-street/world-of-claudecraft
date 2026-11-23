// Asset-browser decisions with no DOM: search matching, subcategory grouping,
// and the favourites/recents lists. The browser (asset_browser.ts) is the thin
// consumer; tests/editor_asset_search.test.ts pins the behaviour.

/** The searchable surface of one asset row (a subset of AssetEntry). */
export interface SearchableAsset {
  id: string;
  label: string;
  category: string;
  path: string;
  subcategory?: string;
}

// Hand-maintained synonyms: a query term on the left ALSO matches assets
// containing any term on the right. Small on purpose, every entry is a word
// makers actually type that the catalogue spells differently.
const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  house: ['building', 'home'],
  building: ['house'],
  torch: ['light', 'lantern', 'candle', 'brazier'],
  light: ['torch', 'lantern', 'lamp', 'candle'],
  plant: ['foliage', 'bush', 'fern', 'flower'],
  stone: ['rock', 'boulder'],
  rock: ['stone', 'boulder'],
  crate: ['box', 'container'],
  box: ['crate', 'container'],
  tree: ['oak', 'pine', 'palm'],
  enemy: ['creature', 'mob'],
  fence: ['wall', 'barrier'],
};

/**
 * Multi-term AND search: every whitespace-separated term must match the
 * asset's id, label, category, subcategory or path (case-insensitive
 * substring), where a term also matches through its synonym row. Empty query
 * matches everything.
 */
export function matchesAssetQuery(asset: SearchableAsset, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = [asset.id, asset.label, asset.category, asset.subcategory ?? '', asset.path]
    .join(' ')
    .toLowerCase();
  for (const term of terms) {
    if (hay.includes(term)) continue;
    const alts = SYNONYMS[term];
    if (alts && alts.some((a) => hay.includes(a))) continue;
    return false;
  }
  return true;
}

/** Filter + stable-order a list by `matchesAssetQuery`. */
export function filterAssets<T extends SearchableAsset>(assets: readonly T[], query: string): T[] {
  return assets.filter((a) => matchesAssetQuery(a, query));
}

/**
 * The subcategory chips for a category, in catalogue order with counts.
 * Empty when the category is undivided (fewer than 2 distinct subcategories)
 *, one chip would only restate the tab.
 */
export function subcategoriesOf(
  assets: readonly SearchableAsset[],
  category: string,
): { id: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const a of assets) {
    if (a.category !== category || !a.subcategory) continue;
    counts.set(a.subcategory, (counts.get(a.subcategory) ?? 0) + 1);
  }
  if (counts.size < 2) return [];
  return [...counts.entries()]
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .map(([id, count]) => ({ id, count }));
}

// ---- favourites / recents ---------------------------------------------------
// Pure list transforms over the persisted JSON arrays; the browser owns the
// localStorage round-trip (same arrangement as its drawer-height pref).

export const RECENTS_CAP = 24;

/** Toggle membership, preserving insertion order for the rest. */
export function toggleFavourite(favourites: readonly string[], id: string): string[] {
  return favourites.includes(id) ? favourites.filter((f) => f !== id) : [...favourites, id];
}

/** Most-recent-first, deduplicated, capped. */
export function pushRecent(recents: readonly string[], id: string): string[] {
  return [id, ...recents.filter((r) => r !== id)].slice(0, RECENTS_CAP);
}

/** Parse a persisted JSON string list, tolerating junk (storage is untrusted). */
export function parseStoredIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}
