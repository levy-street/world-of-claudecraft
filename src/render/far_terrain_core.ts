// Pure planning core for the far-vista terrain layer: the whole-world coarse
// mesh that stands in for everything past the detail envelope, so the horizon
// shows real terrain. The outdoor fog is gone on the vista tiers; this layer
// is what makes that possible, because without it the detail envelope's edge
// would face open void.
//
// The layer splits the one distance the renderer used to key off fog into:
// - detail far: what the existing subsystems (terrain chunks, props, town,
//   foliage, water, zone streaming) cull against. Capped at the classic
//   MAX_OUTDOOR_FOG_FAR envelope so their cost model is unchanged.
// - view far: the tier's whole-world envelope (the camera far plane rides
//   it). The far mesh, and the foliage sprites, fill the band between.
//
// Everything here is host-agnostic math (no Three, no DOM) so a Vitest
// drives every decision directly; the thin painter is far_terrain.ts. The
// color recipe is a cheap re-read of the near terrain's vertex thresholds
// (terrain_chunk_build.ts) against the shared terrain_palette.ts data: one
// terrainHeight tap per vertex (slope and normals come from the sampled
// grid), which is what makes a whole-world pass affordable.

import {
  COLUMN_ZONES,
  columnBlendAt,
  STRIP_ZONES,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_X,
  WORLD_MIN_Z,
  ZONES,
} from '../sim/data';
import { fbm2 } from '../sim/rng';
import type { BiomeId } from '../sim/types';
import { terrainHeight, WATER_LEVEL, zoneBiomeAt } from '../sim/world';
import { BIOME_PALETTE, ROCK_SLOPE_START, TERRAIN_TONES } from './terrain_palette';

/** Square far-mesh tile edge, world units. Divisible by every tier spacing.
 *  Sized so the whole world is about a dozen draws: each tile carries only a
 *  couple thousand triangles, so draw count, not triangle count, is what the
 *  layer must keep small; the camera frustum still culls tile-by-tile. */
export const FAR_TILE_SIZE = 960;

/** How far past the zone-rect world the far mesh extends: covers the rim
 *  mountains' far side and the open sea apron band beyond them. */
export const FAR_WORLD_MARGIN = 600;

/** Vertical drop applied to every far-mesh vertex so the coarse mesh never
 *  pokes through the dense near terrain where the two overlap. */
export const FAR_MESH_DROP = 1.8;

/** A far tile draws only while some part of it is inside the view envelope
 *  plus this margin; with the outdoor fog gone the envelope is the camera
 *  far plane, so in practice the frustum is the real cull and this test
 *  only sheds tiles when an indoor state shrinks the view. */
export const FAR_TILE_FOG_MARGIN = 30;

export interface FarVistaPlan {
  /** false leaves the renderer exactly as it was (low tier, constrained). */
  enabled: boolean;
  /** far-mesh vertex spacing, world units */
  spacing: number;
  /** the whole-world view envelope (far tiles + foliage sprites reach it) */
  envelopeFar: number;
  /** camera far plane for the tier */
  cameraFar: number;
}

/** Camera far plane when the vista layer is off: the classic constant. */
export const CLASSIC_CAMERA_FAR = 950;

/**
 * The uniform detail horizon on the fog-free vista arm: exactly the widest
 * cull the fogged clear realms ever ran (their 700u presets), so no detail
 * subsystem draws farther than it ever did, and nothing pops closer than it
 * used to. The vista tiles and the foliage sprites carry everything beyond;
 * at 700u+ the splat texture and prop silhouettes they replace are
 * sub-pixel anyway.
 */
export const FOGLESS_DETAIL_FAR = 700;

/**
 * The horizon haze band: where scene fog parks on the vista arm. A raw
 * fog-free horizon puts a razor edge between the open sea and the sky; real
 * atmosphere never does that. The band starts far past every gameplay
 * distance (nothing a player interacts with is ever hazed) and saturates
 * beyond the world, so distant water, the rim silhouettes and the sky
 * dome's fog-colored horizon band all converge on one realm-tinted
 * atmosphere right where sea meets sky. Fractions of the tier envelope so
 * medium's shorter world melts proportionally.
 */
export function horizonHazePlan(envelopeFar: number): { near: number; far: number } {
  return { near: envelopeFar * 0.62, far: envelopeFar * 1.6 };
}

/**
 * Per-tier vista plan. Low and constrained-memory devices keep the classic
 * renderer byte-for-byte (fog wall at the biome preset, camera far 950, no
 * far mesh); medium opens a shorter vista; high and above see the whole
 * world (the zone map's diagonal is about 2.9k units).
 */
export function farVistaPlan(
  tier: 'low' | 'medium' | 'high' | 'ultra' | 'insane',
  constrainedMemory: boolean,
): FarVistaPlan {
  if (constrainedMemory || tier === 'low') {
    return { enabled: false, spacing: 0, envelopeFar: 0, cameraFar: CLASSIC_CAMERA_FAR };
  }
  if (tier === 'medium') {
    return { enabled: true, spacing: 16, envelopeFar: 2200, cameraFar: 2600 };
  }
  if (tier === 'high') {
    return { enabled: true, spacing: 12, envelopeFar: 3200, cameraFar: 3600 };
  }
  if (tier === 'ultra') {
    return { enabled: true, spacing: 10, envelopeFar: 3200, cameraFar: 3600 };
  }
  if (tier === 'insane') {
    return { enabled: true, spacing: 8, envelopeFar: 3200, cameraFar: 3600 };
  }
  // Unknown tier (a partial GFX in a unit test, a future addition that has
  // not chosen a plan): the classic fogged renderer, never a silent vista.
  return { enabled: false, spacing: 0, envelopeFar: 0, cameraFar: CLASSIC_CAMERA_FAR };
}

/** The distance the classic subsystems cull against: the residency-eased
 *  detail horizon capped at the classic envelope, so the whole-world view
 *  never widens their workload. */
export function detailCullFar(detailFar: number, maxOutdoorFar: number): number {
  return Math.min(detailFar, maxOutdoorFar);
}

/** The capability flags the far-field decision reads (a GFX subset). */
export interface FarFieldCapabilities {
  standardMaterials: boolean;
  leanFoliage: boolean;
  constrainedMemory: boolean;
}

export interface FarFieldPolicy {
  /** bake the atlas and draw sprite impostors (the fogged stage-1 arm too) */
  sprites: boolean;
  /** the whole-world fog-free vista; never enabled without sprites */
  vista: FarVistaPlan;
}

/**
 * THE one far-field capability decision: every consumer (the impostor
 * session, the renderer's vista arm, the water apron, the shortfall
 * sampler) reads this, never farVistaPlan or the GFX flags directly, so
 * the sprite and vista arms can never diverge per profile.
 *
 * Laws, in force together:
 * - Sprites require the standard-material pipeline, the full foliage kit,
 *   and an unconstrained memory ceiling: the lean arm (low tier, weak-iGPU
 *   medium) and every phone-class memory profile keep the classic fogged
 *   renderer byte-for-byte and never allocate the atlas.
 * - The vista requires sprites: a fog-free horizon with no far foliage
 *   would read as a bare-ground world, so any profile that sheds the atlas
 *   keeps its fog wall too.
 */
export function farFieldPolicy(
  tier: 'low' | 'medium' | 'high' | 'ultra' | 'insane',
  caps: FarFieldCapabilities,
): FarFieldPolicy {
  const sprites = caps.standardMaterials && !caps.leanFoliage && !caps.constrainedMemory;
  if (!sprites) {
    return {
      sprites: false,
      vista: { enabled: false, spacing: 0, envelopeFar: 0, cameraFar: CLASSIC_CAMERA_FAR },
    };
  }
  return { sprites: true, vista: farVistaPlan(tier, caps.constrainedMemory) };
}

export interface FarTile {
  x0: number;
  z0: number;
  size: number;
  /** tile center */
  cx: number;
  cz: number;
}

/**
 * The far-mesh tile grid: the world rect grown by `margin` on every side,
 * cut into `tileSize` squares aligned to the grown origin. Tiles share edge
 * sample columns with their neighbours (the grid is global), so adjacent
 * tiles meet exactly and need no skirts between them.
 */
export function planFarTiles(
  worldMinX: number,
  worldMaxX: number,
  worldMinZ: number,
  worldMaxZ: number,
  margin: number = FAR_WORLD_MARGIN,
  tileSize: number = FAR_TILE_SIZE,
): FarTile[] {
  const minX = worldMinX - margin;
  const minZ = worldMinZ - margin;
  const tilesX = Math.ceil((worldMaxX + margin - minX) / tileSize);
  const tilesZ = Math.ceil((worldMaxZ + margin - minZ) / tileSize);
  const tiles: FarTile[] = [];
  for (let tz = 0; tz < tilesZ; tz++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const x0 = minX + tx * tileSize;
      const z0 = minZ + tz * tileSize;
      tiles.push({ x0, z0, size: tileSize, cx: x0 + tileSize / 2, cz: z0 + tileSize / 2 });
    }
  }
  return tiles;
}

/** Build order: tiles nearest the priority point first, so the world fills
 *  in around the player during the idle-paced boot build. */
export function farTileBuildOrder(tiles: readonly FarTile[], px: number, pz: number): number[] {
  return tiles
    .map((tile, i) => ({ i, d: (tile.cx - px) ** 2 + (tile.cz - pz) ** 2 }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((t) => t.i);
}

/**
 * Per-frame visibility for one far tile: draw while the tile's NEAREST
 * point sits inside the view envelope (plus margin); the camera frustum
 * culls the rest. (Near-field overlap with the detail terrain is handled
 * per fragment by the painter's discard, not per tile: the tile grid is far
 * coarser than the detail envelope.)
 */
export function farTileVisible(
  tile: FarTile,
  camX: number,
  camZ: number,
  viewFar: number,
): boolean {
  const half = tile.size / 2;
  const dx = Math.max(Math.abs(camX - tile.cx) - half, 0);
  const dz = Math.max(Math.abs(camZ - tile.cz) - half, 0);
  return Math.hypot(dx, dz) < viewFar + FAR_TILE_FOG_MARGIN;
}

/** Vertex count per tile edge for a spacing that divides the tile size. */
export function farGridSide(tileSize: number, spacing: number): number {
  return Math.round(tileSize / spacing) + 1;
}

/**
 * Triangle indices for one tile's regular grid, row-major vertex order,
 * fixed diagonal. Fits Uint16 for every shipped spacing (97x97 max).
 */
export function farGridIndices(side: number): Uint16Array {
  if (side * side > 65536) {
    throw new Error(`far grid side ${side} overflows Uint16 indices`);
  }
  const cells = side - 1;
  const out = new Uint16Array(cells * cells * 6);
  let k = 0;
  for (let iz = 0; iz < cells; iz++) {
    for (let ix = 0; ix < cells; ix++) {
      const a = iz * side + ix;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      out[k++] = a;
      out[k++] = c;
      out[k++] = b;
      out[k++] = b;
      out[k++] = c;
      out[k++] = d;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The far color recipe: terrain.ts's sampleVertex thresholds re-read at
// far-mesh scale. Sub-vertex features (roads, hub discs, rock streak grain)
// are deliberately dropped: they are narrower than one far-mesh cell and the
// near terrain owns everything inside the detail envelope anyway.
// ---------------------------------------------------------------------------

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

type Triple = [number, number, number];

/** sRGB hex to the linear-srgb triple THREE.Color(hex) resolves to, so far
 *  vertex colors land in the same working space as the near terrain's. */
export function srgbHexToLinear(hex: number): Triple {
  const conv = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [conv((hex >> 16) & 0xff), conv((hex >> 8) & 0xff), conv(hex & 0xff)];
}

interface FarPalette {
  grass: Triple;
  grassDark: Triple;
  grassYellow: Triple;
  dirt: Triple;
  sand: Triple;
}

const zoneFarPalettes: FarPalette[] = ZONES.map((zn) => {
  const p = BIOME_PALETTE[zn.biome];
  return {
    grass: srgbHexToLinear(p.grass),
    grassDark: srgbHexToLinear(p.grassDark),
    grassYellow: srgbHexToLinear(p.grassYellow),
    dirt: srgbHexToLinear(p.dirt),
    sand: srgbHexToLinear(p.sand),
  };
});

const TONE = {
  dirtDark: srgbHexToLinear(TERRAIN_TONES.dirtDark),
  rock: srgbHexToLinear(TERRAIN_TONES.rock),
  wetRock: srgbHexToLinear(TERRAIN_TONES.wetRock),
  hazyPeak: srgbHexToLinear(TERRAIN_TONES.hazyPeak),
  emberForest: srgbHexToLinear(TERRAIN_TONES.emberForest),
  emberScorch: srgbHexToLinear(TERRAIN_TONES.emberScorch),
  emberBasalt: srgbHexToLinear(TERRAIN_TONES.emberBasalt),
  snowCap: srgbHexToLinear(TERRAIN_TONES.snowCap),
  // Mountain-face variants around TERRAIN_TONES.rock: a shadowed crevice
  // tone and a warm sunned face, blended by ridge-scale noise so distant
  // rock reads as strata and gullies instead of one flat gray.
  rockCrevice: srgbHexToLinear(0x565650),
  rockWarm: srgbHexToLinear(0x8f887c),
};

const lerp3 = (out: Triple, to: Triple, t: number): void => {
  if (t <= 0) return;
  out[0] += (to[0] - out[0]) * t;
  out[1] += (to[1] - out[1]) * t;
  out[2] += (to[2] - out[2]) * t;
};

const copy3 = (out: Triple, from: Triple): void => {
  out[0] = from[0];
  out[1] = from[1];
  out[2] = from[2];
};

const farPaletteScratch: FarPalette = {
  grass: [0, 0, 0],
  grassDark: [0, 0, 0],
  grassYellow: [0, 0, 0],
  dirt: [0, 0, 0],
  sand: [0, 0, 0],
};

const stripPalette = (zn: (typeof ZONES)[number]): FarPalette =>
  zoneFarPalettes[ZONES.indexOf(zn)] ?? zoneFarPalettes[0];

/** The same strip-cascade plus column blend paletteAt uses in terrain.ts,
 *  over linear triples. Writes into the module scratch (hot loop). */
function farPaletteAt(x: number, z: number): FarPalette {
  const out = farPaletteScratch;
  const first = stripPalette(STRIP_ZONES[0]);
  copy3(out.grass, first.grass);
  copy3(out.grassDark, first.grassDark);
  copy3(out.grassYellow, first.grassYellow);
  copy3(out.dirt, first.dirt);
  copy3(out.sand, first.sand);
  for (let i = 0; i + 1 < STRIP_ZONES.length; i++) {
    const b = STRIP_ZONES[i].zMax;
    const t = clamp01((z - (b - 30)) / 65);
    const tt = t * t * (3 - 2 * t);
    if (tt <= 0) break;
    const next = stripPalette(STRIP_ZONES[i + 1]);
    lerp3(out.grass, next.grass, tt);
    lerp3(out.grassDark, next.grassDark, tt);
    lerp3(out.grassYellow, next.grassYellow, tt);
    lerp3(out.dirt, next.dirt, tt);
    lerp3(out.sand, next.sand, tt);
  }
  for (const col of COLUMN_ZONES) {
    const t = columnBlendAt(col, x, z);
    if (t <= 0) continue;
    const p = stripPalette(col);
    lerp3(out.grass, p.grass, t);
    lerp3(out.grassDark, p.grassDark, t);
    lerp3(out.grassYellow, p.grassYellow, t);
    lerp3(out.dirt, p.dirt, t);
    lerp3(out.sand, p.sand, t);
  }
  return out;
}

/** Blend weight of one biome across the same windows the palette fades. */
function biomeWeightAt(biome: BiomeId, x: number, z: number): number {
  let w = STRIP_ZONES[0].biome === biome ? 1 : 0;
  for (let i = 0; i + 1 < STRIP_ZONES.length; i++) {
    const b = STRIP_ZONES[i].zMax;
    const t = clamp01((z - (b - 30)) / 65);
    const tt = t * t * (3 - 2 * t);
    if (tt <= 0) break;
    w += ((STRIP_ZONES[i + 1].biome === biome ? 1 : 0) - w) * tt;
  }
  for (const col of COLUMN_ZONES) {
    const t = columnBlendAt(col, x, z);
    if (t > 0) w += ((col.biome === biome ? 1 : 0) - w) * t;
  }
  return w;
}

/** How much forest mass a biome carries on the far mesh: distant hillsides
 *  read as wooded where the decoration field is dense. Purely cosmetic far
 *  paint; the real trees inside the detail envelope are the source of truth. */
const FAR_FOREST_DENSITY: Partial<Record<BiomeId, number>> = {
  vale: 0.5,
  marsh: 0.35,
  peaks: 0.25,
  dusk: 0.42,
  ember: 0.2,
  frost: 0.12,
  amber: 0.45,
  fen: 0.35,
  night: 0.3,
  haunt: 0.62,
  jungle: 0.72,
  garden: 0.4,
  gale: 0.1,
};

/**
 * One far vertex's ground color, written into `out` as a linear-srgb triple.
 * `slope` is height units per world unit, from the caller's sampled grid.
 */
export function farGroundColor(
  x: number,
  z: number,
  h: number,
  slope: number,
  seed: number,
  out: Triple,
): void {
  const pal = farPaletteAt(x, z);
  const biome = zoneBiomeAt(x, z);

  // base grass with the same patchy fbm variation the near tint uses
  const v = fbm2(x * 0.045, z * 0.045, seed + 53, 3);
  copy3(out, pal.grass);
  lerp3(out, pal.grassDark, v);
  const v2 = fbm2(x * 0.16, z * 0.16, seed + 59, 2);
  lerp3(out, pal.grassYellow, v2 * 0.35);

  if (biome === 'ember') {
    const forest = 1 - clamp01((z - 1925) / 145);
    if (forest > 0) lerp3(out, TONE.emberForest, forest * 0.85);
    const passT = 1 - clamp01((Math.abs(x - 404) - 26) / 26);
    const valley = passT * clamp01((z - 2310) / 80);
    const scorch = clamp01((z - 2260) / 100) * (1 - valley);
    if (scorch > 0) lerp3(out, TONE.emberScorch, scorch * 0.55);
    if (valley > 0) lerp3(out, TONE.emberForest, valley * 0.8);
  }

  // marsh mud: pull the ground toward dark wet earth where the marsh blends in
  const marshW = biomeWeightAt('marsh', x, z);
  if (marshW > 0) lerp3(out, TONE.dirtDark, marshW * 0.45);

  // far forest mass: clumped canopy paint over gentle, dry, low ground
  const shoreH = h - (WATER_LEVEL + 1.6);
  const rockStart = ROCK_SLOPE_START[biome];
  const density = FAR_FOREST_DENSITY[biome] ?? 0.3;
  if (h < 22 && shoreH > 1.2 && slope < rockStart) {
    const clump = fbm2(x * 0.03, z * 0.03, seed + 271, 2);
    const forest = clamp01((clump - 0.45) * 2.4) * density;
    if (forest > 0) {
      const canopy: Triple = [
        pal.grassDark[0] * 0.52,
        pal.grassDark[1] * 0.62,
        pal.grassDark[2] * 0.5,
      ];
      lerp3(out, canopy, forest * 0.85);
    }
  }

  // shoreline band: sand at the waterline (wet rock in the stone biomes)
  const shore = clamp01((WATER_LEVEL + 1.6 - h) / 1.6);
  if (shore > 0) {
    const wetStone = biome === 'peaks' || biome === 'volcano' || biome === 'cave';
    lerp3(out, wetStone ? TONE.wetRock : biome === 'marsh' ? TONE.dirtDark : pal.sand, shore);
  }

  // steep faces shed their cover; the rock itself carries ridge-scale
  // variation (gully shadows, warm strata) so far mountains read as stone
  const slopeRock = clamp01((slope - rockStart) * 2);
  if (slopeRock > 0) {
    lerp3(out, TONE.rock, slopeRock);
    const strata = fbm2(x * 0.06 + h * 0.05, z * 0.06, seed + 631, 3);
    if (strata < 0.45) {
      lerp3(out, TONE.rockCrevice, slopeRock * clamp01((0.45 - strata) * 3.2) * 0.8);
    } else if (strata > 0.55) {
      lerp3(out, TONE.rockWarm, slopeRock * clamp01((strata - 0.55) * 3.2) * 0.7);
    }
  }

  // high ground: rock, then a noise-broken snow ramp. The Drakelands'
  // volcanic cones never take snow (terrain.ts holds the same rule): their
  // high ground darkens toward bare basalt instead.
  if (biome === 'ember') {
    if (h > 20) lerp3(out, TONE.emberBasalt, clamp01((h - 20) / 8) * 0.8);
  } else {
    if (h > 22) lerp3(out, TONE.rock, clamp01((h - 22) / 10) * 0.6);
    const snowPatch = fbm2(x * 0.05, z * 0.05, seed + 61, 2);
    const snow = clamp01((h - 34 + (snowPatch - 0.5) * 14) / 26) * 0.85;
    if (snow > 0) lerp3(out, TONE.snowCap, snow);
  }

  // the Frostveil's blanket: snow down to the shore wherever frost blends in
  const frostW = biomeWeightAt('frost', x, z);
  if (frostW > 0) {
    const blanket = clamp01((h - (WATER_LEVEL + 1.2)) / 3) * frostW;
    lerp3(out, TONE.snowCap, blanket * 0.8);
  }

  // Aerial tint on the high rim: with the fog gone, the old near-solid
  // hazyPeak wash read as flat pale cones. The rim now keeps its real rock
  // and snow and takes only a light cool shift that strengthens with
  // ALTITUDE (tall silhouettes recede, valleys stay grounded), so distance
  // reads through color without erasing the mountain.
  const edge = Math.max(
    Math.abs(x) - (WORLD_MAX_X - 70),
    WORLD_MIN_Z + 70 - z,
    z - (WORLD_MAX_Z - 70),
  );
  const rim = clamp01(edge / 64);
  if (rim > 0) {
    const alt = clamp01((h - 12) / 30);
    lerp3(out, TONE.hazyPeak, rim * (0.18 + alt * 0.3));
  }
}

// ---------------------------------------------------------------------------
// Incremental tile builder: samples the padded height grid row by row so the
// painter can spread a whole-world build across idle slots, then emits flat
// typed arrays the painter wraps into a BufferGeometry unchanged. Each
// vertex costs five terrainHeight taps (farVertexHeight's crest max); the
// whole world is still well under a second, spread across idle slots.
// ---------------------------------------------------------------------------

// Triangle indices are NOT part of the tile data: every tile of one
// spacing shares the same topology, so callers build one farGridIndices
// buffer and reuse it across tiles.
export interface FarTileData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  minY: number;
  maxY: number;
}

export interface FarTileBuilder {
  /** Advance up to `rows` grid rows of work; true once the tile is complete. */
  step(rows: number): boolean;
  /** The finished tile. Throws if called before step() returned true. */
  result(): FarTileData;
}

/**
 * One far-mesh vertex height: the MAX of the point and its four half-spacing
 * neighbours. A plain point sample shaves every ridge crest by its chord
 * error (the sealed walls rise tens of units inside one cell), and with the
 * outdoor fog gone that shaving SHOWS: trees legitimately hidden behind a
 * crest poke into the sky gap where the true silhouette should be. The max
 * bias keeps silhouettes conservative (never lower than the terrain within
 * half a cell), which also offsets FAR_MESH_DROP on steep ground; valleys
 * only gain the slope's half-cell rise. The sprite shortfall
 * (foliage_impostor.ts) bilinears over the same function so sprites stay
 * planted on the exact surface the tiles build.
 */
/** How far outside the zone-rect world a point sits (0 inside). */
function outsideWorldBy(x: number, z: number): number {
  return Math.max(0, x - WORLD_MAX_X, WORLD_MIN_X - x, z - WORLD_MAX_Z, WORLD_MIN_Z - z);
}

/** Seabed the beyond-rim band settles to (under WATER_LEVEL, gentle). */
const BEYOND_RIM_SEABED = WATER_LEVEL - 6;

export function farVertexHeight(x: number, z: number, spacing: number, seed: number): number {
  // Beyond the world rect the heightfield is unauthored procedural noise:
  // under the old fog it was never seen, but fog-free it reads as random
  // cone hills standing offshore. The margin band exists to seat the rim
  // mountains' far side and the sea apron, so past the rim it settles to
  // open seabed over a short falloff and the horizon meets clean water.
  const outside = outsideWorldBy(x, z);
  if (outside >= 90) return BEYOND_RIM_SEABED;
  const h = spacing / 2;
  let y = terrainHeight(x, z, seed);
  y = Math.max(y, terrainHeight(x + h, z, seed));
  y = Math.max(y, terrainHeight(x - h, z, seed));
  y = Math.max(y, terrainHeight(x, z + h, seed));
  y = Math.max(y, terrainHeight(x, z - h, seed));
  if (outside > 0) {
    const t = outside / 90;
    const fall = t * t * (3 - 2 * t);
    y = y * (1 - fall) + BEYOND_RIM_SEABED * fall;
  }
  // High ground gets a build-time crag: the coarse grid renders peaks as
  // smooth cones, and with the fog gone that smoothness reads from across
  // the world. A couple of ridge-scale fbm octaves break the profile into
  // rock. Zero at valley height, so meadows and coasts keep the exact
  // heightfield, and included HERE so the sprite shortfall
  // (foliage_impostor.ts) and the tiles keep agreeing on one surface.
  const crag = Math.min(1, Math.max(0, (y - 16) / 14));
  if (crag > 0) {
    const ridge = fbm2(x * 0.045, z * 0.045, seed + 977, 3) - 0.5;
    const fine = fbm2(x * 0.13, z * 0.13, seed + 991, 2) - 0.5;
    y += crag * (ridge * 7 + fine * 2.5);
  }
  return y;
}

/**
 * How far the coarse far-tile surface sits BELOW a base height at (x, z):
 * the safety drop plus the crest chord error of the tier's sampling grid,
 * bilinearly reconstructed the way the far mesh itself samples. Sprites
 * past the detail envelope ease down by this much so their bases stay
 * planted on the vista instead of floating over shaved ridge crests.
 *
 * A sampler is a SESSION object: its corner cache is keyed by grid corner
 * only because seed, spacing and the grid origin are fixed at creation, so
 * a world rebuild or tier change mints a new sampler and can never reuse
 * the previous world's surface (the module-level-cache staleness class).
 */
export interface FarShortfallSampler {
  shortfall(x: number, z: number, baseY: number): number;
}

export function createFarShortfallSampler(
  seed: number,
  spacing: number,
  originX: number,
  originZ: number,
): FarShortfallSampler {
  const corners = new Map<string, number>();
  const corner = (x: number, z: number): number => {
    const key = `${x}:${z}`;
    const cached = corners.get(key);
    if (cached !== undefined) return cached;
    const y = farVertexHeight(x, z, spacing, seed);
    corners.set(key, y);
    return y;
  };
  return {
    shortfall(x, z, baseY) {
      const x0 = originX + Math.floor((x - originX) / spacing) * spacing;
      const z0 = originZ + Math.floor((z - originZ) / spacing) * spacing;
      const tx = (x - x0) / spacing;
      const tz = (z - z0) / spacing;
      const h00 = corner(x0, z0);
      const h10 = corner(x0 + spacing, z0);
      const h01 = corner(x0, z0 + spacing);
      const h11 = corner(x0 + spacing, z0 + spacing);
      const farY = (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
      return Math.max(0, baseY - (farY - FAR_MESH_DROP));
    },
  };
}

/**
 * Advance an incremental builder inside one cooperative slice: repeat single
 * steps until the work completes or the caller's clock passes `budgetMs`.
 * At least one step ALWAYS runs, whatever the budget or clock reports, so a
 * saturated host still makes forward progress. This is the law that retired
 * the production vista stall: the old row-count slices only ran when the
 * browser granted idle time, and a boot busy with asset arrival, decode and
 * compile grants none, so the far grid took its timeout ceiling times its
 * slice count (tens of seconds of fogged horizon) while the same build
 * finished in a blink on an idle dev machine. Progress per slice is now a
 * bounded TIME bite that never depends on the host's idle policy.
 * Returns true once the builder reports complete.
 */
export function advanceWithinBudget(
  step: () => boolean,
  budgetMs: number,
  now: () => number,
): boolean {
  const start = now();
  for (;;) {
    if (step()) return true;
    if (now() - start >= budgetMs) return false;
  }
}

export function createFarTileBuilder(tile: FarTile, spacing: number, seed: number): FarTileBuilder {
  const side = farGridSide(tile.size, spacing);
  const padded = side + 2;
  const heights = new Float32Array(padded * padded);
  const positions = new Float32Array(side * side * 3);
  const normals = new Float32Array(side * side * 3);
  const colors = new Float32Array(side * side * 3);
  let minY = Infinity;
  let maxY = -Infinity;
  let heightRow = 0;
  let vertexRow = 0;
  const color: Triple = [0, 0, 0];

  const sampleHeightRow = (): void => {
    const z = tile.z0 + (heightRow - 1) * spacing;
    for (let ix = 0; ix < padded; ix++) {
      heights[heightRow * padded + ix] = farVertexHeight(
        tile.x0 + (ix - 1) * spacing,
        z,
        spacing,
        seed,
      );
    }
    heightRow++;
  };

  const emitVertexRow = (): void => {
    const iz = vertexRow;
    const z = tile.z0 + iz * spacing;
    const hRow = (iz + 1) * padded;
    for (let ix = 0; ix < side; ix++) {
      const x = tile.x0 + ix * spacing;
      const hi = hRow + ix + 1;
      const h = heights[hi];
      const hx = heights[hi + 1] - heights[hi - 1];
      const hz = heights[hi + padded] - heights[hi - padded];
      const slope = Math.sqrt(hx * hx + hz * hz) / (2 * spacing);
      const invLen = 1 / Math.hypot(hx / (2 * spacing), 1, hz / (2 * spacing));
      const vi = (iz * side + ix) * 3;
      const y = h - FAR_MESH_DROP;
      positions[vi] = x;
      positions[vi + 1] = y;
      positions[vi + 2] = z;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      normals[vi] = -(hx / (2 * spacing)) * invLen;
      normals[vi + 1] = invLen;
      normals[vi + 2] = -(hz / (2 * spacing)) * invLen;
      farGroundColor(x, z, h, slope, seed, color);
      colors[vi] = color[0];
      colors[vi + 1] = color[1];
      colors[vi + 2] = color[2];
    }
    vertexRow++;
  };

  return {
    step(rows: number): boolean {
      let budget = rows;
      while (budget > 0 && heightRow < padded) {
        sampleHeightRow();
        budget--;
      }
      while (budget > 0 && heightRow >= padded && vertexRow < side) {
        emitVertexRow();
        budget--;
      }
      return heightRow >= padded && vertexRow >= side;
    },
    result(): FarTileData {
      if (heightRow < padded || vertexRow < side) {
        throw new Error('far tile builder not complete');
      }
      return { positions, normals, colors, minY, maxY };
    },
  };
}
