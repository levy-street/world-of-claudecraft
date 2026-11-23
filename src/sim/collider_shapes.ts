// The static collider SHAPES (circle, OBB, authored prism), the one
// standable-top sampler, and the yaw helper every shape reads. A pure
// type-and-math leaf extracted out of colliders.ts so it and the authored
// collider modules (colliders_authored/) share them without an import
// cycle. colliders.ts re-exports every public name here, so existing
// './colliders' importers stand. Sim layer: no three.js imports.

export interface CircleCollider {
  type: 'circle';
  x: number;
  z: number;
  r: number;
  /** Absolute world-space visual top used by sight checks; movement ignores it. */
  cameraTopY?: number;
  /**
   * Absolute world-space BASE (the ground the obstacle stands on). A mover
   * whose head is below it passes underneath, cave tubes run under surface
   * props, and an authored upper storey does not wall the floor below it.
   * Absent = height-agnostic (blocker walls, interior wall sets): blocks at
   * every depth, which is every collider the shipped world builds.
   */
  baseY?: number;
  /**
   * Pass-under floor for MOVEMENT only (the shipped world's surface props):
   * a body walking a cave tube or carve sheet below this height passes under
   * the prop instead of hitting its 2D footprint. Deliberately NOT `baseY`,
   * which also suppresses the collider in `sightBlockedAt`: the open world has
   * no terrain occlusion in that model, so a prop standing on a bank is the
   * only thing blocking a sight line across it, and letting a distant low eye
   * see under it would let mobs and pets see through the bank.
   */
  underY?: number;
  /**
   * Absolute world-space top of the PHYSICAL obstacle for movement (parkour):
   * a mover whose feet reach this height passes over instead of being walled
   * (see `passesOver`). Distinct from `cameraTopY`, which follows the visual
   * silhouette and often includes flames or roofs taller than the solid body.
   * Undefined means full-height, blocking at any altitude (buildings, trees, wells).
   */
  moveTopY?: number;
  /**
   * A mover may stand ON `moveTopY` (crates, rocks): the top feeds
   * `supportHeightAt` (landing/walking surface) and grants the airborne
   * mantle lift, so a jump at the rim hoists the body onto the top.
   */
  standable?: boolean;
  /** Optional pitched surface for the standable top (see {@link TopSlope}). */
  topSlope?: TopSlope;
  /**
   * Absolute world-space UNDERSIDE of an elevated slab: a mover with height
   * whose head clears this passes BENEATH the collider (the balcony-walk
   * contract; see `passesOver`). Height-less movers (mobs, pathfinding) never
   * read it, so to them the slab stays a full-height solid by design.
   * Undefined means nothing passes under (the default for everything).
   */
  passUnderY?: number;
  /** A transport berth gate (transport_gates.ts): the collider is in its grid
   *  cells only while that berth's ship lies docked (setColliderGateOpen). */
  gate?: string;
  /** Engine bookkeeping: index into the owning grid's dedupe stamp buffer. */
  gridIndex?: number;
  /**
   * Dev attribution: which source emitted this collider (a placement's model
   * path plus its lane, e.g. "/models/props/inn.glb#prism"). Never read by
   * gameplay, the playtest Dev panel surfaces it so an invisible wall can
   * name itself. Absent = a built-in record collider.
   */
  src?: string;
}

export interface ObbCollider {
  type: 'obb';
  x: number;
  z: number;
  hw: number; // half width (local x)
  hd: number; // half depth (local z)
  rot: number; // yaw, three.js rotation.y convention
  /** Absolute world-space visual top used by sight checks; movement ignores it. */
  cameraTopY?: number;
  /** See {@link CircleCollider.baseY}. */
  baseY?: number;
  /** See {@link CircleCollider.underY}. */
  underY?: number;
  /** See {@link CircleCollider.moveTopY}. */
  moveTopY?: number;
  /** See {@link CircleCollider.standable}. */
  standable?: boolean;
  /** See {@link CircleCollider.topSlope}. */
  topSlope?: TopSlope;
  /** See {@link CircleCollider.passUnderY}. */
  passUnderY?: number;
  /**
   * Low fence rail: a grounded mover collides normally, but a mover that is
   * airborne above the rail (see `FENCE_RAIL_HEIGHT`) jumps clear of it. Set on
   * the OBBs built from `PROPS.fences`.
   */
  isFence?: boolean;
  /** See {@link CircleCollider.gate}. */
  gate?: string;
  /** See {@link CircleCollider.gridIndex}. */
  gridIndex?: number;
  /** See {@link CircleCollider.src}. */
  src?: string;
}

/**
 * A convex banded prism: the shape a Collision Master volume collides as.
 *
 * An OBB is a 4-gon prism, so this loses nothing and gains the sections a
 * rectangle could only approximate, hexagonal rocks, round towers, angled
 * walls. It exists because the maker's authored volumes ARE the contract:
 * fitting rectangles to them put a large share of the collider outside the
 * drawn shape, which in game is an invisible wall short of the thing modelled.
 */
export interface PrismCollider {
  type: 'prism';
  /** See {@link CircleCollider.passUnderY}. */
  passUnderY?: number;
  /** Outline anchor (the placement's world position). */
  x: number;
  z: number;
  /** Convex outline, counter-clockwise, in world yards RELATIVE to (x, z):
   *  flat u,v pairs. Relative so the anchor alone drives broad-phase bounds. */
  poly: readonly number[];
  /** Bounding radius of `poly` about (x, z), the O(1) narrow-phase reject, so
   *  a prism costs less than an OBB for every mover that is not touching it. */
  br: number;
  /**
   * LOFT outlines (world yards relative to x,z, same vertex count and
   * correspondence as `poly`): the authored section at baseY and at moveTopY.
   * Height-aware consumers interpolate between them at the mover's own feet
   * height (see prismPolyAt), so a tapered Collision Master volume collides
   * exactly as drawn instead of as a stack of flat-walled hulls. `poly`
   * stays the coverage-complete union hull for height-blind consumers.
   */
  polyLo?: readonly number[];
  polyHi?: readonly number[];
  /** See {@link CircleCollider.cameraTopY}. */
  cameraTopY?: number;
  /** See {@link CircleCollider.baseY}. */
  baseY?: number;
  /** See {@link CircleCollider.underY}. */
  underY?: number;
  /** See {@link CircleCollider.moveTopY}. An authored volume is a real physical
   *  body, so the parkour solver reads its top exactly like a crate's. */
  moveTopY?: number;
  /** See {@link CircleCollider.standable}. This is what lets an authored deck
   *  (a second storey, a ramp landing) carry a body rather than only block it. */
  standable?: boolean;
  /** See {@link CircleCollider.topSlope}. */
  topSlope?: TopSlope;
  /** See {@link CircleCollider.gridIndex}. */
  gridIndex?: number;
  /** See {@link CircleCollider.gate}. */
  gate?: string;
  /** See {@link CircleCollider.src}. */
  src?: string;
}

export type Collider = CircleCollider | ObbCollider | PrismCollider;

/**
 * The collider shape a HAND-AUTHORED layout emits (arena, delves, rifts, the
 * battleground, interior wall sets, shipped-map imports). Prisms only ever come
 * from a placement's Collision Master volumes, so layout code can keep reading
 * `hw`/`hd`/`rot` off anything that is not a circle.
 */
export type LayoutCollider = CircleCollider | ObbCollider;

/**
 * A shaped (non-flat) standable top: real roofs pitch. `moveTopY` stays the
 * MAXIMUM surface height (the ridge line or cone peak), so blocking logic can
 * keep using it conservatively; the sampled surface only ever falls from
 * there, clamped at the eaves. `colliderTopAt` is the one sampler.
 */
export interface TopSlope {
  /** 'ridge': gable with a straight high line; 'cone': radial peak at the
   *  circle's centre. */
  kind: 'ridge' | 'cone';
  /** Which LOCAL axis the ridge's high line runs along ('x' default): the
   *  surface falls across the other axis. Measured per asset (house_3 and
   *  the coffins ridge along their local z, the market stands along x). */
  axis?: 'x' | 'z';
  /** surface drop per yard of run away from the ridge line / peak */
  pitch: number;
  /** lowest surface height (absolute Y); the slope clamps here (the eaves) */
  eaveY: number;
  /**
   * OBB ridge only: the ridge line itself DESCENDS this much per yard along
   * the ridge axis, from `moveTopY` at the box's -axis end. A tree root's
   * crest falls from the trunk to its tip; level ridge segments left a
   * vertical step face at every joint for a walker to catch on. Absent = a
   * level ridge (every roof).
   */
  fall?: number;
}

/**
 * The standable surface height of a collider at a point: `moveTopY` for flat
 * tops, the pitched surface for sloped ones (never above `moveTopY`, never
 * below the eaves). Infinity for full-height colliders, which have no top.
 */
export function colliderTopAt(c: Collider, x: number, z: number): number {
  const top = c.moveTopY;
  if (top === undefined) return Infinity;
  const s = c.topSlope;
  if (!s) return top;
  let run: number;
  // A prism has no single yaw to measure a ridge across, so a sloped one falls
  // radially like a cone.
  if (s.kind === 'cone' || c.type === 'circle' || c.type === 'prism') {
    run = Math.hypot(x - c.x, z - c.z);
  } else {
    const cos = Math.cos(-c.rot);
    const sin = Math.sin(-c.rot);
    const lx = (x - c.x) * cos + (z - c.z) * sin;
    const lz = -(x - c.x) * sin + (z - c.z) * cos;
    // The surface falls across the axis PERPENDICULAR to the ridge line.
    run = s.axis === 'z' ? Math.abs(lx) : Math.abs(lz);
    if (s.fall && c.type === 'obb') {
      // ...and a falling ridge along it, from moveTopY at the -axis end;
      // never above moveTopY past that end
      const along = s.axis === 'z' ? lz + c.hd : lx + c.hw;
      return Math.max(s.eaveY, Math.min(top, top - run * s.pitch - along * s.fall));
    }
  }
  return Math.max(s.eaveY, top - run * s.pitch);
}

// rotate a local offset by a three.js rotation.y angle
export function rotY(lx: number, lz: number, rot: number): { x: number; z: number } {
  const c = Math.cos(rot),
    s = Math.sin(rot);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}
