// The dithered camera ghost (GFX.ditheredGhostFade: the low and medium tiers,
// and the Advanced "Camera Ghost" dial): a fade that never flips `transparent`.
//
// The shipped fade (occluder_fade.ts) turns a structure's materials transparent,
// and three keys a second program on that flip, so every hideable material owns
// a transparent twin: about a sixth of the compile cost measured on Windows
// D3D11. This variant keeps the material OPAQUE and drops fragments instead, on
// a 4x4 ordered (Bayer) screen-door pattern driven by one uniform. One program
// per material, no twin, no gate, no prewarm group.
//
// What it costs, so the trade is judged honestly: the look changes (a stipple
// instead of a smooth blend), and the `discard` sits in the material's one
// program for good, faded or not, which takes early depth rejection away from
// every hideable surface on GPUs that rely on it.
import type * as THREE from 'three';
import { GFX } from './gfx';

const PROGRAM_CACHE_KEY = 'ghost-dither-fade-v1';
const ANCHOR = '#include <clipping_planes_fragment>';

let forcedForTest: boolean | null = null;
let forcedByUrl: boolean | null | undefined;

/**
 * The page's ghost style. Read where a hideable material or batch is BUILT
 * (the style is baked into its program), and read live off GFX: a graphics
 * rebuild republishes the profile in the same page and rebuilds every
 * consumer, which must then see the new style. `?ghostfade=dither|blend`
 * overrides the profile for an A/B.
 */
export function ditherFadeEnabled(): boolean {
  if (forcedForTest !== null) return forcedForTest;
  if (forcedByUrl === undefined) {
    const search = typeof location === 'undefined' ? '' : location.search;
    const forced = new URLSearchParams(search).get('ghostfade');
    forcedByUrl = forced === 'dither' ? true : forced === 'blend' ? false : null;
  }
  return forcedByUrl ?? GFX.ditheredGhostFade;
}

export function setDitherFadeEnabledForTest(value: boolean | null): void {
  forcedForTest = value;
}

/**
 * The one screen-door pattern every dithered ghost drops fragments on. `fade`
 * is a GLSL float expression, 1 = fully drawn; the per-instance arm
 * (instanced_dither_fade.ts) splices the same block on its own varying.
 */
export function ghostDitherDiscardGlsl(fade: string): string {
  return `
  if ( ${fade} < 1.0 ) {
    // 4x4 Bayer matrix, thresholds centred in their cells so a fade of 0 drops
    // every fragment and a fade of 1 (guarded above) keeps them all.
    ivec2 ghostCell = ivec2( mod( gl_FragCoord.xy, 4.0 ) );
    int ghostIndex = ghostCell.x + ghostCell.y * 4;
    float ghostBayer[16] = float[16](
      0.0, 8.0, 2.0, 10.0,
      12.0, 4.0, 14.0, 6.0,
      3.0, 11.0, 1.0, 9.0,
      15.0, 7.0, 13.0, 5.0
    );
    if ( ${fade} <= ( ghostBayer[ ghostIndex ] + 0.5 ) / 16.0 ) discard;
  }`;
}

export const GHOST_DITHER_ANCHOR = ANCHOR;

const DITHER_GLSL = `${ANCHOR}${ghostDitherDiscardGlsl('uGhostFade')}`;

interface FadeUniform {
  value: number;
}

// Held apart from userData: Material.copy round-trips userData through JSON,
// so a clone would inherit a dead copy of the uniform without the hook.
const fadeUniforms = new WeakMap<THREE.Material, FadeUniform>();

/** The fade uniform a decorated material owns, or null when undecorated. */
export function ditherFadeUniform(material: THREE.Material): FadeUniform | null {
  return fadeUniforms.get(material) ?? null;
}

/** Chain the screen-door layer onto a hideable material. Idempotent. */
export function attachDitherFade(material: THREE.Material): void {
  if (fadeUniforms.has(material)) return;
  const uniform: FadeUniform = { value: 1 };
  fadeUniforms.set(material, uniform);
  const previousCompile = material.onBeforeCompile.bind(material);
  // Three's default key is the CURRENT hook's source, which is this layer's
  // once it is installed: snapshot the previous hook's source instead.
  const previousSource = material.onBeforeCompile.toString();
  const previousCacheKey = Object.hasOwn(material, 'customProgramCacheKey')
    ? material.customProgramCacheKey.bind(material)
    : null;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile(shader, renderer);
    shader.uniforms.uGhostFade = uniform;
    shader.fragmentShader = `uniform float uGhostFade;\n${shader.fragmentShader}`.replace(
      ANCHOR,
      DITHER_GLSL,
    );
  };
  material.customProgramCacheKey = () =>
    `${previousCacheKey ? previousCacheKey() : previousSource}|${PROGRAM_CACHE_KEY}`;
  material.needsUpdate = true;
}
