// The home page's characters-created counter (every .js-stat-characters in the realm
// select): a short localStorage cache in front of /api/project-stats. Moved whole out of
// src/main.ts so the landing-first boot (src/ui/landing_first.ts) can fill it before
// the client loads; main.ts fills it again on boot with the Api client's fetch.

export const STATS_CACHE_KEY = 'woc_cached_stats';
export const STATS_CACHE_TTL_MS = 30000; // 30 seconds

/** The /api/project-stats body. */
export interface ProjectStats {
  accounts_created: number;
  characters_created: number;
  players_online: number;
  realm: string;
}

export async function loadProjectStats(fetchStats: () => Promise<ProjectStats>): Promise<void> {
  // Realm status now lives in the realm dropdown, both in the trigger sub-line
  // and inside the Online option, so update every instance by class.
  const characterEls = document.querySelectorAll<HTMLElement>('.js-stat-characters');
  if (!characterEls.length) return;
  const setAll = (els: NodeListOf<HTMLElement>, text: string): void => {
    els.forEach((el) => {
      el.textContent = text;
    });
  };

  // 1. Try to read from localStorage first. characters_created is optional:
  // an entry written before the accounts-to-characters stat swap lacks it, and
  // the freshness check below treats such an entry as a miss so we re-fetch
  // rather than render "undefined".
  let cached: {
    realm: string;
    accounts_created: number;
    characters_created?: number;
    players_online: number;
    timestamp: number;
  } | null = null;
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(STATS_CACHE_KEY);
    if (raw) {
      try {
        cached = JSON.parse(raw);
      } catch {}
    }
  }

  // If cache exists, is fresh (within TTL), and carries the character count,
  // use it and skip the API request
  if (
    cached &&
    cached.characters_created != null &&
    Date.now() - cached.timestamp < STATS_CACHE_TTL_MS
  ) {
    setAll(characterEls, String(cached.characters_created));
    return;
  }

  // 2. Fetch fresh stats
  try {
    const data = await fetchStats();

    setAll(characterEls, data.characters_created != null ? String(data.characters_created) : '-');

    // Save to cache with timestamp
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(
        STATS_CACHE_KEY,
        JSON.stringify({
          ...data,
          timestamp: Date.now(),
        }),
      );
    }
  } catch {
    // A marketing counter is not worth an error entry: the API being down or
    // absent (offline play, a dev client with no server) is an ordinary state
    // and the cache fallback below already handles it.
    // If API fails, fall back to cached data (even if expired)
    if (cached) {
      setAll(characterEls, String(cached.characters_created ?? '-'));
    } else {
      setAll(characterEls, '-');
    }
  }
}
