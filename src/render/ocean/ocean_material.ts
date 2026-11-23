import * as THREE from 'three';
import { biomeHazeUniforms, hasBiomeHazeField } from '../biome_haze_field';
import { applyTextureAnisotropy } from '../texture_anisotropy';
import type { WaterWaveUniforms } from '../water_simulation';
import { buildOceanFoamTexels, OCEAN_FOAM_SIZE } from './ocean_foam_core';
import type { OceanSurfaceUniforms } from './ocean_simulation';
import { oceanDepthFragment, oceanSurfaceFragment, oceanSurfaceVertex } from './ocean_surface_glsl';
import { waterCharacterUniforms } from './water_character_field';

// The ShaderMaterial every water surface draws with. One instance serves every
// sheet of the overworld (the zone sheets and the horizon apron), so the shared
// uniform objects below drive all of them by reference; a second instance is
// the from-below ceiling. Nothing here allocates per frame.

/** The colour and light inputs a surface shares with the rest of the water. */
export interface OceanSharedUniforms {
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uDayNight: THREE.IUniform<THREE.Vector3>;
  uTime: THREE.IUniform<number>;
  uSunColor: THREE.IUniform<THREE.Color>;
  uSkyColor: THREE.IUniform<THREE.Color>;
  uDeep: THREE.IUniform<THREE.Color>;
  uShallow: THREE.IUniform<THREE.Color>;
  uScatter: THREE.IUniform<THREE.Color>;
}

/** The reflection the surface reads: a cube capture of the live dome. */
export interface OceanSkyUniforms {
  uSkyProbe: THREE.IUniform<THREE.Texture | null>;
  uSkyProbeLod: THREE.IUniform<number>;
  uSkyProbeReady: THREE.IUniform<number>;
}

/**
 * The look knobs every surface shares (one object, by reference):
 * x sun brightness on the water, y refraction strength, z caustic strength,
 * w whitecap strength.
 */
export const OCEAN_LOOK: THREE.IUniform<THREE.Vector4> = {
  value: new THREE.Vector4(5.5, 0.07, 0.8, 1),
};
/**
 * 1 while the palette lab's water row owns the colours (setWaterPalette), 0
 * for each realm's own water character.
 */
export const OCEAN_PALETTE_OVERRIDE: THREE.IUniform<number> = { value: 0 };
/** Vertical scale of the simulated waves (gameplay keeps swimmers afloat). */
export const OCEAN_DISP_SCALE: THREE.IUniform<number> = { value: 0.6 };

/**
 * Dev only (`?oceandebug=1`): compile a term switch into the surface so one
 * shading term can be drawn on its own (F, sky, under, body, sun, foam, sss,
 * normal: 1 to 8, written into OCEAN_DEBUG_TERM.value). Absent, the shader is
 * built without the switch.
 */
export const OCEAN_DEBUG_TERM: THREE.IUniform<number> = { value: 0 };
function oceanDebugRequested(): boolean {
  if (!import.meta.env?.DEV) return false;
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('oceandebug') === '1';
  } catch {
    return false;
  }
}

let foamTexture: THREE.DataTexture | null = null;
/** The shared procedural foam texture (ocean_foam_core.ts), built once. */
export function oceanFoamTexture(): THREE.DataTexture {
  if (foamTexture) return foamTexture;
  const tex = new THREE.DataTexture(
    buildOceanFoamTexels(),
    OCEAN_FOAM_SIZE,
    OCEAN_FOAM_SIZE,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  applyTextureAnisotropy(tex, 'colour');
  tex.name = 'ocean-foam';
  tex.needsUpdate = true;
  foamTexture = tex;
  return tex;
}

/**
 * Scene-capture uniforms present from the first compile, so every sampler in
 * the program is bound to a real slot before scene_sampling.ts swaps in its
 * shared objects (an unbound sampler2D would default to unit 0 and collide
 * with the cube sampler there).
 */
function sceneSamplePlaceholders(): Record<string, THREE.IUniform> {
  return {
    uOpaqueColor: { value: null },
    uOpaqueDepth: { value: null },
    uSceneReady: { value: 0 },
    uSceneExtent: { value: new THREE.Vector4(1, 1, 1, 1) },
    uSceneClip: { value: new THREE.Vector2(0.1, 1000) },
  };
}

/** The fine sheets the horizon apron must not draw under (see `apron`). */
export interface OceanSheetRects {
  /** Up to OCEAN_MAX_SHEET_RECTS entries: (minX, minZ, maxX, maxZ). */
  uSheetRects: THREE.IUniform<THREE.Vector4[]>;
  uSheetRectCount: THREE.IUniform<number>;
}

export interface OceanMaterialOptions {
  underside?: boolean;
  shoreEdgeFade?: boolean;
  /** Screen-space reflection steps; 0 or absent compiles the trace out. */
  ssrSteps?: number;
  /**
   * The horizon apron's own variant: it discards every pixel inside a built
   * fine sheet, so the sheet alone draws there whatever the two surfaces'
   * displacement does (they sample different grids and cannot agree to the
   * hundredth of a unit a depth test would need).
   */
  apron?: OceanSheetRects;
}

export function createOceanSurfaceMaterial(
  ocean: OceanSurfaceUniforms,
  sky: OceanSkyUniforms,
  wave: WaterWaveUniforms,
  shared: OceanSharedUniforms,
  opts?: OceanMaterialOptions,
): THREE.ShaderMaterial {
  const zoneHaze = hasBiomeHazeField();
  const cascades = ocean.shade.length;
  const shaderOpts = {
    cascades,
    underside: opts?.underside === true,
    shoreEdgeFade: opts?.shoreEdgeFade === true,
    zoneHaze,
    // From below there is nothing to trace: the ceiling has no capture arm.
    ssrSteps: opts?.underside ? 0 : Math.max(0, Math.floor(opts?.ssrSteps ?? 0)),
    apron: opts?.apron !== undefined,
  };
  const samplers: Record<string, THREE.IUniform> = {};
  ocean.shade.forEach((u, i) => {
    samplers[`uOceanShade${i}`] = u;
  });
  // The fragment stage always declares the first two displacement samplers
  // (crest height); a one-cascade plan reuses the first for the second.
  samplers.uOceanDisp0 = ocean.disp[0];
  samplers.uOceanDisp1 = ocean.disp[1] ?? ocean.disp[0];
  const material = new THREE.ShaderMaterial({
    defines: {
      ...(shaderOpts.underside ? { WATER_UNDERSIDE: '' } : {}),
      ...(shaderOpts.shoreEdgeFade ? { WATER_SHORE_EDGE_FADE: '' } : {}),
      ...(zoneHaze ? { WOC_ZONE_HAZE: '' } : {}),
      ...(oceanDebugRequested() ? { OCEAN_DEBUG_TERMS: '' } : {}),
      ...(shaderOpts.apron ? { OCEAN_APRON: '' } : {}),
    },
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...(zoneHaze ? biomeHazeUniforms() : {}),
      ...sceneSamplePlaceholders(),
      ...samplers,
      uOceanCascade: ocean.cascade,
      uOceanVariance: ocean.variance,
      uOceanDispScale: OCEAN_DISP_SCALE,
      uOceanLook: OCEAN_LOOK,
      uWaterPalette: OCEAN_PALETTE_OVERRIDE,
      uOceanDebug: OCEAN_DEBUG_TERM,
      ...waterCharacterUniforms(),
      uFoamTex: { value: oceanFoamTexture() },
      ...sky,
      ...shared,
      uWaveState: wave.uWaveState,
      uWaveEnabled: wave.uWaveEnabled,
      uWaveOrigin: wave.uWaveOrigin,
      uWaveSize: wave.uWaveSize,
      ...(opts?.apron ?? {}),
    },
    vertexShader: oceanSurfaceVertex(shaderOpts),
    fragmentShader: oceanSurfaceFragment(shaderOpts),
    transparent: true,
    // NO depth writes, by rule: floor marks a player reacts to (boss
    // telegraphs, draped rings, decals) draw after the water and must show
    // through shallow water on every tier exactly as on the Phong plane, and
    // AO and the cel ink must not outline the waterline. Overdraw against the
    // apron is handled by the apron's own discard instead.
    depthWrite: false,
    side: shaderOpts.underside ? THREE.BackSide : THREE.FrontSide,
    fog: true,
  });
  material.name = shaderOpts.underside
    ? 'ocean:surface-underside'
    : shaderOpts.apron
      ? 'ocean:surface-apron'
      : 'ocean:surface';
  return material;
}

/** Paint order of the depth-only pass: after every transparent draw. */
export const OCEAN_DEPTH_RENDER_ORDER = 10_000;

/**
 * The water's depth-only twin material (ocean_surface_glsl.ts
 * oceanDepthFragment): the same vertex stage, the same uniform objects, no
 * colour. Draw it at OCEAN_DEPTH_RENDER_ORDER on a mesh sharing the surface's
 * geometry.
 */
export function createOceanDepthMaterial(
  ocean: OceanSurfaceUniforms,
  wave: WaterWaveUniforms,
  opts?: { apron?: OceanSheetRects },
): THREE.ShaderMaterial {
  const cascades = ocean.shade.length;
  const material = new THREE.ShaderMaterial({
    defines: opts?.apron ? { OCEAN_APRON: '' } : {},
    uniforms: {
      uOceanDisp0: ocean.disp[0],
      uOceanDisp1: ocean.disp[1] ?? ocean.disp[0],
      uOceanCascade: ocean.cascade,
      uOceanDispScale: OCEAN_DISP_SCALE,
      ...waterCharacterUniforms(),
      uWaveState: wave.uWaveState,
      uWaveEnabled: wave.uWaveEnabled,
      uWaveOrigin: wave.uWaveOrigin,
      uWaveSize: wave.uWaveSize,
      ...(opts?.apron ?? {}),
    },
    vertexShader: oceanSurfaceVertex({
      cascades,
      underside: false,
      shoreEdgeFade: false,
      zoneHaze: false,
      ssrSteps: 0,
      apron: opts?.apron !== undefined,
    }),
    fragmentShader: oceanDepthFragment({ apron: opts?.apron !== undefined }),
    transparent: true,
    colorWrite: false,
    depthWrite: true,
    fog: false,
  });
  material.name = opts?.apron ? 'ocean:depth-apron' : 'ocean:depth';
  return material;
}
