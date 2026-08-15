// The Three half of the biome haze field: one small world-space DataTexture
// plus the shared uniform block and GLSL snippet every consumer surface
// splices in, so distant land carries ITS OWN zone's atmosphere instead of
// the camera zone's. All the decisions (layout, colour sourcing, border
// cross-fade, distance ramp) live in biome_haze_field_core.ts, which is
// Node-tested; this file only owns the texture, the uniforms and the string.
//
// One field, one uniform block, four consumers. The near splat terrain, the
// far vista tiles and the water planes all splice the SAME snippet at the
// SAME point (immediately before <fog_fragment>, so the haze lands where
// scene fog lands and the horizon band still wins at the rim), and the sky
// dome samples the same field directionally for its horizon-band tint
// (sky.ts), applied before ITS fog band under the same rim rule. Sharing the
// snippet is what makes the near-to-far handoff seamless: at the detail
// horizon both surfaces evaluate identical math on identical uniforms, so
// there is no ring where one layer hands off to the other.
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
  HAZE_FAR_CEIL,
  HAZE_FAR_ONSET,
  HAZE_FAR_REF,
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

/**
 * Make any built-in lit material (standard or Lambert, instanced or merged)
 * a haze consumer: props, buildings, and foliage canopies at range must take
 * the same air the ground under them does, or the effect cancels itself (a
 * pine keeping full local green over lavender-hazed ground reads as "no fog
 * at all", which is exactly how the first ship of this field played).
 *
 * Chainable and idempotent: it wraps any existing onBeforeCompile (wind,
 * worn-stone detail, emissive reuse) and attaches once per material. The
 * field check runs at COMPILE time, so it is safe to attach from module-scope
 * material factories that run before the renderer builds the field; a tier
 * that never builds one compiles byte-identically (the cache key carries the
 * arm). The world position varying replicates project_vertex's instancing
 * arm, reading `transformed` AFTER any wind displacement.
 */
export function attachBiomeHaze(mat: THREE.Material): void {
  if (renderLayerDisabled('zonehaze')) return;
  const flagged = mat.userData as { wocZoneHaze?: boolean };
  if (flagged.wocZoneHaze) return;
  flagged.wocZoneHaze = true;
  const prev = mat.onBeforeCompile;
  const prevSrc = typeof prev === 'function' ? prev.toString() : '';
  const prevKey =
    typeof mat.customProgramCacheKey === 'function' ? mat.customProgramCacheKey.bind(mat) : null;
  mat.onBeforeCompile = (sh, renderer) => {
    prev?.call(mat, sh, renderer);
    if (!hasBiomeHazeField()) return;
    Object.assign(sh.uniforms, biomeHazeUniforms());
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 wocHazeVXZ;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 wocHazeW = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wocHazeW = instanceMatrix * wocHazeW;
          #endif
          wocHazeVXZ = (modelMatrix * wocHazeW).xz;
        }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec2 wocHazeVXZ;${BIOME_HAZE_DECLARATIONS}`,
      )
      .replace(
        '#include <fog_fragment>',
        `${biomeHazeFragmentGlsl('wocHazeVXZ')}\n\t#include <fog_fragment>`,
      );
  };
  mat.customProgramCacheKey = () =>
    `woc-zone-haze:${hasBiomeHazeField() ? 1 : 0}|${prevKey ? prevKey() : prevSrc}`;
}

/**
 * Re-attach the zone-haze layer to a Material.clone() of a hazed source.
 * clone() copies userData, so the wocZoneHaze marker arrives TRUE on a clone
 * whose hook was silently dropped, and a bare attachBiomeHaze() no-ops on
 * that lying flag. Clear it first, then attach, restoring both the visual
 * layer and the program-cache-key identity with the source. No-op for clones
 * of un-hazed sources.
 */
export function reattachBiomeHazeToClone(source: THREE.Material, clone: THREE.Material): void {
  if (!(source.userData as { wocZoneHaze?: boolean }).wocZoneHaze) return;
  (clone.userData as { wocZoneHaze?: boolean }).wocZoneHaze = false;
  attachBiomeHaze(clone);
}

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
 * is the Node-tested `aerialHazeAmount` curve (two summed Gaussian-shoulder
 * terms, both zero-derivative at their onsets so neither draws a ring): the
 * border-band term that puts a realm's air on it from across the line, scaled
 * by that realm's own murk, and the camera's air column, which fades distance
 * out into the LOCAL area's fog colour at the same depth everywhere.
 */
export function biomeHazeFragmentGlsl(worldXZ: string): string {
  return `
  {
    vec2 wocHazeXZ = ${worldXZ};
    vec4 wocHaze = texture2D(uHazeField, (wocHazeXZ - uHazeRect.xy) * uHazeRect.zw);
    float wocHazeD = distance(wocHazeXZ, uHazeCam);
    float wocHazeT = max(0.0, wocHazeD - ${glsl(HAZE_AERIAL_ONSET)}) / ${glsl(HAZE_AERIAL_REF)};
    float wocHazeT2 = max(0.0, wocHazeD - ${glsl(HAZE_FAR_ONSET)}) / ${glsl(HAZE_FAR_REF)};
    float wocHazeA = wocHaze.a * ${glsl(HAZE_AERIAL_MAX)} * (1.0 - exp(-wocHazeT * wocHazeT))
      + ${glsl(HAZE_FAR_CEIL - HAZE_AERIAL_MAX)} * (1.0 - exp(-wocHazeT2 * wocHazeT2));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, wocHaze.rgb * uHazeGrade, wocHazeA);
  }`;
}
