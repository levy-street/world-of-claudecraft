// Per-instance distance collapse for the instanced foliage meshes.
//
// Foliage buckets are ~540x240u slabs, so bucket-level culling always draws
// instances far past whatever boundary the bucket as a whole survived: in the
// short-fog realms that put fully fogged trees hundreds of units past the fog
// wall, silhouetted against the sky with no ground under them. This shader hook
// collapses each INSTANCE to a degenerate point once its own distance leaves
// its window, so the boundaries (the real-model/impostor swap and the fog cull)
// hold per tree while the bucket tests stay the cheap coarse pre-filter.
//
// The windows arrive per frame via updateCollapseUniforms (the shared-uniform
// pattern of gfx.ts sharedUniforms.uTime): every material references the same
// value objects, so the per-frame cost is three number writes. The decision
// arithmetic lives in foliage_lod.ts (instanceCullWindows); this module is only
// the Three-side injection, kept import-free so tests can drive it with plain
// fakes.
//
// COST MODEL: a collapsed instance still submits its vertices, so draw calls,
// index bandwidth, vertex-shader work and the perf-stats triangle counts are
// all unchanged; only rasterisation and fragment work are saved. This is a
// correctness-at-the-boundary tool, not a triangle-budget lever (the bucket
// culls remain that). The shadow depth pass is untouched too: three renders
// shadows with its own depth material, so shadow reach is bounded at bucket
// level (the shadow registers in foliage.ts), not per instance.

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

// Injected immediately before project_vertex, i.e. AFTER every transformed
// mutation (wind sway included): a collapsed vertex must stay collapsed, not be
// nudged back off the origin by a later wind offset. instanceMatrix[3] is the
// instance's world-space base (the foliage group sits at identity; the wind
// hook already relies on this), and cameraPosition is in every vertex prelude.
// step(min, d) * (1 - step(max, d)) is 1 exactly on [min, max).
const COLLAPSE_VERTEX = `
#ifdef USE_INSTANCING
  vec2 collapseOrigin = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
  float collapseDist = distance(collapseOrigin, cameraPosition.xz);
  transformed *= step(uCollapseMin, collapseDist) * (1.0 - step(uCollapseMax, collapseDist));
#endif
#include <project_vertex>`;

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
      .replace('#include <project_vertex>', COLLAPSE_VERTEX);
  };
  mat.customProgramCacheKey = () => `foliage-collapse|${prevSrc}`;
}
