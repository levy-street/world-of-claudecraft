import { WORLD_SEED } from '../sim/world_seed';
// Editor -> game play-test handoff. Stashes a WorldContent (built from the current
// CustomMap via custom_map.customMapToWorldContent) under a one-shot transfer token
// in IndexedDB and opens a disposable game tab, which boots OFFLINE into that
// world (see game/editor_playtest.ts + main.ts). Offline-only: playtest never
// talks to the server. localStorage and then a sessionStorage same-tab handoff
// cover browsers that block IndexedDB.

import { EDITOR_PLAYTEST_KEY, stashPlaytestTransfer } from '../game/editor_playtest';
import { retirePageAndReplace } from '../render/context_release';
import { encodeBiomePaintIdsRle } from '../sim/map_doc';
import type { WorldContent } from '../sim/types';
import type { CustomMap } from './custom_map';
import { parseMap, serializeMapCompact } from './persist';

// The shipped world seed: using it makes the play-test heightfield match
// what the editor previews for the built-in terrain.
export const DEFAULT_PLAYTEST_SEED = WORLD_SEED;

// sessionStorage key holding the meta.id of the map that launched the last
// playtest in this tab. The editor writes it on launch (after a full local
// save) and reads it on boot, so the game's "Back to Editor" button lands on
// the same map instead of a blank document.
export const PLAYTEST_RESUME_KEY = 'woc_editor_playtest_resume';

// Full editor-document recovery for the rare case where the local map store is
// unavailable during launch. The game still receives WorldContent below; this
// copy is only for the editor if the user comes back from a failed navigation.
export const PLAYTEST_RECOVERY_KEY = 'woc_editor_playtest_recovery';
export const PLAYTEST_TRANSFER_PREFIX = 'woc_editor_playtest_transfer:';
export const PLAYTEST_TRANSFER_PARAM = 'editorPlaytest';

export interface PlaytestOptions {
  seed: number;
  playerClass: string;
  playerName: string;
}

// A fine paint grid's plain ids array is several MB of JSON ? past the
// sessionStorage quota ("storage blocked" on Playtest). Ship it run-length
// encoded (shared codec in sim/map_doc); the game-side reader expands it
// before the world boots. Small grids stay plain.
const IDS_RLE_MIN = 4096;

export function savePlaytestRecoveryDraft(map: CustomMap): boolean {
  try {
    sessionStorage.setItem(PLAYTEST_RECOVERY_KEY, serializeMapCompact(map));
    return true;
  } catch {
    return false;
  }
}

export function loadPlaytestRecoveryDraft(): CustomMap | null {
  try {
    const raw = sessionStorage.getItem(PLAYTEST_RECOVERY_KEY);
    return raw ? parseMap(raw) : null;
  } catch {
    return null;
  }
}

export function clearPlaytestRecoveryDraft(mapId?: string): void {
  try {
    if (mapId) {
      const map = loadPlaytestRecoveryDraft();
      if (map && map.meta.id !== mapId) return;
    }
    sessionStorage.removeItem(PLAYTEST_RECOVERY_KEY);
  } catch {
    // Blocked storage: a stale recovery draft is harmless.
  }
}

// Stash the world and open the game. Resolves false only if every transfer store
// is blocked or full; the caller can surface that and the editor stays put.
export async function launchPlaytest(world: WorldContent, opts: PlaytestOptions): Promise<boolean> {
  let content: unknown = world;
  const bp = world.biomePaint;
  if (bp && Array.isArray(bp.ids) && bp.ids.length >= IDS_RLE_MIN) {
    const { ids, ...rest } = bp;
    content = { ...world, biomePaint: { ...rest, idsRle: encodeBiomePaintIdsRle(ids) } };
  }
  const payload = JSON.stringify({
    content,
    seed: opts.seed,
    playerClass: opts.playerClass,
    playerName: opts.playerName,
  });
  const token =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  // Run the duplicate game renderer in an opener-free browsing context. When
  // its Back to Editor button closes that tab, Chrome can terminate its whole
  // renderer process and return PartitionAlloc/decoded texture pages to the OS
  // instead of reusing an ever-larger allocator arena for the next playtest.
  const openGameTab = () =>
    window.open(
      `/index.html?${PLAYTEST_TRANSFER_PARAM}=${encodeURIComponent(token)}`,
      '_blank',
      'noopener',
    );
  // A popup blocker can prevent the consumer from opening. Clear any older
  // orphaned localStorage payload first so storage can never accumulate across
  // failed launches (the IndexedDB courier replaces its own orphans).
  try {
    const staleKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PLAYTEST_TRANSFER_PREFIX)) staleKeys.push(key);
    }
    for (const key of staleKeys) localStorage.removeItem(key);
  } catch {
    // Blocked localStorage holds no orphans to clear.
  }
  // IndexedDB is the one-shot cross-tab courier; the game consumes and deletes
  // the token immediately. Web Storage throws QuotaExceededError past ~5.2M
  // characters per origin, which a map with a big cave carve outgrows. The
  // write finishes well inside the click's user-activation window, so the
  // popup is still allowed after the await.
  if (await stashPlaytestTransfer(token, payload)) {
    openGameTab();
    return true;
  }
  try {
    localStorage.setItem(`${PLAYTEST_TRANSFER_PREFIX}${token}`, payload);
    openGameTab();
    return true;
  } catch (err) {
    // Privacy modes can block localStorage, and a large map overflows it. Try
    // the older same-tab sessionStorage handoff so playtesting still works there.
    console.warn('playtest: localStorage handoff failed', err);
  }

  let stored = false;
  try {
    sessionStorage.setItem(EDITOR_PLAYTEST_KEY, payload);
    stored = true;
  } catch {
    stored = false;
  }
  if (stored) {
    // Replace instead of adding another giant editor document to session
    // history. The return button is the supported way back and opens a fresh,
    // fully saved editor without retaining this page's heap in the bfcache.
    retirePageAndReplace('/index.html');
  }
  return stored;
}
