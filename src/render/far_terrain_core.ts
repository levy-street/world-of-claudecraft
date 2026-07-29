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
import {
  FAR_CELL_PROBES,
  farCellOvershoot,
  farRenderedCellHeight,
  farVertexClearance,
} from './far_surface_core';
import {
  makeShoreProbe,
  SHORE_BAND_HEIGHT,
  type ShoreProbe,
  shoreWaterGate,
} from './shore_water_gate_core';
import { meshTerrainHeight } from './terrain_mesh_height';
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

/**
 * How far the world rim's BAKED colour is pulled toward the atmospheric peak
 * tone: a flat part every rim vertex takes, plus an altitude-weighted part, so
 * tall silhouettes recede and rim valleys stay grounded (see the rim block in
 * farGroundColor). Named rather than inline because their SUM is the real
 * contract: this is paint that cannot respond to the sky, the hour or the
 * weather, and the live per-zone haze field now carries genuine aerial
 * perspective at the distances the rim sits at, so the baked half must stay a
 * hint. Was 0.18 plus 0.30, which double-painted the recession and left the rim
 * range reading as flat pale cones whatever the light was doing.
 */
export const FAR_RIM_TINT_BASE = 0.09;
export const FAR_RIM_TINT_ALT = 0.15;

/**
 * Surface detail for the coarse mesh: world yards per repeat of the shared rock
 * detail texture, how hard it tilts the shading normal, and how much it varies
 * the albedo.
 *
 * This is the through-line of every "the distant terrain looks smoothed" report,
 * and the one that no horizon distance can fix. The near terrain is a photo
 * splat with a macro normal; the vista tiles carry ONE flat baked colour per
 * vertex and nothing else, so the two do not look like the same material at any
 * range. On a single mountain that straddles the detail horizon the near half
 * comes out as textured rock and the far half as a smooth shell, and the line
 * between them reads exactly like a skin laid over the real shape. Moving the
 * horizon only moves that line.
 *
 * Sampled TRIPLANAR-free, by world xz alone: the tiles have no uv attribute and
 * do not need one, and a single up-projection is right for a layer whose faces
 * are read from hundreds of yards away (a cliff samples stretched, which is
 * invisible at that range). The mip chain averages it back toward flat as
 * distance grows, which is what should happen.
 *
 * 12 yards per repeat puts the grain at the scale of real rock bedding rather
 * than noise; the normal tilt does most of the work (shading break-up is what
 * separates rock from plastic) and the albedo grain is deliberately gentle, so
 * the recipe's zone colours still read as themselves.
 */
export const FAR_DETAIL_YARDS = 12;
export const FAR_DETAIL_NORMAL = 0.55;
export const FAR_DETAIL_GRAIN = 0.18;

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
 * atmosphere never does that. The band starts past every gameplay distance
 * (nothing a player interacts with is ever hazed) and saturates beyond the
 * world, so distant water, the rim silhouettes and the sky dome's
 * fog-colored horizon band all converge on one realm-tinted atmosphere right
 * where sea meets sky. Fractions of the tier envelope so medium's shorter
 * world melts proportionally.
 *
 * The band sits well inside the envelope rather than hugging the rim: parked
 * at the old 0.62 to 1.6 it only ever softened the last sliver of world, so
 * ridges and sprite towns two thirds of the way out stayed as crisp as the
 * ground underfoot and the vista read flat, with no aerial perspective to
 * separate the far ranges from the near ones. Starting at 0.42 gives real
 * depth cueing across the outer half of the view while leaving a wide clear
 * margin over the detail horizon (FOGLESS_DETAIL_FAR): the closest the haze
 * ever begins is medium's 924 units, still a third again past the 700 unit
 * horizon where every detail subsystem stops drawing, so no mid-range
 * content is ever repainted by it (which is what the day/night fog grade
 * would otherwise flatten at dawn).
 */
export function horizonHazePlan(envelopeFar: number): { near: number; far: number } {
  return { near: envelopeFar * 0.42, far: envelopeFar * 1.35 };
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
    // Deliberately the SAME grid high runs, not a finer one. This layer only
    // ever draws past FAR_DISCARD_MARGIN inside the detail horizon, so its
    // NEAREST fragment sits about 640 yards out, and from there the grid only
    // gets smaller on screen: at 640 yards a 10 yard cell spans about 13
    // screen pixels at 720p against a 12 yard cell's 15, and past a kilometre
    // both are single digits. What the finer grid buys is a slightly truer
    // ridge crest on the handful of cells that straddle one; what it costs is
    // 44 percent more vista triangles in every frame and 44 percent more
    // terrainHeight sampling in the boot build, which competes with
    // near-terrain streaming for the same idle slots. High has shipped the 12
    // yard grid all along. insane keeps the 8 yard grid for the same reason it
    // keeps everything else: it exists to be measured against.
    return { enabled: true, spacing: 12, envelopeFar: 3200, cameraFar: 3600 };
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

/**
 * How many far-mesh cells of change a colour ramp is widened to span. One
 * cell on each side of the midpoint is the least that leaves a whole
 * interpolated triangle inside the transition instead of straddling it.
 */
const RAMP_CELL_SPAN = 2;

/**
 * A colour ramp over `v`, widened by how far `v` itself moves across ONE
 * far-mesh cell. Every threshold in the recipe below runs through this, keyed
 * on whichever quantity it tests: the height ramps widen by the height a
 * vertex climbs per cell, the slope ramp by the slope it gains per cell.
 *
 * This is the whole fix for the faceted mountainside. The near terrain sizes
 * its ramps against its OWN step: the 26 unit snow ramp in
 * terrain_chunk_build.ts is deliberately wide because that heightfield
 * terraces 6 units at a time, and a ramp comparable to the step paints
 * alternate treads fully white and fully bare. The far mesh re-reads those
 * same thresholds but samples on an 8 to 16 unit grid, where a mountainside
 * climbs 25 units between NEIGHBOURING vertices. The 26 unit ramp then
 * resolves inside a single cell: one vertex takes full pale snow while its
 * neighbour takes bare rock, and interpolated across the two triangles they
 * share, that is the pale-against-black sawtooth a coarse mountainside shows
 * at range. The slope ramp aliases the same way and for the same reason (a
 * two-cell central difference on a cliff scatters by more than the 0.5 the
 * rock threshold spans), which is what streaked the snowbound realms with
 * dark rock facets.
 *
 * Widening about the ramp's MIDPOINT is what keeps this honest. A vertex on
 * ground the mesh CAN resolve has no per-cell change and keeps the shipped
 * colour exactly; ground it cannot resolve spreads the same transition over
 * the cells it needs, without moving the snow line or the rock line up or
 * down. It is the CPU-side twin of widening a shader threshold by its own
 * screen-space derivative, and like that, it converges on the shipped recipe
 * as the mesh gets finer.
 */
function softRamp(v: number, lo: number, hi: number, cellChange: number): number {
  const half = (hi - lo) / 2 + cellChange * RAMP_CELL_SPAN;
  const mid = (lo + hi) / 2;
  return clamp01((v - mid) / (2 * half) + 0.5);
}

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
 * `cellRise` and `cellSlopeRise` are how much the height and the slope change
 * across ONE cell of that grid: they are what every threshold below widens
 * against, so the recipe never paints a transition the mesh is too coarse to
 * resolve (see softRamp). Both are zero for a caller sampling a surface it
 * resolves fully, which reproduces the thresholds verbatim.
 *
 * Returns the vertex's GRASS PAINT weight for the meadow-continuum ground
 * texture: 1 where the colour above is meadow, feathering to 0 through the
 * same mixes that remove the meadow from the colour (shore, rock, snow,
 * scorch, rim). The near terrain's splat grass weight is the same idea
 * (sampleVertex's lerpSplat calls); keeping the two recipes side by side is
 * what keeps the painted grass gate from drifting between the tiers.
 */
// One shore-band probe per seed, reused across far tiles (the near tier keeps
// the same pair): its memo is what keeps the ring sampling affordable. Reset
// on a seed change because the memo is keyed on position alone.
let shoreProbeSeed = Number.NaN;
let shoreProbe = makeShoreProbe(() => 0);
function shoreProbeFor(seed: number): ShoreProbe {
  if (seed !== shoreProbeSeed) {
    shoreProbeSeed = seed;
    shoreProbe = makeShoreProbe((x, z) => terrainHeight(x, z, seed));
  }
  return shoreProbe;
}

export function farGroundColor(
  x: number,
  z: number,
  h: number,
  slope: number,
  cellRise: number,
  cellSlopeRise: number,
  seed: number,
  out: Triple,
): number {
  const pal = farPaletteAt(x, z);
  const biome = zoneBiomeAt(x, z);
  let grassW = 1;

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
    // the volcanic belt sheds its meadow (near tier: the sand/scorch splat)
    grassW *= 1 - clamp01((z - 1925) / 145) * 0.75;
    grassW *= 1 - scorch * 0.5;
    grassW = grassW + (1 - grassW) * valley * 0.6;
  }

  // marsh mud: pull the ground toward dark wet earth where the marsh blends in
  const marshW = biomeWeightAt('marsh', x, z);
  if (marshW > 0) {
    lerp3(out, TONE.dirtDark, marshW * 0.45);
    grassW *= 1 - marshW * 0.45;
  }

  // far forest mass: clumped canopy paint over gentle, dry, low ground
  const shoreH = h - (WATER_LEVEL + SHORE_BAND_HEIGHT);
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

  // shoreline band: sand at the waterline (wet rock in the stone biomes).
  // The band is SHORE_BAND_HEIGHT units tall, well under one far cell on
  // anything but a flat strand, so widening it is what turns a dashed aliased
  // line of beach into a continuous coast that thins out as the shore
  // steepens. Gated on water actually being there by the same rule the near
  // splat terrain uses, so a dry inland dip at beach elevation reads as plain
  // ground at BOTH tiers instead of a pale coast on one of them.
  let shore = 1 - softRamp(h, WATER_LEVEL, WATER_LEVEL + SHORE_BAND_HEIGHT, cellRise);
  if (shore > 0) shore *= shoreWaterGate(x, z, h, WATER_LEVEL, shoreProbeFor(seed));
  if (shore > 0) {
    const wetStone = biome === 'peaks' || biome === 'volcano' || biome === 'cave';
    lerp3(out, wetStone ? TONE.wetRock : biome === 'marsh' ? TONE.dirtDark : pal.sand, shore);
    grassW *= 1 - shore;
  }

  // steep faces shed their cover; the rock itself carries ridge-scale
  // variation (gully shadows, warm strata) so far mountains read as stone.
  // Widened by the slope the surface gains per cell: at far spacing a cliff's
  // central-difference slope scatters by more than the 0.5 this ramp spans,
  // which cut dark rock facets into the snowbound realms' white hillsides.
  const slopeRock = softRamp(slope, rockStart, rockStart + 0.5, cellSlopeRise);
  if (slopeRock > 0) {
    grassW *= 1 - slopeRock;
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
    const basalt = softRamp(h, 20, 28, cellRise);
    if (basalt > 0) {
      lerp3(out, TONE.emberBasalt, basalt * 0.8);
      grassW *= 1 - basalt * 0.8;
    }
  } else {
    const highRock = softRamp(h, 22, 32, cellRise);
    if (highRock > 0) {
      lerp3(out, TONE.rock, highRock * 0.6);
      grassW *= 1 - highRock * 0.8;
      // the same 30yd stone-tone field the near vertex tint carries
      // (terrain_chunk_build.ts): whole high faces shift a shade lighter or
      // darker, so distant domes stop reading as one flat pour
      const tone = fbm2(x * 0.033, z * 0.033, seed + 87, 2);
      const f = 1 + (tone - 0.5) * 0.3 * highRock * 0.6;
      out[0] *= f;
      out[1] *= f;
      out[2] *= f;
    }
    // Snow is the pale end of the whole recipe, so it is the term that made
    // the coarse mountainside read as sawtooth facets: the patch noise shifts
    // the line per vertex, and on a steep face the 26 unit ramp is crossed
    // whole inside one cell. The widened ramp is what keeps a summit white
    // and its cliffs stone without a hard edge between them.
    const snowPatch = fbm2(x * 0.05, z * 0.05, seed + 61, 2);
    const snowShift = (snowPatch - 0.5) * 14;
    const snow = softRamp(h, 34 - snowShift, 60 - snowShift, cellRise) * 0.85;
    if (snow > 0) {
      lerp3(out, TONE.snowCap, snow);
      grassW *= 1 - snow;
    }
  }

  // the Frostveil's blanket: snow down to the shore wherever frost blends in
  const frostW = biomeWeightAt('frost', x, z);
  if (frostW > 0) {
    const blanket = softRamp(h, WATER_LEVEL + 1.2, WATER_LEVEL + 4.2, cellRise) * frostW;
    lerp3(out, TONE.snowCap, blanket * 0.8);
    grassW *= 1 - blanket;
  }

  // Aerial tint on the high rim: a BAKED hint of recession, and deliberately
  // only a hint now. This wash is a survivor of the fogged era, when nothing
  // else told the rim it was far away; the live per-zone haze field
  // (biome_haze_field_core.ts) now carries a real camera air column that
  // converges near its ceiling at exactly the kilometre-plus distances this
  // band sits at, so the two were painting the same recession twice and the
  // baked half is the one that cannot respond to the sky, the hour or the
  // weather. Halved, and still altitude-weighted (tall silhouettes recede,
  // valleys stay grounded), so the rim keeps its real rock and snow and the
  // atmosphere over it is the part that moves.
  const edge = Math.max(
    Math.abs(x) - (WORLD_MAX_X - 70),
    WORLD_MIN_Z + 70 - z,
    z - (WORLD_MAX_Z - 70),
  );
  const rim = clamp01(edge / 64);
  if (rim > 0) {
    const alt = softRamp(h, 12, 42, cellRise);
    lerp3(out, TONE.hazyPeak, rim * (FAR_RIM_TINT_BASE + alt * FAR_RIM_TINT_ALT));
    grassW *= 1 - rim * 0.85;
  }
  return grassW;
}

// ---------------------------------------------------------------------------
// Incremental tile builder: samples the padded height grid row by row so the
// painter can spread a whole-world build across idle slots, then emits flat
// typed arrays the painter wraps into a BufferGeometry unchanged. Each
// vertex costs one terrainHeight tap, plus FAR_CELL_PROBES taps per CELL for
// the clearance pass (far_surface_core.ts). The whole world is a few hundred
// milliseconds, spread across idle slots.
// ---------------------------------------------------------------------------

// Triangle indices are NOT part of the tile data: every tile of one
// spacing shares the same topology, so callers build one farGridIndices
// buffer and reuse it across tiles.
export interface FarTileData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /** Meadow-continuum grass paint weight per vertex (see farGroundColor). */
  grassW: Float32Array;
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
 * One far-mesh vertex height: the heightfield SAMPLED AT THE POINT, then carved
 * (never raised) on high ground. The direction of that bias is the whole
 * ballgame for this layer.
 *
 * THE INVARIANT: the coarse mesh must never rise above the real terrain it
 * stands in for. It is a stand-in, and the moment it sits higher anywhere the
 * two coexist it wins the depth test and surfaces THROUGH the detailed terrain:
 * a smooth, untextured, unshadowed skin over a real hillside, in a shape that
 * does not match it. That is what four rounds of "the distant terrain looks
 * smoothed, and it un-smooths when I walk closer" all were.
 *
 * This USED to be the MAX of the point and its four half-cell neighbours, on the
 * argument that a point sample shaves ridge crests by their chord error and a
 * shaved crest lets a tree that should be hidden behind it poke into the sky.
 * That had the priorities backwards. The shaving only shows where this layer IS
 * the terrain, past the detail envelope, and out there the trees are impostor
 * sprites whose own shortfall bilinears over THIS function
 * (foliage_impostor.ts), so they sink with the crest and keep their occlusion.
 * The overlap failure lands in the middle of the frame at gameplay range. A
 * silhouette a few units shy of true, kilometres away, is a rounding error; a
 * coarse skin surfacing through the mountain you are looking at is the bug.
 *
 * A MIN over the neighbourhood would guarantee the invariant even harder, and
 * was tried: it creases the sampled field into a V at every ridge line, and
 * those creases double the height step between neighbouring vertices, which the
 * colour recipe reads as a threshold crossing and paints as a hard band (caught
 * by the adjacent-vertex colour pin in tests/far_terrain_core). A point sample
 * keeps the field as smooth as the terrain is, puts every vertex exactly on the
 * surface, and leaves only the departure of the flat triangles BETWEEN those
 * samples, which far_surface_core.ts measures per cell and subtracts from the
 * position at build time.
 */
/** How far outside the zone-rect world a point sits (0 inside). */
function outsideWorldBy(x: number, z: number): number {
  return Math.max(0, x - WORLD_MAX_X, WORLD_MIN_X - x, z - WORLD_MAX_Z, WORLD_MIN_Z - z);
}

/** Seabed the beyond-rim band settles to (under WATER_LEVEL, gentle). */
const BEYOND_RIM_SEABED = WATER_LEVEL - 6;

export function farVertexHeight(x: number, z: number, _spacing: number, seed: number): number {
  // Beyond the world rect the heightfield is unauthored procedural noise:
  // under the old fog it was never seen, but fog-free it reads as random
  // cone hills standing offshore. The margin band exists to seat the rim
  // mountains' far side and the sea apron, so past the rim it settles to
  // open seabed over a short falloff and the horizon meets clean water.
  const outside = outsideWorldBy(x, z);
  if (outside >= 90) return BEYOND_RIM_SEABED;
  let y = terrainHeight(x, z, seed);
  if (outside > 0) {
    const t = outside / 90;
    const fall = t * t * (3 - 2 * t);
    y = y * (1 - fall) + BEYOND_RIM_SEABED * fall;
    // OPEN COASTS stay open: where the world-edge terrain itself is under
    // the waterline, the unauthored noise outside it must never blend in as
    // land standing offshore (measured live: a 38 yard noise plateau held a
    // dark slab 3.5 yards above the sea on the west horizon). Rim mountains
    // keep their far side: their edge sample is high, so no cap applies.
    const edgeY = terrainHeight(
      Math.min(WORLD_MAX_X, Math.max(WORLD_MIN_X, x)),
      Math.min(WORLD_MAX_Z, Math.max(WORLD_MIN_Z, z)),
      seed,
    );
    if (edgeY < WATER_LEVEL) y = Math.min(y, WATER_LEVEL - 1.5);
  }
  // High ground gets a build-time crag: the coarse grid renders peaks as
  // smooth cones, and with the fog gone that smoothness reads from across
  // the world. A couple of ridge-scale fbm octaves break the profile into
  // rock. Zero at valley height, so meadows and coasts keep the exact
  // heightfield, and included HERE so the sprite shortfall
  // (foliage_impostor.ts) and the tiles keep agreeing on one surface.
  //
  // It CARVES ONLY. A signed displacement here used to lift high ground by up
  // to 4.75 units, which broke the guarantee above for the sake of a shape the
  // player cannot measure anyway: nobody can tell whether a distant ridge was
  // roughened by adding rock or by cutting gullies into it, but they can
  // absolutely tell when the coarse layer surfaces through the real one.
  // Shifted, not folded: fbm2 lands in [0, 1], so subtracting 1 gives a
  // strictly non-positive offset with the SAME smooth gradient the signed
  // version had. Taking an absolute value would also carve only downward, but
  // it creases the field wherever the noise crosses its midpoint, and those
  // creases double the height step between neighbouring vertices, which the
  // colour recipe reads as a threshold crossing and paints as a hard band.
  const crag = Math.min(1, Math.max(0, (y - 16) / 14));
  if (crag > 0) {
    const ridge = fbm2(x * 0.045, z * 0.045, seed + 977, 3) - 1;
    const fine = fbm2(x * 0.13, z * 0.13, seed + 991, 2) - 1;
    y += crag * (ridge * 3.5 + fine * 1.25);
  }
  return y;
}

/**
 * The final rendered Y of ONE far-mesh grid corner: the sampled height, less the
 * anti-poke drop, less the per-vertex clearance (far_surface_core.ts).
 *
 * This is the standalone twin of what createFarTileBuilder writes into its
 * position buffer. The builder keeps its own fast path, because it already holds
 * a padded height grid and a cell-overshoot grid and would otherwise resample
 * every shared corner four times over; this exists for callers that need ONE
 * corner and have no grid, principally the foliage impostor's shortfall (a
 * sprite must sit on the surface the tiles actually build, or it floats over the
 * vista or sinks into it). `tests/far_surface_core` pins the two against each
 * other, which is what keeps the fast path honest.
 */
/**
 * What one cell-overshoot row costs relative to one height row, in the
 * incremental builder's budget units. A height row samples one height per
 * vertex; a cell row probes FAR_CELL_PROBES heights per cell, so it is that much
 * heavier and must be charged as such or every slice overruns its millisecond
 * budget (see FAR_BUILD_ROWS_PER_SLICE in far_terrain.ts).
 */
export const CELL_ROW_BUDGET_WEIGHT = FAR_CELL_PROBES.length;

export function farVertexRenderY(x: number, z: number, spacing: number, seed: number): number {
  const sample = (sx: number, sz: number): number => meshTerrainHeight(sx, sz, seed);
  // The four cells share a 3x3 block of corners, so resolve those NINE heights
  // once instead of the sixteen a naive per-cell walk would take. This runs per
  // sprite corner inside the zone prepare, which is a latency-sensitive lane
  // (the escalation path puts it on macrotasks beside the frame loop), not the
  // deferential idle lane the tile build uses.
  const corner: number[] = [];
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      corner.push(farVertexHeight(x + i * spacing, z + j * spacing, spacing, seed));
    }
  }
  const at = (i: number, j: number): number => corner[(j + 1) * 3 + (i + 1)];
  let clearance = 0;
  // The four cells this corner belongs to, in the same orientation the builder
  // reads them (low corner at the cell origin).
  for (const [dx, dz] of [
    [-1, -1],
    [0, -1],
    [-1, 0],
    [0, 0],
  ] as const) {
    const over = farCellOvershoot(
      at(dx, dz),
      at(dx + 1, dz),
      at(dx, dz + 1),
      at(dx + 1, dz + 1),
      x + dx * spacing,
      z + dz * spacing,
      spacing,
      sample,
    );
    if (over > clearance) clearance = over;
  }
  return at(0, 0) - FAR_MESH_DROP - clearance;
}

/**
 * How far the coarse far-tile surface sits BELOW a base height at (x, z).
 * Sprites past the detail envelope ease down by this much so their bases stay
 * planted on the vista instead of floating over it.
 *
 * Reconstructed the way the far mesh is actually TRIANGULATED (the anti-diagonal
 * split farGridIndices emits) over farVertexRenderY corners, so this reports the
 * exact surface the tile builder writes: bilinear and the real triangulation
 * disagree on a saddle, and a saddle is exactly a ridge shoulder where sprites
 * stand.
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
    const y = farVertexRenderY(x, z, spacing, seed);
    corners.set(key, y);
    return y;
  };
  return {
    shortfall(x, z, baseY) {
      const x0 = originX + Math.floor((x - originX) / spacing) * spacing;
      const z0 = originZ + Math.floor((z - originZ) / spacing) * spacing;
      const tx = (x - x0) / spacing;
      const tz = (z - z0) / spacing;
      const farY = farRenderedCellHeight(
        corner(x0, z0),
        corner(x0 + spacing, z0),
        corner(x0, z0 + spacing),
        corner(x0 + spacing, z0 + spacing),
        tx,
        tz,
      );
      // farVertexRenderY already carries FAR_MESH_DROP and the clearance, so the
      // surface here is the finished one: no second drop to subtract.
      return Math.max(0, baseY - farY);
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
  // Rendered-surface overshoot per CELL, over the same padded lattice: cell
  // (i, j) is the one whose low corner is padded vertex (i, j), so the cells a
  // vertex owns are simply the four around its own padded index. Computed once
  // after the heights land and read by every vertex that touches it, which is
  // what keeps this to three terrainHeight taps per cell rather than per corner.
  const cellOver = new Float32Array(padded * padded);
  let cellRowDone = 0;
  // The cell grid has one fewer row than the padded vertex lattice: a cell is
  // spanned BY two vertex rows. Named because the predicate is read in three
  // places and an off-by-one here silently emits vertices before their cells.
  const cellsDone = (): boolean => cellRowDone + 1 >= padded;
  const positions = new Float32Array(side * side * 3);
  const normals = new Float32Array(side * side * 3);
  const colors = new Float32Array(side * side * 3);
  const grassW = new Float32Array(side * side);
  let minY = Infinity;
  let maxY = -Infinity;
  let heightRow = 0;
  let vertexRow = 0;
  const color: Triple = [0, 0, 0];
  // Compared against the height the NEAR mesh draws, not the raw sim height:
  // terrain_mesh_height subtracts the castle ward terrace that terrainHeight
  // keeps, and that terrace is exactly a place the coarse layer could poke
  // through drawn ground while a raw comparison called it innocent.
  const meshSample = (sx: number, sz: number): number => meshTerrainHeight(sx, sz, seed);

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

  // One row of cell overshoots. Runs after the whole padded height grid is
  // sampled and before any vertex row is emitted, so every cell a vertex needs
  // is already resolved.
  const cellOvershootRow = (): void => {
    const j = cellRowDone;
    for (let i = 0; i + 1 < padded; i++) {
      const x0 = tile.x0 + (i - 1) * spacing;
      const z0 = tile.z0 + (j - 1) * spacing;
      cellOver[j * padded + i] = farCellOvershoot(
        heights[j * padded + i],
        heights[j * padded + i + 1],
        heights[(j + 1) * padded + i],
        heights[(j + 1) * padded + i + 1],
        x0,
        z0,
        spacing,
        meshSample,
      );
    }
    cellRowDone++;
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
      // What the colour recipe cannot resolve at this spacing: the height the
      // surface climbs across one cell (first difference) and the slope it
      // gains across one cell (second difference, which is the curvature
      // times the cell). Both come out of the padded row the builder already
      // sampled, so widening every threshold against them costs no extra
      // terrainHeight taps. See softRamp.
      const cellRise = slope * spacing;
      const hxx = heights[hi + 1] - 2 * h + heights[hi - 1];
      const hzz = heights[hi + padded] - 2 * h + heights[hi - padded];
      const cellSlopeRise = Math.hypot(hxx, hzz) / spacing;
      const vi = (iz * side + ix) * 3;
      // The clearance drops the POSITION only. `h` below still carries the true
      // sampled height into farGroundColor, so the colour, the grass gate and
      // the haze are byte-identical to an unclearanced build: this moves the
      // surface, never the paint on it.
      const pi = (iz + 1) * padded + ix + 1;
      const clearance = farVertexClearance(
        cellOver[pi - padded - 1],
        cellOver[pi - padded],
        cellOver[pi - 1],
        cellOver[pi],
      );
      const y = h - FAR_MESH_DROP - clearance;
      positions[vi] = x;
      positions[vi + 1] = y;
      positions[vi + 2] = z;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      normals[vi] = -(hx / (2 * spacing)) * invLen;
      normals[vi + 1] = invLen;
      normals[vi + 2] = -(hz / (2 * spacing)) * invLen;
      grassW[iz * side + ix] = farGroundColor(x, z, h, slope, cellRise, cellSlopeRise, seed, color);
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
      while (budget > 0 && heightRow >= padded && !cellsDone()) {
        cellOvershootRow();
        // A cell row probes seven heights per cell where a height row samples
        // one per vertex, so it is charged what it actually costs. Slices are
        // sized in milliseconds by the painter (FAR_BUILD_ROWS_PER_SLICE); a
        // phase that lies about its weight silently overruns them.
        budget -= CELL_ROW_BUDGET_WEIGHT;
      }
      while (budget > 0 && cellsDone() && vertexRow < side) {
        emitVertexRow();
        budget--;
      }
      return heightRow >= padded && cellsDone() && vertexRow >= side;
    },
    result(): FarTileData {
      if (heightRow < padded || !cellsDone() || vertexRow < side) {
        throw new Error('far tile builder not complete');
      }
      return { positions, normals, colors, grassW, minY, maxY };
    },
  };
}
