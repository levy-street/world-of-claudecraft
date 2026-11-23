// Baked world-map terrain plates. The plates are pure functions of (world
// seed, zone bounds) rendered at build time (scripts/build_map_backgrounds.mjs)
// into public/map_bg/<zoneId>.webp, so a client on the shipped world only
// DECODES an image instead of painting ~360k terrain pixels per zone at
// runtime. The HUD's procedural painter remains the fallback for custom
// seeds, edited worlds (the editor's sculpt layer changes the heightfield),
// and any missing plate.
import { GFX } from '../render/gfx';
import { BUILTIN_WORLD, getActiveWorldContent } from '../sim/data';
import { BAKED_MAP_BG } from './map_bg_manifest.generated';
import { MapBgResidentCache, mapBgResidencyPolicy } from './map_bg_residency_core';

type PlateState = HTMLImageElement | 'loading' | 'missing';
const cache = new Map<string, PlateState>();
const waiters = new Map<
  string,
  { onReady: (img: HTMLImageElement) => void; onMiss: () => void }[]
>();
// Every caller copies the plate into its own canvas inside onReady, so a
// memory-bounded profile keeps that one copy and lets the decoded image go.
let retainDecoded = true;

/** The HUD's per-zone map background cache under this page's residency policy
 *  (map_bg_residency_core.ts), keyed off the iOS memory profile. Build it after
 *  the renderer resolved the graphics profile, as the Hud is. */
export function createMapBgCache(
  currentZoneId: () => string,
): MapBgResidentCache<HTMLCanvasElement> {
  const policy = mapBgResidencyPolicy(GFX.iosMemoryProfile);
  retainDecoded = policy.retainDecodedPlates;
  return new MapBgResidentCache(policy, releaseCanvas, currentZoneId);
}

// Free the backing store now rather than whenever the element is collected.
function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

function settlePlate(zoneId: string, img: HTMLImageElement): void {
  if (retainDecoded) cache.set(zoneId, img);
  else cache.delete(zoneId); // the next load fetches and decodes it again
  const q = waiters.get(zoneId) ?? [];
  waiters.delete(zoneId);
  for (const w of q) w.onReady(img);
  if (!retainDecoded) releasePlate(img);
}

function releasePlate(img: HTMLImageElement): void {
  img.onload = null;
  img.onerror = null;
  img.removeAttribute('src');
}

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
 *  callbacks fires: onReady with the decoded image, which the caller copies
 *  before returning (a memory-bounded profile releases it right after), or
 *  onMiss so the caller can fall back to the procedural painter. */
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
    // A bounded profile (iOS, so WebKit) reloads plates, so it asks for an
    // off-main-thread decode first, in the hope that the callers' canvas copy
    // reuses it (Blink decodes again at the copy; WebKit's reuse is unmeasured).
    // Without decode(), or when it rejects, the copy decodes the plate itself,
    // as it always has.
    if (retainDecoded || typeof img.decode !== 'function') {
      settlePlate(zoneId, img);
      return;
    }
    const settle = () => settlePlate(zoneId, img);
    img.decode().then(settle, settle);
  };
  img.onerror = () => {
    cache.set(zoneId, 'missing');
    const q = waiters.get(zoneId) ?? [];
    waiters.delete(zoneId);
    for (const w of q) w.onMiss();
  };
  img.src = `/map_bg/${zoneId}.webp`;
}
