// Offline character persistence: continue an offline character across
// sessions instead of starting fresh every launch.
//
// The save IS the server's persistence shape: Sim.serializeCharacter() out,
// SimConfig.characterState (addPlayer state) back in, so everything the
// server would persist for a login (level, xp, gear, bags, quests, money,
// talents, position) survives an offline relaunch the same way. Storage is
// localStorage, one slot per class and name, mirroring the offline keybind
// namespacing (woc_keybinds:offline:<class>:<name>).
//
// Every storage touch is try/catch-guarded: private mode, corrupt JSON, or a
// missing DOM (Vitest plain-Node env) all degrade to "no save", never a throw.

import type { CharacterState } from '../sim/sim';
import type { PlayerClass } from '../sim/types';

interface OfflineSaveSim {
  playerId: number;
  serializeCharacter(pid: number): CharacterState | null;
}

const KEY_PREFIX = 'woc_offline_save';
const AUTOSAVE_MS = 30_000; // match the server's 30 s autosave cadence

export function offlineSaveKey(cls: PlayerClass, name: string): string {
  return `${KEY_PREFIX}:${cls}:${name.trim().toLowerCase()}`;
}

export function loadOfflineSave(cls: PlayerClass, name: string): CharacterState | null {
  try {
    const raw = localStorage.getItem(offlineSaveKey(cls, name));
    if (!raw) return null;
    const state = JSON.parse(raw) as CharacterState;
    // Minimal shape check: a save without a numeric level is not a save.
    if (!state || typeof state !== 'object' || typeof state.level !== 'number') return null;
    return state;
  } catch {
    return null;
  }
}

export function storeOfflineSave(cls: PlayerClass, name: string, state: CharacterState): void {
  try {
    localStorage.setItem(offlineSaveKey(cls, name), JSON.stringify(state));
  } catch {
    /* quota or private mode: this session just does not persist */
  }
}

export function clearOfflineSave(cls: PlayerClass, name: string): void {
  try {
    localStorage.removeItem(offlineSaveKey(cls, name));
  } catch {
    /* nothing to clear */
  }
}

/**
 * Start autosaving the sim's primary player. Saves every 30 s and flushes on
 * pagehide and on the tab going hidden, which is how a packaged console app
 * "closes" (the WebView suspends; there is no beforeunload on Xbox). Returns
 * an unmount that stops the interval, flushes once more, and removes the
 * listeners, for a clean world exit back to the menu.
 */
export function mountOfflineAutosave(
  sim: OfflineSaveSim,
  cls: PlayerClass,
  name: string,
): () => void {
  const flush = (): void => {
    const state = sim.serializeCharacter(sim.playerId);
    if (state) storeOfflineSave(cls, name, state);
  };
  const onHidden = (): void => {
    if (document.visibilityState === 'hidden') flush();
  };

  const timer = setInterval(flush, AUTOSAVE_MS);
  let listening = false;
  try {
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    listening = true;
  } catch {
    /* no DOM host: interval-only autosave */
  }

  return () => {
    clearInterval(timer);
    if (listening) {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
    }
    flush();
  };
}
