// Collider-volume placements: the map editor stores box/sphere/plane collision
// volumes as ordinary MapPlacements with a reserved 'collider/<kind>' assetId,
// so they ride the whole placement pipeline (transform tools, undo, caps, the
// sanitizer, region copy/paste) for free. This module owns the reserved ids and
// the ONE resolution from a placement record to a world-space ColliderVolume,
// shared by the playtest projection (custom_map.ts) and the editor overlay.
// Sim layer: pure data, no DOM/Three imports.

import type { MapPlacement } from './map_doc';
import type { ColliderVolume } from './types';

export type ColliderVolumeKind = ColliderVolume['kind'];

const COLLIDER_ASSET_PREFIX = 'collider/';

export const COLLIDER_ASSET_IDS: Record<ColliderVolumeKind, string> = {
  box: 'collider/box',
  sphere: 'collider/sphere',
  plane: 'collider/plane',
  wall: 'collider/wall',
};

/** Authoring dimensions at placement scale 1 (yards): box W/H/D, sphere
 *  diameter, plane W/(floor offset)/D, wall W/H/thickness (a floor plane
 *  stood on its side, ready-made for invisible wall blocking). */
export const COLLIDER_DEFAULT_SIZE: Record<
  ColliderVolumeKind,
  { x: number; y: number; z: number }
> = {
  box: { x: 4, y: 4, z: 4 },
  sphere: { x: 3, y: 3, z: 3 },
  plane: { x: 12, y: 0, z: 12 },
  wall: { x: 12, y: 10, z: 0.6 },
};

export function isColliderAssetId(assetId: string): boolean {
  return assetId.startsWith(COLLIDER_ASSET_PREFIX);
}

export function colliderKindFor(assetId: string): ColliderVolumeKind | null {
  if (assetId === COLLIDER_ASSET_IDS.box) return 'box';
  if (assetId === COLLIDER_ASSET_IDS.sphere) return 'sphere';
  if (assetId === COLLIDER_ASSET_IDS.plane) return 'plane';
  if (assetId === COLLIDER_ASSET_IDS.wall) return 'wall';
  return null;
}

/**
 * Resolve a collider placement into its world-space volume, or null when the
 * placement is not a (blocking) collider. Scale multiplies the footprint
 * dimensions; a plane's sizeY is a floor OFFSET, deliberately unscaled so the
 * Scale tool widens a room floor without also lifting it.
 */
export function colliderVolumeFromPlacement(p: MapPlacement): ColliderVolume | null {
  const kind = colliderKindFor(p.assetId);
  if (!kind || !p.collide) return null;
  const d = COLLIDER_DEFAULT_SIZE[kind];
  const sx = Math.max(0.1, (p.sizeX ?? d.x) * p.scale);
  const sz = Math.max(0.1, (p.sizeZ ?? d.z) * p.scale);
  const sy = kind === 'plane' ? (p.sizeY ?? d.y) : Math.max(0.1, (p.sizeY ?? d.y) * p.scale);
  const out: ColliderVolume = {
    kind,
    x: p.x,
    z: p.z,
    rotY: p.rotY,
    sizeX: sx,
    sizeY: sy,
    sizeZ: sz,
  };
  // Planes accept tilt (sloped floors / ramps); box and sphere collision stays
  // yaw-only OBBs, so their tilt is deliberately dropped.
  if (kind === 'plane') {
    if (p.rotX) out.rotX = p.rotX;
    if (p.rotZ) out.rotZ = p.rotZ;
    // Fold the gizmo Y-lift and detached anchor into the walkable floor so a
    // raised bridge deck collides where it is drawn, not down at the terrain.
    if (p.y) out.offsetY = p.y;
    if (p.detached) {
      out.detached = true;
      out.groundY = p.groundY ?? 0;
    }
  }
  return out;
}

/** All blocking collider volumes in a placement list (playtest projection). */
export function colliderVolumesFromPlacements(
  placements: readonly MapPlacement[],
): ColliderVolume[] {
  const out: ColliderVolume[] = [];
  for (const p of placements) {
    const v = colliderVolumeFromPlacement(p);
    if (v) out.push(v);
  }
  return out;
}
