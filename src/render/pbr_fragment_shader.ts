import * as THREE from 'three';
import { patchPointLightFragmentChunk } from './point_light_shader_core';

interface PbrShaderChunks {
  lights_fragment_begin: string;
}

const RIM_PATCH_MARKER = 'WOC_PBR_RIM_REUSE';
const COMMON_ANCHOR = '#include <common>';
const LIGHTS_BEGIN_ANCHOR = '#include <lights_fragment_begin>';

/**
 * Move the character rim term after the stock light setup so it can reuse
 * geometryViewDir. Every character render path uses a PerspectiveCamera, where
 * Three defines that value with the exact normalize(vViewPosition) expression
 * the old patch evaluated independently.
 */
export function patchPbrRimGlowFragmentShader(source: string): string {
  if (source.includes(RIM_PATCH_MARKER)) return source;
  if (!source.includes(COMMON_ANCHOR) || !source.includes(LIGHTS_BEGIN_ANCHOR)) {
    return source;
  }
  return source
    .replace(
      COMMON_ANCHOR,
      `${COMMON_ANCHOR}
      // ${RIM_PATCH_MARKER}
      uniform float uRimBoost;`,
    )
    .replace(
      LIGHTS_BEGIN_ANCHOR,
      `${LIGHTS_BEGIN_ANCHOR}
      totalEmissiveRadiance += vec3(0.5, 0.6, 0.8) * 0.12 * uRimBoost *
        pow(1.0 - saturate(dot(normal, geometryViewDir)), 3.0);`,
    );
}

/**
 * Install before the renderer compiles scene materials. Returns true only
 * when this call changed the shared chunk. A changed Three anchor throws so a
 * renderer upgrade cannot silently run without the intended shader patch.
 */
export function installPbrPointLightShaderPruning(
  chunks: PbrShaderChunks = THREE.ShaderChunk,
): boolean {
  const patched = patchPointLightFragmentChunk(chunks.lights_fragment_begin);
  if (patched === chunks.lights_fragment_begin) return false;
  chunks.lights_fragment_begin = patched;
  return true;
}
