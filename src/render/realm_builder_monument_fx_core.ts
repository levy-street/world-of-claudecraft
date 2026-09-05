// Where the Realm Builder monument's effects belong: the projection anchors on
// its two honour plates and the flame anchors in its four lanterns. Three- and
// DOM-free (a registered RENDER_PURE_CORE), so the placement math a misaligned
// hologram would expose is unit-testable without a browser.
//
// The numbers below are MEASURED off the shipped GLB, not eyeballed, and
// tests/realm_builder_monument_fx_core.test.ts re-measures them against
// public/models/props/eastbrook_realm_builder_monument.glb on every run. That
// is the whole reason they are constants rather than a runtime scene walk: if
// the sculpt is re-exported and an anchor drifts, a test fails instead of a
// name quietly projecting out of a statue's hip.

/** A point or direction in the monument's own model space (glTF, Y up). */
export interface MonumentLocal {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The shipped GLB's bounding-box size, the divisor placementMatrix scales by. */
export const MONUMENT_SOURCE_SIZE = {
  x: 0.755235,
  y: 0.991974,
  z: 0.702649,
} as const satisfies MonumentLocal;

/**
 * The honour plates: the centre of each recessed dark plate, and the outward
 * normal of the plate face. Both plates tilt back about 12.6 degrees (the
 * normals' y component), because the sculpt sets them into a plinth course
 * that leans; the projection follows that lean so the name rises off the plate
 * rather than out of it at a right angle to nothing.
 */
export const MONUMENT_PLATE_FRONT = {
  anchor: { x: 0.005804, y: 0.113437, z: 0.270204 },
  normal: { x: 0.0102, y: 0.2183, z: 0.9758 },
} as const;
export const MONUMENT_PLATE_BACK = {
  anchor: { x: 0.002776, y: 0.113437, z: -0.289506 },
  normal: { x: -0.0055, y: 0.2183, z: -0.9759 },
} as const;

/** The four lantern flames, on the plinth's outrigger ring. */
export const MONUMENT_LANTERNS: readonly MonumentLocal[] = Object.freeze([
  { x: -0.337989, y: 0.112617, z: 0.151826 },
  { x: 0.335273, y: 0.112559, z: 0.144209 },
  { x: 0.331369, y: 0.112559, z: -0.19133 },
  { x: -0.331968, y: 0.112617, z: -0.183852 },
]);

/** How the monument was seated in the world, in the terms the layout owns. */
export interface MonumentPlacement {
  readonly x: number;
  readonly z: number;
  /** Terrain height under the monument's own point: its base sits here. */
  readonly groundY: number;
  /** Y rotation in radians, applied exactly as placementMatrix applies it. */
  readonly rotation: number;
  readonly nativeWidth: number;
  readonly nativeHeight: number;
  readonly nativeDepth: number;
}

export interface MonumentScale {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The per-axis scale placementMatrix derives. Proportional nativeDimensions
 * make all three equal, and they are asserted equal by this module's test:
 * a sheared statue is the failure a single "scale" number would hide.
 */
export function monumentScale(placement: MonumentPlacement): MonumentScale {
  return {
    x: placement.nativeWidth / MONUMENT_SOURCE_SIZE.x,
    y: placement.nativeHeight / MONUMENT_SOURCE_SIZE.y,
    z: placement.nativeDepth / MONUMENT_SOURCE_SIZE.z,
  };
}

/**
 * A model-space point in world space.
 *
 * `rotation` is applied exactly as three applies a Y Euler, which maps local
 * +Z to world (sin, cos) and local +X to (cos, -sin). Getting this backwards is
 * invisible in review and glaring in game: the front plate's hologram surfaces
 * out of the statue's back.
 */
export function monumentPointWorld(
  local: MonumentLocal,
  placement: MonumentPlacement,
): MonumentLocal {
  const scale = monumentScale(placement);
  const sx = local.x * scale.x;
  const sy = local.y * scale.y;
  const sz = local.z * scale.z;
  const cos = Math.cos(placement.rotation);
  const sin = Math.sin(placement.rotation);
  return {
    x: placement.x + sx * cos + sz * sin,
    y: placement.groundY + sy,
    z: placement.z - sx * sin + sz * cos,
  };
}

/** A model-space DIRECTION in world space: rotation only, never translation. */
export function monumentDirectionWorld(
  local: MonumentLocal,
  placement: MonumentPlacement,
): MonumentLocal {
  const cos = Math.cos(placement.rotation);
  const sin = Math.sin(placement.rotation);
  return {
    x: local.x * cos + local.z * sin,
    y: local.y,
    z: -local.x * sin + local.z * cos,
  };
}

/** The compass bearing a plate faces, for aiming a panel that never billboards. */
export function monumentPlateYaw(normalWorld: MonumentLocal): number {
  return Math.atan2(normalWorld.x, normalWorld.z);
}

/**
 * Hologram tuning as FRACTIONS of the monument's height, not fixed yards.
 *
 * These were first authored as yards against a 3.8 yard statue, and when the
 * owner doubled it the projection stayed the same size and read as a sticker on
 * a giant. A projection is part of the monument's composition, so it scales
 * with it: at any height the name sits a third of the statue up from its plate
 * and spans half the statue's width.
 */
export const MONUMENT_HOLOGRAM = {
  /** How far out from the plate face the projection stands. */
  standoff: 0.09,
  /** How far above the plate the name floats. */
  lift: 0.33,
  panelWidth: 0.5,
  panelHeight: 0.163,
  /** The beam's radius where it leaves the plate, and where it meets the name. */
  beamBaseRadius: 0.063,
  beamTopRadius: 0.163,
} as const;

export interface HologramMetrics {
  readonly standoff: number;
  readonly lift: number;
  readonly panelWidth: number;
  readonly panelHeight: number;
  readonly beamBaseRadius: number;
  readonly beamTopRadius: number;
}

/** The tuning above resolved into world yards for one placement. */
export function hologramMetrics(placement: MonumentPlacement): HologramMetrics {
  const height = placement.nativeHeight;
  return {
    standoff: MONUMENT_HOLOGRAM.standoff * height,
    lift: MONUMENT_HOLOGRAM.lift * height,
    panelWidth: MONUMENT_HOLOGRAM.panelWidth * height,
    panelHeight: MONUMENT_HOLOGRAM.panelHeight * height,
    beamBaseRadius: MONUMENT_HOLOGRAM.beamBaseRadius * height,
    beamTopRadius: MONUMENT_HOLOGRAM.beamTopRadius * height,
  };
}

/** Where a plate's floating name sits, given the plate's own world anchor. */
export function hologramPanelCenter(
  plateWorld: MonumentLocal,
  normalWorld: MonumentLocal,
  metrics: HologramMetrics,
): MonumentLocal {
  // Flatten the normal before stepping out: the plate leans back, and following
  // that lean for the standoff too would push the panel up twice.
  const flat = Math.hypot(normalWorld.x, normalWorld.z) || 1;
  return {
    x: plateWorld.x + (normalWorld.x / flat) * metrics.standoff,
    y: plateWorld.y + metrics.lift,
    z: plateWorld.z + (normalWorld.z / flat) * metrics.standoff,
  };
}

/**
 * Ember tuning: a lantern wick, not a brazier. `rise`, `radius` and `haloRadius`
 * are FRACTIONS of the monument's height for the same reason the hologram is
 * (a doubled statue with the same little embers reads as a doll's house);
 * `size` is a pixel figure and `cycleSec` a duration, so both stay absolute.
 */
export const MONUMENT_EMBERS = {
  perLantern: 9,
  rise: 0.224,
  radius: 0.032,
  haloRadius: 0.068,
  size: 190,
  cycleSec: 2.6,
  colorCore: 0xfff2c0,
  colorEdge: 0xd48a1e,
} as const;

export interface EmberMetrics {
  readonly rise: number;
  readonly radius: number;
  readonly haloRadius: number;
}

/** The lantern tuning above resolved into world yards for one placement. */
export function emberMetrics(placement: MonumentPlacement): EmberMetrics {
  const height = placement.nativeHeight;
  return {
    rise: MONUMENT_EMBERS.rise * height,
    radius: MONUMENT_EMBERS.radius * height,
    haloRadius: MONUMENT_EMBERS.haloRadius * height,
  };
}

export const MONUMENT_EMBER_SEED_STRIDE = 4;

/**
 * Deterministic per-mote seeds (angle, radial bias, life phase, rate bias).
 *
 * A plain LCG rather than Math.random: the renderer is allowed randomness, but
 * a seeded stream keeps a screenshot diff meaningful and keeps this core
 * testable, the same rule textures.ts follows for its canvas noise.
 */
export function monumentEmberSeeds(count: number): Float32Array {
  const out = new Float32Array(count * MONUMENT_EMBER_SEED_STRIDE);
  let state = 0x9e3779b9;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let index = 0; index < out.length; index++) out[index] = next();
  return out;
}

// ---------------------------------------------------------------------------
// Distance LOD.
//
// The monument is the town's most expensive prop by a wide margin: a 5,923
// triangle textured body over three draws, two projected names with their
// beams, four lantern halos, an ember cloud and a sparkle cloud, most of them
// additive and every one of them overdraw. All of that earns its keep from the
// square. None of it does from the far side of the map, where the whole thing
// is a few dozen pixels tall.
//
// So it degrades in two steps rather than one: the effects go first (they are
// the fill-rate cost and the first thing to stop reading), then the body is
// swapped for a billboard. Both distances are measured to the monument's own
// point, not the town's, and both are cosmetic: nothing a player acts on lives
// out here.
// ---------------------------------------------------------------------------

/** Beyond this, the projections, halos, embers and sparkle stop drawing. */
export const MONUMENT_EFFECTS_RANGE = 48;
/** Beyond this, the body is a billboard. Comfortably past the effects cut, so
 *  the two never change on the same frame and neither draws attention. */
export const MONUMENT_IMPOSTOR_RANGE = 72;
/** Cells in the baked impostor atlas, one per 45 degrees of view bearing. */
export const MONUMENT_IMPOSTOR_ANGLES = 8;
export const MONUMENT_IMPOSTOR_ATLAS = { columns: 4, rows: 2 } as const;

export interface MonumentLodPlan {
  readonly body: boolean;
  readonly impostor: boolean;
  readonly effects: boolean;
}

// The three plans, built once: monumentLodPlan runs every frame from two
// callers (the body's setLod and the effects' update), and a per-frame object
// would be the only allocation on the monument's steady-state path.
const LOD_FULL: MonumentLodPlan = Object.freeze({ body: true, impostor: false, effects: true });
const LOD_BODY_ONLY: MonumentLodPlan = Object.freeze({
  body: true,
  impostor: false,
  effects: false,
});
const LOD_IMPOSTOR: MonumentLodPlan = Object.freeze({
  body: false,
  impostor: true,
  effects: false,
});

/**
 * What to draw at `distance` yards from the monument.
 *
 * Body and impostor are exclusive by construction: exactly one of them is true
 * at every distance, so a caller cannot draw both or neither. Answers one of
 * three shared frozen plans, never a fresh object.
 */
export function monumentLodPlan(distance: number): MonumentLodPlan {
  if (distance >= MONUMENT_IMPOSTOR_RANGE) return LOD_IMPOSTOR;
  return distance < MONUMENT_EFFECTS_RANGE ? LOD_FULL : LOD_BODY_ONLY;
}

/**
 * Which atlas cell faces a camera at `cameraX/cameraZ`.
 *
 * The bake walked its azimuth as `atan2(x, z)` in the model's own frame, so the
 * placement's rotation comes back off the world bearing before the cell is
 * chosen. Rounding (not flooring) puts each baked view at the CENTRE of the arc
 * it serves, which halves the worst-case angular error.
 */
export function monumentImpostorCell(
  cameraX: number,
  cameraZ: number,
  placement: MonumentPlacement,
): number {
  const bearing = Math.atan2(cameraX - placement.x, cameraZ - placement.z) - placement.rotation;
  const step = (2 * Math.PI) / MONUMENT_IMPOSTOR_ANGLES;
  const cell = Math.round(bearing / step);
  return ((cell % MONUMENT_IMPOSTOR_ANGLES) + MONUMENT_IMPOSTOR_ANGLES) % MONUMENT_IMPOSTOR_ANGLES;
}

/** The UV offset of one atlas cell. Row 0 is the TOP row of the baked image. */
export function monumentImpostorUvOffset(cell: number): { u: number; v: number } {
  const { columns, rows } = MONUMENT_IMPOSTOR_ATLAS;
  const column = cell % columns;
  const row = Math.floor(cell / columns);
  return { u: column / columns, v: (rows - 1 - row) / rows };
}

/**
 * The billboard's size in world yards.
 *
 * The bake framed every cell to the WIDEST silhouette (the diagonal, where the
 * lantern outriggers show), so the quad has to be that wide too or the statue
 * shrinks the moment it swaps. One square frame for every angle, which is what
 * lets a single quad serve all eight.
 */
export function monumentImpostorSize(placement: MonumentPlacement): number {
  const scale = monumentScale(placement);
  const width = MONUMENT_SOURCE_SIZE.x * scale.x;
  const depth = MONUMENT_SOURCE_SIZE.z * scale.z;
  const height = MONUMENT_SOURCE_SIZE.y * scale.y;
  return Math.max(Math.hypot(width, depth) * 1.04, height * 1.06);
}
