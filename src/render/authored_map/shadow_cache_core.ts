// Pure staleness rule for the editor's parked sun-shadow map (shadow_cache.ts).
// Three- and DOM-free.

export const SHADOW_CACHE_MOVE = 6; // yards the sun target drifts before a re-render
export const SHADOW_CACHE_DIR_DOT = 0.99996; // ~0.5 deg of key-light swing (time of day)
export const SHADOW_CACHE_MAX_AGE = 0.75; // sec heartbeat so animated NPC/mob shadows still creep
export const EDITOR_SHADOW_MAP_MAX = 2048;

/** Whether the parked shadow map must re-render this frame: an edit poked it
 *  (`dirty`), the heartbeat elapsed, the sun target drifted (`moved2` is the
 *  squared drift in yards), or the key light swung (`dirDot` is the cosine
 *  between this frame's light direction and the cached one). */
export function shadowCacheStale(
  dirty: boolean,
  age: number,
  moved2: number,
  dirDot: number,
): boolean {
  return (
    dirty ||
    age >= SHADOW_CACHE_MAX_AGE ||
    moved2 > SHADOW_CACHE_MOVE * SHADOW_CACHE_MOVE ||
    dirDot < SHADOW_CACHE_DIR_DOT
  );
}
