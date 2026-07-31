// Baked world-map terrain plates. The plates are pure functions of (world
// seed, zone bounds) rendered at build time (scripts/build_map_backgrounds.mjs)
// into public/map_bg/<zoneId>.webp, so a client on the shipped world only
// DECODES an image instead of painting ~360k terrain pixels per zone at
// runtime. The HUD's procedural painter remains the fallback for custom
// seeds, edited worlds (the editor's sculpt layer changes the heightfield),
// and any missing plate.
import { BUILTIN_WORLD, getActiveWorldContent } from '../sim/data';
import { BAKED_MAP_BG } from './map_bg_manifest.generated';

type PlateState = HTMLImageElement | 'loading' | 'missing';
const cache = new Map<string, PlateState>();
const waiters = new Map<
  string,
  { onReady: (img: HTMLImageElement) => void; onMiss: () => void }[]
>();

/** True when the baked plate matches this world: the shipped seed, the
 *  BUILTIN world content by identity (the plates are baked against it,
 *  including its shipped sculpt stamps; the editor swaps in custom content),
 *  and a plate actually baked for the zone. */
export function bakedMapBgEligible(seed: number, zoneId: string): boolean {
  return (
    seed === BAKED_MAP_BG.seed &&
    zoneId in BAKED_MAP_BG.zones &&
    getActiveWorldContent() === BUILTIN_WORLD
  );
}

/** Load (or join the load of) a zone's baked plate. Exactly one of the two
 *  callbacks fires: onReady with the decoded image, or onMiss so the caller
 *  can fall back to the procedural painter. */
export function loadBakedMapBg(
  zoneId: string,
  onReady: (img: HTMLImageElement) => void,
  onMiss: () => void,
): void {
  const state = cache.get(zoneId);
  if (state === 'missing') {
    onMiss();
    return;
  }
  if (state instanceof HTMLImageElement) {
    onReady(state);
    return;
  }
  const queue = waiters.get(zoneId) ?? [];
  queue.push({ onReady, onMiss });
  waiters.set(zoneId, queue);
  if (state === 'loading') return;
  cache.set(zoneId, 'loading');
  const img = new Image();
  img.onload = () => {
    cache.set(zoneId, img);
    const q = waiters.get(zoneId) ?? [];
    waiters.delete(zoneId);
    for (const w of q) w.onReady(img);
  };
  img.onerror = () => {
    cache.set(zoneId, 'missing');
    const q = waiters.get(zoneId) ?? [];
    waiters.delete(zoneId);
    for (const w of q) w.onMiss();
  };
  img.src = `/map_bg/${zoneId}.webp`;
}
