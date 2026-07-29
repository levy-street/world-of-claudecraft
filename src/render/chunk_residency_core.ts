// Chunk-level ground residency: the pure half of "how far can the camera see
// before it reaches ground that has not been built yet?".
//
// The renderer streams terrain in CHUNK_SIZE cells but used to answer that
// question per ZONE, and the outdoor fog clamp keyed off the answer. One
// unprepared 36-to-54 chunk rectangle within ~53 yd therefore pinned the view
// at MIN_OUTDOOR_FOG_FAR until that whole rectangle (and its HDRI) finished:
// measured live at 198 s of a 45-yard wall after a Drakelands portal, against
// an authored ember far of 360. The unit of work the clamp waited on was
// roughly 20x the unit of work that actually unblocks the view. This module
// answers the same question against the grid the terrain already builds on, so
// the fog frontier tracks the build frontier instead of jumping a zone at a
// time.
//
// It deliberately assumes NOTHING about the SHAPE of the built set. Builds are
// zone-ordered today, so the built set is a union of rectangles; ordering them
// globally nearest-first later makes it a disc. Caching a single frontier
// radius is only correct for the disc: against rectangles it reports a clamp
// that is too generous, which means visible holes. The query here is an exact
// bounded outward ring walk, correct for both.
//
// The query is also DIRECTIONAL, and that is load bearing. The clamp exists so
// the player never sees a hole, and a hole is only ever seen where the camera
// is pointed: unbuilt ground behind the camera costs the view nothing. Asking
// radially made the horizon a function of camera YAW, because a third-person
// camera orbits its player and the binding chunk swings around with it.
// Measured from the Eastbrook spawn, standing still and rotating on the spot
// against a 700 yard request: 170 yards served with the binder 90 degrees off
// the view axis, and 235 with the binder at 179 degrees, i.e. directly behind
// the camera. Everything past that horizon hands off to the coarse vista mesh,
// which carries no splat texture and takes no shadows, so rotating in place
// visibly deleted mid-field scenery and its shadows. Restricting the walk to
// the wedge the camera can actually see keeps the no-holes guarantee (the only
// ground that can show a hole is ground in frame) and makes the horizon
// independent of where the player happens to be looking.

import { MAX_OUTDOOR_FOG_FAR, MIN_OUTDOOR_FOG_FAR } from './zone_streaming';

/** Keep the fog this far short of unbuilt ground, so the clamp bites before
 *  the hole reaches the far plane rather than exactly at it. */
export const UNBUILT_GROUND_FOG_GUARD = 8;

/**
 * The terrain chunk lattice: square cells `size` across, `countX` by `countZ`,
 * with cell (0, 0)'s minimum corner at (originX, originZ).
 */
export interface ChunkGrid {
  readonly size: number;
  readonly countX: number;
  readonly countZ: number;
  readonly originX: number;
  readonly originZ: number;
}

/**
 * True when cell (cx, cz) is OWED terrain geometry that has not been attached
 * yet, which is the only condition that may clamp the fog.
 *
 * Note what this is NOT: "has no geometry". Cells no zone rectangle owns can
 * never be built (the rects do not tile: 96 of the 792 cells are unowned), and
 * neither can anything past the world rim. Those must never clamp, exactly as
 * the old zone-rectangle clamp never clamped for them, or the view would pin
 * itself against a hole that is never going to fill.
 */
export type GroundPendingAt = (cx: number, cz: number) => boolean;

/**
 * The horizontal wedge of world the camera can see, as a direction plus a
 * half-angle measured off it. Ground outside this wedge cannot show a hole, so
 * it must not clamp the horizon.
 *
 * `forwardX`/`forwardZ` are the camera's forward direction projected to XZ and
 * need not be normalized; a zero-length direction disables the restriction
 * (every cell is considered) rather than rejecting everything, so a caller that
 * cannot supply a direction degrades to the old radial answer.
 */
export interface GroundViewCone {
  readonly forwardX: number;
  readonly forwardZ: number;
  /** Half-angle off the forward axis, in radians. */
  readonly halfAngle: number;
}

/**
 * Slack added to the camera's own half-angle, in radians (15 degrees).
 *
 * The clamp is applied the same frame it is computed but CONSUMED a frame later
 * (subsystemCullFar reads the value updateAmbience refreshes further down the
 * same sync), so the wedge has to lead the camera by a frame of rotation: 15
 * degrees is 450 deg/s at 30 fps, faster than any sustained turn.
 *
 * A single-frame mouse flick can out-turn any fixed margin, which is why this
 * is a lead and not the safety net. The net is the far vista mesh standing
 * under the detail horizon: on the arm where the clamp actually gates scenery,
 * ground that has not arrived reads as coarse terrain, never as a hole, so
 * being one frame late costs a frame of coarse ground rather than a void. Wider
 * would be worse, not safer: every extra degree re-admits off-screen ground to
 * the clamp, which is the coupling this exists to break.
 */
export const GROUND_VIEW_CONE_MARGIN = Math.PI / 12;

/**
 * The bounding half-angle of a perspective frustum (its CORNER, not its
 * horizontal edge, so the wedge covers the whole frame) plus the lead margin.
 *
 * Capped just under a right angle: the wedge is expressed as two half-planes,
 * which only exclude the region behind the camera while the half-angle stays
 * below 90 degrees. A wider request would silently start clamping against
 * ground the player has their back to, which is the bug this exists to stop.
 */
export function groundViewConeHalfAngle(
  fovYRadians: number,
  aspect: number,
  margin = GROUND_VIEW_CONE_MARGIN,
): number {
  const tanY = Math.tan(Math.max(0, fovYRadians) / 2);
  const tanX = tanY * Math.max(0, aspect);
  const corner = Math.atan(Math.hypot(tanX, tanY));
  return Math.min(corner + Math.max(0, margin), Math.PI / 2 - 1e-3);
}

/**
 * True when a cell's rectangle lies wholly outside the view wedge.
 *
 * The wedge is the intersection of two half-planes through the camera, so a
 * rectangle entirely on the outside of EITHER of them is disjoint from it. That
 * is a sound rejection rather than a complete one (a rectangle can straddle
 * both boundaries beyond the wedge and still be kept), and incompleteness only
 * keeps a cell that could have been skipped, which is the safe direction: the
 * worst case is the old radial answer.
 */
function coneRejectsCell(
  cone: GroundViewCone,
  apexX: number,
  apexZ: number,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): boolean {
  const length = Math.hypot(cone.forwardX, cone.forwardZ);
  if (!(length > 0)) return false;
  const ux = cone.forwardX / length;
  const uz = cone.forwardZ / length;
  const sin = Math.sin(cone.halfAngle);
  const cos = Math.cos(cone.halfAngle);
  // Inward normals of the wedge's two boundary rays.
  const leftX = ux * sin + uz * cos;
  const leftZ = uz * sin - ux * cos;
  const rightX = ux * sin - uz * cos;
  const rightZ = ux * cos + uz * sin;
  // Support point of the axis-aligned cell along each normal: the rectangle is
  // outside a half-plane exactly when even its furthest corner falls short.
  const outside = (nx: number, nz: number): boolean =>
    nx * ((nx > 0 ? maxX : minX) - apexX) + nz * ((nz > 0 ? maxZ : minZ) - apexZ) < 0;
  return outside(leftX, leftZ) || outside(rightX, rightZ);
}

/** Cell column containing world x. May fall outside [0, countX). */
export function chunkCellX(grid: ChunkGrid, x: number): number {
  return Math.floor((x - grid.originX) / grid.size);
}

/** Cell row containing world z. May fall outside [0, countZ). */
export function chunkCellZ(grid: ChunkGrid, z: number): number {
  return Math.floor((z - grid.originZ) / grid.size);
}

/** Distance from (x, z) to cell (cx, cz)'s rectangle, 0 when inside it. */
function distanceToCell(grid: ChunkGrid, cx: number, cz: number, x: number, z: number): number {
  const minX = grid.originX + cx * grid.size;
  const minZ = grid.originZ + cz * grid.size;
  const maxX = minX + grid.size;
  const maxZ = minZ + grid.size;
  const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
  const dz = z < minZ ? minZ - z : z > maxZ ? z - maxZ : 0;
  return Math.hypot(dx, dz);
}

/**
 * Distance from (x, z) to the nearest cell still owing terrain geometry, or
 * Infinity when nothing within `maxDistance` does.
 *
 * Walks outward in Chebyshev rings. A cell on ring r is separated from the
 * camera's own cell by r - 1 whole cells, so nothing on ring r or beyond can be
 * nearer than (r - 1) * size; that bound stops the walk a ring or two after the
 * first hit instead of scanning the grid. The clamped case (the one that costs
 * the player anything) is therefore the cheapest case, and the fully built case
 * is bounded by maxDistance rather than by the size of the world.
 *
 * With a `cone`, only ground the camera can see is considered. Skipping a cell
 * can only raise the answer, so the ring bound stays valid; omitting the cone
 * asks the old radial question.
 */
export function nearestPendingGroundDistance(
  grid: ChunkGrid,
  isPending: GroundPendingAt,
  x: number,
  z: number,
  maxDistance: number,
  cone?: GroundViewCone | null,
): number {
  if (!(maxDistance > 0)) return Number.POSITIVE_INFINITY;
  const camCx = chunkCellX(grid, x);
  const camCz = chunkCellZ(grid, z);
  const maxRing = Math.ceil(maxDistance / grid.size) + 1;
  let best = Number.POSITIVE_INFINITY;
  for (let r = 0; r <= maxRing; r++) {
    const ringFloor = (r - 1) * grid.size;
    if (ringFloor >= best || ringFloor >= maxDistance) break;
    const cxMin = camCx - r;
    const cxMax = camCx + r;
    const czMin = camCz - r;
    const czMax = camCz + r;
    for (let cz = czMin; cz <= czMax; cz++) {
      if (cz < 0 || cz >= grid.countZ) continue;
      // The ring's top and bottom rows are solid; every row between them
      // contributes only its two end cells.
      const step = cz === czMin || cz === czMax ? 1 : cxMax - cxMin || 1;
      for (let cx = cxMin; cx <= cxMax; cx += step) {
        if (cx < 0 || cx >= grid.countX) continue;
        if (!isPending(cx, cz)) continue;
        if (cone) {
          const minX = grid.originX + cx * grid.size;
          const minZ = grid.originZ + cz * grid.size;
          if (coneRejectsCell(cone, x, z, minX, minZ, minX + grid.size, minZ + grid.size)) {
            continue;
          }
        }
        const distance = distanceToCell(grid, cx, cz, x, z);
        if (distance < best) best = distance;
      }
    }
  }
  return best;
}

/**
 * Cap outdoor visibility before the nearest ground that has not been built.
 * The chunk-level replacement for the old zone-rectangle clamp: same envelope
 * (floor, ceiling, guard), a unit of work roughly 20x smaller. No geometry is
 * generated by this query.
 *
 * Pass the camera's `cone` so only ground that can actually be seen binds the
 * clamp; without it the answer is radial and the horizon becomes a function of
 * camera yaw (see the module header).
 */
export function fogFarForBuiltGround(
  grid: ChunkGrid,
  isPending: GroundPendingAt,
  cameraX: number,
  cameraZ: number,
  requestedFar: number,
  cone?: GroundViewCone | null,
): number {
  const capped = Math.min(requestedFar, MAX_OUTDOOR_FOG_FAR);
  // Ground past the request cannot bind the clamp, and the guard comes off
  // afterwards, so the walk never needs to look further than this.
  const nearest = nearestPendingGroundDistance(
    grid,
    isPending,
    cameraX,
    cameraZ,
    capped + UNBUILT_GROUND_FOG_GUARD,
    cone,
  );
  if (!Number.isFinite(nearest)) return capped;
  return Math.max(MIN_OUTDOOR_FOG_FAR, Math.min(capped, nearest - UNBUILT_GROUND_FOG_GUARD));
}

/**
 * Build order for one zone's cells: the bounded neighbourhood around the entry
 * point first, nearest first, then everything else in its original row-major
 * order.
 *
 * This is the "which chunk next" seam. A player can enter a zone anywhere (a
 * returning character's logout spot, a walked boundary crossing), so row-major
 * order alone can leave them standing on not-yet-built terrain. Only the near
 * neighbourhood is reordered: the tail keeps row-major order so the far band's
 * 2x2 super-chunk merge still forms. Replacing this with a globally
 * nearest-first queue is a swap of this one function, not a change to the zone
 * lane that calls it.
 *
 * Returns a new array; the input is not modified.
 */
export function orderCellsForEntry(
  cells: readonly (readonly [number, number])[],
  grid: ChunkGrid,
  entry: { x: number; z: number } | null | undefined,
  nearRadius: number,
): [number, number][] {
  const ordered: [number, number][] = cells.map(([cx, cz]) => [cx, cz]);
  if (!entry) return ordered;
  const distance = ([cx, cz]: readonly [number, number]): number =>
    Math.hypot(
      grid.originX + (cx + 0.5) * grid.size - entry.x,
      grid.originZ + (cz + 0.5) * grid.size - entry.z,
    );
  const nearby = ordered.filter((cell) => distance(cell) <= nearRadius);
  if (nearby.length === 0) return ordered;
  const nearbySet = new Set(nearby);
  nearby.sort((a, b) => distance(a) - distance(b));
  return [...nearby, ...ordered.filter((cell) => !nearbySet.has(cell))];
}
