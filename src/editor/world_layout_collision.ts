import { effectiveCollisionMode, type MapDoc, type MapPlacement } from '../sim/map_doc';
import type { PlacedAsset } from '../sim/types';
import { placementsToPlayAssets } from './custom_map';
import { matchLayoutScenery } from './world_layout_scenery';

export interface CollisionLayoutAdoption {
  uid: string;
  source: MapPlacement;
  reason: string;
}

/** Adopt authored collision on existing noncolliding scenery without rendering it twice. */
export function compileLayoutCollision(
  map: MapDoc,
  adoptions: readonly CollisionLayoutAdoption[] | undefined,
  current: readonly MapPlacement[] | undefined,
  used: Set<string>,
  issue: (id: string, reason: string) => void,
): { collisions: PlacedAsset[]; reservedIndices: Set<number> } {
  const collisions: PlacedAsset[] = [];
  const reservedIndices = new Set<number>();
  for (const adoption of adoptions ?? []) {
    const placement = map.placements.find((p) => p.uid === adoption.uid);
    const matches =
      current && matchLayoutScenery([adoption.source, adoption.source], current).matches;
    if (
      !placement ||
      used.has(adoption.uid) ||
      !adoption.reason.trim() ||
      matches?.length !== 1 ||
      effectiveCollisionMode(adoption.source) !== 'none' ||
      effectiveCollisionMode(placement) !== 'baked'
    ) {
      issue(
        `collision:${adoption.uid}`,
        'Collision adoption requires one unchanged noncolliding baseline and an unused baked source.',
      );
      continue;
    }
    const index = matches[0].currentIndex;
    // GLB conversion can differ by one floating-point ulp in its ground lift.
    // This explicit collision-only decision keeps the current rendered seat.
    const y = adoption.source.y;
    const visual = { ...placement, y, collide: false, collisionMode: 'none' as const };
    if (
      reservedIndices.has(index) ||
      Math.abs((placement.y ?? 0) - (y ?? 0)) > 1e-12 ||
      matchLayoutScenery([visual], [adoption.source]).matches.length !== 1
    ) {
      issue(
        `collision:${adoption.uid}`,
        'Collision-only adoption cannot move, replace or reuse the current model.',
      );
      continue;
    }
    const projected = placementsToPlayAssets([{ ...placement, y }], map.assetCollisionMesh);
    if (projected.length !== 1) {
      issue(`collision:${adoption.uid}`, 'Collision asset could not be projected.');
      continue;
    }
    collisions.push(projected[0]);
    reservedIndices.add(index);
    used.add(adoption.uid);
  }
  return { collisions, reservedIndices };
}
