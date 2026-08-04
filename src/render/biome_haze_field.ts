// The Three half of the biome haze field: one small world-space DataTexture
// plus the shared uniform block and GLSL snippet every consumer surface
// splices in, so distant land carries ITS OWN zone's atmosphere instead of
// the camera zone's. All the decisions (layout, colour sourcing, border
// cross-fade, distance ramp) live in biome_haze_field_core.ts, which is
// Node-tested; this file only owns the texture, the uniforms and the string.
//
// One field, one uniform block, three consumers. The near splat terrain, the
// far vista tiles and (when a caller opts in) any other world surface all
// splice the SAME snippet at the SAME point (immediately before
// <fog_fragment>, so the haze lands where scene fog lands and the horizon
// band still wins at the rim). Sharing the snippet is what makes the
// near-to-far handoff seamless: at the detail horizon both surfaces evaluate
// identical math on identical uniforms, so there is no ring where one layer
// hands off to the other.
//
// Cost: one RGBA8 texture of about 15k texels (60 KB, one zoneBiomeAt tap per
// texel, roughly 10 ms once per session and memoized across terrain rebuilds),
// one texture fetch and a handful of ALU per world fragment, and two tiny
// uniform writes per frame.

import * as THREE from 'three';
import type { BiomeId } from '../sim/types';
import {
  type BiomeHazePreset,
  buildBiomeHazeFieldData,
  HAZE_AERIAL_MAX,
  HAZE_AERIAL_ONSET,
  HAZE_AERIAL_REF,
  type HazeFieldLayout,
} from './biome_haze_field_core';
import { renderLayerDisabled } from './render_dev_flags';

// Shared BY REFERENCE across every consumer material, the sharedUniforms.uTime
// idiom: the renderer writes them once per frame and every surface follows.
// uHazeRect is (originX, originZ, 1/sizeX, 1/sizeZ) so a fragment normalizes
// its world xz into field uv with one multiply-add.
const uHazeField: { value: THREE.Texture | null } = { value: null };
const uHazeRect = { value: new THREE.Vector4(0, 0, 1, 1) };
const uHazeGrade = { value: new THREE.Vector3(1, 1, 1) };
const uHazeCam = { value: new THREE.Vector2(0, 0) };

let fieldTexture: THREE.DataTexture | null = null;
let fieldLayout: HazeFieldLayout | null = null;

/**
 * Build the field once, from the renderer's own outdoor fog presets. Call
 * BEFORE building any surface that samples it: the consumers gate their
 * shader patch on hasBiomeHazeField() at compile time, so a field installed
 * later would never be read. Repeat calls are a no-op (the field is
 * world-static, so a terrain rebuild reuses it).
 *
 * `?zonehaze=off` keeps the field out entirely, which is the A/B switch back
 * to the uniform camera-zone atmosphere.
 */
export function ensureBiomeHazeField(presets: Readonly<Record<BiomeId, BiomeHazePreset>>): void {
  if (fieldTexture || renderLayerDisabled('zonehaze')) return;
  const data = buildBiomeHazeFieldData(presets);
  const tex = new THREE.DataTexture(
    data.rgba,
    data.layout.cols,
    data.layout.rows,
    THREE.RGBAFormat,
  );
  // sRGB upload: the sampler decodes per texel and filters in linear, so a
  // fragment reads exactly the linear colour THREE.Color.setHex would give
  // the scene fog, and a border cross-fade averages two atmospheres honestly.
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.name = 'biomeHazeField';
  tex.needsUpdate = true;
  fieldTexture = tex;
  fieldLayout = data.layout;
  uHazeField.value = tex;
  uHazeRect.value.set(
    data.layout.originX,
    data.layout.originZ,
    1 / data.layout.sizeX,
    1 / data.layout.sizeZ,
  );
}

/** True once the field exists: the compile-time gate every consumer reads, so
 *  a tier without one (low, or `?zonehaze=off`) compiles byte-identically. */
export function hasBiomeHazeField(): boolean {
  return fieldTexture !== null;
}

/** The day/night colour multiply, the same `dnGrade.fog` triple the scene fog
 *  takes: distant-zone atmosphere darkens and cools with the cycle exactly as
 *  the atmosphere you are standing in does. */
export function setBiomeHazeGrade(mul: readonly [number, number, number]): void {
  uHazeGrade.value.set(mul[0], mul[1], mul[2]);
}

/** Camera world xz: the origin the aerial distance ramp measures from. */
export function setBiomeHazeCamera(x: number, z: number): void {
  uHazeCam.value.set(x, z);
}

/** The uniforms a consumer material installs (in its onBeforeCompile, or in a
 *  ShaderMaterial's own uniforms map). Shared objects, never copies. */
export function biomeHazeUniforms(): Record<string, THREE.IUniform> {
  return { uHazeField, uHazeRect, uHazeGrade, uHazeCam };
}

/** Field layout, for diagnostics and tests. Null before the field is built. */
export function biomeHazeFieldLayout(): HazeFieldLayout | null {
  return fieldLayout;
}

/** Drop the field. The field is deliberately session-static (the grass-bake
 *  idiom), so nothing in the renderer calls this; it exists so a test can
 *  reset the module between cases. */
export function disposeBiomeHazeField(): void {
  fieldTexture?.dispose();
  fieldTexture = null;
  fieldLayout = null;
  uHazeField.value = null;
}

const glsl = (v: number): string => v.toFixed(6);

/** Fragment-stage declarations. Splice into the fragment `<common>` patch. */
export const BIOME_HAZE_DECLARATIONS = `
uniform sampler2D uHazeField;
uniform vec4 uHazeRect;
uniform vec3 uHazeGrade;
uniform vec2 uHazeCam;`;

/**
 * The blend block. Splice immediately BEFORE `#include <fog_fragment>`, with
 * `worldXZ` naming the fragment's world xz (the caller's own varying).
 *
 * Reads the field at the FRAGMENT's position, not the camera's: that is what
 * makes a neighbouring realm look like itself from across a bay. The amount
 * is the Node-tested `aerialHazeAmount` curve, zero derivative at the onset
 * so the ramp never draws a ring, saturating gently so it stays a hint of
 * air rather than a paint-over.
 */
export function biomeHazeFragmentGlsl(worldXZ: string): string {
  return `
  {
    vec2 wocHazeXZ = ${worldXZ};
    vec4 wocHaze = texture2D(uHazeField, (wocHazeXZ - uHazeRect.xy) * uHazeRect.zw);
    float wocHazeT = max(0.0, distance(wocHazeXZ, uHazeCam) - ${glsl(HAZE_AERIAL_ONSET)})
      / ${glsl(HAZE_AERIAL_REF)};
    float wocHazeA = ${glsl(HAZE_AERIAL_MAX)} * wocHaze.a * (1.0 - exp(-wocHazeT * wocHazeT));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, wocHaze.rgb * uHazeGrade, wocHazeA);
  }`;
}
