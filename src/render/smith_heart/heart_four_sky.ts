// The Heart's four-way night (the owner's ask of 2026-11-11: "each of the 4 sections feel a
// bit different, and a blend in the middle"): one ChatGPT painting of the whole sky seen
// straight up out of the crown, the zenith its middle, a quarter of it over each element's
// quarter of the room (the Breath's storm north, the Quench's aurora east, the Hammer's
// golden dust south, the Heat's ember smoke west), all four swirling together overhead.
// Over the main map, wherever no vein's own sky holds (the Ring, at the middle of the four
// veins), its twin: a muted dusk panorama painted with a sky's own perspective (thin cloud
// bands crowding the horizon, bigger soft clouds higher up), each vein's quarter round the
// horizon over its way out, all four blended into one colour overhead (the fisheye one,
// seen low from the Ring, read as blobs; the owner's call of 2026-11-11: "more like a sky,
// less colourful", then "more aligned with the previous one": ChatGPT repainted the Heart's
// painting as this panorama, the same four skies, and the dome takes both down to about
// a third to a half of their saturation, the game's grade giving some back). The dome draws both (heart_sky.ts `heartFourSky`); sources and prompt
// docs/design/raid/kit/heart_sky_src/. A standalone KTX2 like the world's skies
// (`public/env/`), fetched when the raid's interior is built, never at boot: nobody outside
// the raid draws it. Until it lands (or if it never does) the Heart keeps its procedural
// ember-violet night.

import type * as THREE from 'three';
import { loadKtx2Texture } from '../assets/loader';

/** The paintings' files: the Heart's seen straight up, the main map's panorama. */
export const SMITH_HEART_FOUR_SKY_URL = '/env/smith_heart_four_sky.ktx2';
export const SMITH_HEART_RING_SKY_URL = '/env/smith_heart_ring_sky.ktx2';

/** How the dome wraps it: `reach` the angle from the zenith the painting's rim stands at
 *  (radians: the crown hides everything under about 40 degrees of elevation, so the
 *  quarters' own skies fill what the room sees), `disc` the painting's circle's radius in
 *  the image (ChatGPT's rim stops a little short of the edges), `swirl` how far the middle
 *  turns back and forth (radians, slow: the four mixing), `grade` its value, `stars` the
 *  twinkle laid over its painted stars, `flash` the lightning walking the storm quarter. */
export const HEART_FOUR_SKY = {
  reach: 1.3,
  disc: 0.955,
  swirl: 0.3,
  grade: 0.78,
  sat: 0.45,
  stars: 0.4,
  flash: 0.6,
} as const;

/** How the dome wraps the main map's panorama, v = `horizon` - up * `stretch` (v 0 the
 *  painting's top): the Ring's cliffs hide the sky under about 25 degrees, so the
 *  painting's foot is pressed down behind them and its clouds fill the band over them;
 *  `turn` the
 *  share of a turn the painting is rotated by (each quarter over its vein's way out),
 *  `zenith` the elevation band (the up component) over which the four blend into one
 *  colour, `grade` its value, `sat` its saturation, `stars` the twinkle, `flash` the
 *  lightning in the storm's quarter. */
export const HEART_RING_SKY = {
  horizon: 1.3,
  stretch: 1.35,
  turn: 0,
  zenith: [0.55, 0.88],
  grade: 0.78,
  sat: 0.32,
  stars: 0.35,
  flash: 0.45,
} as const;

/** How long the interior waits for it before building with the procedural night. */
const WAIT_MS = 8000;

let texture: THREE.Texture | null = null;
let ringTexture: THREE.Texture | null = null;
let loading: Promise<void> | null = null;
let settled = false;

/** Fetch both paintings once. Never rejects; resolves within the wait cap. */
export function ensureHeartFourSky(): Promise<void> {
  if (settled || typeof window === 'undefined') return Promise.resolve();
  if (!loading)
    loading = Promise.all([
      loadKtx2Texture(SMITH_HEART_FOUR_SKY_URL, { large: true })
        .then((t) => {
          texture = t;
        })
        .catch(() => undefined),
      loadKtx2Texture(SMITH_HEART_RING_SKY_URL, { large: true })
        .then((t) => {
          ringTexture = t;
        })
        .catch(() => undefined),
    ]).then(() => {
      settled = true;
    });
  return Promise.race([loading, new Promise<void>((resolve) => setTimeout(resolve, WAIT_MS))]);
}

/** The Heart's painting, once it has landed. */
export function heartFourSkyTexture(): THREE.Texture | null {
  return texture;
}

/** The main map's panorama, once it has landed. */
export function heartRingSkyTexture(): THREE.Texture | null {
  return ringTexture;
}
