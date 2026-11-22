import * as THREE from 'three';
import {
  CEL_RAMP_SOFT_GLSL,
  CEL_RAMP_SOFT_UNIFORM,
  CEL_RAMP_SOFT_UNIFORM_NAME,
  celSoftRampExpression,
} from './cel_ramp_soft_zone_core';
import {
  CEL_MATERIAL_INK_BEGIN,
  type CelShadingSettings,
  celShadingFromQuery,
  patchCelDirectionalLightChunk,
  patchCelMaterialInk,
  unpatchCelMaterialInk,
} from './cel_shading_core';

// The cel-shading R&D look (`?cel=on`, see cel_shading_core.ts). Read once at
// module load: the light ramp is a shader-chunk patch, so it can only take
// effect before the first program links, and flipping it needs a reload.
// Headless hosts without a location always run the stock look.
const settings: CelShadingSettings | null =
  typeof location === 'undefined' ? null : celShadingFromQuery(location.search, true);

/** The session's cel look, or null for the stock look. */
export function celShadingSettings(): CelShadingSettings | null {
  return settings;
}

interface CelShaderChunks {
  lights_fragment_begin: string;
}

/**
 * Patch the shared directional-light loop with the cel ramp. Returns true only
 * when this call changed the chunk; a null look leaves the chunk untouched.
 */
export function installCelShading(
  look: CelShadingSettings | null = settings,
  chunks: CelShaderChunks = THREE.ShaderChunk,
  soft?: Parameters<typeof patchCelDirectionalLightChunk>[2],
): boolean {
  if (!look?.light) return false;
  const patched = patchCelDirectionalLightChunk(chunks.lights_fragment_begin, look, soft);
  if (patched === chunks.lights_fragment_begin) return false;
  chunks.lights_fragment_begin = patched;
  return true;
}

interface CelMaterialChunks {
  opaque_fragment: string;
}

/**
 * Put the material ink in or take it out of the shared opaque_fragment chunk.
 * gfx.ts calls this on every profile activation (boot and every graphics
 * rebuild) with whether the chain has an output grade to carry the post ink:
 * no grade (Low, iPhone/iPad) wants the material ink, a grade does not, so
 * exactly one outline path draws. Returns whether the material ink is in.
 */
export function syncCelMaterialInk(
  wanted: boolean,
  look: CelShadingSettings | null = settings,
  chunks: CelMaterialChunks = THREE.ShaderChunk,
): boolean {
  const installed = chunks.opaque_fragment.includes(CEL_MATERIAL_INK_BEGIN);
  if (!look || !wanted) {
    if (installed) chunks.opaque_fragment = unpatchCelMaterialInk(chunks.opaque_fragment);
    return false;
  }
  if (!installed) chunks.opaque_fragment = patchCelMaterialInk(chunks.opaque_fragment, look);
  return true;
}

// The per-zone ramp softness (cel_ramp_soft_zone_core.ts): declared once in the
// shared lights_pars_begin chunk and bound on every lit ShaderLib entry; its
// Float32Array value reaches every material by reference. Its default 0 is the
// hard band exactly.
const CEL_SOFT_DECLARATION = `\nuniform vec4 ${CEL_RAMP_SOFT_UNIFORM_NAME};\n`;
const LIT_SHADERS = ['standard', 'physical', 'lambert', 'phong', 'toon'] as const;

function installCelRampSoft(): void {
  const chunk = THREE.ShaderChunk as unknown as Record<string, string>;
  if (!chunk.lights_pars_begin.includes(CEL_RAMP_SOFT_UNIFORM_NAME)) {
    chunk.lights_pars_begin = `${chunk.lights_pars_begin}${CEL_SOFT_DECLARATION}`;
  }
  const lib = THREE.ShaderLib as unknown as Record<
    string,
    { uniforms: Record<string, THREE.IUniform> }
  >;
  for (const id of LIT_SHADERS) {
    const entry = lib[id];
    if (entry) entry.uniforms[CEL_RAMP_SOFT_UNIFORM_NAME] = CEL_RAMP_SOFT_UNIFORM;
  }
}

// Module scope, like final_color_nan_guard.ts: gfx.ts imports this for the
// side effect, so the world renderer AND the preview/portrait renderers that
// never run initGfxTier all compile under the same look.
if (settings?.light) {
  installCelRampSoft();
  installCelShading(settings, THREE.ShaderChunk, {
    uniform: CEL_RAMP_SOFT_GLSL,
    expression: celSoftRampExpression,
  });
}
