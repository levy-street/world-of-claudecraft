// Loads the painted continent-overview plate shown on the world map's continent
// level. A single static hand-authored / AI-generated key-art image at
// /map_art/world_overview.webp, decoded once and cached. The continent painter
// blits it into the world-bounds dest rect; when it is missing the painter falls
// back to an ocean fill plus the zone-region overlay, so the overview still works
// (custom worlds, a stripped asset build, or a not-yet-committed plate).
//
// Terrain-only art contract (mirrors map_art.ts): north at the top, the same
// east-west mirroring as the game map, no baked text or labels (the localized
// zone names + markers are drawn on top by the painter). Swap the file in place
// to change the art; the loader keys on the fixed path, nothing else.
//
// FRAMING contract, because the zone regions are projected onto the whole plate
// rect: the image must be cropped so its FRAME equals the world bounds, i.e. the
// painted land runs edge to edge (only the coastline's own surf outside it), with
// the three zone columns thirds of the width and the zone bands their real share
// of the height. Ocean padding baked into the crop shifts every clickable region
// off the land it labels. Two things track the file and must be updated with it:
// CONTINENT_FALLBACK_ASPECT (continent_map_view.ts, pinned to the real pixels by
// tests/continent_map_view.test.ts) and --color-map-continent-ocean (tokens.css,
// the flat fill the plate is letterboxed into, sampled from its deep water).

type ArtState = HTMLImageElement | 'loading' | 'missing';

let state: ArtState | null = null;
const waiters: { onReady: (img: HTMLImageElement) => void; onMiss: () => void }[] = [];

const CONTINENT_ART_SRC = '/map_art/world_overview.webp';

/** Load (or join the load of) the continent plate. Exactly one of the two
 *  callbacks fires: onReady with the decoded image, or onMiss so the caller can
 *  fall back to the ocean + region overlay. */
export function loadContinentArt(
  onReady: (img: HTMLImageElement) => void,
  onMiss: () => void,
): void {
  if (state === 'missing') {
    onMiss();
    return;
  }
  if (state instanceof HTMLImageElement) {
    onReady(state);
    return;
  }
  waiters.push({ onReady, onMiss });
  if (state === 'loading') return;
  state = 'loading';
  const img = new Image();
  img.onload = () => {
    state = img;
    const queue = waiters.splice(0);
    for (const w of queue) w.onReady(img);
  };
  img.onerror = () => {
    state = 'missing';
    const queue = waiters.splice(0);
    for (const w of queue) w.onMiss();
  };
  img.src = CONTINENT_ART_SRC;
}
