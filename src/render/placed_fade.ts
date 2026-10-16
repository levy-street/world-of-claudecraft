// Per-instance fade for the placed-asset batches.
//
// A placement that leaves its draw (distance cull, or the swap to its 300 yd
// imposter sprite) used to vanish between one frame and the next; SPACEY
// (2026-09-18): "when models phase out they should pop out gentle with a fade
// look". An InstancedMesh has no per-instance opacity, so the batches carry a
// one-float instanced attribute (PLACED_FADE_ATTRIBUTE, 0..1) and the shared
// template materials get a small shader patch: a 4x4 Bayer screen-door test
// discards fragments as the value drops. Screen-door rather than alpha so the
// fading copy stays in the OPAQUE pass (no sorting, no blending, depth still
// written) and costs nothing while the value sits at 1.
//
// The patch is safe on a material drawn by anything else: the attribute is
// only declared under USE_INSTANCING, a non-instanced draw hard-codes 1, and
// `defaultAttributeValues` (which three honours for every material, not only
// ShaderMaterial) feeds 1 to any OTHER instanced mesh that shares the material
// without carrying the attribute (the shipped world's own instanced props).
//
// Materials that already carry a shader patch (tree sway, ship motion) keep
// it: the fade wraps and chains the existing onBeforeCompile and extends the
// program cache key, so a swaying tree and a rigid crate never share a
// program by accident. mesh_merge.ts reads `wocFrameBound`, set here when a
// patch was ALREADY present, to keep those node-frame-bound materials out of
// the material merge; the fade patch itself is frame-agnostic and merge-safe.

import * as THREE from 'three';

export const PLACED_FADE_ATTRIBUTE = 'aWocFade';

const DEFAULT_ON_BEFORE_COMPILE = THREE.Material.prototype.onBeforeCompile;
const DEFAULT_CACHE_KEY = THREE.Material.prototype.customProgramCacheKey;

interface FadeUserData {
  wocFadePatched?: boolean;
  wocFrameBound?: boolean;
}

/** 4x4 ordered dither: 0..15/16 by screen pixel, the classic Bayer matrix. */
export const PLACED_FADE_DITHER_GLSL = /* glsl */ `
float wocBayer4(vec2 fragCoord) {
  int x = int(mod(fragCoord.x, 4.0));
  int y = int(mod(fragCoord.y, 4.0));
  int i = x + y * 4;
  const float b[16] = float[16](
    0.0, 8.0, 2.0, 10.0,
    12.0, 4.0, 14.0, 6.0,
    3.0, 11.0, 1.0, 9.0,
    15.0, 7.0, 13.0, 5.0);
  return b[i] / 16.0;
}
`;

/** The shader edits, exported so a custom (ShaderMaterial) sprite can apply
 *  the same screen-door fade from its own source. */
export function patchFadeShader(shader: { vertexShader: string; fragmentShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
#ifdef USE_INSTANCING
attribute float ${PLACED_FADE_ATTRIBUTE};
#endif
varying float vWocFade;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
#ifdef USE_INSTANCING
vWocFade = ${PLACED_FADE_ATTRIBUTE};
#else
vWocFade = 1.0;
#endif`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
varying float vWocFade;
${PLACED_FADE_DITHER_GLSL}`,
    )
    .replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
// A cross-fade must PARTITION the dither, not test both reps the same way.
// Both patches used to discard where bayer >= fade, and advanceFades gives
// the incoming rep t and the outgoing 1 - t, so both drew the pixels with
// bayer < 0.5 at the midpoint and NOBODY drew the other half: the object
// went half see-through every time it changed tier. A NEGATIVE fade marks
// the outgoing rep, which draws the exact complement of the incoming one.
if (vWocFade < 0.0) {
  if (wocBayer4(gl_FragCoord.xy) < 1.0 + vWocFade) discard;
} else if (vWocFade < 0.999 && wocBayer4(gl_FragCoord.xy) >= vWocFade) discard;`,
    );
}

/** Is this material already fade-patched? */
export function placedFadeInstalled(material: THREE.Material): boolean {
  return (material.userData as FadeUserData).wocFadePatched === true;
}

/**
 * Install the fade patch on a shared template material, once. Idempotent.
 * Call BEFORE the material's sub-meshes are decomposed for batching, so the
 * merge sees the `wocFrameBound` verdict for materials that carried a
 * node-frame-bound patch of their own.
 */
export function installPlacedFade(material: THREE.Material): void {
  const ud = material.userData as FadeUserData;
  if (ud.wocFadePatched) return;
  const prevCompile = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  const hadPatch = prevCompile !== DEFAULT_ON_BEFORE_COMPILE;
  // a patch that declares itself frame-agnostic (town_smart_material.ts reads
  // only the view matrix) leaves the material merge-eligible
  if (hadPatch && (material.userData as { wocFrameAgnostic?: boolean }).wocFrameAgnostic !== true)
    ud.wocFrameBound = true;
  ud.wocFadePatched = true;
  material.onBeforeCompile = function (this: THREE.Material, shader, renderer) {
    if (hadPatch) prevCompile.call(this, shader, renderer);
    patchFadeShader(shader);
  };
  material.customProgramCacheKey = function (this: THREE.Material) {
    const base = prevKey === DEFAULT_CACHE_KEY ? prevCompile.toString() : prevKey.call(this);
    return `${base}|wocfade`;
  };
  const withDefaults = material as unknown as {
    defaultAttributeValues?: Record<string, number[]>;
  };
  withDefaults.defaultAttributeValues = {
    ...(withDefaults.defaultAttributeValues ?? {}),
    [PLACED_FADE_ATTRIBUTE]: [1],
  };
  material.needsUpdate = true;
}
