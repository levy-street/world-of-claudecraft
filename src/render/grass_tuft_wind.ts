// The wind GLSL the grass-tuft cards and the canopy share, moved out of
// foliage.ts (the monolith ratchet) when the Studio's tuft wind was gated to
// authored maps. Pure string builders: no Three, no DOM.

import { GRASS_WIND_TIME_SCALE } from './tree_sway';

// Slow travelling gust, shared by the canopy and grass shaders: it scales the
// sway amplitude (0.2 to 1) instead of adding displacement of its own, so the
// vegetation swells and calms in coherent waves rather than every plant
// flapping at one fixed strength. Same rate and world scale in both keeps the
// canopy and the meadow in the same weather.
export const windGustGlsl = (x: string, z: string, t = 'uTime'): string =>
  `0.6 + 0.4 * sin(${t} * 0.6 + ${x} * 0.05 + ${z} * 0.04)`;

/**
 * The tuft-card sway, injected after `tuftBase` is declared.
 *
 * `classic` (the built-in world) is the sway the release shipped: the shared
 * uTime clock, always on. The Studio's variant (authored maps) sways only while
 * the tuft draws: the fragment fade (foliage_shader_core.ts) has discarded it
 * by uFadeFar, so past that the wind is branched around (SPACEY, 2026-09-24:
 * "only when they are visiable"). The static interior scatter parks
 * uPlayerPos at 1e6 under a 1e8 uFadeFar, so it always sways. It runs on the
 * blade carpet's slowed clock, so tufts and blades share one wind.
 */
export function grassTuftWindGlsl(classic: boolean, strength: number): string {
  if (classic) {
    return `
        float windPhase = tuftBase.x * 0.31 + tuftBase.y * 0.27;
        float windGust = ${windGustGlsl('tuftBase.x', 'tuftBase.y')};
        float windAmt = (sin(uTime * 1.7 + windPhase) + 0.5 * sin(uTime * 3.1 + windPhase * 1.3))
          * windGust * ${strength.toFixed(3)} * smoothstep(0.0, 0.7, transformed.y);
        transformed.x += windAmt;
        transformed.z += windAmt * 0.6;`;
  }
  return `
        if (distance(tuftBase, uPlayerPos) < uFadeFar) {
          float grassT = uTime * ${GRASS_WIND_TIME_SCALE.toFixed(4)};
          float windPhase = tuftBase.x * 0.31 + tuftBase.y * 0.27;
          float windGust = ${windGustGlsl('tuftBase.x', 'tuftBase.y', 'grassT')};
          float windAmt = (sin(grassT * 1.7 + windPhase) + 0.5 * sin(grassT * 3.1 + windPhase * 1.3))
            * windGust * ${strength.toFixed(3)} * smoothstep(0.0, 0.7, transformed.y);
          transformed.x += windAmt;
          transformed.z += windAmt * 0.6;
        }`;
}
