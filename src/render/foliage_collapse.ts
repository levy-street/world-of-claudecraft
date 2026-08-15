// Per-instance distance collapse for the instanced foliage meshes.
//
// Foliage buckets are ~540x240u slabs, so bucket-level culling always draws
// instances far past whatever boundary the bucket as a whole survived: in the
// short-fog realms that put fully fogged trees hundreds of units past the fog
// wall, silhouetted against the sky with no ground under them. This shader hook
// rejects each INSTANCE before material vertex work once its own distance
// leaves its window, so the boundaries (the real-model handoff to the baked
// sprite impostors, and the fog cull) hold per tree while the bucket tests stay
// the cheap coarse filter.
//
// THE HANDOFF IS JITTERED PER INSTANCE. Every real-geometry role ends at its
// window max minus a hashed share of the fade span (IMPOSTOR_SWAP_FADE), and
// the sprite mesh (foliage_impostor.ts) begins each instance at the same
// hashed distance: the shared GLSL lives in foliage_impostor_core.ts so both
// vertex shaders compile the identical expression (see its header for the
// precision caveat). The swap line is therefore never a front that sweeps
// the forest; each tree trades representations alone, at a fixed distance,
// in a single frame.
//
// The windows arrive per frame via updateCollapseUniforms (the shared-uniform
// pattern of gfx.ts sharedUniforms.uTime): every material references the same
// value objects, so the per-frame cost is a handful of number writes. The
// decision arithmetic lives in foliage_lod.ts and foliage_impostor_core.ts;
// this module is only the Three-side injection, kept import-light so tests can
// drive it with plain fakes.
//
// COST MODEL: a collapsed instance still submits its indices and begins the
// vertex shader, so draw calls and perf-stats triangle counts are unchanged.
// It returns before projection and every later world, shadow, fog, and canopy
// vertex chunk, then produces no raster or fragment work. Bucket culls remain
// the triangle-submission lever. The shadow depth pass is untouched too: Three
// renders shadows with its own depth material, so shadow reach is bounded at
// bucket level (the shadow registers in foliage.ts), not per instance.

import { IMPOSTOR_JITTER_GLSL } from './foliage_impostor_core';

/**
 * Which window a material's instances collapse against:
 * - 'tree': real tree parts (core and near-fill), alive in [0, treeSwap - fade * jitter)
 * - 'rock': real rocks, alive in [0, rockSwap - fade * jitter)
 * - 'dress': real bushes, alive in [0, dressSwap - fade * jitter)
 * - 'plain': ferns, mushrooms, everything with no sprite: alive in [0, fogCull)
 * On the lean arm (no impostors) the fade uniform stays 0, so every window is
 * the plain hard boundary the old single-LOD picture had.
 */
export type CollapseRole = 'tree' | 'rock' | 'dress' | 'plain';

interface UniformValue {
  value: number;
}

interface CollapsibleShader {
  uniforms: Record<string, UniformValue>;
  vertexShader: string;
}

/**
 * The subset of THREE.Material this module touches, kept structural so the
 * module (and its test) never needs a three import. onBeforeCompile is method
 * syntax on purpose: it keeps assignment from THREE.Material bivariant.
 */
export interface CollapsibleMaterial {
  onBeforeCompile?(shader: CollapsibleShader, renderer: unknown): void;
  customProgramCacheKey?(): string;
}

// Finite seeds on purpose: GLSL ES leaves step() with an infinite edge
// unspecified. Seeding every max at FAR_SEED (with fade 0) means a frame
// rendered before the first update() draws exactly the old single-LOD picture.
const FAR_SEED = 1e8;
const ZERO: UniformValue = { value: 0 };
const uTreeMax: UniformValue = { value: FAR_SEED };
const uRockMax: UniformValue = { value: FAR_SEED };
const uDressMax: UniformValue = { value: FAR_SEED };
const uBuildingMax: UniformValue = { value: FAR_SEED };
const uFogCull: UniformValue = { value: FAR_SEED };
const uFade: UniformValue = { value: 0 };
const uSpriteFar: UniformValue = { value: FAR_SEED };

export interface CollapseWindowValues {
  treeMax: number;
  rockMax: number;
  dressMax: number;
  /** real buildings and skyline decor end at the detail horizon; their
   *  sprites begin a little inside it (foliage_impostor.ts binds this) */
  buildingMax: number;
  fogCull: number;
  fade: number;
  /** where every sprite dies: the live fog wall (foliage_impostor.ts binds it) */
  spriteFar: number;
}

/** Per-frame: push the windows every collapse-enabled material reads. */
export function updateCollapseUniforms(w: CollapseWindowValues): void {
  uTreeMax.value = w.treeMax;
  uRockMax.value = w.rockMax;
  uDressMax.value = w.dressMax;
  uBuildingMax.value = w.buildingMax;
  uFogCull.value = w.fogCull;
  uFade.value = w.fade;
  uSpriteFar.value = w.spriteFar;
}

/**
 * The live uniform value objects, for the sprite material to bind directly
 * (foliage_impostor.ts): the sprite side of each handoff must read the very
 * same numbers the real side collapsed against, on the same frame.
 */
export function collapseWindowUniforms(): {
  uTreeMax: UniformValue;
  uRockMax: UniformValue;
  uDressMax: UniformValue;
  uBuildingMax: UniformValue;
  uFogCull: UniformValue;
  uFade: UniformValue;
  uSpriteFar: UniformValue;
} {
  return { uTreeMax, uRockMax, uDressMax, uBuildingMax, uFogCull, uFade, uSpriteFar };
}

const COLLAPSE_PARS = `
uniform float uCollapseMin;
uniform float uCollapseMax;
uniform float uCollapseFade;`;

// Injected at the first stable vertex-main anchor. The decision depends only
// on the instance translation and camera uniform, so rejected instances can
// skip UV, color, normal, wind, projection, world, shadow, fog, and canopy
// work. step(min, d) * (1 - step(max, d)) is 1 exactly on [min, max), matching
// the prior late multiply. A zero keep used to form one degenerate triangle;
// one out-of-clip triangle likewise produces no fragments. The fade term pulls
// each instance's max in by its own hash so the sprite side can start it at
// the same distance (see the module header).
const COLLAPSE_VERTEX = `
#ifdef USE_INSTANCING
  vec2 collapseOrigin = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
  float collapseDist = distance(collapseOrigin, cameraPosition.xz);
  float collapseJitter = ${IMPOSTOR_JITTER_GLSL};
  float collapseEnd = uCollapseMax - uCollapseFade * collapseJitter;
  float collapseKeep = step(uCollapseMin, collapseDist) * (1.0 - step(collapseEnd, collapseDist));
  if (collapseKeep == 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
#endif
#include <uv_vertex>`;

const ROLE_MAX: Record<CollapseRole, UniformValue> = {
  tree: uTreeMax,
  rock: uRockMax,
  dress: uDressMax,
  plain: uFogCull,
};

/**
 * Attach the collapse hook to a foliage material, composing with any hook the
 * material already has (the wind sway) by running it first. Also pins an
 * explicit program cache key: the default key stringifies onBeforeCompile, and
 * every chained wrapper here stringifies identically even though the PREVIOUS
 * hook (which edits the shader source) differs, so two materials could share a
 * program whose source only one of them has. The key therefore re-includes the
 * previous hook's source text, reproducing the default's semantics. Every role
 * shares one injected source (only uniform BINDINGS differ), so the roles keep
 * sharing programs exactly as the single-window version did.
 */
export function applyInstanceCollapse(mat: CollapsibleMaterial, role: CollapseRole): void {
  const max = ROLE_MAX[role];
  const fade = role === 'plain' ? ZERO : uFade;
  const prev = mat.onBeforeCompile;
  const prevSrc = typeof prev === 'function' ? prev.toString() : '';
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uCollapseMin = ZERO;
    shader.uniforms.uCollapseMax = max;
    shader.uniforms.uCollapseFade = fade;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${COLLAPSE_PARS}`)
      .replace('#include <uv_vertex>', COLLAPSE_VERTEX);
  };
  mat.customProgramCacheKey = () => `foliage-collapse|${prevSrc}`;
}
