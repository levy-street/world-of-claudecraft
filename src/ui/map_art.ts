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

import { require2dContext } from './canvas_context';

const cache = new Map<string, Promise<HTMLImageElement | null>>();
// The editor opts into the static atlas directly through loadMapArt. The game
// HUD still calls onMapArtReady for every zone while building its world strip,
// so keep that eager path parked until it is converted to one lazy world plate.
const GAME_MAP_ART_ENABLED = false;

/** Load one bundled plate. Replacing public/map_art/<id>.png is the complete
 * manual update workflow; markers and labels remain live overlays. */
export function loadMapArt(zoneId: string): Promise<HTMLImageElement | null> {
  const cached = cache.get(zoneId);
  if (cached) return cached;
  const pending = tryLoad(zoneId, ['webp', 'png'], 0);
  cache.set(zoneId, pending);
  return pending;
}

/** Hand-painted plates land in the whole-world minimap strip too, each over its
 *  own band of `region`. The caller passes the ACTIVE world's zones (shipped
 *  plate art must not land on an authored map); `strip` is read again when a
 *  plate lands, since the HUD may have swapped the canvas by then. */
export function paintMapArtIntoStrip(
  strip: () => HTMLCanvasElement,
  region: { minZ: number; maxZ: number },
  zones: readonly { id: string; zMin: number; zMax: number }[],
): void {
  const stripH = strip().height;
  const spanZ = region.maxZ - region.minZ;
  for (const zn of zones) {
    onMapArtReady(zn.id, (img) => {
      const top = ((region.maxZ - zn.zMax) / spanZ) * stripH;
      const rows = ((zn.zMax - zn.zMin) / spanZ) * stripH;
      const canvas = strip();
      require2dContext(canvas).drawImage(img, 0, top, canvas.width, rows);
    });
  }
}

/** Kick (or join) the load of a plate; onReady fires only if it exists. */
export function onMapArtReady(zoneId: string, onReady: (img: HTMLImageElement) => void): void {
  if (!GAME_MAP_ART_ENABLED) return;
  void loadMapArt(zoneId).then((img) => {
    if (img) onReady(img);
  });
}

function tryLoad(
  zoneId: string,
  exts: readonly string[],
  i: number,
): Promise<HTMLImageElement | null> {
  if (i >= exts.length) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => void tryLoad(zoneId, exts, i + 1).then(resolve);
    img.src = `/map_art/${zoneId}.${exts[i]}`;
  });
}
