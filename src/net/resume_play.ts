// Active-play resume marker.
//
// On mobile (notably iOS), the OS evicts a backgrounded WebView under memory
// pressure; when the player foregrounds the app it RELOADS index.html. The
// client is a single-page app whose boot path lands a restored session on the
// home / character-select chrome, never back in the world, so the player is
// silently dropped out of the game and (if the token also fails revalidation)
// all the way to the login screen. Reported as "it randomly returns me to the
// login screen".
//
// This module persists "actively in-world playing character N on realm R" so
// the boot path can re-enter the world instead of the home screen. The marker
// is bounded three ways:
// - FRESHNESS: honored only for a bounded window after it was last stamped, so
//   a cold open of a long-closed tab still lands on home as before, and only a
//   genuine reload-during-play resumes. Re-stamping refuses to resurrect an
//   already-stale marker (it clears it instead), so the window can never be
//   extended past its documented size by backgrounding an idle tab.
// - REALM: the marker names the realm it was stamped on, so a resume can never
//   enter a same-id character on a different realm (realm directories whose
//   realms live on separate databases can collide on character ids).
// - ATTEMPTS: each boot-time resume consumption increments a persisted attempt
//   counter, and only a completed world entry resets it. A resume that keeps
//   failing terminally (for example "character already in world" from a live
//   duplicate session in another tab) therefore self-disarms after
//   MAX_RESUME_ATTEMPTS reloads instead of trapping the tab in a fatal-overlay
//   reload loop, while still leaving enough retries for the server's keepalive
//   sweep to flip a black-holed session linkdead.
//
// This is client-only (src/net), so wall-clock time is allowed: the pure helpers
// take `now` as a parameter (unit-testable), and the thin storage wrappers read
// the clock and localStorage at the impure boundary, matching the Api
// saveSession/clearSession idiom.

export const RESUME_KEY = 'woc_active_play';

// Honor the marker only if it was stamped within this window. Re-stamped while
// the app is being backgrounded (the pre-eviction moment), so even a long play
// session resumes; a marker older than this falls through to the normal home
// landing.
export const RESUME_MAX_AGE_MS = 30 * 60 * 1000;

// A marker consumed this many times without a completed world entry stops
// resuming: the boot path treats it as spent and clears it. Keeps a terminally
// failing auto-resume (live duplicate session, persistent entry failure) from
// looping forever, while covering the one-or-two-reload window a black-holed
// drop needs before the server's keepalive sweep flips the session linkdead.
export const MAX_RESUME_ATTEMPTS = 3;

export interface PlayMarker {
  characterId: number;
  realm: string;
  savedAt: number;
  attempts: number;
}

export function serializeMarker(marker: PlayMarker): string {
  return JSON.stringify(marker);
}

// Parse a stored marker, rejecting anything malformed (a positive integer
// characterId, a non-empty realm name, a finite savedAt, and a non-negative
// integer attempts count are required; a missing attempts field reads as 0).
export function parseMarker(raw: string | null): PlayMarker | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as {
      characterId?: unknown;
      realm?: unknown;
      savedAt?: unknown;
      attempts?: unknown;
    };
    const { characterId, realm, savedAt } = v;
    if (typeof characterId !== 'number' || !Number.isInteger(characterId) || characterId <= 0) {
      return null;
    }
    if (typeof realm !== 'string' || realm === '') return null;
    if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return null;
    const attempts = v.attempts === undefined ? 0 : v.attempts;
    if (typeof attempts !== 'number' || !Number.isInteger(attempts) || attempts < 0) return null;
    return { characterId, realm, savedAt, attempts };
  } catch {
    return null;
  }
}

// The pure resume decision: given a parsed marker and the current time, return
// the marker to resume on, or null when there is no marker, it is stale, or its
// resume attempts are spent. The negative-age guard covers a backwards clock
// change (never resume on a marker that claims to be from the future).
export function freshMarker(
  marker: PlayMarker | null,
  now: number,
  maxAgeMs = RESUME_MAX_AGE_MS,
): PlayMarker | null {
  if (!marker) return null;
  const age = now - marker.savedAt;
  if (age < 0 || age > maxAgeMs) return null;
  if (marker.attempts >= MAX_RESUME_ATTEMPTS) return null;
  return marker;
}

// localStorage is unavailable in private mode / SSR / some WebViews; every
// wrapper fails soft so a storage error can never break boot or play.
function readRaw(): string | null {
  try {
    return localStorage.getItem(RESUME_KEY);
  } catch {
    return null;
  }
}

function writeRaw(marker: PlayMarker): void {
  try {
    localStorage.setItem(RESUME_KEY, serializeMarker(marker));
  } catch {
    // ignore: resume is a best-effort convenience, never load-bearing
  }
}

export function readPlayMarker(): PlayMarker | null {
  return parseMarker(readRaw());
}

// Stamp the marker for the character just entered on its realm. A completed
// entry is also the point that resets the attempt counter: the session is
// known-good again, so the next reload gets its full retry budget back.
export function savePlayMarker(characterId: number, realm: string, now: number): void {
  writeRaw({ characterId, realm, savedAt: now, attempts: 0 });
}

// Re-stamp the existing marker's savedAt without changing the character, so a
// long play session stays inside the resume window right up to the moment the
// app is backgrounded. Only a still-fresh marker is re-stamped: a stale one is
// cleared instead of resurrected (backgrounding the homepage days after playing
// must not re-arm the resume). No-op when no marker is stored.
export function refreshPlayMarker(now: number): void {
  const existing = readPlayMarker();
  if (!existing) return;
  if (!freshMarker(existing, now)) {
    clearPlayMarker();
    return;
  }
  writeRaw({ ...existing, savedAt: now });
}

// Record that the boot path consumed the marker for an auto-resume attempt.
// Called before the entry outcome is known; a completed entry resets the
// counter via savePlayMarker, so only attempts that never finish accumulate.
export function markResumeAttempt(): void {
  const existing = readPlayMarker();
  if (!existing) return;
  writeRaw({ ...existing, attempts: existing.attempts + 1 });
}

export function clearPlayMarker(): void {
  try {
    localStorage.removeItem(RESUME_KEY);
  } catch {
    // ignore
  }
}
