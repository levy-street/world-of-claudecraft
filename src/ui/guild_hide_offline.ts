// The persisted "hide offline guild members" toggle for the social window's Guild
// tab. A tiny DOM-free, deterministic state helper (the party_collapse.ts exemplar):
// the localStorage key plus load/save, driven over an injected Storage in Node tests.
//
// Guild member presence is actionable INFORMATION, not a cosmetic, so this is a pure
// USER choice: it is never gated on data-fx-level, reduce-motion, or the FPS governor.
// The only input is the player's own persisted preference.

// The persisted flag's localStorage key. Its own key, like the party-collapse
// woc_party_collapsed: '1' means hide offline members, '0' means show them. Showing
// everyone is the default, so a MISSING key (never toggled) reads as "show".
export const GUILD_HIDE_OFFLINE_STORE_KEY = 'woc_guild_hide_offline';

/**
 * Read the persisted "hide offline" flag. Default FALSE (show offline) when storage is
 * unavailable, the key is unset, or a read throws (the party-collapse feature-detect +
 * try/catch shape). Only the exact stored '1' hides; anything else (including a missing
 * or corrupt value) shows offline members.
 */
export function loadGuildHideOffline(
  storage: Pick<Storage, 'getItem'> | null = safeLocalStorage(),
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(GUILD_HIDE_OFFLINE_STORE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Persist the flag ('1' hide, '0' show). Silently no-ops when storage is unavailable
 *  or a write throws, exactly like savePartyCollapsed. */
export function saveGuildHideOffline(
  hide: boolean,
  storage: Pick<Storage, 'setItem'> | null = safeLocalStorage(),
): void {
  try {
    storage?.setItem(GUILD_HIDE_OFFLINE_STORE_KEY, hide ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

function safeLocalStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
