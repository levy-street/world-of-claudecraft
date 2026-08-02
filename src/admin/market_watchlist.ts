// The Market watchlist: starred item ids, remembered per browser (the
// auto_refresh_preference idiom). Client-side by design for v1: a watchlist
// is a per-operator lens over the same analytics data, so it earns no server
// state; a blocked or full storage must never break the pages, so every
// access is guarded and failure degrades to an empty list.

const STORAGE_KEY = 'claudecraft_admin_market_watchlist';

export function readMarketWatchlist(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((entry): entry is string => typeof entry === 'string'));
  } catch {
    return new Set();
  }
}

function writeMarketWatchlist(watchlist: ReadonlySet<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...watchlist].sort()));
  } catch {
    // Storage failure only loses persistence, never the in-memory toggle.
  }
}

// Toggle one item and persist; returns the NEW set (a fresh object, so a
// Svelte $state assignment sees the change).
export function toggleMarketWatchlist(watchlist: ReadonlySet<string>, itemId: string): Set<string> {
  const next = new Set(watchlist);
  if (next.has(itemId)) next.delete(itemId);
  else next.add(itemId);
  writeMarketWatchlist(next);
  return next;
}
