// What colour is the dust a body kicks up off a given surface.
//
// Extracted from renderer.ts, where it was a five-deep nested ternary inside the puff
// emitter. It is a lookup table over a closed union and it is now shared: the footstep
// puffs the renderer emits and the debris a boss throws off the ground both have to agree
// about what the ground is made of, or a slam and a footfall land on the same mud and
// throw up two different colours.
//
// Three- and DOM-free, so a Vitest drives it directly and the RENDER_PURE_CORES purity
// sweep in tests/architecture.test.ts covers it.
import type { Surface } from './audio_sink';

/**
 * Dust colour for a surface, or `null` where a surface throws no dust at all.
 *
 * Water returns null rather than a blue: a splash is not a puff, it moves differently and
 * lives for a different length of time, so a caller that wants one has to ask for one.
 * Returning a colour here would have every dust emitter quietly render sea spray as
 * hovering fog.
 */
export function groundPuffColor(surface: Surface): number | null {
  switch (surface) {
    case 'water':
      return null;
    case 'stone':
      return 0x9b9a95;
    case 'wood':
      return 0xa8895f;
    case 'snow':
      return 0xe6eef5;
    case 'dirt':
      return 0xa38257;
    default:
      return 0x8d9a63;
  }
}

/**
 * The heavier, wetter tone the same surface throws when something enormous hits it.
 *
 * A footfall lifts the dry top layer; a fist that leaves a crater turns over what is
 * under it. Darkening and desaturating the same base is what makes the two read as the
 * same ground rather than as two unrelated effects.
 */
export function excavatedPuffColor(surface: Surface): number | null {
  const base = groundPuffColor(surface);
  if (base === null) return null;
  const r = (base >> 16) & 0xff;
  const g = (base >> 8) & 0xff;
  const b = base & 0xff;
  const mix = (c: number) => Math.round(c * 0.62 + 0x2a * 0.38);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}
