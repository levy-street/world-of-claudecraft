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
import { roadDistance, WATER_LEVEL, zoneBiomeAt } from '../sim/world';
import { impactCraterTerrainBlend } from './impact_terrain';
import { clamp01 } from './num_clamp';
import { meshTerrainHeight } from './terrain_mesh_height';
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
  const impact = impactCraterTerrainBlend(x, z);

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
  }
  // the marsh reads muddier: patches of wet dirt across the lowland
  if (biome === 'marsh') lerpSplat(w, 1, 0.3 * v2 * clamp01((4 - h) / 6));
  // shoreline blend, biome-specific: marsh has no sandy beach (wet mud
  // instead), rocky/ashen biomes get a darker wet-rock tint, everywhere else
  // keeps the classic sandy bank. Color and splat weight share one feathered
  // falloff so the shore blends out instead of cutting a razor-hard edge.
  const wl = WATER_LEVEL;
  const shore = clamp01((wl + 1.6 - h) / 1.6);
  if (biome === 'marsh') {
    cTmp.lerp(dirtDarkC, shore);
    lerpSplat(w, 1, shore);
  } else if (biome === 'peaks' || biome === 'volcano' || biome === 'cave') {
    cTmp.lerp(wetRockC, shore);
    lerpSplat(w, 2, shore);
  } else {
    cTmp.lerp(sandC, shore);
    lerpSplat(w, 3, shore);
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
    const blanket = clamp01((h - (WATER_LEVEL + 1.2)) / 3) * snowline;
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
}

export interface ChunkGeometryBuildState extends ChunkGeometryArrays {
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
  sampleCache: Map<number, VertexSample>;
  /** The shared height lattice: (nx+3) x (nz+3) heights covering the vertex
   *  grid plus a one-cell margin ring for the normal stencil, each height
   *  computed once (see ensureHeightRow). */
  heights: Float32Array;
  heightRowDone: Uint8Array;
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
