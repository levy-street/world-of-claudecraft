// Optional hand-painted map plates. A zone that ships art at
// /map_art/<zoneId>.png (or .webp, tried first) gets it composited over its
// procedural map background in BOTH map surfaces: the map window's per-zone
// canvas and the minimap's world-strip canvas. Zones without art keep the
// procedural painter, so plates can arrive one realm at a time.
//
// Art contract (matches the maps_ref/ layout exports the plates are painted
// over): the image covers the zone's full band, north at the top, the same
// east-west mirroring as the game map, any resolution with the band's aspect
// ratio. Markers, labels, and the player arrow are drawn on top by the
// existing painters, so the art wants terrain only, no text.

type ArtState = HTMLImageElement | 'loading' | 'missing';
const cache = new Map<string, ArtState>();
const waiters = new Map<string, ((img: HTMLImageElement) => void)[]>();

/** Kick (or join) the load of a zone's plate; onReady fires only if it exists. */
// Plates are parked while the world's shape settles: the shipped art was
// painted for the old layout and no longer matches the terrain. Flip to
// true when fresh plates land in public/map_art/.
const MAP_ART_ENABLED = false;

export function onMapArtReady(zoneId: string, onReady: (img: HTMLImageElement) => void): void {
  if (!MAP_ART_ENABLED) return;
  const state = cache.get(zoneId);
  if (state === 'missing') return;
  if (state instanceof HTMLImageElement) {
    onReady(state);
    return;
  }
  const queue = waiters.get(zoneId) ?? [];
  queue.push(onReady);
  waiters.set(zoneId, queue);
  if (state === 'loading') return;
  cache.set(zoneId, 'loading');
  tryLoad(zoneId, ['webp', 'png'], 0);
}

function tryLoad(zoneId: string, exts: string[], i: number): void {
  if (i >= exts.length) {
    cache.set(zoneId, 'missing');
    waiters.delete(zoneId);
    return;
  }
  const img = new Image();
  img.onload = () => {
    cache.set(zoneId, img);
    const queue = waiters.get(zoneId) ?? [];
    waiters.delete(zoneId);
    for (const cb of queue) cb(img);
  };
  img.onerror = () => tryLoad(zoneId, exts, i + 1);
  img.src = `/map_art/${zoneId}.${exts[i]}`;
}
