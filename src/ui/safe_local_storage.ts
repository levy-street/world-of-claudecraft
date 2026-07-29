// The shared localStorage feature-detect every persisted-toggle pure core needs
// (guild_hide_offline.ts, party_collapse.ts, and any future one like them): probe
// for localStorage without throwing when it is unavailable (SSR, a locked-down
// browser, or a test environment with no Storage global at all), and hand back
// null rather than a broken reference so a caller's own try/catch stays the only
// place that has to reason about a missing key or a write that fails.
//
// This module is the ONE place allowed to reach `localStorage` in value position
// (`typeof localStorage !== 'undefined' ? localStorage : null`): the purity guard
// (tests/architecture.test.ts) allowlists exactly this file for that idiom, since
// DOM_GLOBAL_RE (member access only) cannot see it and every OTHER pure core is
// expected to go through here instead of re-probing on its own.

/**
 * Returns the real `localStorage` when it exists and is reachable, or null when it
 * is unavailable (SSR/no browser) or a read throws (storage disabled, private-mode
 * quota lockouts on some browsers). Callers still wrap their own getItem/setItem in
 * try/catch: a storage object handed back here can still throw on individual calls.
 */
export function safeLocalStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
