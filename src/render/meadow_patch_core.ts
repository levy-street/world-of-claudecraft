// The Eastbrook meadow patch: WHERE grass grows inside the meadow scope
// (meadow_scope_core.ts), how tall each clump stands and which way its colour
// leans. Read per cell by every grass layer, the near blade carpet
// (blade_grass.ts), the mid band (blade_grass_band.ts) and the card tufts
// (foliage.ts), so the three draw ONE meadow on every graphics tier: a tier
// changes how many cells it samples, never this answer.
//
// The look it serves (the painted top-down ARPG frame): mostly painted ground,
// with real grass in soft clumps and drifts over a small share of open ground,
// and thick, slightly TALLER growth hugging the edges of things: path borders,
// wall and building bases, rocks, tree trunks and the clustered bushes
// (meadow_bush_core.ts). Roads, paths and the town ground stay bare, behind a
// feathered border whose line wanders. Nothing is laid on a grid or a straight
// line: the field is three octaves of seeded value noise (a stretched drift, a
// clump and a fraying tuft octave), each rotated off the world axes, the first
// two domain-warped.
//
// Outside the scope every sample is the stock carpet exactly (cover 1, unit
// size and tint, the stock verge taper), so the other zones draw as shipped.
//
// Pure: sim reads only (no Three, no DOM, no GFX). A consumer takes the one
// context of its world (`meadowPatchContext`, built once and shared by every
// layer) and calls `meadowPatchGrows` per cell after its own cheap gates and
// before any terrain sample, so the cells this keeps bare never pay for one;
// it then sizes and tints a growing cell from the context's sample.

import { getActiveWorldContent } from '../sim/data';
import { noise2 } from '../sim/rng';
import type { WorldContent } from '../sim/types';
import { eastbrookGrassExclusions, hashAt } from './foliage_core';
import {
  createGrassClearanceIndex,
  type GrassClearanceIndex,
  type GrassInstancePatch,
  grassClearanceAt,
} from './grass_edge_taper_core';
import {
  MEADOW_BUSH_FOOTPRINT,
  MEADOW_ROCK_RADIUS_PER_SCALE,
  MEADOW_TRUNK_RADIUS_PER_SCALE,
  meadowBushPlacements,
} from './meadow_bush_core';
import {
  type MeadowScope,
  meadowScopeDecorations,
  meadowScopeFor,
  meadowScopeWeight,
  smoothstep01,
} from './meadow_scope_core';
import {
  paintedGroundMacro,
  paintedGroundMacroVersion,
  samplePaintedGroundMacro,
} from './painted_ground_macro_core';
import {
  coverMasksAt,
  type MacroSampler,
  type MacroStats,
  resolveCobbleLanes,
  resolveCobbleTowns,
  townCobbleAt,
} from './terrain_painted_ground_core';

// ---------------------------------------------------------------------------
// Tunable knobs (by eye)
// ---------------------------------------------------------------------------

/** The open-ground field's grow threshold: higher keeps more ground bare. Tuned
 *  so open vale ground (away from every edge) is roughly 15 to 35 percent grass
 *  by area, pinned by tests/meadow_patch_core.test.ts. */
export const MEADOW_PATCH_THRESHOLD = 0.605;
/** Half-width of the field's soft edge: a clump thins over this much field
 *  value (about a yard or two on the ground) instead of stopping on a line. */
export const MEADOW_PATCH_SOFTNESS = 0.055;
/** Yards per lattice cell of the slow drift octave, and its stretch along its
 *  own axis (drifts run long, like wind-laid growth). */
export const MEADOW_PATCH_DRIFT_YARDS = 13;
export const MEADOW_PATCH_DRIFT_STRETCH = 1.8;
/** Yards per lattice cell of the clump octave. */
export const MEADOW_PATCH_CLUMP_YARDS = 3.9;
/** Yards per lattice cell of the fine tuft octave that frays clump outlines. */
export const MEADOW_PATCH_TUFT_YARDS = 1.7;
/** How much of the field the drift and tuft octaves carry (clumps the rest). */
export const MEADOW_PATCH_DRIFT_WEIGHT = 0.46;
export const MEADOW_PATCH_TUFT_WEIGHT = 0.13;
/** Domain warp: how far (yards) a sample is pushed before the octaves read it. */
export const MEADOW_PATCH_WARP_YARDS = 5;

/** Clump height: a clump's rim stands at the low end, its heart at its own
 *  peak, which varies clump to clump between the two peak bounds. */
export const MEADOW_CLUMP_RIM_HEIGHT = 0.5;
export const MEADOW_CLUMP_PEAK_MIN = 0.85;
export const MEADOW_CLUMP_PEAK_MAX = 1.4;
/** Field value above the threshold at which a clump reaches its peak. */
export const MEADOW_CLUMP_DEPTH = 0.16;
/** Clump width: a short rim spreads to MIN, a clump at its peak to MIN + GAIN. */
export const MEADOW_CLUMP_WIDTH_MIN = 0.9;
export const MEADOW_CLUMP_WIDTH_GAIN = 0.16;

/** Roads and paths: no grass inside CLEAR yards of the centreline (the dirt
 *  paint), a feathered toe over TOE yards, a verge of edge growth out to VERGE
 *  yards past the toe, fading over FADE. The clear line wanders by WANDER. */
export const MEADOW_ROAD_CLEAR = 2.3;
export const MEADOW_ROAD_TOE = 0.8;
export const MEADOW_ROAD_VERGE = 1.9;
export const MEADOW_ROAD_FADE = 1.8;
export const MEADOW_ROAD_WANDER = 0.45;

/** Built edges (walls, building bases, fences): the toe past the padded
 *  boundary, the band of edge growth and its fade. */
export const MEADOW_WALL_PADDING = 0.6;
export const MEADOW_WALL_TOE = 0.45;
export const MEADOW_WALL_BAND = 1.1;
export const MEADOW_WALL_FADE = 1.5;

/** Rings round rocks, tree trunks and bushes: grass tucks right against the
 *  body and thins out by RING yards past it. Trunks ring a little weaker. */
export const MEADOW_RING_YARDS = 1.6;
export const MEADOW_TRUNK_RING_STRENGTH = 0.72;
export const MEADOW_BUSH_RING_STRENGTH = 0.9;

/** Edge growth stands this tall (times the shipped cluster) once past its toe. */
export const MEADOW_EDGE_HEIGHT = 1.24;
/** Edge growth starts this short right at its toe, rising to full over it. */
export const MEADOW_EDGE_TOE_HEIGHT = 0.72;
/** Verge strength: thick reaches and thin reaches along every edge. */
export const MEADOW_VERGE_MIN = 0.35;

/** Town ground: the hub's own disc plus a lot round each building near it (the
 *  building's half-diagonal plus LOT_MARGIN; full town weight a feather inside
 *  that), feathered over TOWN_FEATHER yards (wandering by TOWN_WANDER). Open
 *  clumps are cut by OPEN_CUT there, edge growth by EDGE_CUT (sparse tufts
 *  still hug the house walls and rocks). */
export const MEADOW_TOWN_REACH = 110;
export const MEADOW_TOWN_HUB_SCALE = 1.1;
export const MEADOW_TOWN_LOT_MARGIN = 11;
export const MEADOW_TOWN_FEATHER = 8;
export const MEADOW_TOWN_WANDER = 3;
export const MEADOW_TOWN_OPEN_CUT = 0.97;
export const MEADOW_TOWN_EDGE_CUT = 0.5;
/** Town streets keep only a trace of verge (cut harder than a wall's foot). */
export const MEADOW_TOWN_VERGE_CUT = 0.85;

/** Colour: each clump leans between sunlit yellow-green and shaded teal-green.
 *  These are the full-lean multipliers; the tone noise rarely reaches them. */
export const MEADOW_TONE_SUN: readonly [number, number, number] = [1.07, 1.03, 0.88];
export const MEADOW_TONE_SHADE: readonly [number, number, number] = [0.9, 0.99, 1.08];
/** Yards per lattice cell of the tone noise (a few clumps share a lean). */
export const MEADOW_TONE_YARDS = 17;
/** Edge growth against a wall leans this far toward the shade tone. */
export const MEADOW_WALL_SHADE = 0.45;

/** Whole-cluster lean multiplier inside the scope (neighbouring tufts tip
 *  further apart than the shipped crop). */
export const MEADOW_PATCH_LEAN = 1.35;

/** The painted ground's leaf litter and bare earth (terrain_painted_ground_core
 *  coverMasksAt, their combined share of the grass weight, 0 to about 0.82):
 *  blades thin from START to FULL, keeping 1 - THIN of the cells in a patch's
 *  heart (turf poking through, the ground's own rule), and stand SHORTEN lower. */
export const MEADOW_LITTER_START = 0.08;
export const MEADOW_LITTER_FULL = 0.5;
export const MEADOW_LITTER_THIN = 0.88;
export const MEADOW_LITTER_SHORTEN = 0.3;
/** The painted ground's town cobbles (its dirt weight times townCobbleAt): no
 *  blade once the cobble lane reaches FULL, feathered in from START. */
export const MEADOW_COBBLE_START = 0.08;
export const MEADOW_COBBLE_FULL = 0.3;

/** The largest height or width multiplier a sample can return: a carpet widens
 *  its culling bound by this inside the scope so a tall clump never pops at a
 *  sector edge. */
export const MEADOW_PATCH_MAX_STRETCH = Math.max(
  MEADOW_CLUMP_PEAK_MAX,
  MEADOW_EDGE_HEIGHT,
  MEADOW_CLUMP_WIDTH_MIN + MEADOW_CLUMP_WIDTH_GAIN,
);

// rotations off the world axes, so no octave's lattice lines up with a road,
// a wall or the world grid (irrational-ish angles in radians)
const DRIFT_COS = Math.cos(0.61);
const DRIFT_SIN = Math.sin(0.61);
const CLUMP_COS = Math.cos(2.17);
const CLUMP_SIN = Math.sin(2.17);
const PEAK_COS = Math.cos(1.13);
const PEAK_SIN = Math.sin(1.13);
const WARP_FREQ = 1 / 19;

const S_WARP_X = 0x2a1;
const S_WARP_Z = 0x2a3;
const S_DRIFT = 0x2a7;
const S_CLUMP = 0x2ad;
const S_PEAK = 0x2b3;
const S_TONE = 0x2b9;
const S_VERGE = 0x2bf;
const S_WANDER = 0x2c5;
const S_TOWN = 0x2cb;
const S_TUFT = 0x2d1;

/**
 * The open-ground field at (x, z), in [0, 1]: a slow, stretched drift octave, a
 * finer clump octave (both rotated off the world axes and read through a domain
 * warp) and a fine tuft octave that frays their outlines. Grass grows where it
 * rises past MEADOW_PATCH_THRESHOLD.
 */
export function meadowPatchField(seed: number, x: number, z: number): number {
  const wx =
    x + (noise2(x * WARP_FREQ, z * WARP_FREQ, seed + S_WARP_X) - 0.5) * 2 * MEADOW_PATCH_WARP_YARDS;
  const wz =
    z +
    (noise2(x * WARP_FREQ + 17.3, z * WARP_FREQ - 9.1, seed + S_WARP_Z) - 0.5) *
      2 *
      MEADOW_PATCH_WARP_YARDS;
  const du =
    (wx * DRIFT_COS - wz * DRIFT_SIN) / (MEADOW_PATCH_DRIFT_YARDS * MEADOW_PATCH_DRIFT_STRETCH);
  const dv = (wx * DRIFT_SIN + wz * DRIFT_COS) / MEADOW_PATCH_DRIFT_YARDS;
  const drift = noise2(du, dv, seed + S_DRIFT);
  const cu = (wx * CLUMP_COS - wz * CLUMP_SIN) / MEADOW_PATCH_CLUMP_YARDS;
  const cv = (wx * CLUMP_SIN + wz * CLUMP_COS) / MEADOW_PATCH_CLUMP_YARDS;
  const clump = noise2(cu, cv, seed + S_CLUMP);
  // the tuft octave reads the UNwarped position at a third angle: it frays
  // outlines into tufts without dragging along with the warp
  const tu = (x * PEAK_SIN + z * PEAK_COS) / MEADOW_PATCH_TUFT_YARDS;
  const tv = (z * PEAK_SIN - x * PEAK_COS) / MEADOW_PATCH_TUFT_YARDS;
  const tuft = noise2(tu, tv, seed + S_TUFT);
  return (
    drift * MEADOW_PATCH_DRIFT_WEIGHT +
    tuft * MEADOW_PATCH_TUFT_WEIGHT +
    clump * (1 - MEADOW_PATCH_DRIFT_WEIGHT - MEADOW_PATCH_TUFT_WEIGHT)
  );
}

/** Soft clump membership of a field value: 0 bare, 1 inside a clump. */
export function meadowClumpCover(field: number): number {
  return smoothstep01(
    (field - (MEADOW_PATCH_THRESHOLD - MEADOW_PATCH_SOFTNESS)) / (2 * MEADOW_PATCH_SOFTNESS),
  );
}

/** A clump's height at a field value and clump peak: the rim at
 *  MEADOW_CLUMP_RIM_HEIGHT, rising to `peak` toward the clump's heart. */
export function meadowClumpHeight(field: number, peak: number): number {
  const depth = smoothstep01(
    (field - (MEADOW_PATCH_THRESHOLD - MEADOW_PATCH_SOFTNESS)) / MEADOW_CLUMP_DEPTH,
  );
  return MEADOW_CLUMP_RIM_HEIGHT + (peak - MEADOW_CLUMP_RIM_HEIGHT) * depth;
}

/** The peak height of the clump at (x, z): neighbouring clumps differ. */
export function meadowClumpPeak(seed: number, x: number, z: number): number {
  const u = (x * PEAK_COS - z * PEAK_SIN) / 9;
  const v = (x * PEAK_SIN + z * PEAK_COS) / 9;
  const t = noise2(u, v, seed + S_PEAK);
  return MEADOW_CLUMP_PEAK_MIN + (MEADOW_CLUMP_PEAK_MAX - MEADOW_CLUMP_PEAK_MIN) * smoothstep01(t);
}

/** Thick and thin reaches along an edge: [MEADOW_VERGE_MIN, 1]. */
function vergeStrength(seed: number, x: number, z: number): number {
  const t = noise2(x / 7.3 + 11.1, z / 7.3 - 5.7, seed + S_VERGE);
  return MEADOW_VERGE_MIN + (1 - MEADOW_VERGE_MIN) * smoothstep01((t - 0.3) / 0.36);
}

/** A thick reach is also a WIDE one: the band's width follows its strength,
 *  so a verge swells and narrows instead of running as an even ribbon. */
const VERGE_WIDTH_MIN = 0.55;
const VERGE_WIDTH_MAX = 1.45;
function vergeWidth(verge: number): number {
  return (
    VERGE_WIDTH_MIN +
    ((VERGE_WIDTH_MAX - VERGE_WIDTH_MIN) * (verge - MEADOW_VERGE_MIN)) / (1 - MEADOW_VERGE_MIN)
  );
}

/** Farthest a road's or a wall's edge growth reaches past its clear line. */
const ROAD_REACH =
  MEADOW_ROAD_CLEAR +
  MEADOW_ROAD_WANDER +
  MEADOW_ROAD_TOE +
  MEADOW_ROAD_VERGE * VERGE_WIDTH_MAX +
  MEADOW_ROAD_FADE;
const WALL_REACH = MEADOW_WALL_TOE + MEADOW_WALL_BAND * VERGE_WIDTH_MAX + MEADOW_WALL_FADE;

// ---------------------------------------------------------------------------
// The context: built once per world, shared by every grass layer
// ---------------------------------------------------------------------------

interface RingBody {
  readonly x: number;
  readonly z: number;
  /** inside this radius nothing grows (the body covers it) */
  readonly clear: number;
  /** where the ring of edge growth starts (grass tucks against the body) */
  readonly ring: number;
  readonly strength: number;
}

interface TownLot {
  readonly x: number;
  readonly z: number;
  readonly r: number;
}

export interface MeadowPatchContext {
  readonly scope: MeadowScope | null;
  readonly seed: number;
  readonly structures: GrassClearanceIndex | null;
  readonly rings: ReadonlyMap<number, readonly RingBody[]>;
  readonly town: readonly TownLot[];
  /** The scratch `meadowPatchGrows` fills: valid until the next gate on this
   *  context (the taperTuftScales idiom), so read it before asking again. */
  readonly sample: MeadowPatchSample;
  /** The painted ground's masks, when the terrain bound its macro texture
   *  (synced lazily: the splat material may be built after this context). */
  ground: PaintedGroundCover | null;
  groundVersion: number;
}

/** What the blades read of the painted ground: the terrain's own macro texture
 *  and stats (painted_ground_macro_core.ts) and its cobble towns and lanes. */
interface PaintedGroundCover {
  readonly sampler: MacroSampler;
  readonly stats: MacroStats;
  readonly towns: readonly (readonly [number, number, number, number])[];
  readonly lanes: readonly (readonly [number, number, number, number])[];
}

const RING_CELL = 6;
const ringKey = (cx: number, cz: number): number => ((cx & 0xffff) << 16) | (cz & 0xffff);

function indexRings(bodies: readonly RingBody[]): Map<number, RingBody[]> {
  const grid = new Map<number, RingBody[]>();
  for (const body of bodies) {
    const reach = body.ring + MEADOW_RING_YARDS;
    const x0 = Math.floor((body.x - reach) / RING_CELL);
    const x1 = Math.floor((body.x + reach) / RING_CELL);
    const z0 = Math.floor((body.z - reach) / RING_CELL);
    const z1 = Math.floor((body.z + reach) / RING_CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const key = ringKey(cx, cz);
        const list = grid.get(key);
        if (list) list.push(body);
        else grid.set(key, [body]);
      }
    }
  }
  return grid;
}

const EMPTY_RINGS: ReadonlyMap<number, readonly RingBody[]> = new Map();
const contextCache = new WeakMap<MeadowScope, MeadowPatchContext>();
const STOCK_CONTEXT: MeadowPatchContext = {
  scope: null,
  seed: 0,
  structures: null,
  rings: EMPTY_RINGS,
  town: [],
  sample: createMeadowPatchSample(),
  ground: null,
  groundVersion: -1,
};

/**
 * The meadow patch context for the active (or given) world: the scope, the
 * built-edge clearance index, the ring bodies and the town lots. Built once per
 * scope and shared, so the carpet, the band and the tuft ring pay it once (and a
 * graphics rebuild pays nothing). Outside the built-in world it is the stock
 * context, whose every sample is the shipped carpet.
 */
export function meadowPatchContext(
  seed: number,
  content: WorldContent = getActiveWorldContent(),
): MeadowPatchContext {
  const scope = meadowScopeFor(seed, content);
  if (!scope) return STOCK_CONTEXT;
  const cached = contextCache.get(scope);
  if (cached) return cached;
  const townExclusions = eastbrookGrassExclusions(
    content.props.buildings,
    true,
    content.services?.noticeboards ?? [],
  );
  const structures = createGrassClearanceIndex(
    townExclusions,
    content.props.buildings,
    content.grassClear,
    MEADOW_WALL_PADDING,
    WALL_REACH,
  );
  const decorations = meadowScopeDecorations(scope);
  const bodies: RingBody[] = [];
  for (const rock of decorations.rocks) {
    const r = rock.scale * MEADOW_ROCK_RADIUS_PER_SCALE;
    bodies.push({ x: rock.x, z: rock.z, clear: r * 0.78, ring: r * 0.85, strength: 1 });
  }
  for (const tree of decorations.trees) {
    const r = tree.scale * MEADOW_TRUNK_RADIUS_PER_SCALE;
    bodies.push({
      x: tree.x,
      z: tree.z,
      clear: r,
      ring: r + 0.1,
      strength: MEADOW_TRUNK_RING_STRENGTH,
    });
  }
  for (const bush of meadowBushPlacements(seed, content)) {
    const r = bush.scale * MEADOW_BUSH_FOOTPRINT[bush.kind];
    bodies.push({
      x: bush.x,
      z: bush.z,
      clear: r * 0.35,
      ring: r * 0.75,
      strength: MEADOW_BUSH_RING_STRENGTH,
    });
  }
  const hub = scope.hub;
  const town: TownLot[] = [{ x: hub.x, z: hub.z, r: hub.radius * MEADOW_TOWN_HUB_SCALE }];
  for (const b of content.props.buildings) {
    if (Math.hypot(b.x - hub.x, b.z - hub.z) > MEADOW_TOWN_REACH) continue;
    town.push({ x: b.x, z: b.z, r: 0.5 * Math.hypot(b.w, b.d) + MEADOW_TOWN_LOT_MARGIN });
  }
  const ctx: MeadowPatchContext = {
    scope,
    seed,
    structures,
    rings: indexRings(bodies),
    town,
    sample: createMeadowPatchSample(),
    ground: null,
    groundVersion: -1,
  };
  syncPaintedGround(ctx);
  contextCache.set(scope, ctx);
  return ctx;
}

/**
 * Point the context at the painted ground the terrain bound last (or at none).
 * Cheap when nothing changed: one version compare. Not tier-gated on purpose:
 * a tier whose terrain draws no painted ground (Low, the iOS memory profile)
 * records no macro texture, so its grass follows its own plain ground.
 */
function syncPaintedGround(ctx: MeadowPatchContext): void {
  const version = paintedGroundMacroVersion();
  if (version === ctx.groundVersion) return;
  ctx.groundVersion = version;
  const macro = paintedGroundMacro();
  const content = ctx.scope?.content;
  if (!macro || !content) {
    ctx.ground = null;
    return;
  }
  ctx.ground = {
    sampler: (u, v) => samplePaintedGroundMacro(macro, u, v),
    stats: { mean: macro.mean, sd: macro.sd },
    towns: resolveCobbleTowns(content.zones),
    lanes: resolveCobbleLanes(content.zones),
  };
}

/**
 * The terrain's dirt weight at a road distance and a distance to the zone hub:
 * the splat tiers' road shoulder (full to 1.9 yards from the centreline, eased
 * out by 3.6) and the hub's packed disc (inside 14 yards, eased over its outer
 * 3), the weights terrain_chunk_build.ts lays (pinned against its source by
 * tests/meadow_patch_core.test.ts). The painted ground lays its cobbles on
 * exactly this weight.
 */
export function paintedDirtWeight(roadDist: number, hubDist: number): number {
  let road = 0;
  if (roadDist < 1.9) road = 0.88;
  else if (roadDist < 3.6) road = 0.88 * smoothstep01(1 - (roadDist - 1.9) / 1.7);
  const hub = hubDist < 14 ? 0.75 * Math.min(1, (14 - hubDist) / 3) : 0;
  return road > hub ? road : hub;
}

// ---------------------------------------------------------------------------
// The sample
// ---------------------------------------------------------------------------

/** What one cell of grass takes from the patch. Multipliers over the stock
 *  carpet; every field is exactly the stock value outside the scope. */
export interface MeadowPatchSample extends GrassInstancePatch {
  /** 0 outside the scope, 1 fully inside it (the feathered border between). */
  scope: number;
  /** Chance a candidate cell grows, [0, 1] (stock 1). */
  cover: number;
  /** Height and width multipliers (stock 1). */
  height: number;
  width: number;
  /** Whole-cluster lean multiplier (stock 1). */
  lean: number;
  /** Linear colour multipliers (stock 1). */
  tintR: number;
  tintG: number;
  tintB: number;
}

export function createMeadowPatchSample(): MeadowPatchSample {
  return { scope: 0, cover: 1, height: 1, width: 1, lean: 1, tintR: 1, tintG: 1, tintB: 1 };
}

function stockSample(out: MeadowPatchSample): MeadowPatchSample {
  out.scope = 0;
  out.cover = 1;
  out.height = 1;
  out.width = 1;
  out.lean = 1;
  out.tintR = 1;
  out.tintG = 1;
  out.tintB = 1;
  return out;
}

/** How much of (x, z) is town ground: 1 on the hub's disc and the building
 *  lots, 0 a feather past them, the line wandering. */
export function meadowTownWeight(ctx: MeadowPatchContext, x: number, z: number): number {
  let best = 0;
  let wander = Number.NaN;
  for (const lot of ctx.town) {
    const inside = lot.r - Math.hypot(x - lot.x, z - lot.z);
    if (inside <= -MEADOW_TOWN_WANDER) continue;
    if (inside >= MEADOW_TOWN_FEATHER + MEADOW_TOWN_WANDER) return 1;
    if (Number.isNaN(wander)) {
      wander = (noise2(x / 6.5, z / 6.5, ctx.seed + S_TOWN) - 0.5) * 2 * MEADOW_TOWN_WANDER;
    }
    const t = smoothstep01((inside + wander) / MEADOW_TOWN_FEATHER);
    if (t > best) best = t;
  }
  return best;
}

/** One cell's edge reading, filled by the per-source passes below. */
interface EdgeState {
  /** soft clearance: 0 on a path, in a wall or under a body, 1 past the toe */
  clear: number;
  /** strongest edge growth after the town cut, and its toe ramp (0 to 1) */
  edge: number;
  toe: number;
  /** how much of the growth stands against a wall (leans its tone shaded) */
  shade: number;
  /** the verge strength here, read once on demand (negative until read) */
  verge: number;
}

const edgeState: EdgeState = { clear: 1, edge: 0, toe: 1, shade: 0, verge: -1 };
const clearance: [number, number] = [0, 0];

function offerEdge(state: EdgeState, band: number, toe: number): void {
  if (band > state.edge) {
    state.edge = band;
    state.toe = toe;
  }
}

/** Paths and roads: bare inside the wandering clear line, a feathered toe,
 *  then a verge that swells and narrows. Town streets keep only a trace. */
function roadEdge(state: EdgeState, seed: number, x: number, z: number, rd: number, town: number) {
  if (rd >= ROAD_REACH) return;
  const wander = (noise2(x / 3.1, z / 3.1, seed + S_WANDER) - 0.5) * 2 * MEADOW_ROAD_WANDER;
  const c = rd - MEADOW_ROAD_CLEAR - wander;
  state.clear *= smoothstep01(c / MEADOW_ROAD_TOE);
  state.verge = vergeStrength(seed, x, z);
  const body = MEADOW_ROAD_TOE + MEADOW_ROAD_VERGE * vergeWidth(state.verge);
  const band = state.verge * (1 - smoothstep01((c - body) / MEADOW_ROAD_FADE));
  offerEdge(
    state,
    band * (1 - MEADOW_TOWN_VERGE_CUT * town),
    smoothstep01(c / (MEADOW_ROAD_TOE * 1.8)),
  );
}

/** Walls, fences and building bases: clear to the padded footprint behind a
 *  short toe, then growth hugging the base (door aprons only clear). */
function wallEdge(
  state: EdgeState,
  index: GrassClearanceIndex,
  seed: number,
  x: number,
  z: number,
  town: number,
): void {
  grassClearanceAt(index, x, z, index.reach, clearance);
  if (clearance[0] < index.reach) state.clear *= smoothstep01(clearance[0] / MEADOW_WALL_TOE);
  if (clearance[1] >= index.reach) return;
  if (state.verge < 0) state.verge = vergeStrength(seed, x, z);
  const c = clearance[1];
  const body = MEADOW_WALL_TOE + MEADOW_WALL_BAND * vergeWidth(state.verge);
  const band = state.verge * (1 - smoothstep01((c - body) / MEADOW_WALL_FADE));
  if (band > state.shade) state.shade = band;
  offerEdge(
    state,
    band * (1 - MEADOW_TOWN_EDGE_CUT * town),
    smoothstep01(c / (MEADOW_WALL_TOE * 1.8)),
  );
}

/** Rocks, trunks and bushes: bare under the body, a ring tucked against it. */
function ringEdge(state: EdgeState, ctx: MeadowPatchContext, x: number, z: number, town: number) {
  const rings = ctx.rings.get(ringKey(Math.floor(x / RING_CELL), Math.floor(z / RING_CELL)));
  if (!rings) return;
  for (let i = 0; i < rings.length; i++) {
    const body = rings[i];
    const d = Math.hypot(x - body.x, z - body.z);
    if (d >= body.ring + MEADOW_RING_YARDS) continue;
    if (d <= body.clear) {
      state.clear = 0;
      return;
    }
    // each body rings its own way: some thick, some sparse
    const own = 0.45 + 0.55 * hashAt(body.x, body.z, 131);
    const band = body.strength * own * (1 - smoothstep01((d - body.ring) / MEADOW_RING_YARDS));
    offerEdge(state, band * (1 - MEADOW_TOWN_EDGE_CUT * town), 1);
  }
}

/** The tint a clump takes: sunlit yellow-green or shaded teal-green, leaning
 *  shaded where it stands against a wall. Written into `out`'s tint fields. */
function toneTint(seed: number, x: number, z: number, shade: number, out: MeadowPatchSample): void {
  let tone = (noise2(x / MEADOW_TONE_YARDS, z / MEADOW_TONE_YARDS, seed + S_TONE) - 0.5) * 2.4;
  tone -= shade * MEADOW_WALL_SHADE;
  if (tone > 1) tone = 1;
  else if (tone < -1) tone = -1;
  const sun = tone > 0 ? tone : 0;
  const dark = tone < 0 ? -tone : 0;
  out.tintR = (1 + (MEADOW_TONE_SUN[0] - 1) * sun) * (1 + (MEADOW_TONE_SHADE[0] - 1) * dark);
  out.tintG = (1 + (MEADOW_TONE_SUN[1] - 1) * sun) * (1 + (MEADOW_TONE_SHADE[1] - 1) * dark);
  out.tintB = (1 + (MEADOW_TONE_SUN[2] - 1) * sun) * (1 + (MEADOW_TONE_SHADE[2] - 1) * dark);
}

/**
 * Sample the patch at (x, z) into `out`. `roadDist` is the caller's
 * roadDistance(x, z) (every grass layer already pays it). Cheap: a handful of
 * value-noise reads plus bucket lookups, no terrain sample.
 */
export function sampleMeadowPatch(
  ctx: MeadowPatchContext,
  x: number,
  z: number,
  roadDist: number,
  out: MeadowPatchSample,
): MeadowPatchSample {
  const w = meadowScopeWeight(ctx.scope, x, z);
  if (w <= 0) return stockSample(out);
  const seed = ctx.seed;
  const town = meadowTownWeight(ctx, x, z);

  // open ground: soft clumps and drifts, all but gone on the town ground
  const field = meadowPatchField(seed, x, z);
  const openCover = meadowClumpCover(field) * (1 - MEADOW_TOWN_OPEN_CUT * town);
  const openHeight = openCover > 0 ? meadowClumpHeight(field, meadowClumpPeak(seed, x, z)) : 1;

  // edges: the toe that keeps a feathered border bare, and the growth past it
  const state = edgeState;
  state.clear = 1;
  state.edge = 0;
  state.toe = 1;
  state.shade = 0;
  state.verge = -1;
  roadEdge(state, seed, x, z, roadDist, town);
  if (ctx.structures) wallEdge(state, ctx.structures, seed, x, z, town);
  if (state.clear > 0) ringEdge(state, ctx, x, z, town);

  // the painted ground agrees: no blade on its cobbles, few on its leaf litter
  // and bare earth (the terrain's own masks, read only where a blade could grow)
  let litter = 0;
  syncPaintedGround(ctx);
  const ground = ctx.ground;
  if (ground && state.clear > 0 && (openCover > 0 || state.edge > 0)) {
    const masks = coverMasksAt(x, z, 1, ground.sampler, ground.stats);
    litter = smoothstep01(
      (masks.leaf + masks.earth - MEADOW_LITTER_START) / (MEADOW_LITTER_FULL - MEADOW_LITTER_START),
    );
    const cobble = townCobbleAt(x, z, ground.towns, masks.repeatZ, ground.lanes);
    if (cobble > 0) {
      const hub = ctx.scope?.hub;
      const hubDist = hub ? Math.hypot(x - hub.x, z - hub.z) : Number.POSITIVE_INFINITY;
      const lane = cobble * paintedDirtWeight(roadDist, hubDist);
      state.clear *=
        1 - smoothstep01((lane - MEADOW_COBBLE_START) / (MEADOW_COBBLE_FULL - MEADOW_COBBLE_START));
    }
  }
  const cover = state.clear * Math.max(openCover, state.edge) * (1 - MEADOW_LITTER_THIN * litter);

  // height: the cover-weighted blend of the clump and the edge profile (edge
  // growth starts short at its toe); taller clumps spread a touch wider
  const edgeHeight =
    MEADOW_EDGE_TOE_HEIGHT + (MEADOW_EDGE_HEIGHT - MEADOW_EDGE_TOE_HEIGHT) * state.toe;
  const sum = openCover + state.edge;
  const height =
    (sum > 1e-6 ? (openCover * openHeight + state.edge * edgeHeight) / sum : 1) *
    (1 - MEADOW_LITTER_SHORTEN * litter);
  const rise =
    (height - MEADOW_CLUMP_RIM_HEIGHT) / (MEADOW_CLUMP_PEAK_MAX - MEADOW_CLUMP_RIM_HEIGHT);
  const width = MEADOW_CLUMP_WIDTH_MIN + MEADOW_CLUMP_WIDTH_GAIN * Math.min(1, Math.max(0, rise));
  toneTint(seed, x, z, state.shade, out);

  // the scope weight blends every answer from the stock carpet
  out.scope = w;
  out.cover = 1 + (cover - 1) * w;
  out.height = 1 + (height - 1) * w;
  out.width = 1 + (width - 1) * w;
  out.lean = 1 + (MEADOW_PATCH_LEAN - 1) * w;
  out.tintR = 1 + (out.tintR - 1) * w;
  out.tintG = 1 + (out.tintG - 1) * w;
  out.tintB = 1 + (out.tintB - 1) * w;
  return out;
}

/**
 * The one gate every grass layer calls: sample the patch into `ctx.sample` and
 * say whether the cell grows, `roll` being the cell's own hash in [0, 1) (a salt
 * the caller uses for nothing else, so the gate never correlates with the
 * cell's jitter or yaw). Outside the scope this is always true and the sample
 * is the stock carpet. The caller then sizes and tints the cell from
 * `ctx.sample`, before its next gate.
 */
export function meadowPatchGrows(
  ctx: MeadowPatchContext,
  x: number,
  z: number,
  roadDist: number,
  roll: number,
): boolean {
  return roll < sampleMeadowPatch(ctx, x, z, roadDist, ctx.sample).cover;
}

/** Multiply a linear colour (a THREE.Color, or any {r, g, b}) by the sample's tint. */
export function applyMeadowPatchTint(
  sample: MeadowPatchSample,
  color: { r: number; g: number; b: number },
): void {
  color.r *= sample.tintR;
  color.g *= sample.tintG;
  color.b *= sample.tintB;
}

const accentScratch: [number, number, number] = [1, 1, 1];
const UNIT_ACCENT: readonly [number, number, number] = [1, 1, 1];

/** A card tuft's biome accent with the sample's tint folded in (the tuft colour
 *  path multiplies the accent into its ground-keyed gain). Returns a scratch. */
export function meadowPatchAccent(
  sample: MeadowPatchSample,
  accent: readonly [number, number, number] | undefined,
): readonly [number, number, number] {
  const a = accent ?? UNIT_ACCENT;
  if (sample.scope <= 0) return a;
  accentScratch[0] = a[0] * sample.tintR;
  accentScratch[1] = a[1] * sample.tintG;
  accentScratch[2] = a[2] * sample.tintB;
  return accentScratch;
}
