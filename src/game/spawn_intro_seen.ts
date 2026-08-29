// Per-character persistence of "the first-spawn cinematic has played"
// (spawn_cinematic.ts), so it plays exactly once. Storage-agnostic on purpose:
// main.ts hands in the browser's localStorage and tests hand in a map.

/** The slice of Web Storage this module reads and writes. */
export interface SpawnIntroSeenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function spawnIntroSeenKey(keybindScope: string): string {
  return `woc_spawn_intro_seen:${keybindScope}`;
}

/**
 * Whether this character has already seen the intro. Unavailable storage (a
 * throwing accessor, a private window with storage disabled) reads as SEEN:
 * the marker could never persist, so the safe answer is to skip the cinematic
 * rather than replay it on every boot.
 */
export function readSpawnIntroSeen(
  keybindScope: string,
  storage: () => SpawnIntroSeenStorage = () => localStorage,
): boolean {
  try {
    return storage().getItem(spawnIntroSeenKey(keybindScope)) === '1';
  } catch {
    return true;
  }
}

/** Record the intro as seen. Unavailable storage is tolerated: worst case
 *  the intro replays next session. */
export function markSpawnIntroSeen(
  keybindScope: string,
  storage: () => SpawnIntroSeenStorage = () => localStorage,
): void {
  try {
    storage().setItem(spawnIntroSeenKey(keybindScope), '1');
  } catch {
    // storage unavailable: worst case the intro replays next session
  }
}
