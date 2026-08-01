import * as THREE from 'three';
import {
  COLUMN_ZONES,
  columnBlendAt,
  STRIP_MAX_X,
  STRIP_MIN_X,
  STRIP_ZONES,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_Z,
  ZONES,
} from '../sim/data';
import { fbm2 } from '../sim/rng';
import type { BiomeId, ZoneDef } from '../sim/types';
import { roadDistance, WATER_LEVEL, zoneBiomeAt } from '../sim/world';
import { loadTexture } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { type ChunkGrid, type GroundPendingAt, orderCellsForEntry } from './chunk_residency_core';
import { GFX } from './gfx';
import { idleSlot } from './idle_queue';
import { impactCraterTerrainBlend } from './impact_terrain';
import {
  beginChunkGeometry,
  type ChunkGeometryArrays,
  type ChunkGeometryBuildState,
  fillChunkIndexRow,
  fillChunkVertexRow,
} from './terrain_chunk_build';
import { terrainChunkPool } from './terrain_chunk_pool';
import { meshTerrainHeight } from './terrain_mesh_height';
import {
  chunkIntersectsRegion,
  normalTexelBounds,
  owningRectIndex,
  type TexelBounds,
  type WorldRect,
} from './terrain_region_core';
import { groundDetailTexture, groundSplatMaps, macroNoiseTexture } from './textures';

// Chunked terrain across the whole 360x1080 zone strip.
//
// - ~60u chunks with their own bounding volumes so frustum culling actually
//   works (the old single-plane-per-zone terrain was always fully submitted).
// - LOD by distance from the nearest hub at build time: settlements (where
//   the camera lingers) get dense vertices, the wilderness gets coarse ones.
//   Chunks carrying the impassable mountain walls (inter-zone ridges, world
//   rim) are promoted to the densest band regardless: the terraced walls hold
//   the heightfield's highest frequencies and the far band smears them into
//   ragged shards.
// - Skirts hang from every chunk edge to hide LOD cracks: a 0.3u base drop
//   plus the vertex slope times the coarsest band spacing, since a T-junction
//   hole grows with both the neighbor's chord span and the local gradient
//   (terraced cliffs open multi-yard holes that a flat drop cannot cover).
// - High tier: MeshStandardMaterial + splat shading (grass/dirt/rock/sand
//   weights precomputed per vertex from slope/height/roadDistance into a vec4
//   attribute) over the biome vertex-color tint, plus a world-space macro
//   normal map baked from the mesh height view (terrain_mesh_height.ts).
// - Low tier: the legacy vertex-color Lambert look, still chunked for culling.

const CHUNK_SIZE = 60;
// An 'idle'-paced zone build waits for a browser idle slot between batches;
// this timeout forces one batch through anyway under sustained frame load.
const IDLE_BUILD_TIMEOUT_MS = 200;

// ---------------------------------------------------------------------------
// Real PBR splat layers (ambientCG 1K, shipped under public/textures/terrain).
// Kicked off at module import and registered with the preload gate, so by the
// time buildTerrain runs the resolved textures are available synchronously.
// ---------------------------------------------------------------------------

const TERRAIN_TEX: Record<string, THREE.Texture> = {};
const ALBEDO_ANISOTROPY = 8;
const NORMAL_ANISOTROPY = 4;

function kickTerrainTex(key: string, file: string, srgb: boolean): void {
  registerDeferredPreload(() =>
    loadTexture(`/textures/terrain/${file}`, { srgb, repeat: true }).then((tex) => {
      tex.anisotropy = srgb ? ALBEDO_ANISOTROPY : NORMAL_ANISOTROPY;
      TERRAIN_TEX[key] = tex;
      return tex;
    }),
  );
}

// ~15MB of JPEGs — skip when the URL already forces the Lambert tier (an
// auto-detected low tier still fetches them; the URL guess can't know yet)
if (GFX.terrainSplat) {
  kickTerrainTex('grassC', 'Grass001_Color.jpg', true);
  kickTerrainTex('grassN', 'Grass001_NormalGL.jpg', false);
  kickTerrainTex('dirtC', 'Ground048_Color.jpg', true);
  kickTerrainTex('dirtN', 'Ground048_NormalGL.jpg', false);
  kickTerrainTex('rockC', 'Rock051_Color.jpg', true);
  kickTerrainTex('rockN', 'Rock051_NormalGL.jpg', false);
  kickTerrainTex('sandC', 'Ground080_Color.jpg', true);
  kickTerrainTex('sandN', 'Ground080_NormalGL.jpg', false);
  kickTerrainTex('mudC', 'Ground071_Color.jpg', true); // marsh wet mud (dirt variant)
  kickTerrainTex('snowC', 'Snow010A_Color.jpg', true);
}

export function hasTerrainSplatAssets(): boolean {
  return Boolean(
    TERRAIN_TEX.grassC &&
      TERRAIN_TEX.grassN &&
      TERRAIN_TEX.dirtC &&
      TERRAIN_TEX.dirtN &&
      TERRAIN_TEX.rockC &&
      TERRAIN_TEX.rockN &&
      TERRAIN_TEX.sandC &&
      TERRAIN_TEX.sandN &&
      TERRAIN_TEX.mudC &&
      TERRAIN_TEX.snowC,
  );
}

/** Narrow read of the loaded grass splat layers for interiors that reuse the
 *  overworld ground look (the Wildheart Basin floor). Undefined until the
 *  boot preload resolves; callers must fall back to their own material. */
export function terrainSplatTexture(key: 'grassC' | 'grassN'): THREE.Texture | undefined {
  return TERRAIN_TEX[key];
}

// Per-layer constant roughness, eyeballed from the packs' roughness-map means
// (saves four samplers vs. real roughness maps; terrain is never glossy
// enough for the difference to read at gameplay camera distance).
// ROUGH_GRASS is exported for interiors sharing the grass albedo.
export const ROUGH_GRASS = 0.8;
const ROUGH_DIRT = 0.9;
const ROUGH_ROCK = 0.75;
const ROUGH_SAND = 0.85;
const ROUGH_MUD = 0.62; // wet sheen
const ROUGH_SNOW = 0.72;

// vertex spacing by distance from the nearest hub centre
const LOD_BANDS = {
  high: [
    { maxHubDist: 95, spacing: 1.2 },
    { maxHubDist: 185, spacing: 1.6 },
    { maxHubDist: Infinity, spacing: 2.6 },
  ],
  low: [
    { maxHubDist: 95, spacing: 3.0 },
    { maxHubDist: 185, spacing: 4.4 },
    { maxHubDist: Infinity, spacing: 6.5 },
  ],
} as const;

// Mountain-wall chunks are promoted to the densest LOD band. Half-widths
// mirror sim/world.ts: the ridge contribution lives within RIDGE_SIGMA*3
// (30yd) of each inter-zone ridge line, and the rim rise starts 30yd inside
// the world edge (plus crest-noise margin).
const WALL_LOD_RIDGE_HALF = 30;
const WALL_LOD_RIM_MARGIN = 40;

// Macro relief only needs to carry broad slopes: vertex normals and the four
// tiled material normals own close detail. The atlas spans the whole expanded
// world but is baked sparsely by zone, so keep it compact enough that entering
// a new region never turns tens of thousands of height samples into a
// second boot. At the current bounds this is roughly 3yd/texel.
const NORMAL_TEX_W = 320;
const NORMAL_TEX_H = 960;
const NORMAL_TEX_STRENGTH = 1.35;

// Ground colors per biome; boundaries blend across the same window as the
// heightfield's shape blend. This is the tint layer the splat albedo
// multiplies into (splat textures are authored near mid-gray).
function finishChunkGeometry(state: ChunkGeometryArrays): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(state.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(state.normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(state.colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(state.uvs, 2));
  if (state.splats) geo.setAttribute('aSplat', new THREE.BufferAttribute(state.splats, 4));
  if (state.extras) geo.setAttribute('aExtra', new THREE.BufferAttribute(state.extras, 4));
  geo.setIndex(new THREE.BufferAttribute(state.indices, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function buildChunkGeometry(
  x0: number,
  z0: number,
  size: number,
  spacing: number,
  seed: number,
  withSplat: boolean,
  skirtSpan: number,
  lowShade: boolean,
): THREE.BufferGeometry {
  const state = beginChunkGeometry(x0, z0, size, spacing, seed, withSplat, skirtSpan, lowShade);
  for (let row = 0; row < state.gh; row++) fillChunkVertexRow(state, row);
  for (let row = 0; row < state.gh - 1; row++) fillChunkIndexRow(state, row);
  return finishChunkGeometry(state);
}

const IDLE_GEOMETRY_SLICE_MS = 6;

async function buildChunkGeometryIdle(
  x0: number,
  z0: number,
  size: number,
  spacing: number,
  seed: number,
  withSplat: boolean,
  skirtSpan: number,
  lowShade: boolean,
  yieldSlice: () => Promise<void>,
  cancelled: () => boolean,
): Promise<THREE.BufferGeometry | null> {
  const state = beginChunkGeometry(x0, z0, size, spacing, seed, withSplat, skirtSpan, lowShade);
  const drainRows = async (rows: number, fill: (row: number) => void): Promise<boolean> => {
    let row = 0;
    while (row < rows) {
      await yieldSlice();
      if (cancelled()) return false;
      const started = performance.now();
      do fill(row++);
      while (row < rows && performance.now() - started < IDLE_GEOMETRY_SLICE_MS);
    }
    return true;
  };
  if (!(await drainRows(state.gh, (row) => fillChunkVertexRow(state, row)))) return null;
  if (!(await drainRows(state.gh - 1, (row) => fillChunkIndexRow(state, row)))) return null;
  return finishChunkGeometry(state);
}

// ---------------------------------------------------------------------------
// Macro relief: a DataTexture normal map baked from the mesh height view in
// strip-planar UV space — cliffs and ridges get per-pixel light response far
// beyond the vertex density.
// ---------------------------------------------------------------------------

// Bake the normal texels [i0..i1] x [j0..j1] (inclusive) into `data`, sampling
// the CURRENT mesh height. The full build and the editor's partial rebake
// share this one path so a partial rebake is byte-identical to a full one:
// heights are sampled one texel beyond the baked rect (clamped at the texture
// border, exactly like the full bake's clamped derivative stencil).
function bakeNormalRegion(
  data: Uint8Array,
  seed: number,
  i0: number,
  i1: number,
  j0: number,
  j1: number,
): void {
  const w = NORMAL_TEX_W,
    h = NORMAL_TEX_H;
  const worldW = WORLD_MAX_X * 2;
  const worldD = WORLD_MAX_Z - WORLD_MIN_Z;
  const stepX = worldW / w;
  const stepZ = worldD / h;
  // height window: the baked rect plus the 1-texel derivative stencil
  const hi0 = Math.max(0, i0 - 1),
    hi1 = Math.min(w - 1, i1 + 1);
  const hj0 = Math.max(0, j0 - 1),
    hj1 = Math.min(h - 1, j1 + 1);
  const hw = hi1 - hi0 + 1;
  const heights = new Float32Array(hw * (hj1 - hj0 + 1));
  for (let j = hj0; j <= hj1; j++) {
    const z = WORLD_MIN_Z + (j + 0.5) * stepZ;
    for (let i = hi0; i <= hi1; i++) {
      heights[(j - hj0) * hw + (i - hi0)] = meshTerrainHeight(
        -WORLD_MAX_X + (i + 0.5) * stepX,
        z,
        seed,
      );
    }
  }
  const hAt = (i: number, j: number): number => heights[(j - hj0) * hw + (i - hi0)];
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const iw = Math.max(0, i - 1),
        ie = Math.min(w - 1, i + 1);
      const jn = Math.max(0, j - 1),
        js = Math.min(h - 1, j + 1);
      const dhdx = (hAt(ie, j) - hAt(iw, j)) / ((ie - iw) * stepX);
      const dhdz = (hAt(i, js) - hAt(i, jn)) / ((js - jn) * stepZ);
      const nx = -dhdx * NORMAL_TEX_STRENGTH;
      const nz = -dhdz * NORMAL_TEX_STRENGTH;
      const inv = 1 / Math.hypot(nx, 1, nz);
      const o = (j * w + i) * 4;
      data[o] = (nx * inv * 0.5 + 0.5) * 255;
      data[o + 1] = (nz * inv * 0.5 + 0.5) * 255; // green follows +v (+z)
      data[o + 2] = (inv * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  }
}

function terrainNormalTexture(): THREE.DataTexture {
  const data = new Uint8Array(NORMAL_TEX_W * NORMAL_TEX_H * 4);
  // Zone texels are baked on demand. Unloaded areas remain a flat normal and
  // have no geometry, so they cannot be sampled on screen.
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 128;
    data[i + 1] = 128;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, NORMAL_TEX_W, NORMAL_TEX_H, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  // Mipmapped minification (DataTexture defaults it off): the bake packs the
  // terraces' near-vertical risers next to flat treads at 0.56u/texel, and
  // sampling that unfiltered from a distant camera aliases the lighting into
  // shimmering checker patterns. Mips average the relief away smoothly with
  // distance instead. WebGL2 handles the NPOT mip chain; the editor's
  // rebakeNormalRegion re-upload regenerates it automatically.
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = NORMAL_ANISOTROPY;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

// Editor brush cursor: a soft additive ring projected onto the ground in world
// XZ space, injected into BOTH terrain materials so it reads identically on the
// splat and Lambert tiers. One shared uniform-value set per terrain view; the
// uniform objects are installed once at material build (onBeforeCompile) and
// per-frame updates only write .value, never rebuild a material. Radius 0
// disables (the default), so the shipped game pays one uniform branch and
// nothing else.
interface BrushUniforms {
  uBrushCenter: { value: THREE.Vector2 };
  uBrushRadius: { value: number };
  uBrushColor: { value: THREE.Color };
}

function makeBrushUniforms(): BrushUniforms {
  return {
    uBrushCenter: { value: new THREE.Vector2(0, 0) },
    uBrushRadius: { value: 0 },
    uBrushColor: { value: new THREE.Color(0x6fd2ff) },
  };
}

// Two smoothsteps: a feathered rise to the radius and a feathered fall past it.
const BRUSH_RING_GLSL = /* glsl */ `
uniform vec2 uBrushCenter;
uniform float uBrushRadius;
uniform vec3 uBrushColor;
vec3 wocBrushRing(vec2 p) {
  if (uBrushRadius <= 0.0) return vec3(0.0);
  float d = distance(p, uBrushCenter);
  float w = max(0.28, uBrushRadius * 0.055);
  float ring = smoothstep(uBrushRadius - w, uBrushRadius, d)
             * (1.0 - smoothstep(uBrushRadius, uBrushRadius + w, d));
  return uBrushColor * ring * 1.35;
}
`;

function buildSplatMaterial(
  normalTex: THREE.DataTexture,
  brush: BrushUniforms,
): THREE.MeshStandardMaterial {
  // Legacy canvas splats are still generated (result unused): textures.ts
  // shares one LCG across all generators, so dropping this call would shift
  // the look of every texture generated after it (foliage, props, ...).
  groundSplatMaps();
  const macro = macroNoiseTexture();
  const t = TERRAIN_TEX;
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1.0,
    metalness: 0,
    normalMap: normalTex,
    normalScale: new THREE.Vector2(0.85, 0.85),
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, brush);
    Object.assign(sh.uniforms, {
      uGrass: { value: t.grassC },
      uGrassN: { value: t.grassN },
      uDirt: { value: t.dirtC },
      uDirtN: { value: t.dirtN },
      uRock: { value: t.rockC },
      uRockN: { value: t.rockN },
      uSand: { value: t.sandC },
      uSandN: { value: t.sandN },
      uMud: { value: t.mudC },
      uSnow: { value: t.snowC },
      uMacro: { value: macro },
    });
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 aSplat;
        attribute vec4 aExtra;
        varying vec4 vSplat;
        varying vec4 vExtra;
        varying vec3 vWPos;
        varying vec3 vWNorm;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vSplat = aSplat;
        vExtra = aExtra;
        vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vWNorm = objectNormal; // terrain mesh is untransformed: object == world`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec4 vSplat;
        varying vec4 vExtra;
        varying vec3 vWPos;
        varying vec3 vWNorm;
        uniform sampler2D uGrass, uGrassN, uDirt, uDirtN, uRock, uRockN, uSand, uSandN, uMud, uSnow, uMacro;
        ${BRUSH_RING_GLSL}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += wocBrushRing(vWPos.xz);`,
      )
      .replace(
        '#include <map_fragment>',
        `
        vec2 tuv = vWPos.xz * 0.22;
        // grass blends two scales so the 1K photo source never reads as tile
        vec3 grassAlb = mix(texture2D(uGrass, tuv).rgb, texture2D(uGrass, tuv * 0.31).rgb, 0.42);
        // marsh swaps packed dirt for wet mud (roads, hub discs included)
        vec3 dirtAlb = mix(texture2D(uDirt, tuv * 0.8).rgb, texture2D(uMud, tuv * 0.8).rgb, vExtra.x);
        // rock: top-down projection smears into vertical streaks on cliffs,
        // so steep faces blend toward wall-planar (world XY/ZY) samples
        vec3 an = abs(normalize(vWNorm));
        float wallW = clamp(1.0 - an.y * 1.45, 0.0, 1.0);
        float axisW = an.x / max(1e-4, an.x + an.z);
        vec3 rockFlat = texture2D(uRock, tuv * 0.6).rgb;
        vec3 rockWall = mix(
          texture2D(uRock, vWPos.xy * 0.132).rgb,
          texture2D(uRock, vWPos.zy * 0.132).rgb,
          axisW);
        vec3 rockAlb = mix(rockFlat, rockWall, wallW);
        vec3 alb = grassAlb * vSplat.x
                 + dirtAlb * vSplat.y
                 + rockAlb * vSplat.z
                 + texture2D(uSand, tuv).rgb * vSplat.w;
        // snow cover on the peaks/rim, by baked per-vertex weight
        alb = mix(alb, texture2D(uSnow, tuv * 0.7).rgb, vExtra.y);
        // gentle macro brightness swing breaks distant tiling
        float macro = mix(0.92, 1.08, texture2D(uMacro, vWPos.xz * 0.012).r);
        // Meteor impact terrain is authored by the same crater profile as the
        // heightfield. Apply it in albedo space so the PBR textures do not wash
        // the crater floor back toward marsh sand.
        vec3 impactAlb = mix(vec3(0.20, 0.08, 0.035), vec3(0.055, 0.040, 0.032), vExtra.w);
        alb = mix(alb, impactAlb, clamp(vExtra.z * 0.86 + vExtra.w * 0.18, 0.0, 0.96));
        // very-low-frequency hue drift (~100u wavelength) keeps distant
        // hills from flattening into one uniform lawn green
        float macro2 = texture2D(uMacro, vWPos.xz * 0.0045 + 0.37).r;
        alb = mix(alb, alb * vec3(1.07, 1.03, 0.86), (macro2 - 0.5) * 0.5 * vSplat.x);
        // real albedo carries the hue now; vertex color only modulates gently
        // so the biome painting (roads, hub discs, snowline) still reads.
        // (vColor was authored as a full sRGB ground color, so re-centre it
        // around 1.0 before using it as a multiplier.)
        vec3 vtint = clamp(vColor.rgb * 2.0, 0.0, 2.0);
        diffuseColor.rgb *= alb * mix(vec3(1.0), vtint, 0.35) * macro;`,
      )
      .replace(
        '#include <color_fragment>',
        `
        // vertex color already folded into the splat albedo above (gently);
        // the stock full multiply would re-tint the real textures to mush`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `
        float roughnessFactor = roughness * mix(
          dot(vSplat, vec4(${ROUGH_GRASS}, mix(${ROUGH_DIRT}, ${ROUGH_MUD}, vExtra.x), ${ROUGH_ROCK}, ${ROUGH_SAND})),
          ${ROUGH_SNOW}, vExtra.y);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        // per-layer detail normals (GL-convention), weighted by splat
        vec3 gN = texture2D(uGrassN, tuv).xyz * 2.0 - 1.0;
        vec3 dN = texture2D(uDirtN, tuv * 0.8).xyz * 2.0 - 1.0;
        vec3 rN = texture2D(uRockN, tuv * 0.6).xyz * 2.0 - 1.0;
        vec3 sN = texture2D(uSandN, tuv).xyz * 2.0 - 1.0;
        vec2 detN = gN.xy * vSplat.x * 0.65
                  + dN.xy * vSplat.y * 0.8
                  + rN.xy * vSplat.z * 0.9 * (1.0 - wallW)
                  + sN.xy * vSplat.w * 0.55;
        detN *= 1.0 - vExtra.y * 0.7; // snow softens the relief beneath it
        normal = normalize(normal + tbn * vec3(detN, 0.0));
        // cliffs: wall-projected rock normal so steep faces get real relief
        // (approximate world-space tangent frames per projection plane; the
        // handedness flip on back faces is invisible on noisy rock)
        if (vSplat.z * wallW > 0.01) {
          vec3 rNx = texture2D(uRockN, vWPos.zy * 0.132).xyz * 2.0 - 1.0; // +-x faces
          vec3 rNz = texture2D(uRockN, vWPos.xy * 0.132).xyz * 2.0 - 1.0; // +-z faces
          vec3 wallPerturb = mix(vec3(rNz.x, rNz.y, 0.0), vec3(0.0, rNx.y, rNx.x), axisW);
          normal = normalize(normal + mat3(viewMatrix) * wallPerturb * (vSplat.z * wallW * 0.8));
        }`,
      );
  };
  return mat;
}

function buildLambertMaterial(brush: BrushUniforms): THREE.MeshLambertMaterial {
  const detail = groundDetailTexture();
  // strip-planar uv: keep the legacy ~2.25u texture period in both axes
  detail.repeat.set(160, 480);
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: detail,
    emissive: GFX.lowPlus ? 0x182014 : 0x000000,
    emissiveIntensity: GFX.lowPlus ? 0.08 : 1,
  });
  // The Lambert tier has no world-position varying of its own, so the brush
  // patch carries one (r165 chunk names; same idiom as the splat patch above).
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, brush);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWocWPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWocWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWocWPos;
        ${BRUSH_RING_GLSL}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += wocBrushRing(vWocWPos.xz);`,
      );
  };
  return mat;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface EnsureZoneOptions {
  /** Build the cells nearest this point first (e.g. the entry position).
   *  Falls back to buildTerrain's priorityPoint when omitted. */
  priority?: { x: number; z: number };
  /** 'fast' (default): the caller is gating on the result (boot, a teleport
   *  behind the loading screen), so yield only between small batches.
   *  'idle': a background prepare; every batch waits for a browser idle slot
   *  (requestIdleCallback with a forced-progress timeout) so the build never
   *  steals time an interactive frame needs. */
  pace?: 'fast' | 'idle';
}

export interface TerrainView {
  group: THREE.Group;
  /** Materialize one overworld zone. Repeated calls share the cached task. */
  ensureZone(
    zone: ZoneDef,
    onProgress?: (done: number, total: number) => void,
    opts?: EnsureZoneOptions,
  ): Promise<void>;
  isZoneLoaded(zoneId: string): boolean;
  /**
   * The chunk lattice this view builds on, plus whether a given cell still owes
   * geometry. The outdoor fog clamp reads ground residency through this narrow
   * accessor (never through the renderer's zone-level `preparedZones`), so it
   * stops at the nearest UNBUILT CHUNK rather than the nearest unprepared zone
   * rectangle, and so retiring zone residency later is one implementation swap.
   * The returned object is stable across calls: it is read every frame.
   */
  groundResidency(): { grid: ChunkGrid; isPending: GroundPendingAt };
  /** hides chunks that sit entirely past the fog far plane */
  update(camX: number, camZ: number, fogFar: number): void;
  /**
   * Editor-only: re-mesh ONLY the chunks intersecting the world-space region
   * (a sculpt brush footprint), swapping each geometry in place on the existing
   * mesh (old geometry disposed, shared material kept). Cheap enough to run
   * several times per second during a brush drag; the stale macro normal
   * texture is NOT touched here (see rebakeNormalRegion, for stroke end).
   */
  rebuildRegion(minX: number, minZ: number, maxX: number, maxZ: number): void;
  /**
   * Editor-only: rebake the region's texels of the macro normal DataTexture
   * from the current mesh height and flag it for re-upload. Byte-identical
   * to a full bake over those texels. Call at stroke end, never per drag
   * sample. No-op on the Lambert tier (it has no normal map).
   */
  rebakeNormalRegion(minX: number, minZ: number, maxX: number, maxZ: number): void;
  /**
   * Editor-only: project the brush ring at world (x, z) with the given radius
   * (yards) onto both terrain materials. Writes uniform values only (no
   * material rebuild). Radius <= 0 hides the ring, as does clearBrush().
   */
  setBrush(x: number, z: number, radius: number, color?: THREE.ColorRepresentation): void;
  /** Editor-only: hide the brush ring. */
  clearBrush(): void;
  /**
   * Stops any in-flight ensureZone build from adding further chunks. Call
   * before discarding this view (see renderer rebuildTerrain), or the
   * abandoned zone builds keep running on a setTimeout chain.
   */
  cancelStreaming(): void;
}

export function buildTerrain(seed: number, priorityPoint?: { x: number; z: number }): TerrainView {
  const lowGfx = !GFX.terrainSplat || !hasTerrainSplatAssets();
  // Resolved here, not inside the generator: gfx.ts reads document/navigator, so
  // a worker running the same generator would resolve a different tier.
  const lowShade = GFX.lowPlus && !GFX.terrainSplat;
  const brush = makeBrushUniforms();
  const normalTex = lowGfx ? null : terrainNormalTexture();
  const mat = normalTex ? buildSplatMaterial(normalTex, brush) : buildLambertMaterial(brush);
  const bands = lowGfx ? LOD_BANDS.low : LOD_BANDS.high;
  const group = new THREE.Group();
  group.name = 'terrain';
  const worldDepth = WORLD_MAX_Z - WORLD_MIN_Z;
  const chunksX = Math.ceil((WORLD_MAX_X * 2) / CHUNK_SIZE);
  const chunksZ = Math.ceil(worldDepth / CHUNK_SIZE);
  const grid: ChunkGrid = {
    size: CHUNK_SIZE,
    countX: chunksX,
    countZ: chunksZ,
    originX: -WORLD_MAX_X,
    originZ: WORLD_MIN_Z,
  };
  // 1 = this cell is owed terrain geometry and has not attached it yet, which
  // is the only state that may clamp the outdoor fog. Ownership is TOTAL
  // since the gap-cell fill (cellOwnerId assigns every cell its containing
  // zone, else the nearest rectangle), so ALL 792 cells seed pending and each
  // one is genuinely buildable by its owner: pending-until-attach is the
  // correct state everywhere, and the old carve-out for unowned cells (the
  // rects do not tile; 96 cells used to be permanently unbuildable) is gone.
  const groundPending = new Uint8Array(chunksX * chunksZ);
  // x/z/half feed the per-frame fog cull; x0/z0/size/spacing are the exact
  // buildChunkGeometry inputs, kept so an editor rebuild re-runs the same build.
  const chunks: {
    mesh: THREE.Mesh;
    x: number;
    z: number;
    half: number;
    x0: number;
    z0: number;
    size: number;
    spacing: number;
  }[] = [];

  // True when the chunk cell overlaps a mountain-wall band: an inter-zone
  // ridge line (ZONES[i].zMax) or the world rim. Those chunks always take the
  // densest band; the walls sit far from every hub, so hub-distance LOD alone
  // hands the steepest, most looked-at cliffs the coarsest grid.
  const wallChunkAt = (x0: number, z0: number, size: number): boolean => {
    if (x0 < -WORLD_MAX_X + WALL_LOD_RIM_MARGIN || x0 + size > WORLD_MAX_X - WALL_LOD_RIM_MARGIN) {
      return true;
    }
    if (z0 < WORLD_MIN_Z + WALL_LOD_RIM_MARGIN || z0 + size > WORLD_MAX_Z - WALL_LOD_RIM_MARGIN) {
      return true;
    }
    for (let i = 0; i + 1 < ZONES.length; i++) {
      const ridgeZ = ZONES[i].zMax;
      if (z0 - WALL_LOD_RIDGE_HALF < ridgeZ && z0 + size + WALL_LOD_RIDGE_HALF > ridgeZ) {
        return true;
      }
    }
    return false;
  };

  // The zone rectangles do NOT tile the world box. Three kinds of cell fall
  // outside every one of them: the whole quadrant west of Eastbrook Vale (no
  // realm sits at x < -180 for z -180..180), the centre column north of
  // Frostveil, and the grid's last row, which overhangs WORLD_MAX_Z and so
  // carries the northern 20yd of the Drakelands rim. Those cells still hold
  // ground a player reaches on foot: the tongue of land running south out of
  // the Willowfen border around (-195, 161) sits 1.6yd ABOVE the waterline.
  // Leaving them unowned meant no zone's build ever meshed them, so that
  // ground rendered as a hole you could see (and fall) through.
  const zoneRects: WorldRect[] = ZONES.map((zone) => ({
    minX: zone.xMin ?? STRIP_MIN_X,
    maxX: zone.xMax ?? STRIP_MAX_X,
    minZ: zone.zMin,
    maxZ: zone.zMax,
  }));
  const insideAnyZone = (x: number, z: number): boolean =>
    zoneRects.some((r) => x >= r.minX && x < r.maxX && z >= r.minZ && z < r.maxZ);

  const bandIndexAt = (cx: number, cz: number): number => {
    const x0 = -WORLD_MAX_X + cx * CHUNK_SIZE;
    const z0 = WORLD_MIN_Z + cz * CHUNK_SIZE;
    const centerX = x0 + CHUNK_SIZE / 2;
    const centerZ = z0 + CHUNK_SIZE / 2;
    // Cells outside every realm (see zoneRects) are open sea floor and the
    // outer face of the rim: no quest, camp, or road ever lands there, and the
    // sim drowns a player who swims out. They take the coarsest band whatever
    // wallChunkAt says, so the gap fill costs a handful of merged super-chunks
    // instead of a dense grid over water nobody stands on. Checked BEFORE the
    // wall promotion, which would otherwise hand the empty south-west quadrant
    // the 1.2u spacing meant for the terraced inter-zone walls.
    if (!insideAnyZone(centerX, centerZ)) return bands.length - 1;
    if (wallChunkAt(x0, z0, CHUNK_SIZE)) return 0;
    let hubDist = Infinity;
    for (const zn of ZONES) {
      hubDist = Math.min(hubDist, Math.hypot(centerX - zn.hub.x, centerZ - zn.hub.z));
    }
    const idx = bands.findIndex((b) => hubDist <= b.maxHubDist);
    return idx === -1 ? bands.length - 1 : idx;
  };

  // the coarsest spacing any neighbor chunk can have; sizes the slope-aware
  // skirt drop so a fine chunk's skirt always reaches past the coarsest
  // neighbor's chord (and vice versa)
  const skirtSpan = bands[bands.length - 1].spacing;

  const attachChunk = (
    geo: THREE.BufferGeometry,
    x0: number,
    z0: number,
    size: number,
    spacing: number,
  ): void => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
    // A chunk's transform never changes after this point (its shape lives in
    // the geometry, not the mesh matrix), so it can freeze immediately rather
    // than waiting for the caller's group-wide freezeStaticMatrices pass.
    // That pass only runs once, right after the synchronous near ring returns,
    // so every chunk streamed in afterward (the majority, on the far bands)
    // would otherwise keep matrixAutoUpdate = true and recompose every frame
    // for the rest of the session.
    mesh.updateMatrixWorld(true);
    mesh.matrixAutoUpdate = false;
    // Ground residency flips HERE, where the mesh actually joins the scene, and
    // never at the point the cell is claimed for building: `built` below is set
    // BEFORE the (idle-paced, possibly multi-second) geometry build is awaited,
    // so keying the fog off it would open the view over ground that has not
    // arrived. A far-band super-chunk covers a 2x2 block, hence the span.
    const span = Math.max(1, Math.round(size / CHUNK_SIZE));
    const cx0 = Math.round((x0 + WORLD_MAX_X) / CHUNK_SIZE);
    const cz0 = Math.round((z0 - WORLD_MIN_Z) / CHUNK_SIZE);
    for (let dz = 0; dz < span; dz++) {
      for (let dx = 0; dx < span; dx++) {
        const cx = cx0 + dx;
        const cz = cz0 + dz;
        if (cx < 0 || cx >= chunksX || cz < 0 || cz >= chunksZ) continue;
        groundPending[cz * chunksX + cx] = 0;
      }
    }
    chunks.push({
      mesh,
      x: x0 + size / 2,
      z: z0 + size / 2,
      half: size / 2,
      x0,
      z0,
      size,
      spacing,
    });
  };
  const addChunk = (x0: number, z0: number, size: number, spacing: number): void => {
    attachChunk(
      buildChunkGeometry(x0, z0, size, spacing, seed, !lowGfx, skirtSpan, lowShade),
      x0,
      z0,
      size,
      spacing,
    );
  };
  // One pool per view, torn down with it. Null wherever module workers are
  // unavailable (Vitest under Node, an old WebView, a blocked CSP), in which
  // case every build below takes the main-thread path exactly as before.
  let pool: ReturnType<typeof terrainChunkPool> | null | undefined;
  const chunkPool = (): ReturnType<typeof terrainChunkPool> => {
    if (pool === undefined) pool = terrainChunkPool();
    return pool;
  };
  // A background chunk built OFF-THREAD. Generation is pure arithmetic, so the
  // only reason the idle path yields constantly is to protect frames; with no
  // frame to protect it runs flat out. Returns false only when the caller
  // should fall back, never on cancellation, which the caller checks itself.
  const addChunkInWorker = async (
    x0: number,
    z0: number,
    size: number,
    spacing: number,
  ): Promise<boolean> => {
    const active = chunkPool();
    if (!active) return false;
    const arrays = await active.build({
      x0,
      z0,
      size,
      spacing,
      seed,
      withSplat: !lowGfx,
      skirtSpan,
      lowShade,
    });
    if (!arrays) return false;
    if (cancelled) return true; // discarded view: drop the result, do not attach
    attachChunk(finishChunkGeometry(arrays), x0, z0, size, spacing);
    return true;
  };
  const addChunkIdle = async (
    x0: number,
    z0: number,
    size: number,
    spacing: number,
    yieldSlice: () => Promise<void>,
  ): Promise<boolean> => {
    if (await addChunkInWorker(x0, z0, size, spacing)) return !cancelled;
    const geo = await buildChunkGeometryIdle(
      x0,
      z0,
      size,
      spacing,
      seed,
      !lowGfx,
      skirtSpan,
      lowShade,
      yieldSlice,
      () => cancelled,
    );
    if (!geo) return false;
    attachChunk(geo, x0, z0, size, spacing);
    return true;
  };

  // far-LOD cells merge 2x2 into super-chunks: the far field is where draw
  // count hurts and culling granularity matters least
  const farBand = bands.length - 1;
  const built = new Set<number>();
  const loadedZones = new Set<string>();
  const pendingZones = new Map<string, Promise<void>>();
  // Set by cancelStreaming(): every in-flight ensureZone loop bails at its next
  // yield point without marking its zone loaded, so a discarded view (see
  // renderer rebuildTerrain) stops adding chunks instead of building on a
  // setTimeout chain for the rest of the session.
  let cancelled = false;
  // Every cell of the grid gets exactly one owner: the zone containing it,
  // else (the gap cells described at zoneRects) the nearest zone rectangle.
  // See owningRectIndex for why nearest-rect and not zoneAt's z-band clamp.
  const cellOwnerId = (cx: number, cz: number): string => {
    const x = -WORLD_MAX_X + (cx + 0.5) * CHUNK_SIZE;
    const z = WORLD_MIN_Z + (cz + 0.5) * CHUNK_SIZE;
    return ZONES[owningRectIndex(x, z, zoneRects)].id;
  };
  groundPending.fill(1);
  const residency = {
    grid,
    isPending: (cx: number, cz: number): boolean => groundPending[cz * chunksX + cx] === 1,
  };
  const zoneCells = (zone: ZoneDef): [number, number][] => {
    const out: [number, number][] = [];
    for (let cz = 0; cz < chunksZ; cz++) {
      for (let cx = 0; cx < chunksX; cx++) {
        if (cellOwnerId(cx, cz) === zone.id) out.push([cx, cz]);
      }
    }
    return out;
  };
  const yieldBuild = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  // Background ('idle') builds advance one batch per idle slot instead: the
  // timeout still forces progress under sustained load, so a later gating
  // caller awaiting the same shared task is never starved indefinitely.
  const yieldIdle = (): Promise<void> => idleSlot(IDLE_BUILD_TIMEOUT_MS);
  const normalTexelsOver = (minX: number, minZ: number, maxX: number, maxZ: number) =>
    normalTexelBounds(
      minX,
      minZ,
      maxX,
      maxZ,
      -WORLD_MAX_X,
      WORLD_MIN_Z,
      WORLD_MAX_X * 2,
      WORLD_MAX_Z - WORLD_MIN_Z,
      NORMAL_TEX_W,
      NORMAL_TEX_H,
      1,
    );
  // The macro normal texels this zone's build must bake: its own rectangle,
  // plus one region per owned cell lying outside it (the gap cells above).
  // An unbaked texel stays flat, so without the extra regions the macro relief
  // would stop dead at the realm border. Region-per-cell rather than one
  // bounding box over rect + cells: the gap west of Eastbrook Vale is as wide
  // as the realm itself, and a bbox would re-bake that whole empty quadrant.
  const normalRegionsFor = (zone: ZoneDef, cells: readonly [number, number][]): TexelBounds[] => {
    const minX = zone.xMin ?? STRIP_MIN_X;
    const maxX = zone.xMax ?? STRIP_MAX_X;
    const regions: TexelBounds[] = [];
    const zoneBounds = normalTexelsOver(minX, zone.zMin, maxX, zone.zMax);
    if (zoneBounds) regions.push(zoneBounds);
    for (const [cx, cz] of cells) {
      const x0 = -WORLD_MAX_X + cx * CHUNK_SIZE;
      const z0 = WORLD_MIN_Z + cz * CHUNK_SIZE;
      const inside =
        x0 >= minX && x0 + CHUNK_SIZE <= maxX && z0 >= zone.zMin && z0 + CHUNK_SIZE <= zone.zMax;
      if (inside) continue; // already covered by zoneBounds
      const cellBounds = normalTexelsOver(x0, z0, x0 + CHUNK_SIZE, z0 + CHUNK_SIZE);
      if (cellBounds) regions.push(cellBounds);
    }
    return regions;
  };
  const ensureZone = (
    zone: ZoneDef,
    onProgress?: (done: number, total: number) => void,
    opts?: EnsureZoneOptions,
  ): Promise<void> => {
    if (loadedZones.has(zone.id)) {
      onProgress?.(1, 1);
      return Promise.resolve();
    }
    const pending = pendingZones.get(zone.id);
    if (pending) return pending;
    const idlePace = opts?.pace === 'idle';
    const yieldSlice = idlePace ? yieldIdle : yieldBuild;
    // Gating builds race in batches of four. Idle geometry has its own
    // row/time-sliced builder, preserving one mesh per cell without a blocking
    // 60 yd build or the old four-mesh subdivision workaround.
    const cellsPerSlice = 4;
    const task = (async () => {
      // Build order is the "which chunk next" seam, and it lives in the pure
      // core so a later globally nearest-first queue replaces one function
      // instead of the zone lane around it.
      const cells = orderCellsForEntry(
        zoneCells(zone),
        grid,
        opts?.priority ?? priorityPoint,
        CHUNK_SIZE * 3,
      );
      const normalRegions = normalTex ? normalRegionsFor(zone, cells) : [];
      const rowsPerSlice = 12;
      const normalSlices = normalRegions.reduce(
        (slices, region) => slices + Math.ceil((region.j1 - region.j0 + 1) / rowsPerSlice),
        0,
      );
      const total = Math.max(1, normalSlices + cells.length);
      let done = 0;
      if (normalTex && normalRegions.length > 0) {
        for (const region of normalRegions) {
          for (let j = region.j0; j <= region.j1; j += rowsPerSlice) {
            if (cancelled) return;
            bakeNormalRegion(
              normalTex.image.data as Uint8Array,
              seed,
              region.i0,
              region.i1,
              j,
              Math.min(region.j1, j + rowsPerSlice - 1),
            );
            onProgress?.(++done, total);
            await yieldSlice();
          }
        }
        normalTex.needsUpdate = true;
      }
      for (const [cx, cz] of cells) {
        if (cancelled) return;
        const cell = cz * chunksX + cx;
        if (!built.has(cell)) {
          const superCells = [
            [cx, cz],
            [cx + 1, cz],
            [cx, cz + 1],
            [cx + 1, cz + 1],
          ] as const;
          const superOk =
            cx % 2 === 0 &&
            cz % 2 === 0 &&
            cx + 1 < chunksX &&
            cz + 1 < chunksZ &&
            superCells.every(
              ([sx, sz]) =>
                cellOwnerId(sx, sz) === zone.id &&
                !built.has(sz * chunksX + sx) &&
                bandIndexAt(sx, sz) === farBand,
            );
          if (superOk) {
            for (const [sx, sz] of superCells) built.add(sz * chunksX + sx);
            const x0 = -WORLD_MAX_X + cx * CHUNK_SIZE;
            const z0 = WORLD_MIN_Z + cz * CHUNK_SIZE;
            if (idlePace) {
              if (!(await addChunkIdle(x0, z0, CHUNK_SIZE * 2, bands[farBand].spacing, yieldSlice)))
                return;
            } else {
              addChunk(x0, z0, CHUNK_SIZE * 2, bands[farBand].spacing);
            }
          } else {
            built.add(cell);
            const x0 = -WORLD_MAX_X + cx * CHUNK_SIZE;
            const z0 = WORLD_MIN_Z + cz * CHUNK_SIZE;
            const spacing = bands[bandIndexAt(cx, cz)].spacing;
            if (idlePace) {
              if (!(await addChunkIdle(x0, z0, CHUNK_SIZE, spacing, yieldSlice))) return;
            } else {
              addChunk(x0, z0, CHUNK_SIZE, spacing);
            }
          }
        }
        onProgress?.(++done, total);
        if (!idlePace && done % cellsPerSlice === 0) await yieldSlice();
      }
      loadedZones.add(zone.id);
      onProgress?.(total, total);
    })().finally(() => pendingZones.delete(zone.id));
    pendingZones.set(zone.id, task);
    return task;
  };
  return {
    group,
    ensureZone,
    isZoneLoaded: (zoneId: string) => loadedZones.has(zoneId),
    groundResidency: () => residency,
    cancelStreaming(): void {
      cancelled = true;
      pool?.dispose();
    },
    update(camX: number, camZ: number, fogFar: number): void {
      // fully-fogged chunks are pure overdraw; drop them before the frustum
      for (const chunk of chunks) {
        const dx = Math.max(Math.abs(camX - chunk.x) - chunk.half, 0);
        const dz = Math.max(Math.abs(camZ - chunk.z) - chunk.half, 0);
        chunk.mesh.visible = Math.hypot(dx, dz) < fogFar;
      }
    },
    rebuildRegion(minX: number, minZ: number, maxX: number, maxZ: number): void {
      // No allocation beyond the replacement geometries: the chunk list is
      // scanned in place and only intersecting chunks re-mesh.
      for (const chunk of chunks) {
        if (!chunkIntersectsRegion(chunk.x0, chunk.z0, chunk.size, minX, minZ, maxX, maxZ)) {
          continue;
        }
        const geo = buildChunkGeometry(
          chunk.x0,
          chunk.z0,
          chunk.size,
          chunk.spacing,
          seed,
          !lowGfx,
          skirtSpan,
          lowShade,
        );
        chunk.mesh.geometry.dispose();
        chunk.mesh.geometry = geo; // bounding box/sphere already computed by the build
      }
    },
    rebakeNormalRegion(minX: number, minZ: number, maxX: number, maxZ: number): void {
      if (!normalTex) return; // Lambert tier: no macro normal map
      // margin 1: texels just outside the region read sculpted heights through
      // the derivative stencil, so they go stale too.
      const bounds = normalTexelBounds(
        minX,
        minZ,
        maxX,
        maxZ,
        -WORLD_MAX_X,
        WORLD_MIN_Z,
        WORLD_MAX_X * 2,
        WORLD_MAX_Z - WORLD_MIN_Z,
        NORMAL_TEX_W,
        NORMAL_TEX_H,
        1,
      );
      if (!bounds) return;
      bakeNormalRegion(
        normalTex.image.data as Uint8Array,
        seed,
        bounds.i0,
        bounds.i1,
        bounds.j0,
        bounds.j1,
      );
      normalTex.needsUpdate = true;
    },
    setBrush(x: number, z: number, radius: number, color?: THREE.ColorRepresentation): void {
      brush.uBrushCenter.value.set(x, z);
      brush.uBrushRadius.value = Math.max(0, radius);
      if (color !== undefined) brush.uBrushColor.value.set(color);
    },
    clearBrush(): void {
      brush.uBrushRadius.value = 0;
    },
  };
}
