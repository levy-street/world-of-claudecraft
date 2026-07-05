import * as THREE from 'three';
import {
  WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_Z, ZONES,
} from '../sim/data';
import type { BiomeId } from '../sim/types';
import { roadDistance, terrainHeight, WATER_LEVEL, zoneBiomeAt } from '../sim/world';
import { loadTexture } from './assets/loader';
import { registerPreload } from './assets/preload';
import { GFX } from './gfx';
import { impactCraterTerrainBlend } from './impact_terrain';
import { groundDetailTexture, groundSplatMaps, macroNoiseTexture } from './textures';

// Chunked terrain across the whole 360x1080 zone strip.
//
// - ~60u chunks with their own bounding volumes so frustum culling actually
//   works (the old single-plane-per-zone terrain was always fully submitted).
// - LOD by distance from the nearest hub at build time: settlements (where
//   the camera lingers) get dense vertices, the wilderness gets coarse ones.
// - 0.3u skirts hang from every chunk edge to hide LOD cracks.
// - High tier: MeshStandardMaterial + splat shading (grass/dirt/rock/sand
//   weights precomputed per vertex from slope/height/roadDistance into a vec4
//   attribute) over the biome vertex-color tint, plus a world-space macro
//   normal map baked from terrainHeight.
// - Low tier: the legacy vertex-color Lambert look, still chunked for culling.

const CHUNK_SIZE = 60;
const SKIRT_DROP = 0.3;
const SLOPE_EPS = 1.5; // matches the legacy color pass so tints don't shift

// ---------------------------------------------------------------------------
// Real PBR splat layers (ambientCG 1K, shipped under public/textures/terrain).
// Kicked off at module import and registered with the preload gate, so by the
// time buildTerrain runs the resolved textures are available synchronously.
// ---------------------------------------------------------------------------

const TERRAIN_TEX: Record<string, THREE.Texture> = {};
const ALBEDO_ANISOTROPY = 8;
const NORMAL_ANISOTROPY = 4;

function kickTerrainTex(key: string, file: string, srgb: boolean): void {
  registerPreload(loadTexture(`/textures/terrain/${file}`, { srgb, repeat: true }).then((tex) => {
    tex.anisotropy = srgb ? ALBEDO_ANISOTROPY : NORMAL_ANISOTROPY;
    TERRAIN_TEX[key] = tex;
    return tex;
  }));
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
    TERRAIN_TEX.grassC && TERRAIN_TEX.grassN
      && TERRAIN_TEX.dirtC && TERRAIN_TEX.dirtN
      && TERRAIN_TEX.rockC && TERRAIN_TEX.rockN
      && TERRAIN_TEX.sandC && TERRAIN_TEX.sandN
      && TERRAIN_TEX.mudC && TERRAIN_TEX.snowC,
  );
}

// Per-layer constant roughness, eyeballed from the packs' roughness-map means
// (saves four samplers vs. real roughness maps; terrain is never glossy
// enough for the difference to read at gameplay camera distance).
const ROUGH_GRASS = 0.8;
const ROUGH_DIRT = 0.9;
const ROUGH_ROCK = 0.75;
const ROUGH_SAND = 0.85;
const ROUGH_MUD = 0.62; // wet sheen
const ROUGH_SNOW = 0.72;

// vertex spacing by distance from the nearest hub centre
const LOD_BANDS = {
  high: [
    { maxHubDist: 95, spacing: 1.2 },
    { maxHubDist: 185, spacing: 2.0 },
    { maxHubDist: Infinity, spacing: 3.5 },
  ],
  low: [
    { maxHubDist: 95, spacing: 3.0 },
    { maxHubDist: 185, spacing: 4.4 },
    { maxHubDist: Infinity, spacing: 6.5 },
  ],
} as const;

// terrain normal map resolution (~0.56u per texel over 360x1080)
const NORMAL_TEX_W = 640;
const NORMAL_TEX_H = 1920;
const NORMAL_TEX_STRENGTH = 1.35;

// Ground colors per biome; boundaries blend across the same window as the
// heightfield's shape blend. This is the tint layer the splat albedo
// multiplies into (splat textures are authored near mid-gray).
const BIOME_PALETTE: Record<BiomeId, { grass: number; grassDark: number; grassYellow: number; dirt: number; sand: number }> = {
  vale: { grass: 0x548545, grassDark: 0x3e6635, grassYellow: 0x768c44, dirt: 0x8a6f47, sand: 0xc2b283 },
  marsh: { grass: 0x596d36, grassDark: 0x41522b, grassYellow: 0x71764a, dirt: 0x6e5a3e, sand: 0x8f7f5c },
  peaks: { grass: 0x687a55, grassDark: 0x4d5c45, grassYellow: 0x8d9168, dirt: 0x7d6a50, sand: 0xb0a486 },
};

// rock starts creeping in at lower slopes in the peaks, later in the marsh
const ROCK_SLOPE_START: Record<BiomeId, number> = { vale: 0.55, marsh: 0.62, peaks: 0.45 };

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

interface VertexSample {
  height: number;
  slope: number;
  normal: [number, number, number];
  color: [number, number, number];
  splat: [number, number, number, number]; // grass, dirt, rock, sand
  extra: [number, number, number, number]; // mud, snow, impact scorch, impact ash
}

// Shared scratch colors for the palette blend (hot loop, avoid allocation).
const cTmp = new THREE.Color();
const grassC = new THREE.Color(), grassDarkC = new THREE.Color(), grassYellowC = new THREE.Color();
const dirtC = new THREE.Color(), sandC = new THREE.Color();
const dirtDarkC = new THREE.Color(0x73592f);
const rockC = new THREE.Color(0x7a7a72);
const impactAshC = new THREE.Color(0x18110d);
const impactScorchC = new THREE.Color(0x2a160c);
const hazyPeakC = new THREE.Color(0xa8bdd4); // world-rim mountains, atmospheric
const snowCapC = new THREE.Color(0xedf3fa);
const lowSunC = new THREE.Color(0xe7d9a5);
const lowShadeC = new THREE.Color(0x60745b);
const zonePalettes = ZONES.map((zn) => {
  const p = BIOME_PALETTE[zn.biome];
  return {
    grass: new THREE.Color(p.grass), grassDark: new THREE.Color(p.grassDark),
    grassYellow: new THREE.Color(p.grassYellow), dirt: new THREE.Color(p.dirt), sand: new THREE.Color(p.sand),
  };
});

function paletteAt(z: number): void {
  grassC.copy(zonePalettes[0].grass);
  grassDarkC.copy(zonePalettes[0].grassDark);
  grassYellowC.copy(zonePalettes[0].grassYellow);
  dirtC.copy(zonePalettes[0].dirt);
  sandC.copy(zonePalettes[0].sand);
  for (let i = 0; i + 1 < ZONES.length; i++) {
    const b = ZONES[i].zMax;
    const t = clamp01((z - (b - 30)) / 65);
    const tt = t * t * (3 - 2 * t);
    if (tt <= 0) break;
    grassC.lerp(zonePalettes[i + 1].grass, tt);
    grassDarkC.lerp(zonePalettes[i + 1].grassDark, tt);
    grassYellowC.lerp(zonePalettes[i + 1].grassYellow, tt);
    dirtC.lerp(zonePalettes[i + 1].dirt, tt);
    sandC.lerp(zonePalettes[i + 1].sand, tt);
  }
}

// How "marsh" a given z is — mirrors the palette/heightfield blend windows so
// the mud texture fades in exactly where the marsh palette does.
function marshWeightAt(z: number): number {
  let w = ZONES[0].biome === 'marsh' ? 1 : 0;
  for (let i = 0; i + 1 < ZONES.length; i++) {
    const b = ZONES[i].zMax;
    const t = clamp01((z - (b - 30)) / 65);
    const tt = t * t * (3 - 2 * t);
    if (tt <= 0) break;
    w += ((ZONES[i + 1].biome === 'marsh' ? 1 : 0) - w) * tt;
  }
  return w;
}

// blend the splat weight vector toward a single layer
function lerpSplat(w: [number, number, number, number], layer: 0 | 1 | 2 | 3, t: number): void {
  if (t <= 0) return;
  w[0] -= w[0] * t;
  w[1] -= w[1] * t;
  w[2] -= w[2] * t;
  w[3] -= w[3] * t;
  w[layer] += t;
}

// One terrain sample: height, analytic normal, legacy tint color and splat
// weights. Both tiers use the color; only the splat tier consumes weights.
function sampleVertex(x: number, z: number, seed: number): VertexSample {
  const h = terrainHeight(x, z, seed);
  const hx = terrainHeight(x + SLOPE_EPS, z, seed) - terrainHeight(x - SLOPE_EPS, z, seed);
  const hz = terrainHeight(x, z + SLOPE_EPS, seed) - terrainHeight(x, z - SLOPE_EPS, seed);
  const slope = Math.sqrt(hx * hx + hz * hz) / (2 * SLOPE_EPS);
  const invLen = 1 / Math.hypot(hx / (2 * SLOPE_EPS), 1, hz / (2 * SLOPE_EPS));
  const normal: [number, number, number] = [
    -(hx / (2 * SLOPE_EPS)) * invLen, invLen, -(hz / (2 * SLOPE_EPS)) * invLen,
  ];

  paletteAt(z);
  const biome = zoneBiomeAt(z);
  const w: [number, number, number, number] = [1, 0, 0, 0];
  const impact = impactCraterTerrainBlend(x, z);

  // base grass with patchy variation
  const v = (Math.sin(x * 0.21) * Math.cos(z * 0.17) + 1) / 2;
  cTmp.copy(grassC).lerp(grassDarkC, v);
  const v2 = (Math.sin(x * 0.043 + 5) * Math.cos(z * 0.05 + 2) + 1) / 2;
  cTmp.lerp(grassYellowC, v2 * 0.35);
  // the marsh reads muddier: patches of wet dirt across the lowland
  if (biome === 'marsh') lerpSplat(w, 1, 0.3 * v2 * clamp01((4 - h) / 6));
  // shoreline sand — color and splat weight share one feathered falloff so
  // the beach blends out instead of cutting a razor-hard grass/sand line
  const shore = clamp01((WATER_LEVEL + 1.6 - h) / 1.6);
  cTmp.lerp(sandC, shore);
  lerpSplat(w, 3, shore);
  // packed dirt at each hub settlement (same feather as the splat weight —
  // a constant lerp stamped a clean-edged brown disc on the grass)
  for (const zn of ZONES) {
    const dHub = Math.hypot(x - zn.hub.x, z - zn.hub.z);
    if (dHub < 14) {
      const hubT = clamp01((14 - dHub) / 3);
      cTmp.lerp(dirtDarkC, 0.7 * hubT);
      lerpSplat(w, 1, 0.75 * hubT);
      break;
    }
  }
  const rd = roadDistance(x, z);
  if (rd < 2.0) {
    cTmp.lerp(dirtC, 0.85);
    lerpSplat(w, 1, 0.85);
  } else if (rd < 3.4) {
    const t = 0.85 * (1 - (rd - 2.0) / 1.4);
    cTmp.lerp(dirtC, t);
    lerpSplat(w, 1, t);
  }
  const rockStart = ROCK_SLOPE_START[biome];
  if (slope > rockStart) {
    const t = Math.min(1, (slope - rockStart) * 2);
    cTmp.lerp(rockC, t);
    lerpSplat(w, 2, t);
  }
  // high ground (ridges, peaks) goes rocky then snowy
  let snow = 0;
  if (h > 22) {
    cTmp.lerp(rockC, clamp01((h - 22) / 10) * 0.7);
    snow = clamp01((h - 34) / 14) * 0.85;
    cTmp.lerp(snowCapC, snow);
    lerpSplat(w, 2, clamp01((h - 22) / 10) * 0.8);
  }
  if (impact.scorch > 0) {
    cTmp.lerp(impactScorchC, 0.88 * impact.scorch);
    cTmp.lerp(impactAshC, 0.58 * impact.ash);
    lerpSplat(w, 1, impact.dirt);
    lerpSplat(w, 2, impact.rock);
  }
  // the rim wall reads as distant sunlit peaks, not a black cliff
  const edge = Math.max(
    Math.abs(x) - (WORLD_MAX_X - 32),
    WORLD_MIN_Z + 32 - z,
    z - (WORLD_MAX_Z - 32),
  );
  const rim = clamp01(edge / 26);
  if (rim > 0) {
    cTmp.lerp(hazyPeakC, rim * 0.9);
    const rimSnow = clamp01((h - 26) / 16) * rim * 0.8;
    cTmp.lerp(snowCapC, rimSnow);
    snow = Math.max(snow, rimSnow);
    lerpSplat(w, 2, rim * 0.85);
  }
  // mud rides the dirt layer wherever the marsh palette is active
  const mud = marshWeightAt(z);
  if (GFX.lowPlus && !GFX.terrainSplat) {
    const ridge = clamp01((slope - 0.22) * 1.6);
    const lowland = clamp01((WATER_LEVEL + 7 - h) / 12);
    const upland = clamp01((h - 8) / 22);
    cTmp.lerp(lowShadeC, 0.07 * ridge + 0.05 * lowland * mud);
    cTmp.lerp(lowSunC, 0.035 * (1 - shore) + 0.045 * upland);
    cTmp.multiplyScalar(0.98 + upland * 0.04 - ridge * 0.025);
  }
  return {
    height: h, slope, normal, color: [cTmp.r, cTmp.g, cTmp.b], splat: w,
    extra: [mud, snow, impact.scorch, impact.ash],
  };
}

// ---------------------------------------------------------------------------
// Chunk geometry: interior (nx+1)x(nz+1) grid wrapped in a skirt ring whose
// vertices sit on the chunk border but 0.3u lower, hiding LOD cracks.
// ---------------------------------------------------------------------------

function buildChunkGeometry(x0: number, z0: number, size: number, spacing: number, seed: number, withSplat: boolean): THREE.BufferGeometry {
  const nx = Math.max(4, Math.round(size / spacing));
  const nz = nx;
  const stepX = size / nx;
  const stepZ = size / nz;
  const gw = nx + 3; // grid width including the skirt ring
  const gh = nz + 3;
  const count = gw * gh;

  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const splats = withSplat ? new Float32Array(count * 4) : null;
  const extras = withSplat ? new Float32Array(count * 4) : null;

  const worldDepth = WORLD_MAX_Z - WORLD_MIN_Z;
  const sampleCache = new Map<number, VertexSample>();
  for (let gj = 0; gj < gh; gj++) {
    for (let gi = 0; gi < gw; gi++) {
      const i = gi - 1, j = gj - 1; // interior indices; -1 / n+1 are skirt
      const ci = Math.max(0, Math.min(nx, i));
      const cj = Math.max(0, Math.min(nz, j));
      const isSkirt = i !== ci || j !== cj;
      const x = x0 + ci * stepX;
      const z = z0 + cj * stepZ;
      // skirt verts share the border sample — cache by clamped grid index
      const cacheKey = cj * gw + ci;
      let s = sampleCache.get(cacheKey);
      if (!s) {
        s = sampleVertex(x, z, seed);
        sampleCache.set(cacheKey, s);
      }
      const vi = gj * gw + gi;
      positions[vi * 3] = x;
      positions[vi * 3 + 1] = s.height - (isSkirt ? SKIRT_DROP : 0);
      positions[vi * 3 + 2] = z;
      normals[vi * 3] = s.normal[0];
      normals[vi * 3 + 1] = s.normal[1];
      normals[vi * 3 + 2] = s.normal[2];
      colors[vi * 3] = s.color[0];
      colors[vi * 3 + 1] = s.color[1];
      colors[vi * 3 + 2] = s.color[2];
      uvs[vi * 2] = (x + WORLD_MAX_X) / (WORLD_MAX_X * 2);
      uvs[vi * 2 + 1] = (z - WORLD_MIN_Z) / worldDepth;
      if (splats) {
        splats[vi * 4] = s.splat[0];
        splats[vi * 4 + 1] = s.splat[1];
        splats[vi * 4 + 2] = s.splat[2];
        splats[vi * 4 + 3] = s.splat[3];
      }
      if (extras) {
        extras[vi * 4] = s.extra[0];
        extras[vi * 4 + 1] = s.extra[1];
        extras[vi * 4 + 2] = s.extra[2];
        extras[vi * 4 + 3] = s.extra[3];
      }
    }
  }

  const quadsX = gw - 1, quadsZ = gh - 1;
  const indices = new Uint32Array(quadsX * quadsZ * 6);
  let k = 0;
  for (let gj = 0; gj < quadsZ; gj++) {
    for (let gi = 0; gi < quadsX; gi++) {
      const a = gj * gw + gi;
      const b = a + 1;
      const c = a + gw;
      const d = c + 1;
      indices[k++] = a; indices[k++] = c; indices[k++] = b;
      indices[k++] = b; indices[k++] = c; indices[k++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (splats) geo.setAttribute('aSplat', new THREE.BufferAttribute(splats, 4));
  if (extras) geo.setAttribute('aExtra', new THREE.BufferAttribute(extras, 4));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// ---------------------------------------------------------------------------
// Macro relief: a DataTexture normal map baked from terrainHeight in
// strip-planar UV space — cliffs and ridges get per-pixel light response far
// beyond the vertex density.
// ---------------------------------------------------------------------------

function terrainNormalTexture(seed: number): THREE.DataTexture {
  const w = NORMAL_TEX_W, h = NORMAL_TEX_H;
  const worldW = WORLD_MAX_X * 2;
  const worldD = WORLD_MAX_Z - WORLD_MIN_Z;
  const stepX = worldW / w;
  const stepZ = worldD / h;
  const heights = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const z = WORLD_MIN_Z + (j + 0.5) * stepZ;
    for (let i = 0; i < w; i++) {
      heights[j * w + i] = terrainHeight(-WORLD_MAX_X + (i + 0.5) * stepX, z, seed);
    }
  }
  const data = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const iw = Math.max(0, i - 1), ie = Math.min(w - 1, i + 1);
      const jn = Math.max(0, j - 1), js = Math.min(h - 1, j + 1);
      const dhdx = (heights[j * w + ie] - heights[j * w + iw]) / ((ie - iw) * stepX);
      const dhdz = (heights[js * w + i] - heights[jn * w + i]) / ((js - jn) * stepZ);
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
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

function buildSplatMaterial(seed: number): THREE.MeshStandardMaterial {
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
    normalMap: terrainNormalTexture(seed),
    normalScale: new THREE.Vector2(0.85, 0.85),
  });
  mat.onBeforeCompile = (sh) => {
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
      .replace('#include <common>', `#include <common>
        attribute vec4 aSplat;
        attribute vec4 aExtra;
        varying vec4 vSplat;
        varying vec4 vExtra;
        varying vec3 vWPos;
        varying vec3 vWNorm;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSplat = aSplat;
        vExtra = aExtra;
        vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vWNorm = objectNormal; // terrain mesh is untransformed: object == world`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vSplat;
        varying vec4 vExtra;
        varying vec3 vWPos;
        varying vec3 vWNorm;
        uniform sampler2D uGrass, uGrassN, uDirt, uDirtN, uRock, uRockN, uSand, uSandN, uMud, uSnow, uMacro;`)
      .replace('#include <map_fragment>', `
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
        diffuseColor.rgb *= alb * mix(vec3(1.0), vtint, 0.35) * macro;`)
      .replace('#include <color_fragment>', `
        // vertex color already folded into the splat albedo above (gently);
        // the stock full multiply would re-tint the real textures to mush`)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness * mix(
          dot(vSplat, vec4(${ROUGH_GRASS}, mix(${ROUGH_DIRT}, ${ROUGH_MUD}, vExtra.x), ${ROUGH_ROCK}, ${ROUGH_SAND})),
          ${ROUGH_SNOW}, vExtra.y);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
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
        }`);
  };
  return mat;
}

function buildLambertMaterial(): THREE.MeshLambertMaterial {
  const detail = groundDetailTexture();
  // strip-planar uv: keep the legacy ~2.25u texture period in both axes
  detail.repeat.set(160, 480);
  return new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: detail,
    emissive: GFX.lowPlus ? 0x182014 : 0x000000,
    emissiveIntensity: GFX.lowPlus ? 0.08 : 1,
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface TerrainView {
  group: THREE.Group;
  /** hides chunks that sit entirely past the fog far plane */
  update(camX: number, camZ: number, fogFar: number): void;
}

export function buildTerrain(seed: number): TerrainView {
  const lowGfx = !GFX.terrainSplat || !hasTerrainSplatAssets();
  const mat = lowGfx ? buildLambertMaterial() : buildSplatMaterial(seed);
  const bands = lowGfx ? LOD_BANDS.low : LOD_BANDS.high;
  const group = new THREE.Group();
  group.name = 'terrain';
  const worldDepth = WORLD_MAX_Z - WORLD_MIN_Z;
  const chunksX = Math.ceil((WORLD_MAX_X * 2) / CHUNK_SIZE);
  const chunksZ = Math.ceil(worldDepth / CHUNK_SIZE);
  const chunks: { mesh: THREE.Mesh; x: number; z: number; half: number }[] = [];

  const bandIndexAt = (cx: number, cz: number): number => {
    const centerX = -WORLD_MAX_X + cx * CHUNK_SIZE + CHUNK_SIZE / 2;
    const centerZ = WORLD_MIN_Z + cz * CHUNK_SIZE + CHUNK_SIZE / 2;
    let hubDist = Infinity;
    for (const zn of ZONES) {
      hubDist = Math.min(hubDist, Math.hypot(centerX - zn.hub.x, centerZ - zn.hub.z));
    }
    const idx = bands.findIndex((b) => hubDist <= b.maxHubDist);
    return idx === -1 ? bands.length - 1 : idx;
  };

  const addChunk = (x0: number, z0: number, size: number, spacing: number): void => {
    const geo = buildChunkGeometry(x0, z0, size, spacing, seed, !lowGfx);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
    chunks.push({
      mesh, x: x0 + size / 2, z: z0 + size / 2,
      half: size / 2,
    });
  };

  // far-LOD cells merge 2x2 into super-chunks: the far field is where draw
  // count hurts and culling granularity matters least
  const farBand = bands.length - 1;
  const built = new Set<number>();
  for (let cz = 0; cz < chunksZ; cz++) {
    for (let cx = 0; cx < chunksX; cx++) {
      if (built.has(cz * chunksX + cx)) continue;
      const superOk = cx % 2 === 0 && cz % 2 === 0 && cx + 1 < chunksX && cz + 1 < chunksZ
        && bandIndexAt(cx, cz) === farBand && bandIndexAt(cx + 1, cz) === farBand
        && bandIndexAt(cx, cz + 1) === farBand && bandIndexAt(cx + 1, cz + 1) === farBand;
      if (superOk) {
        for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          built.add((cz + dz) * chunksX + (cx + dx));
        }
        addChunk(-WORLD_MAX_X + cx * CHUNK_SIZE, WORLD_MIN_Z + cz * CHUNK_SIZE, CHUNK_SIZE * 2, bands[farBand].spacing);
      } else {
        built.add(cz * chunksX + cx);
        const band = bands[bandIndexAt(cx, cz)];
        addChunk(-WORLD_MAX_X + cx * CHUNK_SIZE, WORLD_MIN_Z + cz * CHUNK_SIZE, CHUNK_SIZE, band.spacing);
      }
    }
  }
  return {
    group,
    update(camX: number, camZ: number, fogFar: number): void {
      // fully-fogged chunks are pure overdraw; drop them before the frustum
      for (const chunk of chunks) {
        const dx = Math.max(Math.abs(camX - chunk.x) - chunk.half, 0);
        const dz = Math.max(Math.abs(camZ - chunk.z) - chunk.half, 0);
        chunk.mesh.visible = Math.hypot(dx, dz) < fogFar;
      }
    },
  };
}
