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

  // shoreline band: sand at the waterline (wet rock in the stone biomes).
  // The band is 1.6 units tall, well under one far cell on anything but a
  // flat strand, so widening it is what turns a dashed aliased line of beach
  // into a continuous coast that thins out as the shore steepens.
  const shore = 1 - softRamp(h, WATER_LEVEL, WATER_LEVEL + 1.6, cellRise);
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
    const alt = softRamp(h, 12, 42, cellRise);
    lerp3(out, TONE.hazyPeak, rim * (0.18 + alt * 0.3));
    grassW *= 1 - rim * 0.85;
  }
  return grassW;
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
  const crag = Math.min(1, Math.max(0, (y - 16) / 14));
  if (crag > 0) {
    const ridge = fbm2(x * 0.045, z * 0.045, seed + 977, 3) - 0.5;
    const fine = fbm2(x * 0.13, z * 0.13, seed + 991, 2) - 0.5;
    y += crag * (ridge * 7 + fine * 2.5);
  }
  return y;
}

export function createFarTileBuilder(tile: FarTile, spacing: number, seed: number): FarTileBuilder {
  const side = farGridSide(tile.size, spacing);
  const padded = side + 2;
  const heights = new Float32Array(padded * padded);
  const positions = new Float32Array(side * side * 3);
  const normals = new Float32Array(side * side * 3);
  const colors = new Float32Array(side * side * 3);
  const grassW = new Float32Array(side * side);
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
      const y = h - FAR_MESH_DROP;
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
      return { positions, normals, colors, grassW, minY, maxY };
    },
  };
}
