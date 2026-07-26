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
