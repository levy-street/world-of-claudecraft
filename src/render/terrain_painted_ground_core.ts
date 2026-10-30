// The painted ground: the splat terrain's hand-painted layer set and the
// GLSL that blends it, as one pure (Three-free, DOM-free) module.
//
// Three things live here, so the offline converter, the runtime loader, the
// shader and the tests all read ONE table:
//
// 1. The layer table. Every painted layer is a source painting under
//    scripts/assets/painted_ground/src/ converted by
//    scripts/assets/painted_ground/build_painted_ground.mjs into
//    public/textures/terrain/<stem>_Color.jpg (the albedo pack source, raw on
//    purpose, see terrain.ts prepareTerrainTex), <stem>_Height.webp (a 512px
//    lossless grey height the albedo pack stores in the layer's ALPHA channel, so every
//    albedo tap returns its own height for free) and, for the layers with a
//    detail-normal slot, <stem>_NormalGL.jpg plus its flip-baked .ktx2.
//
// 2. The cover breakup (built-in world, every splat tier, one program
//    variant): open grass ground is not one texture wall to wall. Fragment
//    masks off the shared macro noise carve warm leaf-litter patches and bare
//    packed-earth patches out of the grass weight and drift the grass between
//    moss green and yellow green at the 5 to 20 yard scale; inside a town's
//    footprint, and along the town streets that run on past it (a cobble
//    lane), the dirt layer becomes worn cobbles. Every layer boundary is
//    then HEIGHT blended: each layer's painted height competes with its
//    weight, so cobble tops and pebbles win at an edge and grass fills the low
//    gaps, and a world-space ragged noise wanders every boundary so no edge
//    is a clean line. Nothing here is tier-gated; the relief extras in
//    terrain.ts (cavity, parallax, micro-shadow) keep their own ladder.
//
// 3. JS twins of the masks and the blend (coverMasksAt, townCobbleAt,
//    paintedHeightBlend), the same arithmetic as the GLSL, for the tests and
//    the converter's top-down preview, and for any CPU consumer that has to
//    agree with the ground (the blade carpet can thin over leaf litter by
//    asking coverMasksAt with the same macro texture and stats).
//
// The macro noise texture (textures.ts macroNoiseTexture) is a grey blob
// field whose mean and spread depend on how far the shared LCG has run when
// it is generated, so every mask works in Z-SCORES: (sample - mean) / sd,
// with the stats measured from the real texture at material build
// (uMacroStats). The coverage fractions below therefore hold whatever the
// texture's exact values are.

import { EASTBROOK_LAYOUT } from '../sim/eastbrook_layout';
import { recordPaintedGroundMacro } from './painted_ground_macro_core';

/** One painted splat layer. */
export interface PaintedGroundLayer {
  /** Source painting: scripts/assets/painted_ground/src/<source>.png. */
  readonly source: 'grass' | 'dirt' | 'rock' | 'cobble' | 'leaves';
  /** File stem under public/textures/terrain/. */
  readonly stem: string;
  /** The packed albedo array slot it fills (terrain.ts SPLAT_ALBEDO_LAYERS). */
  readonly albedoKey: 'grassC' | 'dirtC' | 'rockC' | 'cobbleC' | 'leafC';
  /** Its detail-normal slot (terrain.ts SPLAT_NORMAL_LAYERS), or null. */
  readonly normalKey: 'grassN' | 'dirtN' | 'rockN' | null;
  /** The terrain texture key its height map loads under. */
  readonly heightKey: 'grassH' | 'dirtH' | 'rockH' | 'cobbleH' | 'leafH';
  /** World yards one repeat covers. The painting's own feature size fixes it
   *  (tuft, pebble, stone, leaf): a larger repeat would be a scaled-up
   *  element, so calm comes from the anti-repeat instead. Grass, dirt and rock
   *  keep the photo layers' tilings (the shader's tuv, tuv x 0.55, tuv x 0.6,
   *  pinned against these values by tests/terrain_painted_ground_core.test.ts)
   *  so the GroundAO_Packed relief channels stay aligned with the albedo. */
  readonly tileYards: number;
}

/** The shader's base ground UV is world xz times this (terrain.ts `tuv`). */
export const TERRAIN_BASE_UV_PER_YARD = 0.22;

export const PAINTED_GROUND_LAYERS: readonly PaintedGroundLayer[] = [
  {
    source: 'grass',
    stem: 'PaintedGrass',
    albedoKey: 'grassC',
    normalKey: 'grassN',
    heightKey: 'grassH',
    tileYards: 1 / TERRAIN_BASE_UV_PER_YARD,
  },
  {
    source: 'dirt',
    stem: 'PaintedDirt',
    albedoKey: 'dirtC',
    normalKey: 'dirtN',
    heightKey: 'dirtH',
    tileYards: 1 / (TERRAIN_BASE_UV_PER_YARD * 0.55),
  },
  {
    source: 'rock',
    stem: 'PaintedRock',
    albedoKey: 'rockC',
    normalKey: 'rockN',
    heightKey: 'rockH',
    tileYards: 1 / (TERRAIN_BASE_UV_PER_YARD * 0.6),
  },
  {
    source: 'cobble',
    stem: 'PaintedCobble',
    albedoKey: 'cobbleC',
    normalKey: null,
    heightKey: 'cobbleH',
    tileYards: 4.6,
  },
  {
    source: 'leaves',
    stem: 'PaintedLeaves',
    albedoKey: 'leafC',
    normalKey: null,
    heightKey: 'leafH',
    tileYards: 2.8,
  },
];

/** Published paths (under the media root) of one painted layer's files. */
export function paintedGroundFiles(layer: PaintedGroundLayer): {
  color: string;
  height: string;
  normal: string | null;
} {
  const dir = 'textures/terrain';
  return {
    color: `${dir}/${layer.stem}_Color.jpg`,
    height: `${dir}/${layer.stem}_Height.webp`,
    normal: layer.normalKey ? `${dir}/${layer.stem}_NormalGL.jpg` : null,
  };
}

/** The height map's resolution; the albedo pack scales it to the layer size. */
export const PAINTED_HEIGHT_SIZE = 512;

/** The alpha a layer with no painted height is packed with: exactly the
 *  shader's height zero, so a photo layer neither wins nor loses on height. */
export const NEUTRAL_HEIGHT_BYTE = 128;

// ---------------------------------------------------------------------------
// Tuning. Every number the GLSL and the JS twins share. Frequencies are in
// cycles per world yard on the 256px macro texture (one blob there is 18 to 64
// px across a 256px tile, so a frequency f makes blobs of roughly 0.07/f to
// 0.25/f yards radius). Mask thresholds are in macro z-scores.
// ---------------------------------------------------------------------------

export const PAINTED_GROUND_TUNING = {
  /** Leaf litter: two macro scales (blobs ~2 to 7 and ~4 to 15 yd), the
   *  second rotated, combined to a unit z; patches where it runs high. The
   *  ramp is deliberately WIDE: the height blend, not the mask, draws the
   *  crisp edge, and a long ramp gives it room to dissolve. */
  leafFreqA: 0.035,
  leafFreqB: 0.016,
  // Raised from 0.5 after the first in-game look: at 0.5 the litter took
  // so much open ground (and the town square) that it read as a red splash
  // pattern; litter is an accent under trees and along edges, not a field.
  leafZ0: 0.95,
  leafZ1: 2.2,
  /** A patch never takes the WHOLE grass weight: the grass keeps enough to
   *  win on its tallest tufts, so turf pokes up through the litter and the
   *  bare earth instead of the patch reading as a flat sticker. */
  leafShareMax: 0.7,
  /** Bare packed earth: the fine field (blobs ~1 to 3.6 yd) folded with the
   *  leaf field's first scale, where BOTH run low, so it neither repeats on
   *  the fine field's 14 yard period nor lands inside a leaf patch. */
  earthFreq: 0.07,
  earthZ0: 1.25,
  earthZ1: 2.4,
  earthShareMax: 0.8,
  /** Moss green (low) to yellow green (high) drift, off the leaf field's
   *  first scale; the endpoints average to about 1 so it reads as hue. */
  mossZSpan: 1.1,
  mossTint: [0.9, 0.97, 1.03] as const,
  yellowTint: [1.1, 1.03, 0.88] as const,
  /** Share of the painted grass over the baked blade strokes, by drift: the
   *  mossy end shows more paint, the yellow end more strokes. */
  paintedGrassShareMoss: 0.82,
  paintedGrassShareYellow: 0.5,
  /** The cover breakup fades out past this camera distance (yards), well
   *  inside the far terrain's handoff, so the horizon tone cannot ring. */
  coverFadeNear: 220,
  coverFadeFar: 320,
  /** Ragged edges: a fine field (blobs ~0.3 to 1.1 yd) folded with the
   *  earth field so the wiggle has no 4.5 yard period along a long road. */
  ragFreq: 0.22,
  ragAmp: 0.22,
  /** Anti-repeat: every painted layer blends two taps, the second rotated
   *  and offset, by the earth field's z (2 to 7 yd regions) with a height
   *  term so the copy boundary follows painted features, never a cross-fade. */
  antiRepeatSharp: 0.9,
  antiRepeatHeight: 3.0,
  /** Height blend: per-layer depth (weight units per unit of centred
   *  height) and the tie window. Cobbles and leaves dissolve over a wider band
   *  than turf meets path. Lanes: grass, dirt, rock, sand | leaf, earth, cobble. */
  heightDepth: [1.2, 1.4, 1.0, 0.6] as const,
  heightDepthSub: [1.8, 1.7, 2.3] as const,
  heightWindow: 0.08,
  /** The tie window widens with camera distance (yards), back toward a soft
   *  weighted blend: past the near field the heights have mipped toward flat
   *  and a hard interlock would only crawl along every road edge. */
  heightWindowFar: 0.6,
  heightWindowNear: 25,
  heightWindowFade: 110,
  /** Town cobbles: worn patches off the earth field; `bias` widens coverage
   *  toward the town centre. At 5 the whole town's roads are laid stone (the
   *  earth field would need a z of -2 to bare one), and the worn patches live
   *  only where the footprint fades out, at the town's edge. */
  cobbleZ0: -1.6,
  cobbleZ1: 0.5,
  cobbleCentreBias: 5,
  /** A cobble lane's reach from its road's centreline (yards): full cobble out to
   *  `inner` (past the widest street's dirt shoulder), none past `outer`. Cobble
   *  only ever replaces dirt, so the reach past the road lays no stone on grass. */
  cobbleLaneInner: 4,
  cobbleLaneOuter: 6,
  /** Constant roughness of the carved layers. */
  roughLeaf: 0.9,
  roughCobble: 0.68,

  // ---- painted relief (normal_fragment_maps; terrain.ts splices it) ----
  /** Gain on the grass, dirt and rock DETAIL normals (their <stem>_NormalGL
   *  maps) in the painted program, in place of the photo-era 0.85, 0.72 and
   *  1.05. The maps themselves were rebuilt stronger too (the converter's
   *  PAINTED_GROUND_RECIPES `normal.strength`). */
  normalGainGrass: 1.15,
  normalGainDirt: 1.3,
  normalGainRock: 1.3,
  /** HEIGHT RELIEF from the composite painted height: the blend's winning
   *  layer's height, in world yards, differentiated in screen space and
   *  applied as a bump (Mikkelsen's surface gradient, the three.js bump map
   *  technique on its unnormalised, world-scaled form): no texture tap, no
   *  memory. It gives cobbles and leaf litter (no normal map) their form and
   *  every layer edge its step, so a stone stands proud of the turf filling
   *  its gaps. Lanes: grass, dirt, rock, sand | leaf, earth, cobble. `Yards`
   *  is the rise across a layer's full 0..1 painted height (zero where a
   *  normal map already carries that layer's own relief); `lift` is the
   *  layer's base level against the turf. */
  bumpYards: [0, 0, 0, 0] as const,
  bumpYardsSub: [0.08, 0, 0.3] as const,
  bumpLift: [0, -0.012, 0.02, -0.006] as const,
  bumpLiftSub: [0.012, -0.018, 0.024] as const,
  /** The relief's own tie window: wider than the colour's, so a layer step
   *  reads as a bevel a few texels wide rather than a one-pixel line. */
  bumpWindow: 0.22,
  /** Steepest relief slope (rise over run) the bump may tilt a normal by. */
  bumpMaxSlope: 1.1,
  /** Overall bump strength, and its fades: out with camera distance (yards),
   *  where the mipped height is flat and screen derivatives only shimmer; on
   *  grazing views (n dot v), where derivative bumps alias first; on banks
   *  (the planar ground UV stretches), with the detail normals. */
  bumpStrength: 1,
  bumpFadeNear: 32,
  bumpFadeFar: 72,
  bumpGrazing0: 0.12,
  bumpGrazing1: 0.34,
} as const;

/**
 * The photo grass layer's mean, measured the way buildSplatAlbedoArray
 * measures a layer (mean sRGB byte, then a 2.2 power): Grass001_Color.jpg
 * averaged (68.1, 91.5, 40.3). The painted grass is tint-neutral, which is
 * what the baked-blade arm wants; the arm WITHOUT the bake (the Studio editor,
 * ?grassbake=off) tints the layer only 35%, so it multiplies the painted grass
 * back onto this green with grassFallbackTint.
 */
export const PHOTO_GRASS_MEAN: readonly [number, number, number] = [
  (68.1 / 255) ** 2.2,
  (91.5 / 255) ** 2.2,
  (40.3 / 255) ** 2.2,
];

/** Per-channel gain from the packed grass layer's mean onto the photo
 *  grass's, clamped to a sane range (a neutral painted grass maps to roughly
 *  0.13, 0.25, 0.04: the photo green is that dark); identity while the
 *  layer's mean is unknown. */
export function grassFallbackTint(
  grassMean: readonly [number, number, number] | null,
): [number, number, number] {
  if (!grassMean) return [1, 1, 1];
  return [0, 1, 2].map((c) =>
    grassMean[c] > 1e-4 ? Math.min(4, Math.max(0.01, PHOTO_GRASS_MEAN[c] / grassMean[c])) : 1,
  ) as [number, number, number];
}

/** A town whose dirt ground is laid as worn cobbles. */
export interface PaintedCobbleTown {
  /** Built-in zone id; the footprint centres on that zone's hub. */
  readonly zoneId: string;
  /** Full cobble coverage inside hub.radius x inner; none past x outer. */
  readonly inner: number;
  readonly outer: number;
}

/** Uniform slots for cobble towns (uCobbleTowns). */
export const PAINTED_COBBLE_TOWN_SLOTS = 2;

/** Eastbrook first: its streets, plaza and quay walks. Full cobble out to twice
 *  the hub radius, past the outermost buildings the town stands, so every road
 *  inside the town is stone and the dirt starts where the town ends. */
export const PAINTED_COBBLE_TOWNS: readonly PaintedCobbleTown[] = [
  { zoneId: 'eastbrook_vale', inner: 2.0, outer: 2.6 },
];

/** A town street laid as cobbles along its own centreline, for the stretch that
 *  runs on past its town's footprint. */
export interface PaintedCobbleLane {
  /** Built-in zone id: the lane is laid only in a world that has that zone. */
  readonly zoneId: string;
  /** The street's centreline, a town layout road's points. */
  readonly points: readonly { readonly x: number; readonly z: number }[];
}

/** Uniform slots for cobble lane segments (uCobbleLanes). */
export const PAINTED_COBBLE_LANE_SLOTS = 6;

function eastbrookRoad(id: string): { readonly points: readonly { x: number; z: number }[] } {
  const road = EASTBROOK_LAYOUT.roads.find((r) => r.id === id);
  if (!road) throw new Error(`no Eastbrook road ${id}`);
  return road;
}

/** Eastbrook's main street (the layout road `east`, the town's spine from the
 *  square to the quay), laid in stone to its end on the quay walk at the harbour
 *  boardwalk's landward edge: the owner's ask, cobbles right up to the docks.
 *  Read off the layout, so the lane follows the street wherever it is laid. */
export const PAINTED_COBBLE_LANES: readonly PaintedCobbleLane[] = [
  { zoneId: 'eastbrook_vale', points: eastbrookRoad('east').points },
];

/** Where an unused lane slot lies: far off every world, so it never matches. */
const NO_LANE = 1e5;

/** The uCobbleLanes uniform: one segment (ax, az, bx, bz) per slot, every lane's
 *  segments in order, less those its town's footprint already lays full (both
 *  ends inside the full-cobble radius by a lane's outer reach, so the circle,
 *  being convex, covers the segment's whole reach); spare slots never match.
 *  Segments past the last slot are dropped (tests pin that Eastbrook's fit). */
export function resolveCobbleLanes(
  zones: readonly { id: string; hub: { x: number; z: number; radius: number } }[],
  lanes: readonly PaintedCobbleLane[] = PAINTED_COBBLE_LANES,
  towns: readonly PaintedCobbleTown[] = PAINTED_COBBLE_TOWNS,
): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const lane of lanes) {
    const zone = zones.find((z) => z.id === lane.zoneId);
    if (!zone) continue;
    const town = towns.find((t) => t.zoneId === lane.zoneId);
    const full = town ? zone.hub.radius * town.inner - PAINTED_GROUND_TUNING.cobbleLaneOuter : -1;
    const inside = (p: { x: number; z: number }): boolean =>
      Math.hypot(p.x - zone.hub.x, p.z - zone.hub.z) <= full;
    for (let i = 1; i < lane.points.length; i++) {
      const a = lane.points[i - 1];
      const b = lane.points[i];
      if (inside(a) && inside(b)) continue;
      if (out.length < PAINTED_COBBLE_LANE_SLOTS) out.push([a.x, a.z, b.x, b.z]);
    }
  }
  while (out.length < PAINTED_COBBLE_LANE_SLOTS) out.push([NO_LANE, NO_LANE, NO_LANE, NO_LANE]);
  return out;
}

/** The uCobbleLaneBox uniform: the box round every laid lane segment (minX, minZ, maxX, maxZ),
 *  grown by a lane's outer reach, so a fragment outside it skips the lane loop: outside it every
 *  segment lies past its outer reach and lays nothing, so the skip changes no texel. Inverted
 *  (min over max, matching nothing) when no lane is laid, so every other zone pays one compare. */
export function resolveCobbleLaneBox(
  lanes: readonly (readonly [number, number, number, number])[],
): [number, number, number, number] {
  const reach = PAINTED_GROUND_TUNING.cobbleLaneOuter;
  let x0 = Number.POSITIVE_INFINITY;
  let z0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let z1 = Number.NEGATIVE_INFINITY;
  for (const l of lanes) {
    if (l[0] >= NO_LANE) continue;
    x0 = Math.min(x0, l[0], l[2]);
    z0 = Math.min(z0, l[1], l[3]);
    x1 = Math.max(x1, l[0], l[2]);
    z1 = Math.max(z1, l[1], l[3]);
  }
  if (x0 > x1) return [1, 1, -1, -1];
  return [x0 - reach, z0 - reach, x1 + reach, z1 + reach];
}

/** Distance from (x, z) to the segment (ax, az)-(bx, bz). */
function segmentDistance(
  x: number,
  z: number,
  [ax, az, bx, bz]: readonly [number, number, number, number],
): number {
  const abx = bx - ax;
  const abz = bz - az;
  const h = Math.min(
    1,
    Math.max(0, ((x - ax) * abx + (z - az) * abz) / Math.max(abx * abx + abz * abz, 1e-4)),
  );
  return Math.hypot(x - ax - abx * h, z - az - abz * h);
}

/** The uCobbleTowns uniform: (hub x, hub z, inner yd, outer yd) per slot;
 *  unused slots are zero-radius and never match. */
export function resolveCobbleTowns(
  zones: readonly { id: string; hub: { x: number; z: number; radius: number } }[],
  towns: readonly PaintedCobbleTown[] = PAINTED_COBBLE_TOWNS,
): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const town of towns) {
    if (out.length >= PAINTED_COBBLE_TOWN_SLOTS) break;
    const zone = zones.find((z) => z.id === town.zoneId);
    if (!zone) continue;
    out.push([zone.hub.x, zone.hub.z, zone.hub.radius * town.inner, zone.hub.radius * town.outer]);
  }
  while (out.length < PAINTED_COBBLE_TOWN_SLOTS) out.push([0, 0, -2, -1]);
  return out;
}

/** Mean and spread of the macro texture's red channel (0..1 samples), with
 *  the fallback the material uses when the texture cannot be read back. */
export interface MacroStats {
  readonly mean: number;
  readonly sd: number;
}
export const FALLBACK_MACRO_STATS: MacroStats = { mean: 0.5, sd: 0.05 };

export function macroStatsOf(red: ArrayLike<number>, stride = 1, scale = 1 / 255): MacroStats {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < red.length; i += stride) {
    sum += red[i] * scale;
    n++;
  }
  if (n === 0) return FALLBACK_MACRO_STATS;
  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < red.length; i += stride) sq += (red[i] * scale - mean) ** 2;
  const sd = Math.sqrt(sq / n);
  const stats = sd > 1e-4 ? { mean, sd } : FALLBACK_MACRO_STATS;
  // terrain.ts measures the texture it binds here and nowhere else, so this is
  // where the CPU twins get its texels: the meadow patch keeps blades off the
  // cobbles and thins them on litter with these same masks
  // (painted_ground_macro_core.ts, meadow_patch_core.ts)
  recordPaintedGroundMacro(red, stride, scale, stats.mean, stats.sd);
  return stats;
}

// ---------------------------------------------------------------------------
// JS twins (same arithmetic as the GLSL below)
// ---------------------------------------------------------------------------

/** A macro texture lookup: wrapped (u, v) in texture units to 0..1. */
export type MacroSampler = (u: number, v: number) => number;

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// the rotation the leaf field's second scale and the rag field sample under
const ROT_C = 0.8;
const ROT_S = 0.6;
const LEAF_B_OFFSET = [0.71, 0.23] as const;
const LEAF_A_OFFSET = [0.17, 0.59] as const;
const EARTH_OFFSET = [0.43, 0.91] as const;
const RAG_OFFSET = [0.29, 0.07] as const;

export interface CoverMasks {
  /** Leaf litter share of the grass weight (0..1). */
  leaf: number;
  /** Bare earth share of the grass weight (0..1), already outside the leaf. */
  earth: number;
  /** Grass drift: 0 moss green, 1 yellow green. */
  drift: number;
  /** Ragged-edge noise (weight units, zero mean). */
  rag: number;
  /** Anti-repeat field (unit z). */
  repeatZ: number;
}

/** Cover masks at world (x, z); `fade` is the camera-distance fade times the
 *  breakup strength (uPaintedCover.x). */
export function coverMasksAt(
  x: number,
  z: number,
  fade: number,
  macro: MacroSampler,
  stats: MacroStats,
): CoverMasks {
  const T = PAINTED_GROUND_TUNING;
  const zs = (v: number) => (v - stats.mean) / stats.sd;
  const za = zs(macro(x * T.leafFreqA + LEAF_A_OFFSET[0], z * T.leafFreqA + LEAF_A_OFFSET[1]));
  const xr = x * ROT_C - z * ROT_S;
  const zr = x * ROT_S + z * ROT_C;
  const zb = zs(macro(xr * T.leafFreqB + LEAF_B_OFFSET[0], zr * T.leafFreqB + LEAF_B_OFFSET[1]));
  const ze = zs(macro(x * T.earthFreq + EARTH_OFFSET[0], z * T.earthFreq + EARTH_OFFSET[1]));
  const zr2 = zs(macro(xr * T.ragFreq + RAG_OFFSET[0], zr * T.ragFreq + RAG_OFFSET[1]));
  const leafZ = (za * 0.45 + zb * 0.55) / 0.7106;
  const leaf = smoothstep(T.leafZ0, T.leafZ1, leafZ) * T.leafShareMax * fade;
  const earthZ = (-ze * 0.45 - za * 0.55) / 0.7106;
  const earth = smoothstep(T.earthZ0, T.earthZ1, earthZ) * T.earthShareMax * (1 - leaf) * fade;
  const drift = smoothstep(-T.mossZSpan, T.mossZSpan, za);
  const rag = (zr2 * 0.6 + ze * 0.4) * T.ragAmp;
  return { leaf, earth, drift, rag, repeatZ: ze };
}

/** Town cobble share of the dirt weight at (x, z) (0..1), before strength: the
 *  town footprints and the cobble lanes (resolveCobbleLanes segments). */
export function townCobbleAt(
  x: number,
  z: number,
  towns: readonly (readonly [number, number, number, number])[],
  earthZ: number,
  lanes: readonly (readonly [number, number, number, number])[] = [],
): number {
  const T = PAINTED_GROUND_TUNING;
  let town = 0;
  for (const t of towns) {
    town = Math.max(town, 1 - smoothstep(t[2], t[3], Math.hypot(x - t[0], z - t[1])));
  }
  for (const l of lanes) {
    town = Math.max(
      town,
      1 - smoothstep(T.cobbleLaneInner, T.cobbleLaneOuter, segmentDistance(x, z, l)),
    );
  }
  if (town <= 0) return 0;
  return town * smoothstep(T.cobbleZ0, T.cobbleZ1, earthZ + (town - 0.5) * T.cobbleCentreBias);
}

/** The height blend's tie window at a camera distance (yards). */
export function heightWindowAt(camDist: number): number {
  const T = PAINTED_GROUND_TUNING;
  const t = smoothstep(T.heightWindowNear, T.heightWindowFade, camDist);
  return T.heightWindow + (T.heightWindowFar - T.heightWindow) * t;
}

/**
 * The height blend over the seven lanes (grass, dirt, rock, sand, leaf,
 * earth, cobble). `w` are the carved weights (summing to the splat total),
 * `h` each lane's painted height centred on zero (alpha - 0.5), `rag` the
 * ragged-edge noise, `window` the tie window (heightWindowAt). Returns the
 * blended weights, summing to 1 whenever any lane is present.
 */
export function paintedHeightBlend(
  w: readonly number[],
  h: readonly number[],
  rag: number,
  window: number = PAINTED_GROUND_TUNING.heightWindow,
): number[] {
  const T = PAINTED_GROUND_TUNING;
  const depth = [...T.heightDepth, ...T.heightDepthSub];
  // grass and the sub-layers carved from it wander against the path layers
  const ragSign = [1, -1, 0, 0, -1, -1, -1];
  const e = w.map((wi, i) => (wi > 1e-4 ? wi + h[i] * depth[i] + rag * ragSign[i] : -1));
  const top = Math.max(...e);
  const b = e.map((ei) => Math.max(ei - (top - window), 0));
  const sum = b.reduce((a, v) => a + v, 0);
  if (sum <= 1e-5) {
    const total = w.reduce((a, v) => a + v, 0) || 1;
    return w.map((v) => v / total);
  }
  return b.map((v) => v / sum);
}

/**
 * The composite relief height (world yards) the bump differentiates, the twin
 * of the `wocBumpH` arithmetic in paintedHeightBlendGlsl: the same lanes and
 * heights as paintedHeightBlend, competing on the wider relief window, each
 * lane's centred height scaled by its yards and set on its base level.
 */
export function paintedBumpHeight(
  w: readonly number[],
  h: readonly number[],
  rag: number,
  colourWindow: number = PAINTED_GROUND_TUNING.heightWindow,
): number {
  const T = PAINTED_GROUND_TUNING;
  const wb = paintedHeightBlend(w, h, rag, Math.max(colourWindow, T.bumpWindow));
  const yards = [...T.bumpYards, ...T.bumpYardsSub];
  const lift = [...T.bumpLift, ...T.bumpLiftSub];
  return wb.reduce((acc, wi, i) => acc + wi * (h[i] * yards[i] + lift[i]), 0);
}

/** The anti-repeat copy's UV (wocRotUv) and a vector sampled there turned
 *  back into the base UV frame (wocRotBack). */
export function rotateUv(
  u: number,
  v: number,
  rot: readonly [number, number, number, number],
): [number, number] {
  return [u * rot[0] - v * rot[1] + rot[2], u * rot[1] + v * rot[0] + rot[3]];
}
export function rotateBack(
  x: number,
  y: number,
  rot: readonly [number, number, number, number],
): [number, number] {
  return [x * rot[0] + y * rot[1], -x * rot[1] + y * rot[0]];
}

// ---------------------------------------------------------------------------
// GLSL. Spliced by terrain.ts buildSplatMaterial into the built-in world's
// splat program (authored maps keep the Studio's own height blend).
// ---------------------------------------------------------------------------

const f = (v: number): string => {
  const s = v.toFixed(4);
  return s.includes('.') ? s : `${s}.0`;
};
const v2 = (a: readonly number[]): string => `vec2(${f(a[0])}, ${f(a[1])})`;
const v3 = (a: readonly number[]): string => `vec3(${a.map(f).join(', ')})`;
const v4 = (a: readonly number[]): string => `vec4(${a.map(f).join(', ')})`;

/** UV scale of a painted layer relative to the shader's base `tuv`. */
export function layerUvPerTuv(layer: PaintedGroundLayer): number {
  return 1 / (layer.tileYards * TERRAIN_BASE_UV_PER_YARD);
}

function layerBySource(source: PaintedGroundLayer['source']): PaintedGroundLayer {
  const layer = PAINTED_GROUND_LAYERS.find((l) => l.source === source);
  if (!layer) throw new Error(`painted ground layer ${source} missing`);
  return layer;
}

/** Top-level declarations: uniforms, constants and the anti-repeat tap. */
export function paintedGroundDeclarationsGlsl(): string {
  const T = PAINTED_GROUND_TUNING;
  return `
        uniform vec4 uCobbleTowns[${PAINTED_COBBLE_TOWN_SLOTS}];
        uniform vec4 uCobbleLanes[${PAINTED_COBBLE_LANE_SLOTS}];
        uniform vec4 uCobbleLaneBox;
        uniform vec2 uPaintedCover;
        uniform vec2 uMacroStats;
        const float WOC_UV_COBBLE = ${f(layerUvPerTuv(layerBySource('cobble')))};
        const float WOC_UV_LEAF = ${f(layerUvPerTuv(layerBySource('leaves')))};
        // The anti-repeat copy's UV (rot = cos, sin, offset), and a tangent
        // vector sampled there turned back into the base UV frame (R^T).
        vec2 wocRotUv(vec2 uv, vec4 rot) {
          return vec2(uv.x * rot.x - uv.y * rot.y, uv.x * rot.y + uv.y * rot.x) + rot.zw;
        }
        vec2 wocRotBack(vec2 v, vec4 rot) {
          return vec2(v.x * rot.x + v.y * rot.y, -v.x * rot.y + v.y * rot.x);
        }
        // Anti-repeat painted tap: the layer and a rotated, offset copy, chosen
        // by a slow world field with a height term, so the copy boundary runs
        // along painted features and the repeat never lines up (two taps, no
        // cross-fade ghost). Alpha carries the layer's painted height; t is
        // the copy weight, so the layer's normal map can follow the same copy.
        vec4 wocPaintedTap(float layer, vec2 uv, float repeatZ, vec4 rot, out float t) {
          vec4 a = texture(uAlb, vec3(uv, layer));
          vec4 b = texture(uAlb, vec3(wocRotUv(uv, rot), layer));
          t = clamp(repeatZ * ${f(T.antiRepeatSharp)} + (b.a - a.a) * ${f(T.antiRepeatHeight)} + 0.5, 0.0, 1.0);
          return mix(a, b, t);
        }
        // Height relief: Mikkelsen's surface gradient from the screen-space
        // derivatives of a WORLD-unit height (dH), on the unnormalised frame
        // so the slope is true rise over run at any distance (three's bump
        // chunk normalises it, which ties strength to pixel size), clamped
        // to a maximum slope. Call from uniform control flow only.
        vec3 wocBumpNormal(vec3 surfPos, vec3 surfNorm, vec2 dH, float faceDir, float maxSlope) {
          vec3 sigX = dFdx(surfPos);
          vec3 sigY = dFdy(surfPos);
          vec3 r1 = cross(sigY, surfNorm);
          vec3 r2 = cross(surfNorm, sigX);
          float det = dot(sigX, r1) * faceDir;
          vec3 g = (dH.x * r1 + dH.y * r2) / (abs(det) > 1e-14 ? det : 1e-14);
          g *= min(1.0, maxSlope / max(length(g), 1e-6));
          return normalize(surfNorm - g);
        }
        float wocMacroZ(vec2 uv) {
          return (texture2D(uMacro, uv).r - uMacroStats.x) * uMacroStats.y;
        }`;
}

/** Per-layer anti-repeat rotations (cos, sin, offset): distinct angles so no
 *  two layers' copies share a phase. */
export const PAINTED_TAP_ROT = {
  grass: [0.7986, 0.6018, 0.37, 0.61],
  dirt: [0.4226, 0.9063, 0.13, 0.77],
  cobble: [0.9135, 0.4067, 0.52, 0.29],
  leaves: [0.2588, 0.9659, 0.81, 0.44],
} as const;

/** Map_fragment, after the splat reshape and wocCamDist: the cover masks,
 *  the ragged-edge noise, the anti-repeat field and the town cobble mask. */
export function paintedCoverGlsl(): string {
  const T = PAINTED_GROUND_TUNING;
  return `
        // --- painted ground cover (terrain_painted_ground_core.ts) ---
        vec4 wocPGrass = vec4(0.5);
        // the grass and dirt copy weights (their normal maps follow them) and
        // the composite relief height the bump differentiates
        float wocTGrass = 0.0;
        float wocTDirt = 0.0;
        float wocBumpH = 0.0;
        float wocCoverFade = (1.0 - smoothstep(${f(T.coverFadeNear)}, ${f(T.coverFadeFar)}, wocCamDist))
          * uPaintedCover.x;
        vec2 wocRotXZ = vec2(vWPos.x * ${f(ROT_C)} - vWPos.z * ${f(ROT_S)}, vWPos.x * ${f(ROT_S)} + vWPos.z * ${f(ROT_C)});
        float wocEarthZ = wocMacroZ(vWPos.xz * ${f(T.earthFreq)} + ${v2(EARTH_OFFSET)});
        float wocRag = (wocMacroZ(wocRotXZ * ${f(T.ragFreq)} + ${v2(RAG_OFFSET)}) * 0.6 + wocEarthZ * 0.4)
          * ${f(T.ragAmp)};
        float wocLeafM = 0.0;
        float wocEarthM = 0.0;
        float wocDrift = 0.5;
        if ( wocHasGrass ) {
          float wocLeafA = wocMacroZ(vWPos.xz * ${f(T.leafFreqA)} + ${v2(LEAF_A_OFFSET)});
          float wocLeafB = wocMacroZ(wocRotXZ * ${f(T.leafFreqB)} + ${v2(LEAF_B_OFFSET)});
          float wocLeafZ = (wocLeafA * 0.45 + wocLeafB * 0.55) / 0.7106;
          wocLeafM = smoothstep(${f(T.leafZ0)}, ${f(T.leafZ1)}, wocLeafZ)
            * ${f(T.leafShareMax)} * wocCoverFade;
          float wocBareZ = (-wocEarthZ * 0.45 - wocLeafA * 0.55) / 0.7106;
          wocEarthM = smoothstep(${f(T.earthZ0)}, ${f(T.earthZ1)}, wocBareZ)
            * ${f(T.earthShareMax)} * (1.0 - wocLeafM) * wocCoverFade;
          wocDrift = smoothstep(${f(-T.mossZSpan)}, ${f(T.mossZSpan)}, wocLeafA);
        }
        // Town cobbles: the dirt inside a town footprint, and along the streets
        // that run on past it, is laid stone, worn back to earth in patches
        // (uCobbleTowns and uCobbleLanes from terrain_painted_ground_core).
        float wocCobbleM = 0.0;
        if ( wocHasDirt && uPaintedCover.y > 0.0 ) {
          float wocTown = 0.0;
          for (int i = 0; i < ${PAINTED_COBBLE_TOWN_SLOTS}; i++) {
            vec4 t = uCobbleTowns[i];
            wocTown = max(wocTown, 1.0 - smoothstep(t.z, t.w, distance(vWPos.xz, t.xy)));
          }
          // the lanes, only inside the box round them (uCobbleLaneBox): elsewhere they lay nothing
          if ( all(greaterThanEqual(vWPos.xz, uCobbleLaneBox.xy)) && all(lessThanEqual(vWPos.xz, uCobbleLaneBox.zw)) ) {
            for (int i = 0; i < ${PAINTED_COBBLE_LANE_SLOTS}; i++) {
              vec4 l = uCobbleLanes[i];
              vec2 wocLaneAB = l.zw - l.xy;
              vec2 wocLaneAP = vWPos.xz - l.xy;
              float wocLaneH = clamp(dot(wocLaneAP, wocLaneAB) / max(dot(wocLaneAB, wocLaneAB), 0.0001), 0.0, 1.0);
              wocTown = max(wocTown, 1.0 - smoothstep(${f(T.cobbleLaneInner)}, ${f(T.cobbleLaneOuter)},
                length(wocLaneAP - wocLaneAB * wocLaneH)));
            }
          }
          if ( wocTown > 0.0 )
            wocCobbleM = wocTown * smoothstep(${f(T.cobbleZ0)}, ${f(T.cobbleZ1)},
              wocEarthZ + (wocTown - 0.5) * ${f(T.cobbleCentreBias)}) * uPaintedCover.y;
        }`;
}

/**
 * The painted grass over the baked blade strokes (bake arm, built-in world),
 * replacing the photo-era carpet ring. Runs where `grassAlb` holds the bake
 * sample: the painted tap is lifted onto the bake's mean (uPlainLift) and
 * chosen per texel by its own painted height (the near-white strokes carry
 * almost no value of their own), so where the share is split the raised
 * tufts and moss show paint and the hollows show strokes, crisp instead of a
 * muddy average. Inside the dense blade carpet
 * (uCarpetRing) the ground is the painted grass alone, a mossy floor under
 * the real blades, and the moss-to-yellow drift tints the result.
 */
export function paintedGrassGlsl(carpetFadeStart: number): string {
  const T = PAINTED_GROUND_TUNING;
  return `
          wocPGrass = wocPaintedTap(WOC_L_GRASS, tuv, wocEarthZ, ${v4(PAINTED_TAP_ROT.grass)}, wocTGrass);
          vec3 wocPGc = wocPGrass.rgb * uPlainLift;
          float wocShare = mix(${f(T.paintedGrassShareMoss)}, ${f(T.paintedGrassShareYellow)}, wocDrift);
          float wocPT = clamp((wocShare - 0.5) * 4.0 + (wocPGrass.a - 0.5) * 3.0 + 0.5, 0.0, 1.0);
          grassAlb = mix(grassAlb, wocPGc, wocPT);
          if ( uCarpetRing.z > 0.0 ) {
            float wocPaintT = smoothstep(uCarpetRing.z * ${f(carpetFadeStart)},
              uCarpetRing.z, distance(vWPos.xz, uCarpetRing.xy));
            grassAlb = mix(wocPGc, grassAlb, wocPaintT);
          }
          grassAlb *= mix(${v3(T.mossTint)}, ${v3(T.yellowTint)}, wocDrift);`;
}

/** The painted dirt's flat albedo: one anti-repeat tap pair at the photo
 *  layer's tiling (tuv x 0.55, where GroundAO_Packed's dirt cavity lines up),
 *  its alpha the dirt height. Identical on every splat tier. */
export function paintedDirtFlatGlsl(): string {
  return `
        vec4 wocPD = wocPaintedTap(WOC_L_DIRT, tuv * 0.55, wocEarthZ, ${v4(PAINTED_TAP_ROT.dirt)}, wocTDirt);
        wocDirtH = wocPD.a;
        vec3 dirtFlat = wocPD.rgb;`;
}

/** Leaf-litter and cobble albedo taps (only where their masks are live). */
export function paintedSubLayerAlbedoGlsl(): string {
  return `
        vec3 leafAlb = vec3(0.0);
        float wocLeafH = 0.5;
        if ( wocLeafM > 0.0 ) {
          float wocTLeaf;
          vec4 wocL = wocPaintedTap(WOC_L_LEAF, tuv * WOC_UV_LEAF, wocEarthZ, ${v4(PAINTED_TAP_ROT.leaves)}, wocTLeaf);
          leafAlb = wocL.rgb;
          wocLeafH = wocL.a;
        }
        vec3 cobbleAlb = vec3(0.0);
        float wocCobbleH = 0.5;
        if ( wocCobbleM > 0.0 ) {
          float wocTCobble;
          vec4 wocC = wocPaintedTap(WOC_L_COBBLE, tuv * WOC_UV_COBBLE, wocEarthZ, ${v4(PAINTED_TAP_ROT.cobble)}, wocTCobble);
          cobbleAlb = wocC.rgb;
          wocCobbleH = wocC.a;
        }`;
}

/** The seven-lane height blend. Reads `wocHW` (the four splat weights) and
 *  rewrites it, writes `wocHW2` (leaf, earth, cobble) and `wocNW` (the
 *  weights the detail normals and roughness use). */
export function paintedHeightBlendGlsl(): string {
  const T = PAINTED_GROUND_TUNING;
  return `
        // --- painted height blend (terrain_painted_ground_core.ts) ---
        // Carve the cover layers out of the splat weights, then let every
        // present layer's painted height compete with its weight: a raised
        // cobble or pebble wins its edge, grass fills the low gaps, and the
        // ragged field wanders the boundary so it is never a clean line.
        {
          float wGr = wocHW.x;
          float wDi = wocHW.y;
          float wLe = wGr * wocLeafM;
          float wEa = wGr * wocEarthM;
          wGr -= wLe + wEa;
          float wCo = wDi * wocCobbleM;
          wDi -= wCo;
          vec4 w4 = vec4(wGr, wDi, wocHW.z, wocHW.w);
          vec3 w3 = vec3(wLe, wEa, wCo);
          vec4 e4 = w4 + (vec4(wocPGrass.a, wocDirtH, wocRockH, 0.5) - 0.5) * ${v4(T.heightDepth)}
            + vec4(wocRag, -wocRag, 0.0, 0.0);
          vec3 e3 = w3 + (vec3(wocLeafH, wocDirtH, wocCobbleH) - 0.5) * ${v3(T.heightDepthSub)}
            - vec3(wocRag);
          e4 = mix(vec4(-1.0), e4, step(1e-4, w4));
          e3 = mix(vec3(-1.0), e3, step(1e-4, w3));
          float top = max(max(max(e4.x, e4.y), max(e4.z, e4.w)), max(max(e3.x, e3.y), e3.z));
          float win = mix(${f(T.heightWindow)}, ${f(T.heightWindowFar)},
            smoothstep(${f(T.heightWindowNear)}, ${f(T.heightWindowFade)}, wocCamDist));
          vec4 b4 = max(e4 - (top - win), 0.0);
          vec3 b3 = max(e3 - (top - win), 0.0);
          float bs = b4.x + b4.y + b4.z + b4.w + b3.x + b3.y + b3.z;
          wocHW = bs > 1e-5 ? b4 / bs : w4;
          wocHW2 = bs > 1e-5 ? b3 / bs : w3;
          wocNW = vec4(wocHW.x, wocHW.y + wocHW2.y, wocHW.z, wocHW.w);
          // the relief height: the same competition on a wider tie window,
          // each lane's height in yards on its base level
          float bwin = max(win, ${f(T.bumpWindow)});
          vec4 c4 = max(e4 - (top - bwin), 0.0);
          vec3 c3 = max(e3 - (top - bwin), 0.0);
          float cs = c4.x + c4.y + c4.z + c4.w + c3.x + c3.y + c3.z;
          vec4 wb4 = cs > 1e-5 ? c4 / cs : w4;
          vec3 wb3 = cs > 1e-5 ? c3 / cs : w3;
          wocBumpH = dot(wb4, (vec4(wocPGrass.a, wocDirtH, wocRockH, 0.5) - 0.5) * ${v4(T.bumpYards)}
              + ${v4(T.bumpLift)})
            + dot(wb3, (vec3(wocLeafH, wocDirtH, wocCobbleH) - 0.5) * ${v3(T.bumpYardsSub)}
              + ${v3(T.bumpLiftSub)});
        }`;
}

/**
 * The carved layers' albedo terms, appended to the splat sum. `valueTint` is
 * the GLSL expression of the photo layers' 35% vertex tint (`vtint35` in the
 * bake arm), whose LUMINANCE they take: they keep their painted hue and take
 * only the zone's value, so a grass-green vertex colour cannot turn leaf
 * litter olive. Null where the arm tints the whole sum afterwards.
 */
export function paintedSubLayerTermsGlsl(valueTint: string | null): string {
  const terms = '(leafAlb * wocHW2.x + dirtAlb * wocHW2.y + cobbleAlb * wocHW2.z)';
  return valueTint
    ? `
                 + ${terms} * dot(${valueTint}, vec3(0.2126, 0.7152, 0.0722))`
    : `
                 + ${terms}`;
}

/**
 * The painted grass and dirt DETAIL normal taps (normal_fragment_maps, inside
 * terrain.ts's near-detail gate), replacing the photo-era combed grass tap
 * and single dirt tap: each samples its <stem>_NormalGL at the albedo's own
 * two anti-repeat UVs and mixes them by the albedo's copy weight (the rotated
 * copy's tangent vector turned back into the base frame), so the lit relief
 * sits on the painted tufts and pebbles actually shown. Writes `gNxy` and
 * `dN`, declared by terrain.ts.
 */
export function paintedDetailNormalTapsGlsl(): string {
  const g = v4(PAINTED_TAP_ROT.grass);
  const d = v4(PAINTED_TAP_ROT.dirt);
  return `
        if ( wocHasGrass && wocNearDetail ) {
          vec2 wocGa = WOC_NRM(tuv, WOC_N_GRASS).xy * 2.0 - 1.0;
          vec2 wocGb = wocRotBack(WOC_NRM(wocRotUv(tuv, ${g}), WOC_N_GRASS).xy * 2.0 - 1.0, ${g});
          gNxy = mix(wocGa, wocGb, wocTGrass);
        }
        if ( (wocHasDirt || wocEarthM > 0.0) && wocNearDetail ) {
          vec2 wocUvD = tuv * 0.55;
          vec2 wocDa = WOC_NRM(wocUvD, WOC_N_DIRT).xy * 2.0 - 1.0;
          vec2 wocDb = wocRotBack(WOC_NRM(wocRotUv(wocUvD, ${d}), WOC_N_DIRT).xy * 2.0 - 1.0, ${d});
          dN = vec3(mix(wocDa, wocDb, wocTDirt), 0.0);
        }`;
}

/**
 * The height relief, spliced at the TOP LEVEL of normal_fragment_maps (after
 * the detail normals; screen derivatives need uniform control flow): the
 * composite painted height's screen-space gradient, faded by distance,
 * grazing view, bank slope and snow, bent into `normal` by wocBumpNormal.
 * Zero texture taps: a few derivative and vector ops per fragment.
 */
export function paintedBumpGlsl(): string {
  const T = PAINTED_GROUND_TUNING;
  return `
        // --- painted height relief (terrain_painted_ground_core.ts) ---
        {
          vec2 wocBumpD = vec2(dFdx(wocBumpH), dFdy(wocBumpH));
          float wocBumpFade = ${f(T.bumpStrength)}
            * (1.0 - smoothstep(${f(T.bumpFadeNear)}, ${f(T.bumpFadeFar)}, wocCamDist))
            * smoothstep(0.5, 0.82, vWNorm.y)
            * (1.0 - vExtra.y * 0.7)
            * (1.0 - wocPaintW)
            * smoothstep(${f(T.bumpGrazing0)}, ${f(T.bumpGrazing1)},
                abs(dot(normal, normalize(vViewPosition))));
          normal = wocBumpNormal(-vViewPosition, normal, wocBumpD * wocBumpFade, faceDirection,
            ${f(T.bumpMaxSlope)});
        }`;
}
