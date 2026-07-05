import { DUNGEON_FLOOR_Y, DUNGEON_X_THRESHOLD, getActiveWorldContent, WORLD_MAX_X } from './data';
import { fbm2, hash2 } from './rng';
import type { BiomeId, HeightStamp, WorldContent } from './types';

// Terrain is a pure function of (x, z, seed) for a given active world content:
// both the sim (ground clamping) and the renderer (mesh) sample the same
// heightfield, so they always agree. The active content is the built-in 3-zone
// world by default (data.ts BUILTIN_WORLD); the editor swaps in a custom map for
// play-testing via setActiveWorldContent. With the built-in world this file
// behaves exactly as before (byte-identical heightfield).
//
// The world is a north-running strip of zone bands (see ZONES in data.ts).
// Each biome shapes the heightfield differently — the vale rolls, the marsh
// lies low and flat, the peaks tower — with smooth blends at the boundaries
// and a mountain ridge wall between zones, pierced by a road pass.

const HILL_SCALE = 0.013;
const DETAIL_SCALE = 0.05;

// The built-in world's water surface height. Fixed-content call sites (tests,
// built-in tuning constants) may use the const; anything that must respect a
// custom map's water goes through waterLevel() below.
export const WATER_LEVEL = -4.5;

// The ACTIVE water surface height: the custom map's level if one is loaded, else
// the built-in constant. Cheap (identity-cached content lookup), safe in hot paths.
export function waterLevel(): number {
  return world().content.waterLevel ?? WATER_LEVEL;
}

// Hill amplitude / base elevation / hub plateau height per biome.
const BIOME_SHAPE: Record<BiomeId, { hill: number; base: number; hubHeight: number }> = {
  vale: { hill: 26, base: 0, hubHeight: 1.5 },
  marsh: { hill: 11, base: -1.0, hubHeight: 1.2 },
  peaks: { hill: 34, base: 7, hubHeight: 9 },
  // Paint-only biomes (the editor's biome brush): never a zone band in the
  // built-in world, so these rows only shape painted cells on custom maps.
  beach: { hill: 5, base: -2.4, hubHeight: 0.8 },
  desert: { hill: 15, base: 2.5, hubHeight: 2 },
  volcano: { hill: 42, base: 9, hubHeight: 6 },
  cave: { hill: 9, base: 1, hubHeight: 1 },
};

// Per-active-content derived terrain inputs: the ridge walls between zone bands
// and the world z-bounds. Recomputed only when the active content object changes
// (identity check), so the hot terrain path stays cheap. For the built-in world
// these match the old module-level constants exactly.
interface WorldDerived {
  content: WorldContent;
  ridges: { z: number; passX: number }[];
  minZ: number;
  maxZ: number;
}
let derivedCache: WorldDerived | null = null;
function world(): WorldDerived {
  const content = getActiveWorldContent();
  if (!derivedCache || derivedCache.content !== content) {
    const ridges: { z: number; passX: number }[] = [];
    for (let i = 0; i + 1 < content.zones.length; i++) {
      ridges.push({ z: content.zones[i].zMax, passX: 0 });
    }
    derivedCache = {
      content,
      ridges,
      minZ: content.zones[0].zMin,
      maxZ: content.zones[content.zones.length - 1].zMax,
    };
  }
  return derivedCache;
}

// Tall and narrow on purpose: every crossing outside the road pass must be
// steeper than the movement climb limit (rise/run 1.5, see sim.ts
// MAX_CLIMB_SLOPE) so the walls are genuinely impassable, not scenery.
// tests/terrain_walls.test.ts guards this.
const RIDGE_HEIGHT = 40;
const RIDGE_SIGMA = 10; // gaussian width of the wall
const PASS_HALF_WIDTH = 10; // flat opening around the road
const PASS_SHOULDER = 34; // ...rising to full wall by this far from the pass

// Terracing turns the smooth ridge/rim rise into stair-stepped bands (flat
// tread then a steep riser) instead of one uniform ramp, so mountainsides
// read as a stacked rocky slope. TERRACE_STEP is the height of one band;
// TERRACE_TREAD is the fraction of each band that stays flat before the
// riser rises through the rest. Purely a reshaping of the already-computed
// mountain rise (see terraceStep below): it cannot lower the overall climb
// gate below the smooth original at the points tests/terrain_walls.test.ts
// samples, since every riser is at least as steep as the ramp it replaces.
// The three terrace parameters are exported only so tests/terrace_step.test.ts
// can pin the production values as literals.
export const TERRACE_STEP = 6;
export const TERRACE_TREAD = 0.6;
// Fraction of the smooth rise kept as a linear talus apron under the first
// band. Without it, any rise below TERRACE_TREAD * TERRACE_STEP terraces to
// exactly 0 and the foot of every wall becomes a dead-flat plain, erasing
// placed landmarks that lean on that rise (the Mirefen impact site sits
// against a 3.1yd wall base; tests/impact_site.test.ts pins it).
export const TERRACE_APRON = 0.5;

// Past the playable rim, the crest noise and terracing fade back to the
// original smooth berm plateau. The overshoot space is never rendered (the
// terrain mesh covers exactly the world rectangle) and never reachable in
// play (the rim is impassable), but the sim relies on it as a flat staging
// ground: dev teleports, the /follow and chat tests, parity scenarios, and
// bot tooling all park entities out there (some as close as ~20yd past the
// edge), and jagged terraced crags would strand them behind risers steeper
// than the climb limit (tests/follow.test.ts walks a follower at z = -1000).
// Full mountain character is kept through OUTSIDE_FADE_START yd beyond the
// edge (so every in-world sample stays bit-identical and edge-vertex normal
// sampling never crosses the fade); by OUTSIDE_FADE_END the rise is the
// smooth berm again (tests/terrain_walls.test.ts pins the flat plateau).
// NOTE: the transition band itself (START..END yd out) is a crag-to-berm
// cliff, steeper than the climb limit in places; "flat staging ground" only
// holds PAST OUTSIDE_FADE_END. Anything staged in the overshoot must sit at
// least OUTSIDE_FADE_END + a couple yd out (existing users are all >= ~20yd).
const OUTSIDE_FADE_START = 2;
const OUTSIDE_FADE_END = 10;

// Quantizes a non-negative rise into `step`-height bands: flat for the first
// `tread` fraction of each band, then a smoothed climb through the rest. The
// first band keeps a linear apron floor (`apron` fraction of the smooth rise,
// capped at `step * apron`) so wall feet stay sloped; the floor can never
// reach past band 0 because every higher band already sits at >= step.
// Continuous and monotonic in v; terraceStep(0) === 0 exactly, so callers can
// add this in unconditionally. Exported for its unit test only.
export function terraceStep(v: number, step: number, tread: number, apron: number): number {
  if (v <= 0) return 0;
  const band = Math.floor(v / step);
  const frac = v / step - band;
  const riser = frac < tread ? 0 : smoothstep(tread, 1, frac);
  return Math.max((band + riser) * step, Math.min(v, step) * apron);
}

export const MIREFEN_IMPACT_CRATER = {
  x: 149.5,
  z: 295,
  bowlRadius: 20,
  radius: 30,
  depth: 2.6,
  rimHeight: 0.95,
} as const;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ---------------------------------------------------------------------------
// The custom-map edit layer (the sculpt brushes), applied to the height computed
// so far. Stamps apply in array order; pure data, no RNG, so the sim and renderer
// agree. `add` stamps add a falloff-weighted delta; `level` stamps pull the height
// toward the absolute height `delta` (flatten/plateau/terrace). The built-in world
// has no edits, so the heightfield is unchanged.
//
// Stamps are looked up through a coarse spatial bucket index (cell 32yd; each
// stamp registered in every cell its radius's bounding box touches) instead of
// a linear scan: the render chunk rebuilder samples terrainHeight 5x per
// vertex, so with the 4000-stamp cap the linear scan grows editor brush cost
// with session length. Determinism contract: candidates for a query point are
// iterated in ascending original array index (each bucket is built in index
// order and a stamp appears at most once per bucket), so float addition order
// is bit-identical to the linear scan. The index is a pure cache keyed by the
// terrainEdits array reference + length; it is rebuilt when either differs and
// cleared by invalidateTerrainEditIndex() for same-length in-place mutations.
// ---------------------------------------------------------------------------

const EDIT_INDEX_CELL = 32; // yards per bucket cell
// A stamp this large would touch an unbounded number of cells; index none and
// fall back to the (bit-identical) linear scan. The document sanitizer caps
// stamp radius at 200, so this only guards hostile in-memory content.
const EDIT_INDEX_MAX_RADIUS = 4096;

interface TerrainEditIndex {
  length: number;
  linear: boolean; // true = do not use buckets, scan the array
  buckets: Map<string, number[]>; // "cx,cz" -> ascending stamp indices
}

let terrainEditIndexCache = new WeakMap<HeightStamp[], TerrainEditIndex>();

// Clears the edit-layer index cache. The editor MUST call this after a
// splice-style in-place mutation that keeps the array reference and length
// (e.g. replacing a stamp); push/pop/reassignment are picked up automatically
// via the length + reference key. The exact export name is a contract with the
// editor lane: do not rename.
export function invalidateTerrainEditIndex(): void {
  terrainEditIndexCache = new WeakMap();
}

function buildTerrainEditIndex(edits: HeightStamp[]): TerrainEditIndex {
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    if (e.radius <= 0) continue; // the scan skips these too; no cell to register
    // A non-finite stamp (NaN poisons the scan; Infinity reaches everywhere)
    // or an absurd radius cannot be bucketed: reproduce the linear scan's
    // exact semantics by not indexing at all.
    if (
      !Number.isFinite(e.radius) ||
      e.radius > EDIT_INDEX_MAX_RADIUS ||
      !Number.isFinite(e.x) ||
      !Number.isFinite(e.z)
    ) {
      return { length: edits.length, linear: true, buckets: new Map() };
    }
    // One guard cell on every side: sqrt rounding can put a point with
    // d < radius up to ~1 ulp outside the bbox cells at an exact cell
    // boundary. Extra candidates are harmless (applyStamp re-checks d).
    const c0 = Math.floor((e.x - e.radius) / EDIT_INDEX_CELL) - 1;
    const c1 = Math.floor((e.x + e.radius) / EDIT_INDEX_CELL) + 1;
    const r0 = Math.floor((e.z - e.radius) / EDIT_INDEX_CELL) - 1;
    const r1 = Math.floor((e.z + e.radius) / EDIT_INDEX_CELL) + 1;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const key = `${c},${r}`;
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = [];
          buckets.set(key, bucket);
        }
        bucket.push(i); // outer loop is ascending i, so each bucket stays sorted
      }
    }
  }
  return { length: edits.length, linear: false, buckets };
}

// One stamp's contribution, shared verbatim by the indexed and linear paths so
// they are bit-identical.
function applyStamp(e: HeightStamp, x: number, z: number, h: number): number {
  if (e.radius <= 0) return h;
  const dx = x - e.x;
  const dz = z - e.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= e.radius) return h;
  const t = d / e.radius; // 0 at centre, 1 at edge
  // 'flat' = full delta out to the edge; 'smooth' = eased taper to 0.
  const w = e.falloff === 'flat' ? 1 : 1 - smoothstep(0, 1, t);
  if (e.mode === 'level') return lerp(h, e.delta, w);
  return h + e.delta * w;
}

function applyEditLayer(x: number, z: number, h0: number): number {
  const edits = world().content.terrainEdits;
  if (!edits || edits.length === 0) return h0;
  let index = terrainEditIndexCache.get(edits);
  if (!index || index.length !== edits.length) {
    index = buildTerrainEditIndex(edits);
    terrainEditIndexCache.set(edits, index);
  }
  let h = h0;
  if (index.linear) {
    for (const e of edits) h = applyStamp(e, x, z, h);
    return h;
  }
  const key = `${Math.floor(x / EDIT_INDEX_CELL)},${Math.floor(z / EDIT_INDEX_CELL)}`;
  const bucket = index.buckets.get(key);
  if (!bucket) return h0;
  // Any stamp with d < radius has |x - e.x| < radius, so its bounding-box cells
  // cover the query cell: the bucket holds every contributing stamp, in
  // ascending array index, exactly once.
  for (const i of bucket) h = applyStamp(edits[i], x, z, h);
  return h;
}

export function mirefenImpactCraterOffset(x: number, z: number): number {
  const dx = x - MIREFEN_IMPACT_CRATER.x;
  const dz = z - MIREFEN_IMPACT_CRATER.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= MIREFEN_IMPACT_CRATER.radius) return 0;

  const bowlT = d / MIREFEN_IMPACT_CRATER.bowlRadius;
  const bowl =
    d < MIREFEN_IMPACT_CRATER.bowlRadius
      ? -MIREFEN_IMPACT_CRATER.depth * (1 - smoothstep(0, 1, bowlT))
      : 0;

  const rimStart = MIREFEN_IMPACT_CRATER.bowlRadius * 0.82;
  if (d <= rimStart) return bowl;
  const rimT = (d - rimStart) / (MIREFEN_IMPACT_CRATER.radius - rimStart);
  const rim =
    MIREFEN_IMPACT_CRATER.rimHeight * smoothstep(0, 0.35, rimT) * (1 - smoothstep(0.72, 1, rimT));
  return bowl + rim;
}

// Paint grid id -> biome. APPEND-ONLY: the id is persisted in map documents.
export const BIOME_BY_ID: BiomeId[] = [
  'vale',
  'marsh',
  'peaks',
  'beach',
  'desert',
  'volcano',
  'cave',
];

// The painted biome at (x,z), or null if unpainted / no paint layer. Cheap grid
// lookup; absent for the built-in world.
function paintedBiomeAt(x: number, z: number): BiomeId | null {
  const bp = world().content.biomePaint;
  if (!bp) return null;
  const c = Math.floor((x - bp.originX) / bp.cell);
  const r = Math.floor((z - bp.originZ) / bp.cell);
  if (c < 0 || c >= bp.cols || r < 0 || r >= bp.rows) return null;
  const id = bp.ids[r * bp.cols + c];
  return id >= 0 && id < BIOME_BY_ID.length ? BIOME_BY_ID[id] : null;
}

// Biome at a world point: the painted override if any, else the zone-band biome.
// This is the 2D biome the renderer colours by; zoneBiomeAt stays the 1D version.
export function biomeAt(x: number, z: number): BiomeId {
  return paintedBiomeAt(x, z) ?? zoneBiomeAt(z);
}

// Blended biome shape at a point. A painted cell hard-overrides to that biome's
// shape; otherwise zone interiors keep their exact shape and blend across ±~35yd
// windows at the band boundaries. With no paint this equals the old shapeAt(z).
function shapeAt(x: number, z: number): { hill: number; base: number } {
  const painted = paintedBiomeAt(x, z);
  if (painted) {
    const s = BIOME_SHAPE[painted];
    return { hill: s.hill, base: s.base };
  }
  const zones = world().content.zones;
  let hill = BIOME_SHAPE[zones[0].biome].hill;
  let base = BIOME_SHAPE[zones[0].biome].base;
  for (let i = 0; i + 1 < zones.length; i++) {
    const boundary = zones[i].zMax;
    const t = smoothstep(boundary - 30, boundary + 35, z);
    const next = BIOME_SHAPE[zones[i + 1].biome];
    hill = lerp(hill, next.hill, t);
    base = lerp(base, next.base, t);
  }
  return { hill, base };
}

function baseHeight(x: number, z: number, seed: number): number {
  const zones = world().content.zones;
  const shape = shapeAt(x, z);
  let h =
    (fbm2(x * HILL_SCALE + 100, z * HILL_SCALE + 100, seed, 4) - 0.5) * shape.hill + shape.base;
  h += (fbm2(x * DETAIL_SCALE, z * DETAIL_SCALE, seed + 7, 2) - 0.5) * 2.2;
  // Flatten each zone's hub settlement into a plateau
  for (const zone of zones) {
    const dx = x - zone.hub.x,
      dz = z - zone.hub.z;
    const dHub = Math.sqrt(dx * dx + dz * dz);
    if (dHub < zone.hub.radius * 1.6) {
      const blend = smoothstep(zone.hub.radius * 0.7, zone.hub.radius * 1.6, dHub);
      h = h * blend + BIOME_SHAPE[zone.biome].hubHeight * (1 - blend);
    }
  }
  // Keep dry land everywhere: soft-floor low dips above the water level...
  const minLand = waterLevel() + 1.4;
  if (h < minLand) h = minLand - (minLand - h) * 0.12;
  // ...except the carved lake basins
  for (const zone of zones) {
    for (const lake of zone.lakes) {
      const dLake = Math.sqrt((x - lake.x) ** 2 + (z - lake.z) ** 2);
      if (dLake < lake.radius * 1.6) {
        const lakeBlend = smoothstep(lake.radius * 0.55, lake.radius * 1.6, dLake);
        h = h * lakeBlend + (waterLevel() - 4) * (1 - lakeBlend);
      }
    }
  }
  return h;
}

// Ground height including instanced dungeon floors (flat, far off-world).
export function groundHeight(x: number, z: number, seed: number): number {
  if (x > DUNGEON_X_THRESHOLD) return DUNGEON_FLOOR_Y;
  return terrainHeight(x, z, seed);
}

export function terrainHeight(x: number, z: number, seed: number): number {
  const w = world();
  let h = baseHeight(x, z, seed);

  // Flatten each camp a little so mobs don't stand on cliffs
  for (const camp of w.content.camps) {
    const dx = x - camp.center.x,
      dz = z - camp.center.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < camp.radius * 1.8) {
      const ch = baseHeight(camp.center.x, camp.center.z, seed);
      const blend = smoothstep(camp.radius * 0.8, camp.radius * 1.8, d);
      h = h * blend + ch * (1 - blend);
    }
  }

  // How far outside the playable rectangle this sample is (0 everywhere
  // in-world), and the resulting fade on all mountain character (crest noise
  // + terracing); see OUTSIDE_FADE_START above.
  const beyond = Math.max(0, w.minZ - z, z - w.maxZ, Math.abs(x) - WORLD_MAX_X);
  const mountainDetail = 1 - smoothstep(OUTSIDE_FADE_START, OUTSIDE_FADE_END, beyond);

  // Mountain ridge walls between zones, pierced by the road pass
  let mountainAdd = 0;
  for (const ridge of w.ridges) {
    const dz = Math.abs(z - ridge.z);
    if (dz < RIDGE_SIGMA * 3) {
      const profile = Math.exp(-(dz * dz) / (2 * RIDGE_SIGMA * RIDGE_SIGMA));
      const pass = smoothstep(PASS_HALF_WIDTH, PASS_SHOULDER, Math.abs(x - ridge.passX));
      // jagged crest so the wall reads as mountains, not a berm: a coarse layer
      // for peak/saddle shape plus a finer layer for crag/shoulder detail.
      // Combined variance kept tight so the lowest saddle still beats the
      // climb limit (tests/terrain_walls.test.ts).
      // (each noise term is scaled by mountainDetail separately: multiplying
      // by an exact 1 keeps in-world samples bit-identical, where regrouping
      // the sum would drift them by ULPs and desync the parity goldens)
      const crest =
        1 +
        (fbm2(x * 0.03, ridge.z * 0.03, seed + 19, 2) - 0.5) * 0.4 * mountainDetail +
        (fbm2(x * 0.11, ridge.z * 0.11, seed + 23, 2) - 0.5) * 0.14 * mountainDetail;
      mountainAdd += RIDGE_HEIGHT * crest * profile * pass;
    }
  }

  // Raise the world rim so the player naturally stays in bounds. Like the zone
  // ridges, the rise is steeper than the climb limit everywhere (guarded by
  // tests/terrain_walls.test.ts); it starts where it always did (30yd inside,
  // the Mirefen impact site leans on that wall base) but peaks before the
  // boundary so the whole climb happens in-world.
  const rimX = smoothstep(WORLD_MAX_X - 30, WORLD_MAX_X - 6, Math.abs(x));
  const rimS = smoothstep(w.minZ + 30, w.minZ + 6, z);
  const rimN = smoothstep(w.maxZ - 30, w.maxZ - 6, z);
  const rim = Math.max(rimX, rimS, rimN);
  // The rim wall used to be a perfectly smooth berm (no noise at all), which
  // read as artificial from a distance. Give it the same two-layer jagged
  // crest as the inter-zone ridges: a coarse peak/saddle layer plus a finer
  // crag layer, same conservative combined variance so the climb-limit
  // invariant still holds along the whole rim.
  const rimCrest =
    1 +
    (fbm2(x * 0.025, z * 0.025, seed + 29, 3) - 0.5) * 0.35 * mountainDetail +
    (fbm2(x * 0.09, z * 0.09, seed + 37, 2) - 0.5) * 0.15 * mountainDetail;
  mountainAdd += rim * 55 * rimCrest;
  // Terrace the combined mountain rise into stair-stepped bands (flat treads
  // + steep risers) instead of one smooth ramp, so slopes read as a stacked
  // rocky mountainside rather than a uniform incline. This does not reduce
  // impassability: a straight crossing still meets a riser steeper than the
  // smooth original everywhere the smooth original was already steep enough
  // (tests/terrain_walls.test.ts checks the max steepness along a crossing,
  // which a stepped riser only increases). terraceStep(0) === 0, so terrain
  // away from any ridge/rim (mountainAdd == 0) is completely unaffected. The
  // terracing, like the crest noise, fades out past the rim (mountainDetail)
  // so the unreachable overshoot plateau stays the flat staging ground it was
  // before the mountains got their craggy pass. (Blended as two products, not
  // lerp(a, b, t): at mountainDetail 1 / 0 the products are exactly
  // terraced + 0 / 0 + mountainAdd, keeping in-world samples bit-identical.)
  const terraced = terraceStep(mountainAdd, TERRACE_STEP, TERRACE_TREAD, TERRACE_APRON);
  h += terraced * mountainDetail + mountainAdd * (1 - mountainDetail);
  h += mirefenImpactCraterOffset(x, z);
  h = applyEditLayer(x, z, h);
  return h;
}

// Steepest local rise/run of the walkable heightfield at (x, z), independent of
// travel direction. Movement gates on this (not just the slope along the step)
// so a diagonal switchback approach cannot beat the straight-line climb limit.
const STEEPNESS_SAMPLE = 0.35; // yards; about one movement tick of run
export function terrainSteepness(x: number, z: number, seed: number): number {
  const e = STEEPNESS_SAMPLE;
  const hx = (groundHeight(x + e, z, seed) - groundHeight(x - e, z, seed)) / (2 * e);
  const hz = (groundHeight(x, z + e, seed) - groundHeight(x, z - e, seed)) / (2 * e);
  return Math.hypot(hx, hz);
}

// Memoized 1-yard-cell view of terrainSteepness for the per-tick movement
// gates (every moving mob evaluates its step fan every tick; the exact helper
// costs four heightfield samples). A cache over a pure function of
// (cell, seed) stays fully deterministic; the cap just bounds memory on
// long-running hosts. Cell granularity only shifts a gate line by under a
// yard, far inside the walls' steepness margin (tests/terrain_walls.test.ts).
const steepnessCache = new Map<number, Map<number, number>>(); // seed -> cell -> steepness
const STEEPNESS_CACHE_MAX = 400_000; // cells per seed; ~the whole overworld
const STEEPNESS_CACHE_MAX_SEEDS = 4; // hosts run one seed; only test runs see more
const STEEPNESS_CELL_SPAN = 16384; // cells per axis in the packed key
export function terrainSteepnessAt(x: number, z: number, seed: number): number {
  // Instanced interiors (dungeons/arena/delves) are flat floors; skip the cache
  // entirely so their far-off coordinates never enter (or overflow) the packed
  // key space, which is sized for the overworld.
  if (x > DUNGEON_X_THRESHOLD) return 0;
  const cx = Math.round(x);
  const cz = Math.round(z);
  let bySeed = steepnessCache.get(seed);
  if (!bySeed) {
    if (steepnessCache.size >= STEEPNESS_CACHE_MAX_SEEDS) steepnessCache.clear();
    bySeed = new Map();
    steepnessCache.set(seed, bySeed);
  }
  const key = (cx + STEEPNESS_CELL_SPAN / 2) * STEEPNESS_CELL_SPAN + (cz + STEEPNESS_CELL_SPAN / 2);
  let v = bySeed.get(key);
  if (v === undefined) {
    if (bySeed.size >= STEEPNESS_CACHE_MAX) bySeed.clear();
    v = terrainSteepness(cx, cz, seed);
    bySeed.set(key, v);
  }
  return v;
}

// True inside the terrain bands that hold the deliberate unwalkable walls: the
// zone-ridge walls and the world rim (with margin). The per-tick mob movement
// gate screens with this so the steepness memo never runs over the open world;
// rare interior steep spots stay mob-walkable, exactly as they always were
// (players get the full gate everywhere in sim.ts).
export function nearSteepWalls(x: number, z: number): boolean {
  if (x > DUNGEON_X_THRESHOLD) return false; // instanced interiors: flat floors
  const w = world();
  if (Math.abs(x) > WORLD_MAX_X - 40 || z < w.minZ + 40 || z > w.maxZ - 40) return true;
  for (const ridge of w.ridges) {
    if (Math.abs(z - ridge.z) < RIDGE_SIGMA * 4) return true;
  }
  return false;
}

// Unit downhill direction at (x, z), or null on (near-)flat ground. Drives the
// slide that carries a player off ground steeper than the climb limit.
export function terrainDownhill(
  x: number,
  z: number,
  seed: number,
): { x: number; z: number } | null {
  const e = STEEPNESS_SAMPLE;
  const hx = (groundHeight(x + e, z, seed) - groundHeight(x - e, z, seed)) / (2 * e);
  const hz = (groundHeight(x, z + e, seed) - groundHeight(x, z - e, seed)) / (2 * e);
  const mag = Math.hypot(hx, hz);
  if (mag < 1e-6) return null;
  return { x: -hx / mag, z: -hz / mag };
}

// Distance from (x,z) to the nearest road polyline segment.
export function roadDistance(x: number, z: number): number {
  let best = Infinity;
  for (const road of world().content.roads) {
    for (let i = 0; i < road.length - 1; i++) {
      const a = road[i],
        b = road[i + 1];
      const abx = b.x - a.x,
        abz = b.z - a.z;
      const apx = x - a.x,
        apz = z - a.z;
      const len2 = abx * abx + abz * abz;
      const t = len2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apz * abz) / len2)) : 0;
      const dx = apx - abx * t,
        dz = apz - abz * t;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < best) best = d;
    }
  }
  return best;
}

// Deterministic decoration placement (trees, rocks) — used by the renderer,
// kept here so it shares the seed and stays out of mob camps / hubs / roads /
// lakes. Density and mix vary by biome: the vale is wooded, the marsh sparse
// and scrubby, the peaks rocky with hardy pines.
export interface Decoration {
  kind: 'tree' | 'tree2' | 'rock';
  x: number;
  z: number;
  scale: number;
  variant: number;
  biome: BiomeId;
}

const DECORATION_EXCLUSION_RADIUS = 1.2;
const DECORATION_EXCLUSIONS = [{ x: 2.456450840458274, z: 211.33819991815835 }];

function isExcludedDecoration(x: number, z: number): boolean {
  return DECORATION_EXCLUSIONS.some(
    (p) => Math.hypot(x - p.x, z - p.z) < DECORATION_EXCLUSION_RADIUS,
  );
}

export function zoneBiomeAt(z: number): BiomeId {
  const zones = world().content.zones;
  for (const zone of zones) {
    if (z < zone.zMax) return zone.biome;
  }
  return zones[zones.length - 1].biome;
}

export function generateDecorations(seed: number): Decoration[] {
  const w = world();
  const out: Decoration[] = [];
  const step = 10;
  const xHalf = WORLD_MAX_X - 14;
  for (let gx = -xHalf; gx < xHalf; gx += step) {
    for (let gz = w.minZ + 14; gz < w.maxZ - 14; gz += step) {
      const r = hash2(Math.round(gx), Math.round(gz), seed + 31);
      // biomeAt so painted areas grow the right mix; without paint this is the
      // zone-band biome exactly (byte-identical built-in world).
      const biome = biomeAt(gx, gz);
      // density gate + kind mix per biome
      let kind: Decoration['kind'] | null = null;
      if (biome === 'vale') {
        if (r > 0.48) continue;
        kind = r < 0.3 ? 'tree' : r < 0.4 ? 'tree2' : 'rock';
      } else if (biome === 'marsh') {
        if (r > 0.34) continue;
        kind = r < 0.08 ? 'tree' : r < 0.26 ? 'tree2' : 'rock';
      } else if (biome === 'beach') {
        if (r > 0.14) continue;
        kind = r < 0.05 ? 'tree' : r < 0.08 ? 'tree2' : 'rock';
      } else if (biome === 'desert') {
        if (r > 0.1) continue;
        kind = r < 0.025 ? 'tree2' : 'rock';
      } else if (biome === 'volcano') {
        if (r > 0.2) continue;
        kind = 'rock';
      } else if (biome === 'cave') {
        if (r > 0.16) continue;
        kind = 'rock';
      } else {
        if (r > 0.44) continue;
        kind = r < 0.2 ? 'tree' : r < 0.24 ? 'tree2' : 'rock';
      }
      const ox = (hash2(Math.round(gx), Math.round(gz), seed + 57) - 0.5) * step;
      const oz = (hash2(Math.round(gx), Math.round(gz), seed + 91) - 0.5) * step;
      const x = gx + ox,
        z = gz + oz;
      if (isExcludedDecoration(x, z)) continue;
      let inHub = false;
      for (const zone of w.content.zones) {
        const dx = x - zone.hub.x,
          dz = z - zone.hub.z;
        if (Math.sqrt(dx * dx + dz * dz) < zone.hub.radius + 4) {
          inHub = true;
          break;
        }
      }
      if (inHub) continue;
      if (terrainHeight(x, z, seed) < waterLevel() + 1) continue;
      if (roadDistance(x, z) < 5) continue;
      let inCamp = false;
      for (const c of w.content.camps) {
        const dx = x - c.center.x,
          dz = z - c.center.z;
        if (Math.sqrt(dx * dx + dz * dz) < c.radius + 3) {
          inCamp = true;
          break;
        }
      }
      if (inCamp) continue;
      out.push({
        kind,
        x,
        z,
        scale: 0.7 + hash2(Math.round(gx), Math.round(gz), seed + 13) * 0.9,
        variant: Math.floor(hash2(Math.round(gx), Math.round(gz), seed + 77) * 3),
        biome,
      });
    }
  }
  return out;
}
