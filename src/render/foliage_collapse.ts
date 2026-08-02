// Per-instance distance collapse for the instanced foliage meshes.
//
// Foliage buckets are ~540x240u slabs, so bucket-level culling always draws
// instances far past whatever boundary the bucket as a whole survived: in the
// short-fog realms that put fully fogged trees hundreds of units past the fog
// wall, silhouetted against the sky with no ground under them. This shader hook
// rejects each INSTANCE before material vertex work once its own distance
// leaves its window, so the boundaries (the real-model/impostor swap and the
// fog cull) hold per tree while the bucket tests stay the cheap coarse filter.
//
// The windows arrive per frame via updateCollapseUniforms (the shared-uniform
// pattern of gfx.ts sharedUniforms.uTime): every material references the same
// value objects, so the per-frame cost is three number writes. The decision
// arithmetic lives in foliage_lod.ts (instanceCullWindows); this module is only
// the Three-side injection, kept import-free so tests can drive it with plain
// fakes.
//
// COST MODEL: a collapsed instance still submits its indices and begins the
// vertex shader, so draw calls and perf-stats triangle counts are unchanged.
// It returns before projection and every later world, shadow, fog, and canopy
// vertex chunk, then produces no raster or fragment work. Bucket culls remain
// the triangle-submission lever. The shadow depth pass is untouched too: Three
// renders shadows with its own depth material, so shadow reach is bounded at
// bucket level (the shadow registers in foliage.ts), not per instance.

import type { InstanceCullWindows } from './foliage_lod';

/**
 * Which window a material's instances collapse against:
 * - 'tree': real model parts, alive in [0, treeMax)
 * - 'impostor': the far stand-ins, alive in [impostorMin, fogCull)
 * - 'plain': rocks and dressing, alive in [0, fogCull)
 */
export type CollapseRole = 'tree' | 'impostor' | 'plain';

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
// unspecified, and seeding the impostor window EMPTY ([seed, seed)) means a
// frame rendered before the first update() draws exactly the old single-LOD
// picture instead of double-drawing trees and cones.
const FAR_SEED = 1e8;
const ZERO: UniformValue = { value: 0 };
const uTreeMax: UniformValue = { value: FAR_SEED };
const uImpostorMin: UniformValue = { value: FAR_SEED };
const uFogCull: UniformValue = { value: FAR_SEED };

/** Per-frame: push the windows every collapse-enabled material reads. */
export function updateCollapseUniforms(w: InstanceCullWindows): void {
  uTreeMax.value = w.treeMax;
  uImpostorMin.value = w.impostorMin;
  uFogCull.value = w.fogCull;
}

const COLLAPSE_PARS = `
uniform float uCollapseMin;
uniform float uCollapseMax;`;

// Injected at the first stable vertex-main anchor. The decision depends only
// on the instance translation and camera uniform, so rejected instances can
// skip UV, color, normal, wind, projection, world, shadow, fog, and canopy
// work. step(min, d) * (1 - step(max, d)) is 1 exactly on [min, max), matching
// the prior late multiply. A zero keep used to form one degenerate triangle;
// one out-of-clip triangle likewise produces no fragments.
const COLLAPSE_VERTEX = `
#ifdef USE_INSTANCING
  vec2 collapseOrigin = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
  float collapseDist = distance(collapseOrigin, cameraPosition.xz);
  float collapseKeep = step(uCollapseMin, collapseDist) * (1.0 - step(uCollapseMax, collapseDist));
  if (collapseKeep == 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
#endif
#include <uv_vertex>`;

/**
 * Attach the collapse hook to a foliage material, composing with any hook the
 * material already has (the wind sway) by running it first. Also pins an
 * explicit program cache key: the default key stringifies onBeforeCompile, and
 * every chained wrapper here stringifies identically even though the PREVIOUS
 * hook (which edits the shader source) differs, so two materials could share a
 * program whose source only one of them has. The key therefore re-includes the
 * previous hook's source text, reproducing the default's semantics.
 */
export function applyInstanceCollapse(mat: CollapsibleMaterial, role: CollapseRole): void {
  const min = role === 'impostor' ? uImpostorMin : ZERO;
  const max = role === 'tree' ? uTreeMax : uFogCull;
  const prev = mat.onBeforeCompile;
  const prevSrc = typeof prev === 'function' ? prev.toString() : '';
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uCollapseMin = min;
    shader.uniforms.uCollapseMax = max;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${COLLAPSE_PARS}`)
      .replace('#include <uv_vertex>', COLLAPSE_VERTEX);
  };
  mat.customProgramCacheKey = () => `foliage-collapse|${prevSrc}`;
}
