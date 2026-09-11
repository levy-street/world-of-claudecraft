// Procedural Rift regions. A rift floor's collision comes from its GENERATED
// DungeonLayout, so it cannot be a static INTERIOR_COLLIDERS entry. rift/runs.ts
// publishes the active floor's instance-local collider set here on spawn/descent
// and clears it on free; every region-aware collision function in colliders.ts
// reads it through `riftRegionAt`, so movement, mob pathing, and line-of-sight
// all respect the generated geometry uniformly. Keyed by a per-Sim COLLISION
// TOKEN (allocated once per world via allocRiftCollisionToken, NOT the world
// seed: two Sims in one process can share a seed) plus the instance origin, so
// concurrent rifts and multiple Sims stay isolated. Token 0 means "no rift
// regions". Extracted out of colliders.ts to keep that file under its monolith
// ceiling (root CLAUDE.md, Modularity); colliders.ts re-exports the three
// publish/token verbs so every existing importer keeps working unchanged.
import { buildColliderCellIndex, type ColliderCellIndex, GRID_CELL } from './collider_cells';
import type { Collider } from './colliders';
import { RIFT_REGION_HALF_X, RIFT_REGION_HALF_Z, riftNearestFloorOriginZ } from './data';

export interface RiftRegion {
  ox: number;
  oz: number;
  colliders: Collider[];
  /** Cell index over `colliders`, built once at publish. Movement and sight
   *  read the sample point's cell instead of scanning the whole floor's list;
   *  the MAX_BODY_RADIUS registration margin (collider_cells.ts) keeps the
   *  single-cell read complete for every live resolve radius. */
  cells: ColliderCellIndex;
}
// token -> floor origin z -> region. Every region shares RIFT_X_MIN as its ox
// and floor origins are RIFT_FLOOR_SPACING (340) apart while regions span
// +/- RIFT_REGION_HALF_Z (160), so origins never collide and oz is a unique
// key. riftNearestFloorOriginZ derives the only candidate origin for a
// position, making the lookup O(1) instead of a scan over every occupied
// slot (NEVER riftOriginAt here: its slot clamp maps the south half of a
// floor 0 into the previous slot's top floor).
const RIFT_REGIONS = new Map<number, Map<number, RiftRegion>>();
let NEXT_RIFT_TOKEN = 1;

export function allocRiftCollisionToken(): number {
  return NEXT_RIFT_TOKEN++;
}

/** Publish a rift floor's generated collider set. `cellSize` is a test seam:
 *  the equivalence suite publishes a reference region with cellSize Infinity,
 *  one all-covering cell that reproduces the pre-index full-list scan (see
 *  collider_cells.ts: a finite size quadrants at the local origin instead). */
export function setRiftRegion(
  token: number,
  ox: number,
  oz: number,
  colliders: Collider[],
  cellSize?: number,
): void {
  let byOz = RIFT_REGIONS.get(token);
  if (!byOz) {
    byOz = new Map();
    RIFT_REGIONS.set(token, byOz);
  }
  // The seam may only WIDEN cells (the reference token's one giant cell): a
  // smaller-than-GRID_CELL cell would break the registration-margin
  // completeness argument, so clamp.
  const size = cellSize === undefined ? undefined : Math.max(cellSize, GRID_CELL);
  byOz.set(oz, { ox, oz, colliders, cells: buildColliderCellIndex(colliders, size) });
}

export function clearRiftRegion(token: number, ox: number, oz: number): void {
  const byOz = RIFT_REGIONS.get(token);
  if (!byOz) return;
  // oz is the key (every origin shares RIFT_X_MIN as its ox); the ox guard
  // keeps a mismatched clear from deleting someone else's region if that
  // invariant ever breaks. Drop the emptied inner map so throwaway Sims
  // (character creation constructs one per call) leave nothing behind.
  if (byOz.get(oz)?.ox === ox) byOz.delete(oz);
  if (byOz.size === 0) RIFT_REGIONS.delete(token);
}

export function riftRegionAt(token: number, x: number, z: number): RiftRegion | null {
  const byOz = RIFT_REGIONS.get(token);
  if (!byOz) return null;
  // The nearest floor origin is the only region that can contain (x, z):
  // regions are 320 deep on 340 spacing, so they never overlap. MUST be the
  // true nearest-origin derivation (riftNearestFloorOriginZ, allocation-free,
  // once per movement resolve and per 0.5 yd sight sample), never
  // riftOriginAt: see the map comment above.
  const region = byOz.get(riftNearestFloorOriginZ(z));
  if (!region) return null;
  if (Math.abs(x - region.ox) > RIFT_REGION_HALF_X || Math.abs(z - region.oz) > RIFT_REGION_HALF_Z)
    return null;
  return region;
}
