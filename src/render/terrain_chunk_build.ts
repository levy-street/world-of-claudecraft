// The terrain chunk generator's COMPUTE half: palette, per-vertex sampling, and
// the row-wise fills that write plain typed arrays.
//
// Split out of terrain.ts because none of it touches WebGL. It writes
// Float32Array / Uint16Array and nothing else, so it can run off the main
// thread; terrain.ts keeps finishChunkGeometry, which is the only part that
// needs Three's BufferGeometry, and every other WebGL-side concern.
//
// Why that matters: generating a zone's geometry costs 2 to 4 seconds of pure
// arithmetic, but the background lane stretches it to 60 to 105 (Frostveil
// measured terrainMs 3914 gating vs 85523 idle, the same geometry) purely to
// avoid stealing frame time. Off-thread that tax disappears, and the outdoor
// fog clamp stops waiting on it.
//
// STILL IMPORTS THREE, on purpose, and is therefore deliberately NOT named
// *_core: the vertex sampler does its colour work with THREE.Color over the
// palette below, and THREE.Color applies an sRGB to linear conversion under
// ColorManagement. Replacing it with plain float maths would reshade the whole
// world while changing nothing's shape, so that swap is a separate step guarded
// by tests/terrain_chunk_geometry.test.ts. Three's maths classes run fine in a
// worker meanwhile; they only cost bundle size.
//
// MOVED VERBATIM from terrain.ts. The geometry pin proves it byte for byte.

import * as THREE from 'three';
import { forgefatherIsleRockWeight } from '../sim/content/ember_coast';
import {
  COLUMN_ZONES,
  columnBlendAt,
  STRIP_ZONES,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_Z,
  ZONES,
} from '../sim/data';
import { fbm2 } from '../sim/rng';
import { cutBounds, cutsInRect, cutsSdfAt, inTerrainCut } from '../sim/terrain_cuts';
import type { TerrainCut } from '../sim/types';
import { roadDistance, waterLevel, zoneBiomeAt } from '../sim/world';
import { isBuiltinWorldActive } from '../sim/data';
import { impactCraterTerrainBlend, type ImpactCraterTerrainBlend } from './impact_terrain';
import { clamp01 } from './num_clamp';
import { makeShoreProbe, type ShoreProbe, shoreWaterGate } from './shore_water_gate_core';
import { buildCutClip, CUT_CELL_KEEP, type CutClipResult } from './terrain_cut_clip_core';
import { buildCutRim, type CutRimArrays } from './terrain_cut_rim_core';
import { meshTerrainHeight } from './terrain_mesh_height';
import { paintTintAt } from './terrain_paint_tint';
import { BIOME_PALETTE, ROCK_SLOPE_START, TERRAIN_TONES } from './terrain_palette';

const SKIRT_DROP = 0.3;
// Three-quad tiles keep a compact working set across both diagonal choices.
// The old full-row walk evicted one grid row before the next quad could reuse
// it on the 25-52-quad chunk widths.
const INDEX_TILE_QUADS = 3;
// Ground palette + rock slope thresholds live in terrain_palette.ts (plain
// data, no Three) so the far-vista mesh colors from the same source.

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
const grassC = new THREE.Color(),
  grassDarkC = new THREE.Color(),
  grassYellowC = new THREE.Color();
const dirtC = new THREE.Color(),
  sandC = new THREE.Color();
const dirtDarkC = new THREE.Color(TERRAIN_TONES.dirtDark);
const rockC = new THREE.Color(TERRAIN_TONES.rock);
const wetRockC = new THREE.Color(TERRAIN_TONES.wetRock); // dark wet-rock shoreline (peaks/volcano/cave)
const NO_IMPACT: ImpactCraterTerrainBlend = { ash: 0, scorch: 0, dirt: 0, rock: 0 };
const impactAshC = new THREE.Color(0x18110d);
const impactScorchC = new THREE.Color(0x2a160c);
const hazyPeakC = new THREE.Color(TERRAIN_TONES.hazyPeak); // world-rim mountains, atmospheric
const emberForestC = new THREE.Color(TERRAIN_TONES.emberForest); // the Drakelands' green gatewood
const emberScorchC = new THREE.Color(TERRAIN_TONES.emberScorch); // volcanic ground near the Drakemaw
const emberBasaltC = new THREE.Color(TERRAIN_TONES.emberBasalt); // the cones' dark volcanic rock
const cobbleC = new THREE.Color(TERRAIN_TONES.cobble); // the Amberfall's laid stone
const cobbleDarkC = new THREE.Color(0x6e6b66); // ...its mortar-shadow cells
const duskCliffC = new THREE.Color(0x544d58); // dark weathered sea-cliff stone
const duskStrataC = new THREE.Color(0x8d7d76); // pale strata bands in the face
const snowCapC = new THREE.Color(TERRAIN_TONES.snowCap);
const lowSunC = new THREE.Color(0xe7d9a5);
const lowShadeC = new THREE.Color(0x60745b);
// Paint-layer scratch (centre-tap bridge: see the paint block below).
const paintC = new THREE.Color();
const zonePalettes = ZONES.map((zn) => {
  const p = BIOME_PALETTE[zn.biome];
  return {
    grass: new THREE.Color(p.grass),
    grassDark: new THREE.Color(p.grassDark),
    grassYellow: new THREE.Color(p.grassYellow),
    dirt: new THREE.Color(p.dirt),
    sand: new THREE.Color(p.sand),
  };
});

function paletteAt(x: number, z: number): void {
  const stripPalette = (zn: (typeof ZONES)[number]) =>
    zonePalettes[ZONES.indexOf(zn)] ?? zonePalettes[0];
  grassC.copy(stripPalette(STRIP_ZONES[0]).grass);
  grassDarkC.copy(stripPalette(STRIP_ZONES[0]).grassDark);
  grassYellowC.copy(stripPalette(STRIP_ZONES[0]).grassYellow);
  dirtC.copy(stripPalette(STRIP_ZONES[0]).dirt);
  sandC.copy(stripPalette(STRIP_ZONES[0]).sand);
  for (let i = 0; i + 1 < STRIP_ZONES.length; i++) {
    const b = STRIP_ZONES[i].zMax;
    const t = clamp01((z - (b - 30)) / 65);
    const tt = t * t * (3 - 2 * t);
    if (tt <= 0) break;
    const next = stripPalette(STRIP_ZONES[i + 1]);
    grassC.lerp(next.grass, tt);
    grassDarkC.lerp(next.grassDark, tt);
    grassYellowC.lerp(next.grassYellow, tt);
    dirtC.lerp(next.dirt, tt);
    sandC.lerp(next.sand, tt);
  }
  for (const col of COLUMN_ZONES) {
    const t = columnBlendAt(col, x, z);
    if (t <= 0) continue;
    const p = stripPalette(col);
    grassC.lerp(p.grass, t);
    grassDarkC.lerp(p.grassDark, t);
    grassYellowC.lerp(p.grassYellow, t);
    dirtC.lerp(p.dirt, t);
    sandC.lerp(p.sand, t);
  }
}

// How "marsh" a given z is — mirrors the palette/heightfield blend windows so
// the mud texture fades in exactly where the marsh palette does.
function marshWeightAt(x: number, z: number): number {
  let w = STRIP_ZONES[0].biome === 'marsh' ? 1 : 0;
  for (let i = 0; i + 1 < STRIP_ZONES.length; i++) {
    const b = STRIP_ZONES[i].zMax;
    const t = clamp01((z - (b - 30)) / 65);
    const tt = t * t * (3 - 2 * t);
    if (tt <= 0) break;
    w += ((STRIP_ZONES[i + 1].biome === 'marsh' ? 1 : 0) - w) * tt;
  }
  for (const col of COLUMN_ZONES) {
    const t = columnBlendAt(col, x, z);
    if (t > 0) w += ((col.biome === 'marsh' ? 1 : 0) - w) * t;
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
// The grass colour the terrain itself would paint at (x, z): the zone-blended
// palette plus the same two fbm patch-noise layers the vertex tint uses.
// Foliage keys tuft and dressing tints off this so ground cover reads as
// growing out of the meadow instead of sitting on top of it (a flat biome
// constant left grass arithmetically decoupled from the ground under it).
export function groundGrassColorAt(
  x: number,
  z: number,
  seed: number,
  out: THREE.Color,
): THREE.Color {
  paletteAt(x, z);
  const v = groundLushnessAt(x, z, seed);
  out.copy(grassC).lerp(grassDarkC, v);
  const v2 = fbm2(x * 0.16, z * 0.16, seed + 59, 2);
  out.lerp(grassYellowC, v2 * 0.35);
  return out;
}

// The dark-patch weight of the grass palette (0 = yellowed open ground,
// 1 = deep lush green), exposed so grass PLACEMENT can follow the same
// noise the ground colour does: dense tall stands on the lush patches,
// thinning to bare ground between them.
export function groundLushnessAt(x: number, z: number, seed: number): number {
  return fbm2(x * 0.045, z * 0.045, seed + 53, 3);
}

// The height lattice a chunk's vertex samples share. The old sampler paid
// FIVE meshTerrainHeight taps per vertex (the vertex plus a four-tap
// central-difference stencil at a fixed 1.5yd epsilon); adjacent vertices
// never shared their stencil taps, so a chunk resampled the heightfield
// almost fivefold. The lattice computes each height ONCE on the vertex grid
// plus a one-cell margin ring, and normals difference the neighboring
// lattice heights instead (epsilon = the chunk's own vertex spacing): about
// 4.6x fewer heightfield evaluations per chunk, which is what pays for the
// natural-relief field being richer per sample.
function ensureHeightRow(state: ChunkGeometryBuildState, hcj: number): void {
  if (state.heightRowDone[hcj]) return;
  state.heightRowDone[hcj] = 1;
  const { nx, x0, z0, stepX, stepZ, seed } = state;
  const hw = nx + 3;
  const z = z0 + (hcj - 1) * stepZ;
  const rowStart = hcj * hw;
  for (let hci = 0; hci < hw; hci++) {
    state.heights[rowStart + hci] = meshTerrainHeight(x0 + (hci - 1) * stepX, z, seed);
  }
}

// One shore-band probe per seed, reused across chunk builds (the far tier
// keeps the same pair, far_terrain_core.ts): its memo is what keeps the ring
// sampling affordable. Reset on a seed change because the memo is keyed on
// position alone. The sampler is this tier's OWN meshTerrainHeight, not raw
// terrainHeight, so the gate probes the same surface the vertices sit on
// (castle-pad corrections included) and the two can never disagree.
let shoreProbeSeed = Number.NaN;
let shoreProbe = makeShoreProbe(() => 0);
function shoreProbeFor(seed: number): ShoreProbe {
  if (seed !== shoreProbeSeed) {
    shoreProbeSeed = seed;
    shoreProbe = makeShoreProbe((x, z) => meshTerrainHeight(x, z, seed));
  }
  return shoreProbe;
}

function sampleVertex(state: ChunkGeometryBuildState, ci: number, cj: number): VertexSample {
  const { nx, x0, z0, stepX, stepZ, seed, lowShade } = state;
  const x = x0 + ci * stepX;
  const z = z0 + cj * stepZ;
  const hw = nx + 3;
  ensureHeightRow(state, cj);
  ensureHeightRow(state, cj + 1);
  ensureHeightRow(state, cj + 2);
  const hAt = (i: number, j: number): number => state.heights[(j + 1) * hw + (i + 1)];
  const h = hAt(ci, cj);
  const hx = hAt(ci + 1, cj) - hAt(ci - 1, cj);
  const hz = hAt(ci, cj + 1) - hAt(ci, cj - 1);
  const slope = Math.hypot(hx / (2 * stepX), hz / (2 * stepZ));
  // Surface curvature from the shared lattice (the discrete Laplacian,
  // 1/yd): negative on convex breaks (ridge crests, cliff shoulders),
  // positive in concave folds (gullies, foot-slopes). Drives the
  // material-accumulation tinting below: exposed stone on convexity, pooled
  // soil in concavity, the standard curvature-texturing rule.
  const curv =
    (hAt(ci + 1, cj) + hAt(ci - 1, cj) + hAt(ci, cj + 1) + hAt(ci, cj - 1) - 4 * h) /
    (stepX * stepX);
  const invLen = 1 / Math.hypot(hx / (2 * stepX), 1, hz / (2 * stepZ));
  const normal: [number, number, number] = [
    -(hx / (2 * stepX)) * invLen,
    invLen,
    -(hz / (2 * stepZ)) * invLen,
  ];

  paletteAt(x, z);
  const biome = zoneBiomeAt(x, z);
  const w: [number, number, number, number] = [1, 0, 0, 0];
  // The Mirefen crater's scorch is a built-in-world landmark: an authored map
  // over its coordinates keeps clean ground (the worker's module copy of the
  // content is the shipped one, so this reads the same answer on every thread).
  const impact: ImpactCraterTerrainBlend = isBuiltinWorldActive()
    ? impactCraterTerrainBlend(x, z)
    : NO_IMPACT;

  // base grass with patchy variation: a coarse fbm layer for dry/lush
  // patches plus a fine one for grain, replacing the old pure-sine tint
  // (sine repeats on a visible grid at a distance; noise reads as natural
  // ground cover instead).
  const v = fbm2(x * 0.045, z * 0.045, seed + 53, 3);
  cTmp.copy(grassC).lerp(grassDarkC, v);
  const v2 = fbm2(x * 0.16, z * 0.16, seed + 59, 2);
  cTmp.lerp(grassYellowC, v2 * 0.35);
  // Dry bare patches: mid-frequency margins where the turf thins to earth,
  // so open country reads as worn, patchy ground instead of one unbroken
  // green sheet (noise-modulated splat rule; the groomed garden and the
  // snowbound frost keep their even cover).
  if (biome !== 'garden' && biome !== 'frost') {
    // two uncorrelated scales: broad worn regions (~80yd) carrying smaller
    // bare patches (~38yd), so the wear reads fractal instead of one dot size
    const dry =
      fbm2(x * 0.026, z * 0.026, seed + 83, 2) * 0.62 +
      fbm2(x * 0.012, z * 0.012, seed + 89, 2) * 0.38;
    const dryW = clamp01((dry - 0.58) * 3.2);
    if (dryW > 0) {
      cTmp.lerp(dirtC, dryW * 0.5);
      cTmp.lerp(grassYellowC, dryW * 0.35);
      lerpSplat(w, 1, dryW * 0.45);
    }
  }
  let isleRock = 0;
  if (biome === 'ember') {
    // the gatewood is green in the south near Wyrmwatch and dries into sand
    // northward; the volcanic belt then darkens toward scorched basalt
    const forest = 1 - clamp01((z - 1925) / 145);
    if (forest > 0) cTmp.lerp(emberForestC, forest * 0.85);
    const sandT = clamp01((z - 1925) / 145);
    lerpSplat(w, 3, sandT * 0.75);
    // the Wyrmroad: a sheltered green corridor along x 404 through the
    // volcanic belt toward the south crossing, the realm's second gradient
    const passT = 1 - clamp01((Math.abs(x - 404) - 26) / 26);
    const valley = passT * clamp01((z - 2310) / 80);
    const scorch = clamp01((z - 2260) / 100) * (1 - valley);
    if (scorch > 0) {
      cTmp.lerp(emberScorchC, scorch * 0.55);
      lerpSplat(w, 2, scorch * 0.5);
    }
    if (valley > 0) {
      cTmp.lerp(emberForestC, valley * 0.8);
      lerpSplat(w, 0, valley * 0.6);
    }
    // The Forgefather's Isle is bare volcanic rock, never sand (the shared
    // sim weight keeps the world, vista, and map tiers in agreement).
    isleRock = forgefatherIsleRockWeight(x, z);
    if (isleRock > 0) {
      cTmp.lerp(emberScorchC, isleRock * 0.75);
      cTmp.lerp(emberBasaltC, isleRock * 0.45);
      lerpSplat(w, 2, isleRock * 0.85);
    }
  }
  // the marsh reads muddier: patches of wet dirt across the lowland
  if (biome === 'marsh') lerpSplat(w, 1, 0.3 * v2 * clamp01((4 - h) / 6));
  // shoreline blend, biome-specific: marsh has no sandy beach (wet mud
  // instead), rocky/ashen biomes get a darker wet-rock tint, everywhere else
  // keeps the classic sandy bank. Color and splat weight share one feathered
  // falloff so the shore blends out instead of cutting a razor-hard edge.
  // The ACTIVE level, not the constant: this band IS the beach, so pinning it
  // to the built-in waterline painted sand where a custom map has no water and
  // left its real shoreline bare. The shipped world has no override, so
  // waterLevel() is WATER_LEVEL there and its ground is byte-identical.
  //
  // Gated on water actually being there by the same rule the far vista uses
  // (shore_water_gate_core), so a dry inland dip at beach elevation (the Wolf
  // Run basin) reads as plain ground instead of a pale coast.
  const wl = waterLevel();
  let shore = clamp01((wl + 1.6 - h) / 1.6);
  if (shore > 0) shore *= shoreWaterGate(x, z, h, wl, shoreProbeFor(seed));
  if (biome === 'marsh') {
    cTmp.lerp(dirtDarkC, shore);
    lerpSplat(w, 1, shore);
  } else if (biome === 'peaks' || biome === 'volcano' || biome === 'cave') {
    cTmp.lerp(wetRockC, shore);
    lerpSplat(w, 2, shore);
  } else {
    // the isle's strand is dark wet gravel, not gold sand: the shore blend
    // splits by the same rock weight so the ring fades with the feather
    const rockShore = shore * isleRock;
    const sandShore = shore - rockShore;
    if (sandShore > 0) {
      cTmp.lerp(sandC, sandShore);
      lerpSplat(w, 3, sandShore);
    }
    if (rockShore > 0) {
      cTmp.lerp(wetRockC, rockShore);
      lerpSplat(w, 2, rockShore);
    }
  }
  // New Eastbrook's strand (owner refinement): the vale's beach band reads as
  // full sand well above the wet lip, so the shore is unambiguous sand rather
  // than the base cover showing through. Fades out by ~2.2yd above the
  // waterline, under the quay pad's working grade.
  if (biome === 'vale') {
    let strand = clamp01((wl + 2.5 - h) / 1.3);
    if (strand > 0) strand *= shoreWaterGate(x, z, h, wl, shoreProbeFor(seed));
    if (strand > 0) {
      cTmp.lerp(sandC, Math.min(1, strand));
      lerpSplat(w, 3, Math.min(1, strand));
    }
  }
  // packed dirt at each hub settlement (same feather as the splat weight —
  // a constant lerp stamped a clean-edged brown disc on the grass)
  for (const zn of ZONES) {
    const dHub = Math.hypot(x - zn.hub.x, z - zn.hub.z);
    if (dHub < 14) {
      const hubT = clamp01((14 - dHub) / 3);
      if (zn.biome === 'amber') {
        // Lanternmere's plaza is paved like its roads
        const cell =
          (Math.sin(Math.floor(x * 1.6) * 12.9898 + Math.floor(z * 1.6) * 78.233) + 1) / 2;
        cTmp.lerp(cobbleC, 0.85 * hubT);
        cTmp.lerp(cobbleDarkC, cell * 0.45 * hubT);
        lerpSplat(w, 2, 0.75 * hubT);
      } else {
        cTmp.lerp(dirtDarkC, 0.7 * hubT);
        lerpSplat(w, 1, 0.75 * hubT);
      }
      break;
    }
  }
  const rd = roadDistance(x, z);
  // the Amberfall paves its ways: cobblestone, cell-jittered so the vertex
  // grid reads as laid stones rather than one grey ribbon (rock splat)
  const cobbles = biome === 'amber';
  if (rd < 2.0) {
    if (cobbles) {
      const cell = (Math.sin(Math.floor(x * 1.6) * 12.9898 + Math.floor(z * 1.6) * 78.233) + 1) / 2;
      cTmp.lerp(cobbleC, 0.9);
      cTmp.lerp(cobbleDarkC, cell * 0.5);
      lerpSplat(w, 2, 0.85);
    } else {
      cTmp.lerp(dirtC, 0.85);
      lerpSplat(w, 1, 0.85);
    }
  } else if (rd < 3.4) {
    const t = 0.85 * (1 - (rd - 2.0) / 1.4);
    cTmp.lerp(cobbles ? cobbleC : dirtC, t);
    lerpSplat(w, cobbles ? 2 : 1, t);
  }
  // Break up the rock/snow blend so cliffs read as striated stone and snow
  // reads as patchy drifts instead of a single flat tone / a clean cutoff.
  const rockStreak = fbm2(x * 0.09, z * 0.09, seed + 41, 3);
  const snowPatch = fbm2(x * 0.06, z * 0.06, seed + 47, 3);
  const rockStart = ROCK_SLOPE_START[biome];
  // Curvature accents (see curv above): a convex break sheds its cover to
  // exposed stone even before the slope threshold, and a concave fold pools
  // darker soil. Both are gated by real gradient so flat ground never
  // mottles, and both come BEFORE the slope-rock arm so a true cliff still
  // ends at full rock.
  const exposeW = clamp01(-curv * 0.85 - 0.1) * clamp01((slope - 0.3) * 2.2);
  if (exposeW > 0) {
    cTmp.lerp(rockC, Math.min(1, exposeW) * 0.55);
    lerpSplat(w, 2, Math.min(1, exposeW) * 0.5);
  }
  const poolW = clamp01(curv * 0.8 - 0.1) * clamp01((0.95 - slope) * 2) * (1 - shore);
  if (poolW > 0) {
    cTmp.lerp(dirtDarkC, Math.min(1, poolW) * 0.3);
    lerpSplat(w, 1, Math.min(1, poolW) * 0.3);
  }
  // Noise-dithered rock margin: the grass-to-stone boundary wanders with the
  // streak field instead of tracing one smooth slope contour, and the blend
  // is a touch sharper so the margin reads as a ragged edge, not a fade.
  const rockEdge = rockStart + (rockStreak - 0.5) * 0.5;
  let rockTintW = 0;
  if (slope > rockEdge) {
    const t = Math.min(1, (slope - rockEdge) * 2.6);
    rockTintW = t;
    cTmp.lerp(rockC, t);
    cTmp.lerp(dirtDarkC, t * (rockStreak - 0.5) * 0.5);
    lerpSplat(w, 2, t);
    // (the Great Maze's hedge walls are modeled props over flat lawn now:
    // no steep terrain faces remain inside the maze to restyle)
    // dusk sea cliffs read as dark weathered stone with pale strata bands, so
    // the coast walls look like rugged wave-cut rock instead of smooth clay
    if (biome === 'dusk') {
      const nearSea = clamp01((16 - h) / 12);
      const band = (Math.sin(h * 1.7 + x * 0.06 + z * 0.045) + 1) / 2;
      cTmp.lerp(duskCliffC, t * nearSea * (0.45 + band * 0.35));
      cTmp.lerp(duskStrataC, t * nearSea * (1 - band) * 0.3);
    } else {
      // every other realm's stone carries warm strata: height-keyed bands
      // wobbled by the streak noise, so cliff faces and crags read as
      // layered geology instead of one smooth pour
      const band = (Math.sin(h * 0.52 + (rockStreak - 0.5) * 5.2) + 1) * 0.5;
      cTmp.lerp(dirtDarkC, t * band * 0.3);
      cTmp.lerp(duskStrataC, t * (1 - band) * 0.18);
    }
  }
  // high ground (ridges, peaks) goes rocky then snowy (the Drakelands' high
  // rock reads as dark basalt instead, and its peaks never take snow). The snow
  // ramp is wide (26u, over four terrace bands) with a strong patch-noise term:
  // the terraced heightfield steps 6u at a time, and a ramp comparable to the
  // step paints alternate treads fully white / fully bare, which reads as a
  // repetitive checkerboard from a distance. The grid world terraces too, so it
  // keeps the release's wide ramp; only the snow LINE (h - 34) stays tuned to
  // the grid's own peak heights.
  let snow = 0;
  if (biome === 'ember') {
    const t2 = Math.max(
      slope > rockStart ? Math.min(1, (slope - rockStart) * 2) : 0,
      clamp01((h - 18) / 8) * 0.75,
    );
    if (t2 > 0) cTmp.lerp(emberBasaltC, t2 * 0.85);
  }
  if (biome === 'frost') {
    // the Reach is snowbound from the shore up, not just on its crowns; the
    // Snowline and the Goldmelt (the sideways crossings) both sit at z 1890
    // on opposite borders, so the green valley floors fade under the snow
    // toward the interior instead of flipping white at the borders
    const passT = 1 - clamp01((Math.abs(z - 1890) - 26) / 26);
    const green = passT * clamp01((Math.abs(x) - 95) / 85);
    const snowline = 1 - green;
    if (green > 0) cTmp.lerp(emberForestC, green * 0.8);
    // Same reason as the shore band: the snow starts just above the waterline,
    // so it has to be the ACTIVE one or a raised sea leaves a white skirt in it.
    const blanket = clamp01((h - (waterLevel() + 1.2)) / 3) * snowline;
    cTmp.lerp(snowCapC, 0.8 * blanket);
    snow = Math.max(snow, 0.85 * blanket);
  }
  // The high-rock altitude band's onset wanders with the streak noise (a
  // dithered elevation band, not a striped cutoff), and the stone above it
  // takes the same warm strata as the slope rock so summits read layered.
  const highH = 22 + (rockStreak - 0.5) * 7;
  if (h > highH) {
    const rockT = clamp01((h - highH) / 10) * (0.6 + rockStreak * 0.25);
    rockTintW = Math.max(rockTintW, rockT);
    cTmp.lerp(biome === 'ember' ? emberBasaltC : rockC, rockT);
    snow = biome === 'ember' ? 0 : clamp01((h - 34 + (snowPatch - 0.5) * 14) / 26) * 0.85;
    if (biome !== 'ember') {
      const band = (Math.sin(h * 0.52 + (rockStreak - 0.5) * 5.2) + 1) * 0.5;
      cTmp.lerp(dirtDarkC, rockT * (1 - snow) * band * 0.26);
      cTmp.lerp(duskStrataC, rockT * (1 - snow) * (1 - band) * 0.14);
    }
    cTmp.lerp(snowCapC, snow);
    lerpSplat(w, 2, clamp01((h - highH) / 10) * 0.8);
  }
  // A 30yd stone-tone field over every rock-tinted vertex: whole faces
  // shift a shade lighter or darker at a scale that survives any view
  // distance, so distant mountainsides read as varied stone masses instead
  // of one flat pour (fine texture mips away; this scale does not).
  if (rockTintW > 0.05) {
    const rockTone = fbm2(x * 0.033, z * 0.033, seed + 87, 2);
    cTmp.multiplyScalar(1 + (rockTone - 0.5) * 0.3 * Math.min(1, rockTintW) * (1 - snow));
  }
  if (impact.scorch > 0) {
    cTmp.lerp(impactScorchC, 0.88 * impact.scorch);
    cTmp.lerp(impactAshC, 0.58 * impact.ash);
    lerpSplat(w, 1, impact.dirt);
    lerpSplat(w, 2, impact.rock);
  }
  // the rim wall reads as distant sunlit peaks, not a black cliff. The haze
  // kicks in well before the wall itself (edge starts negative deep inland)
  // so from a zone's centre the rim reads as atmospheric haze rather than a
  // crisp silhouette, reinforcing the reduced BIOME_FOG draw distance.
  const edge = Math.max(
    Math.abs(x) - (WORLD_MAX_X - 70),
    WORLD_MIN_Z + 70 - z,
    z - (WORLD_MAX_Z - 70),
  );
  const rim = clamp01(edge / 64);
  if (rim > 0) {
    cTmp.lerp(hazyPeakC, rim * 0.95);
    // same wide, noise-broken ramp as the interior snow above: a pure
    // height threshold snowed every terrace tread above the line uniformly,
    // turning the rim's 2D terrace lattice into a white/grey checkerboard
    const rimSnow = clamp01((h - 21 + (snowPatch - 0.5) * 12) / 26) * rim * 0.8;
    cTmp.lerp(snowCapC, rimSnow);
    snow = Math.max(snow, rimSnow);
    lerpSplat(w, 2, rim * 0.85);
  }
  // Hill-scale tone drift: a very-low-frequency value swing so one region's
  // fields and faces sit a few percent lighter or darker than the next.
  // Applied over everything (grass, rock, snow alike) because real ground
  // varies at this scale regardless of material; the swing is small enough
  // to never read as a patch, only as regions that feel different.
  const toneDrift = fbm2(x * 0.008, z * 0.008, seed + 97, 2);
  cTmp.multiplyScalar(0.95 + toneDrift * 0.1);

  // The map's PAINT layer, last: an authored ground truth that beats every
  // natural rule above (dry patches, hub discs, even the snow line). Four
  // diagonal taps average the cell grid so a painted boundary feathers over
  // ~3 yards instead of pixelating at the paint cell size. Swatches resolve
  // to a tint + a splat layer + the shader's snow channel — see
  // terrain_paint_tint.ts for what this is (and is not) of the fork's full
  // custom-texture atlas.
  {
    // CENTRE tap only: a vertex takes the paint's tint/layer/snow ONLY when
    // its own position is inside a painted cell. The old four diagonal taps
    // at +-1.6yd smeared the shifted splat layer BEYOND the painted cells,
    // and once the fragment paint stopped exactly at the cell border the
    // smear showed uncovered: a pale rock ring traced around every rock-like
    // painted region ("painting the cliff around the edges of my texture").
    // Vertex interpolation into the unpainted neighbours still feathers the
    // shift across one triangle, and the fragment paint covers everything
    // inside the cells.
    const fx = paintTintAt(x, z);
    if (fx) {
      // A TEXTURED swatch is rendered by the fragment tile array, which now
      // covers its cells completely - shifting the vertex tint/splat toward
      // it here only bleeds one vertex ring PAST the painted cells (splat
      // weights interpolate across triangles), which showed as a rock rim
      // around rock-like paint. Colour-only swatches still need the vertex
      // path (it is their whole render), and Snow-family swatches ride the
      // dedicated snow channel either way.
      if (!fx.textured) {
        paintC.setRGB(fx.r, fx.g, fx.b);
        cTmp.lerp(paintC, Math.min(1, fx.strength));
        const pLayer = fx.layer;
        if (pLayer !== -1) lerpSplat(w, pLayer, Math.min(1, fx.strength));
      }
      if (fx.snow > 0) snow = Math.max(snow, fx.snow);
    }
  }

  // mud rides the dirt layer wherever the marsh palette is active
  const mud = marshWeightAt(x, z);
  if (lowShade) {
    const ridge = clamp01((slope - 0.22) * 1.6);
    const lowland = clamp01((wl + 7 - h) / 12);
    const upland = clamp01((h - 8) / 22);
    cTmp.lerp(lowShadeC, 0.07 * ridge + 0.05 * lowland * mud);
    cTmp.lerp(lowSunC, 0.035 * (1 - shore) + 0.045 * upland);
    cTmp.multiplyScalar(0.98 + upland * 0.04 - ridge * 0.025);
  }
  return {
    height: h,
    slope,
    normal,
    color: [cTmp.r, cTmp.g, cTmp.b],
    splat: w,
    extra: [mud, snow, impact.scorch, impact.ash],
  };
}

// ---------------------------------------------------------------------------
// Chunk geometry: interior (nx+1)x(nz+1) grid wrapped in a skirt ring whose
// vertices sit on the chunk border but 0.3u lower, hiding LOD cracks.
// ---------------------------------------------------------------------------

/**
 * The generator's whole output: plain typed arrays and nothing else. This is
 * the payload that crosses a worker boundary (every buffer is transferable),
 * and it is all finishChunkGeometry needs to build a BufferGeometry.
 */
export interface ChunkGeometryArrays {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  uvs: Float32Array;
  splats: Float32Array | null;
  extras: Float32Array | null;
  indices: Uint16Array;
  /** The skirt band around any boolean cut crossing this chunk, or null when
   *  none does (every map without cuts, and most chunks of a map with them).
   *  finishChunkGeometry welds it into the same BufferGeometry at rock splat
   *  weights, so it draws through the terrain material rather than needing a
   *  second mesh in the streaming lifecycle. */
  rim: CutRimArrays | null;
  /** The fine-clipped surface patch over the cells the cut contour crosses
   *  (attribute-complete: interpolated from the chunk's own vertices), welded
   *  beside the rim. Null when no contour crosses the chunk. */
  clip: CutClipAttrArrays | null;
}

/** The clipped boundary patch with the full vertex layout of the chunk it
 *  belongs to, ready to weld into the same BufferGeometry. */
export interface CutClipAttrArrays {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  uvs: Float32Array;
  splats: Float32Array | null;
  extras: Float32Array | null;
  indices: Uint32Array;
}

/**
 * The boolean cuts this chunk must honour, plus the patches that undo them.
 * Both arrays are the DOCUMENT's own (sim/ground_sheets.ts effectiveTerrainCuts
 * merges the maker's cuts with every self-carving cave's bore), so the quads
 * this mesher drops and the ground sheet sim movement resolves come from one
 * evaluator over one list. That is the whole contract: a cut the renderer
 * honours and the sim does not is an invisible wall.
 */
export interface ChunkCutSet {
  cuts: readonly TerrainCut[];
  patches?: readonly TerrainCut[];
}

// The rim and clip are produced AFTER the grid is filled (buildChunkCutFine
// reads the finished state), so they are not part of the build state itself.
export interface ChunkGeometryBuildState extends Omit<ChunkGeometryArrays, 'rim' | 'clip'> {
  nx: number;
  nz: number;
  gw: number;
  gh: number;
  x0: number;
  z0: number;
  stepX: number;
  stepZ: number;
  seed: number;
  skirtSpan: number;
  worldDepth: number;
  /** GFX.lowPlus && !GFX.terrainSplat, resolved by the CALLER: gfx.ts reads
   *  document/navigator, so a worker would resolve a different tier. */
  lowShade: boolean;
  /** Null on every map with no cuts, which is the fast path the shipped world
   *  and every unedited document take. */
  cutSet: ChunkCutSet | null;
  /** Lazy cache of the fine-clip classification + geometry (see ensureCutClip):
   *  undefined = not computed yet, null = computed and the cuts never open
   *  this chunk's surface. */
  cutClip?: {
    ci0: number;
    cj0: number;
    cw: number;
    ch: number;
    result: CutClipResult;
  } | null;
  sampleCache: Map<number, VertexSample>;
  /** The shared height lattice: (nx+3) x (nz+3) heights covering the vertex
   *  grid plus a one-cell margin ring for the normal stencil, each height
   *  computed once (see ensureHeightRow). */
  heights: Float32Array;
  heightRowDone: Uint8Array;
}

/** The subset of a cut set that can touch a chunk's rect, or null when none
 *  can. Null is the mesher's fast path: no per-quad test at all. */
function narrowCutSet(
  set: ChunkCutSet | null,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): ChunkCutSet | null {
  if (!set) return null;
  const cuts = cutsInRect(set.cuts, minX, minZ, maxX, maxZ);
  if (!cuts) return null;
  // Patches only ever REMOVE a cut, so a patch outside the rect changes
  // nothing here; narrowing them the same way keeps the inner loop short.
  const patches = cutsInRect(set.patches, minX, minZ, maxX, maxZ);
  return patches ? { cuts, patches } : { cuts };
}

export function beginChunkGeometry(
  x0: number,
  z0: number,
  size: number,
  spacing: number,
  seed: number,
  withSplat: boolean,
  skirtSpan: number,
  lowShade: boolean,
  cutSet: ChunkCutSet | null = null,
): ChunkGeometryBuildState {
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
  const quadsX = gw - 1,
    quadsZ = gh - 1;
  // WebGL2 reserves 65535 as the fixed primitive-restart index. The largest
  // current chunk has 2,809 vertices, but keep the exact safety condition
  // beside the narrowing in case the chunk ladder changes later.
  if (count > 0xffff) {
    throw new Error(`Terrain chunk has ${count} vertices; Uint16 indices require at most 65535`);
  }
  const indices = new Uint16Array(quadsX * quadsZ * 6);
  return {
    nx,
    nz,
    gw,
    gh,
    x0,
    z0,
    stepX,
    stepZ,
    seed,
    skirtSpan,
    worldDepth: WORLD_MAX_Z - WORLD_MIN_Z,
    lowShade,
    positions,
    normals,
    colors,
    uvs,
    splats,
    extras,
    indices,
    // Narrow to the cuts whose footprint can actually reach this chunk (plus
    // the skirt ring), so a map with sixty openings does not evaluate all of
    // them per quad on every chunk in the world.
    cutSet: narrowCutSet(cutSet, x0 - stepX, z0 - stepZ, x0 + size + stepX, z0 + size + stepZ),
    sampleCache: new Map<number, VertexSample>(),
    heights: new Float32Array((nx + 3) * (nz + 3)),
    heightRowDone: new Uint8Array(nz + 3),
  };
}

export function fillChunkVertexRow(state: ChunkGeometryBuildState, gj: number): void {
  const { nx, nz, gw, x0, z0, stepX, stepZ, skirtSpan, worldDepth } = state;
  for (let gi = 0; gi < gw; gi++) {
    const i = gi - 1,
      j = gj - 1; // interior indices; -1 / n+1 are skirt
    const ci = Math.max(0, Math.min(nx, i));
    const cj = Math.max(0, Math.min(nz, j));
    const isSkirt = i !== ci || j !== cj;
    const x = x0 + ci * stepX;
    const z = z0 + cj * stepZ;
    // Skirt verts share the border sample - cache by clamped grid index.
    const cacheKey = cj * gw + ci;
    let s = state.sampleCache.get(cacheKey);
    if (!s) {
      s = sampleVertex(state, ci, cj);
      state.sampleCache.set(cacheKey, s);
    }
    const vi = gj * gw + gi;
    state.positions[vi * 3] = x;
    // Slope-aware drop: a T-junction hole under a coarse neighbor's chord is
    // bounded by the local gradient times that neighbor's vertex spacing.
    state.positions[vi * 3 + 1] = s.height - (isSkirt ? SKIRT_DROP + s.slope * skirtSpan : 0);
    state.positions[vi * 3 + 2] = z;
    state.normals[vi * 3] = s.normal[0];
    state.normals[vi * 3 + 1] = s.normal[1];
    state.normals[vi * 3 + 2] = s.normal[2];
    state.colors[vi * 3] = s.color[0];
    state.colors[vi * 3 + 1] = s.color[1];
    state.colors[vi * 3 + 2] = s.color[2];
    state.uvs[vi * 2] = (x + WORLD_MAX_X) / (WORLD_MAX_X * 2);
    state.uvs[vi * 2 + 1] = (z - WORLD_MIN_Z) / worldDepth;
    if (state.splats) {
      state.splats[vi * 4] = s.splat[0];
      state.splats[vi * 4 + 1] = s.splat[1];
      state.splats[vi * 4 + 2] = s.splat[2];
      state.splats[vi * 4 + 3] = s.splat[3];
    }
    if (state.extras) {
      state.extras[vi * 4] = s.extra[0];
      state.extras[vi * 4 + 1] = s.extra[1];
      state.extras[vi * 4 + 2] = s.extra[2];
      state.extras[vi * 4 + 3] = s.extra[3];
    }
  }
}

// Target edge length for the fine-clip sub-grid: fine enough that the contour
// reads smooth, capped so a far-band super-spacing cannot explode the lattice.
const CUT_CLIP_TARGET = 0.4;

/**
 * The fine-clip classification + geometry for this chunk's cuts, computed once
 * on first use (all vertex rows are filled before the first index row in every
 * build path, so the corner heights are ready). Interior cells only; the skirt
 * ring keeps the old centre test.
 */
export function ensureCutClip(state: ChunkGeometryBuildState): ChunkGeometryBuildState['cutClip'] {
  if (state.cutClip !== undefined) return state.cutClip;
  const set = state.cutSet;
  if (!set) {
    state.cutClip = null;
    return null;
  }
  const { nx, nz, x0, z0, stepX, stepZ, gw } = state;
  // Cell window: the union footprint of every cut, one cell of margin, clamped
  // to the interior grid.
  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const cut of set.cuts) {
    const b = cutBounds(cut);
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minZ = Math.min(minZ, b.minZ);
    maxZ = Math.max(maxZ, b.maxZ);
  }
  const ci0 = Math.max(0, Math.floor((minX - x0) / stepX) - 1);
  const ci1 = Math.min(nx - 1, Math.floor((maxX - x0) / stepX) + 1);
  const cj0 = Math.max(0, Math.floor((minZ - z0) / stepZ) - 1);
  const cj1 = Math.min(nz - 1, Math.floor((maxZ - z0) / stepZ) + 1);
  if (ci1 < ci0 || cj1 < cj0) {
    state.cutClip = null;
    return null;
  }
  const positions = state.positions;
  const cornerHeightAt = (ci: number, cj: number): number =>
    positions[((cj + 1) * gw + ci + 1) * 3 + 1];
  const fieldAt = (x: number, y: number, z: number): number => {
    const d = cutsSdfAt(set.cuts, x, y, z);
    if (!set.patches || set.patches.length === 0) return d;
    return Math.max(d, -cutsSdfAt(set.patches, x, y, z));
  };
  // Carve cuts get NO skirt at all: their cavity mesh is the real wall,
  // clipped to the same surface, so the ground flows straight into the
  // interior — a band here just hung inside the opening wearing streaked
  // surface-projected paint (and its dense sub-lattice quads read as a
  // "cursed" wireframe ring). A contour segment belongs to a carve when the
  // carve-only field is (near) zero at its midpoint; depth 0 skips it.
  const carves = set.cuts.filter((c) => c.carve === true);
  const rimDepthAt =
    carves.length === 0
      ? undefined
      : (x: number, z: number): number => {
          const y = meshTerrainHeight(x, z, state.seed);
          return Math.abs(cutsSdfAt(carves, x, y, z)) <= 0.3 ? 0 : CUT_RIM_DEPTH;
        };
  const result = buildCutClip({
    x0,
    z0,
    nx,
    nz,
    stepX,
    stepZ,
    ci0,
    cj0,
    ci1,
    cj1,
    sub: Math.max(1, Math.min(16, Math.round(Math.max(stepX, stepZ) / CUT_CLIP_TARGET))),
    rimDepth: CUT_RIM_DEPTH,
    rimDepthAt,
    cornerHeightAt,
    fieldAt,
  });
  state.cutClip = result ? { ci0, cj0, cw: ci1 - ci0 + 1, ch: cj1 - cj0 + 1, result } : null;
  return state.cutClip;
}

export function fillChunkIndexRow(state: ChunkGeometryBuildState, gj: number): void {
  const quadsX = state.gw - 1;
  const quadsZ = state.gh - 1;
  const tileRowStart = Math.floor(gj / INDEX_TILE_QUADS) * INDEX_TILE_QUADS;
  const tileHeight = Math.min(INDEX_TILE_QUADS, quadsZ - tileRowStart);
  for (let gi = 0; gi < quadsX; gi++) {
    const tileColumnStart = Math.floor(gi / INDEX_TILE_QUADS) * INDEX_TILE_QUADS;
    const tileWidth = Math.min(INDEX_TILE_QUADS, quadsX - tileColumnStart);
    const cellOffset =
      tileRowStart * quadsX +
      tileColumnStart * tileHeight +
      (gj - tileRowStart) * tileWidth +
      (gi - tileColumnStart);
    let k = cellOffset * 6;
    const a = gj * state.gw + gi;
    const b = a + 1;
    const c = a + state.gw;
    const d = c + 1;
    // Split along the diagonal whose endpoints are closest in height, so the
    // fold follows ridge/terrace edges. Both windings keep the +y face up.
    const ha = state.positions[a * 3 + 1];
    const hb = state.positions[b * 3 + 1];
    const hc = state.positions[c * 3 + 1];
    const hd = state.positions[d * 3 + 1];
    // A boolean cut removes the ground sheet. Interior cells go through the
    // fine-clip classification (terrain_cut_clip_core.ts): fully-inside cells
    // drop, contour cells drop here and are re-tessellated CLIPPED to the
    // contour by buildChunkCutFine, so the opening's edge is smooth at any
    // spacing instead of a staircase of whole quads. The index buffer keeps
    // its fixed six-index slot per cell (the tile offsets above depend on it),
    // so "dropped" is a degenerate triangle. Skirt-ring quads keep the old
    // centre test: their geometry is border padding, not visible ground.
    if (state.cutSet) {
      const i = gi - 1;
      const j = gj - 1;
      if (i >= 0 && i < state.nx && j >= 0 && j < state.nz) {
        const clip = ensureCutClip(state);
        if (clip) {
          const ci = i - clip.ci0;
          const cj = j - clip.cj0;
          if (
            ci >= 0 &&
            ci < clip.cw &&
            cj >= 0 &&
            cj < clip.ch &&
            clip.result.kinds[cj * clip.cw + ci] !== CUT_CELL_KEEP
          ) {
            for (let n = 0; n < 6; n++) state.indices[k++] = a;
            continue;
          }
        }
      } else {
        const cx = (state.positions[a * 3] + state.positions[d * 3]) / 2;
        const cz = (state.positions[a * 3 + 2] + state.positions[d * 3 + 2]) / 2;
        const cy = (ha + hb + hc + hd) / 4;
        if (inTerrainCut(state.cutSet.cuts, cx, cz, cy, state.cutSet.patches)) {
          for (let n = 0; n < 6; n++) state.indices[k++] = a;
          continue;
        }
      }
    }
    if (Math.abs(hb - hc) <= Math.abs(ha - hd)) {
      state.indices[k++] = a;
      state.indices[k++] = c;
      state.indices[k++] = b;
      state.indices[k++] = b;
      state.indices[k++] = c;
      state.indices[k++] = d;
    } else {
      state.indices[k++] = a;
      state.indices[k++] = c;
      state.indices[k++] = d;
      state.indices[k++] = a;
      state.indices[k++] = d;
      state.indices[k++] = b;
    }
  }
}

// How far a cut's rim band hangs below the surface. Deep enough that a
// gameplay camera cannot see under the ground sheet through the opening; past
// that the cave shell behind it (render/cave_mesh.ts) takes over.
const CUT_RIM_DEPTH = 6;

/**
 * The rim band for whatever cuts cross this chunk, or null when none do.
 * Runs on the chunk's own grid, so the contour lands exactly where the dropped
 * quads left off, and samples the SAME field as inTerrainCut: patches subtract
 * from the union (max(cut, -patch)), which is the signed-distance spelling of
 * "a patch beats every cut it overlaps".
 */
export function buildChunkCutRim(state: ChunkGeometryBuildState): CutRimArrays | null {
  const set = state.cutSet;
  if (!set) return null;
  const { seed, nx, nz, x0, z0, stepX, stepZ } = state;
  const heightAt = (x: number, z: number): number => meshTerrainHeight(x, z, seed);
  return buildCutRim({
    x0,
    z0,
    nx,
    nz,
    stepX,
    stepZ,
    depth: CUT_RIM_DEPTH,
    heightAt,
    fieldAt: (x, z) => {
      const y = heightAt(x, z);
      const d = cutsSdfAt(set.cuts, x, y, z);
      if (!set.patches || set.patches.length === 0) return d;
      return Math.max(d, -cutsSdfAt(set.patches, x, y, z));
    },
  });
}

/**
 * The fine cut geometry for this chunk: the rim band walked on the sub-grid
 * lattice, and the clipped surface patch over the contour cells with the
 * chunk's own vertex attributes interpolated across it. Both come from ONE
 * classification (ensureCutClip), the same one fillChunkIndexRow used to drop
 * quads, so the three pieces meet without cracks by construction.
 */
export function buildChunkCutFine(state: ChunkGeometryBuildState): {
  rim: CutRimArrays | null;
  clip: CutClipAttrArrays | null;
} {
  const cached = ensureCutClip(state);
  if (!cached) return { rim: null, clip: null };
  const surf = cached.result.surf;
  let clip: CutClipAttrArrays | null = null;
  if (surf) {
    const { nx, nz, x0, z0, stepX, stepZ, gw, worldDepth } = state;
    const count = surf.positions.length / 3;
    const normals = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const splats = state.splats ? new Float32Array(count * 4) : null;
    const extras = state.extras ? new Float32Array(count * 4) : null;
    for (let v = 0; v < count; v++) {
      const x = surf.positions[v * 3];
      const z = surf.positions[v * 3 + 2];
      const fx = Math.max(0, Math.min(nx - 1e-9, (x - x0) / stepX));
      const fz = Math.max(0, Math.min(nz - 1e-9, (z - z0) / stepZ));
      const ci = fx | 0;
      const cj = fz | 0;
      const tx = fx - ci;
      const tz = fz - cj;
      const w00 = (1 - tx) * (1 - tz);
      const w10 = tx * (1 - tz);
      const w01 = (1 - tx) * tz;
      const w11 = tx * tz;
      const v00 = (cj + 1) * gw + ci + 1;
      const v10 = v00 + 1;
      const v01 = v00 + gw;
      const v11 = v01 + 1;
      const lerp3 = (src: Float32Array, dst: Float32Array): void => {
        for (let c = 0; c < 3; c++) {
          dst[v * 3 + c] =
            src[v00 * 3 + c] * w00 +
            src[v10 * 3 + c] * w10 +
            src[v01 * 3 + c] * w01 +
            src[v11 * 3 + c] * w11;
        }
      };
      lerp3(state.normals, normals);
      const nlen = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]);
      if (nlen > 1e-9) {
        normals[v * 3] /= nlen;
        normals[v * 3 + 1] /= nlen;
        normals[v * 3 + 2] /= nlen;
      } else {
        normals[v * 3] = 0;
        normals[v * 3 + 1] = 1;
        normals[v * 3 + 2] = 0;
      }
      lerp3(state.colors, colors);
      uvs[v * 2] = (x + WORLD_MAX_X) / (WORLD_MAX_X * 2);
      uvs[v * 2 + 1] = (z - WORLD_MIN_Z) / worldDepth;
      const lerp4 = (src: Float32Array, dst: Float32Array): void => {
        for (let c = 0; c < 4; c++) {
          dst[v * 4 + c] =
            src[v00 * 4 + c] * w00 +
            src[v10 * 4 + c] * w10 +
            src[v01 * 4 + c] * w01 +
            src[v11 * 4 + c] * w11;
        }
      };
      if (splats && state.splats) lerp4(state.splats, splats);
      if (extras && state.extras) lerp4(state.extras, extras);
    }
    clip = {
      positions: surf.positions,
      normals,
      colors,
      uvs,
      splats,
      extras,
      indices: surf.indices,
    };
  }
  return { rim: cached.result.rim, clip };
}
