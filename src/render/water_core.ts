// PURE (unit-tested, Three-free): the water shore-depth sample. water.ts bakes
// this per vertex into the aShoreDepth attribute (foam band + shallow tint) at
// build time AND on every editor setLevel() rebuild, so both paths share one
// definition. It also owns the bounded fixed-step height-field tier plan.
// It reads the ACTIVE water surface (waterLevel(): the custom
// map's override when one is loaded, else the built-in constant) against the
// same deterministic terrainHeight the sim uses. Registered in
// RENDER_PURE_CORES (tests/architecture.test.ts).
import { terrainHeight, waterLevel } from '../sim/world';

export interface WaterFieldPlan {
  /** Height-field texels per side (square). */
  resolution: number;
  /** World yards per texel. */
  cellSize: number;
  /** World yards covered per side. */
  size: number;
  stepHz: number;
}

export const WATER_IMPULSE_CAPACITY = 8;
export const WATER_SIM_ACTIVE_SECONDS = 6;
export const WATER_MAX_STEPS_PER_FRAME = 2;
export const WATER_MAX_GLOBAL_PASSES_PER_FRAME = 2;
export const WATER_SCHEDULE_WAKE = 1;
export const WATER_SCHEDULE_SLEEP = 2;

// World yards per height-field texel. The surface is continuous (zone strips
// plus the horizon apron), so the field is a camera-anchored WINDOW rather than
// one texture per lake: sized for a ~1 yard character wake to read clearly.
export const WATER_FIELD_CELL_SIZE = 0.7;
// Fraction of the field, in UV, over which its contribution ramps from nothing
// to full at the window border. The field is a WINDOW, not the whole sea, so
// something has to happen at its edge. Cutting it off hard puts a step in the
// surface NORMAL (the slope drives N with a large gain), and because the window
// is a camera-anchored square that step draws straight-edged seams across open
// water that travel with the camera and survive any amount of colour tuning.
// Feathering costs a band of reduced wake detail at ~34 yards (high tier) where
// a character wake is already sub-pixel, and buys a seamless sea.
export const WATER_FIELD_EDGE_FEATHER_UV = 0.12;
// Re-anchor once the camera has drifted this fraction of the field half-size.
// Hysteresis matters: re-anchoring every frame would scroll the state every
// frame, and each scroll costs a full-field pass.
export const WATER_FIELD_REANCHOR_FRACTION = 0.3;

export interface WaterScheduleState {
  active: boolean;
  pendingCount: number;
  accumulator: number;
  awakeUntil: number;
  stepSeconds: number;
}

/** The tier union re-stated locally: this is a registered pure core and must
 *  stay Three-free, so it cannot import gfx.ts (which imports three). Insane
 *  deliberately matches ultra: the water field is already at its quality
 *  ceiling there and a larger allocation would only spend memory. */
type WaterTier = 'low' | 'medium' | 'high' | 'ultra' | 'insane';

/** Fixed allocation size per tier, so re-anchoring never resizes an attachment. */
export function waterSimulationTargetResolution(tier: WaterTier): number {
  if (tier === 'ultra' || tier === 'insane') return 128;
  if (tier === 'high') return 96;
  if (tier === 'medium') return 64;
  return 48;
}

/** Bounded height-field allocation and fixed rate for the camera-anchored field. */
export function waterFieldPlan(tier: WaterTier): WaterFieldPlan {
  const resolution = waterSimulationTargetResolution(tier);
  return {
    resolution,
    cellSize: WATER_FIELD_CELL_SIZE,
    size: resolution * WATER_FIELD_CELL_SIZE,
    stepHz:
      tier === 'ultra' || tier === 'insane'
        ? 30
        : tier === 'high'
          ? 24
          : tier === 'medium'
            ? 20
            : 15,
  };
}

/**
 * Snap a field edge to the texel lattice. Anchoring on exact cell multiples
 * keeps every re-anchor an INTEGER texel shift, so the scroll pass resamples
 * nothing and standing waves never shimmer as the camera walks.
 */
export function snapWaterFieldOrigin(value: number, cellSize: number): number {
  const step = Math.max(cellSize, 0.0001);
  return Math.round(value / step) * step;
}

/** True once the camera has drifted far enough from the anchor to re-center. */
export function waterFieldNeedsReanchor(
  cameraX: number,
  cameraZ: number,
  anchorX: number,
  anchorZ: number,
  size: number,
): boolean {
  const limit = Math.max(0, size) * 0.5 * WATER_FIELD_REANCHOR_FRACTION;
  return Math.abs(cameraX - anchorX) > limit || Math.abs(cameraZ - anchorZ) > limit;
}

/**
 * Allocation-free scheduler transition shared by the renderer and Node tests.
 * Invisible impulses are discarded instead of extending an unseen lake's wake.
 */
export function advanceWaterSchedule(
  state: WaterScheduleState,
  visible: boolean,
  time: number,
  dt: number,
): number {
  if (!visible) {
    state.pendingCount = 0;
    state.accumulator = 0;
    return state.active && time >= state.awakeUntil ? WATER_SCHEDULE_SLEEP : 0;
  }

  let flags = 0;
  if (state.pendingCount > 0) {
    state.active = true;
    state.awakeUntil = time + WATER_SIM_ACTIVE_SECONDS;
    state.accumulator = Math.max(state.accumulator, state.stepSeconds);
    flags |= WATER_SCHEDULE_WAKE;
  }
  if (!state.active) return flags;
  if (time >= state.awakeUntil && state.pendingCount === 0) {
    return flags | WATER_SCHEDULE_SLEEP;
  }
  state.accumulator = Math.min(
    state.accumulator + Math.max(0, dt),
    state.stepSeconds * WATER_MAX_STEPS_PER_FRAME,
  );
  return flags;
}

// Depth of the ACTIVE water surface above the terrain at (x, z): positive in
// open water, negative on dry land.
export function shoreDepthAt(x: number, z: number, seed: number): number {
  return waterLevel() - terrainHeight(x, z, seed);
}

/**
 * Per-vertex gate for the swell DISPLACEMENT, baked from a sheet's shore-depth
 * grid: the minimum depth over the vertex's 3x3 grid neighbourhood, less a
 * margin, on the same `clamp(depth * 0.8, 0, 1)` ramp the shader used to apply
 * to the vertex's own depth.
 *
 * WHY A NEIGHBOURHOOD MINIMUM, and why 3x3 exactly. Gating on the vertex's own
 * depth is correct AT every vertex and wrong everywhere BETWEEN them: the GPU
 * interpolates the lift linearly across a quad, so one wet corner drags the
 * displaced sheet over the whole cell. On the zone planes that reaches 2 to 3.3
 * yards inland and reads as surf wash, but the horizon apron's cells are 29 by
 * 38 yards, and there the sheet climbed measurably onto dry beaches (600 quads,
 * 7892 square yards, up to 0.44 yards proud of the sand) where it painted the
 * shredded near-opaque foam that shows up in screenshots as water tearing
 * through the shore.
 *
 * The 3x3 minimum closes it completely, and the 4-neighbour version does not.
 * Displacement inside a triangle is barycentric, so the lift anywhere in a quad
 * is a convex combination of its four corner lifts. Take any quad with a dry
 * corner V: every other corner of that quad is a grid neighbour of V by an edge
 * OR BY A DIAGONAL, so each one's 3x3 window contains V's non-positive depth
 * and gates to zero, as does V itself. All four lifts are zero, so the whole
 * quad lies flat at the water level for every wave phase, whatever the terrain
 * does between the vertices. Drop the diagonals and the corner opposite V
 * survives, which is exactly the case that leaks.
 *
 * `margin` covers what the grid cannot see at all: ground that rises above the
 * waterline strictly BETWEEN vertices, so no vertex reads dry. Sandbars smaller
 * than an apron cell are the real case (one measured at 12 by 6 yards). The
 * planes need none of it at 2 yard spacing.
 *
 * A morphological erosion cannot introduce a discontinuity the depth field did
 * not already have: the gate ramp keeps its shape and moves one cell seaward.
 */
export function bakeSwellGate(
  depth: ArrayLike<number>,
  columns: number,
  rows: number,
  margin: number,
): Float32Array {
  const gate = new Float32Array(columns * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      let min = Number.POSITIVE_INFINITY;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= rows) continue;
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc;
          if (cc < 0 || cc >= columns) continue;
          const d = depth[rr * columns + cc];
          if (d < min) min = d;
        }
      }
      const ramp = (min - margin) * 0.8;
      gate[r * columns + c] = ramp < 0 ? 0 : ramp > 1 ? 1 : ramp;
    }
  }
  return gate;
}

/**
 * Dry-tile culling for the water sheets. A zone plane (and the horizon apron)
 * spans its whole rect, but most of that rect is LAND: every quad whose
 * corners all sit this far above the waterline has its surface buried under
 * terrain and can never contribute a visible fragment, yet its vertices are
 * shaded every frame. The margin is one ~2 yard vertex spacing of slack so a
 * quad that straddles the waterline contour (or heaves with the swell) is
 * always kept; only genuinely-inland tiles drop.
 */
export const WATER_TILE_KEEP_ABOVE = -0.75;

/**
 * Index buffer over a (columns x rows) vertex lattice keeping only quads with
 * at least one corner deeper than WATER_TILE_KEEP_ABOVE. Triangle order and
 * winding match THREE.PlaneGeometry exactly (a,b,d / b,c,d), so a culled
 * geometry renders identically to the full sheet minus the buried tiles.
 * Returns null when nothing was dropped (keep the geometry's own index).
 */
export function buildWaterSurfaceIndex(
  depth: ArrayLike<number>,
  columns: number,
  rows: number,
): Uint16Array | Uint32Array | null {
  const quads: number[] = [];
  let dropped = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < columns - 1; c++) {
      const a = r * columns + c;
      const b = (r + 1) * columns + c;
      const cc = (r + 1) * columns + c + 1;
      const d = r * columns + c + 1;
      if (
        depth[a] > WATER_TILE_KEEP_ABOVE ||
        depth[b] > WATER_TILE_KEEP_ABOVE ||
        depth[cc] > WATER_TILE_KEEP_ABOVE ||
        depth[d] > WATER_TILE_KEEP_ABOVE
      ) {
        quads.push(a, b, d, b, cc, d);
      } else {
        dropped++;
      }
    }
  }
  if (dropped === 0) return null;
  const vertexCount = columns * rows;
  return vertexCount > 65535 ? new Uint32Array(quads) : new Uint16Array(quads);
}

/**
 * Deepest the terrain generator ever puts the seabed below the water line.
 * Measured across a 30 sample coastline survey: every sample tops out at
 * exactly this, and depth 15 is reached by none of them. The colour ramp
 * therefore cannot be widened, there is no deeper water to grade into.
 */
export const WATER_SEABED_CLAMP_YARDS = 6;
/** Width of the surf band measured ALONG THE GROUND from the waterline. */
export const WATER_FOAM_WIDTH_YARDS = 4.5;

// Half-width of the central difference used for the seabed gradient, in yards.
// The zone plane bakes at ~2 yard vertex spacing, so sampling wider than that
// would smear a cove's slope into its neighbour's. Exported so interior shore
// bakes (wildheart_terrain.ts) sample with the same contract the shader
// expects instead of mirroring the value.
export const SHORE_SLOPE_SAMPLE_HALF_WIDTH = 1.5;
// Below this the seabed is flat enough that depth carries no direction, and
// dividing by it would explode the derived shoreline distance.
export const MIN_SHORE_SLOPE = 1e-3;

/**
 * Magnitude of the seabed gradient at (x, z): yards of depth gained per yard
 * travelled. Pairs with shoreDepthAt to recover the HORIZONTAL distance to the
 * waterline (depth / slope), which is the only shore signal that behaves the
 * same on a steep shelf and a flat one.
 *
 * Measured motivation (30 coastline samples): the seabed is hard clamped at 6
 * yards, and shelves range from reaching 3.2 yards in 4 yards of run to sitting
 * at 0.2 yards deep for 40 yards. A single depth threshold cannot serve both,
 * so foam keyed on depth alone either floods a flat bay or vanishes on a steep
 * one.
 */
export function shoreSlopeAt(x: number, z: number, seed: number): number {
  const h = SHORE_SLOPE_SAMPLE_HALF_WIDTH;
  const dx = shoreDepthAt(x + h, z, seed) - shoreDepthAt(x - h, z, seed);
  const dz = shoreDepthAt(x, z + h, seed) - shoreDepthAt(x, z - h, seed);
  return Math.max(Math.hypot(dx, dz) / (2 * h), MIN_SHORE_SLOPE);
}
