// Character-select "News & Updates" panel: paints the compact release-notes
// feed (latest release expanded with a NEW badge, older releases collapsed,
// capped at 5, "View all updates on GitHub" link) into the character-select
// stage, in the slot where the class-details sheet used to sit. Cold path
// (painted once per character-select entry), so raw DOM writes are fine here
// (the store_promo_card.ts / dialog_root.ts cold-window convention, not the
// per-frame PainterHost elider). All feed logic and markup builders are pure
// and live in ./news_feed; this module owns only the fetch loop and the
// last-seen persistence.
import {
  markNewReleases,
  type NewsReleaseEntry,
  newsEmptyHtml,
  newsErrorHtml,
  newsLoadingHtml,
  nextLastSeenReleaseId,
  renderCompactNews,
} from './news_feed';

// Kept verbatim from the retired Welcome Screen so each player's seen-state
// (which releases still show a NEW badge) survives the move to this panel.
const LAST_SEEN_RELEASE_KEY = 'woc.welcome.lastSeenReleaseId';
const GITHUB_RELEASES_URL = 'https://github.com/levy-street/world-of-claudecraft/releases';

/** Reads the persisted "last seen release" marker (localStorage; survives across sessions). */
function readLastSeenReleaseId(storage: Storage): number | null {
  const raw = storage.getItem(LAST_SEEN_RELEASE_KEY);
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

function writeLastSeenReleaseId(storage: Storage, id: number): void {
  storage.setItem(LAST_SEEN_RELEASE_KEY, String(id));
}

// Last-caller-wins generation token for overlapping loads: character select
// can be re-entered while a slow fetch is still in flight, and only the newest
// entry may paint. A boolean in-flight gate would instead WEDGE the panel for
// the rest of the session if one fetch never settles (browser fetch has no
// timeout), so stale results are dropped on arrival rather than new loads
// being refused.
let loadGeneration = 0;

/**
 * Fetches releases and paints the character-select news feed into `host`,
 * advancing the last-seen marker so the NEW badges reflect what this player
 * had not yet seen when the panel opened. A failed fetch paints the error row
 * and leaves the marker untouched. `storage` is injectable for tests;
 * defaults to window.localStorage.
 */
export async function loadCharselectNews(
  host: HTMLElement | null,
  fetchReleases: () => Promise<NewsReleaseEntry[]>,
  storage?: Storage,
): Promise<void> {
  if (!host) return;
  const generation = ++loadGeneration;
  host.innerHTML = newsLoadingHtml();
  let releases: NewsReleaseEntry[];
  try {
    releases = await fetchReleases();
  } catch {
    if (generation === loadGeneration) host.innerHTML = newsErrorHtml();
    return;
  }
  if (generation !== loadGeneration) return;
  const store = storage ?? window.localStorage;
  let lastSeen: number | null = null;
  try {
    lastSeen = readLastSeenReleaseId(store);
    const next = nextLastSeenReleaseId(releases, lastSeen);
    if (next !== null) writeLastSeenReleaseId(store, next);
  } catch {
    // Storage unavailable (private mode): worst case every release shows NEW.
  }
  if (releases.length === 0) {
    host.innerHTML = newsEmptyHtml();
    return;
  }
  host.innerHTML = renderCompactNews(markNewReleases(releases, lastSeen), GITHUB_RELEASES_URL);
}
