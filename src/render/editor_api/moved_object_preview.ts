// The map editor's live preview of a moved built-in gameplay object
// (sim/moved_objects.ts): shift what the renderer already drew, in place, by
// the move's offset, so the maker sees a farm bed, a gather node or a dungeon
// entrance land where they dropped it without rebuilding the world.
//
// Editor-only and approximate on purpose: the beds and nodes are instanced
// batches baked at build time, so the preview translates one instance (its
// ground tilt is the old spot's), and an entrance set piece moves as a whole
// rather than re-seating every stone. The next build of the renderer reads
// the moved tables (Sim.farmPatches, activeGatherNodes, activeDungeonDoorPos)
// and draws everything exactly. The shipped game never calls this.

import * as THREE from 'three';
import { DROWNED_TEMPLE_ENTRANCE_DUNGEON_ID } from '../../sim/drowned_temple_entrance';
import { HOLLOW_CRYPT_ENTRANCE_DUNGEON_ID } from '../../sim/hollow_crypt_entrance';
import { SANCTUM_SEAL_GATE_DUNGEON_ID } from '../../sim/sanctum_seal_gate';
import { SUNKEN_BASTION_ENTRANCE_DUNGEON_ID } from '../../sim/sunken_bastion_entrance';
import { WILDHEART_BASIN_ENTRANCE_DUNGEON_ID } from '../../sim/wildheart_basin_entrance';

export type MovedObjectPreview =
  | { readonly kind: 'farmBed'; readonly patchId: string; readonly bedIndex: number }
  | { readonly kind: 'farmBin'; readonly patchId: string }
  | { readonly kind: 'gatherNode'; readonly id: string }
  | { readonly kind: 'dungeonDoor'; readonly dungeonId: string };

/** The entrance set pieces each built door carries (static_world_features.ts),
 *  by the root group name its builder gives it. */
const DOOR_SET_PIECE_GROUPS: Readonly<Record<string, string>> = {
  [SANCTUM_SEAL_GATE_DUNGEON_ID]: 'sanctumSealGate',
  [SUNKEN_BASTION_ENTRANCE_DUNGEON_ID]: 'sunkenBastionEntrance',
  [HOLLOW_CRYPT_ENTRANCE_DUNGEON_ID]: 'hollowCryptEntrance',
  [DROWNED_TEMPLE_ENTRANCE_DUNGEON_ID]: 'drownedTempleEntrance',
  [WILDHEART_BASIN_ENTRANCE_DUNGEON_ID]: 'wildheartBasinEntrance',
};

function shiftInstance(mesh: THREE.InstancedMesh, index: number, d: THREE.Vector3): boolean {
  if (index < 0 || index >= mesh.instanceMatrix.count) return false;
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(index, m);
  m.elements[12] += d.x;
  m.elements[13] += d.y;
  m.elements[14] += d.z;
  mesh.setMatrixAt(index, m);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return true;
}

function shiftObject(object: THREE.Object3D, d: THREE.Vector3): void {
  object.position.add(d);
  // The static dressing freezes its matrices, so recompute them by hand.
  object.updateMatrix();
  object.updateMatrixWorld(true);
}

/**
 * Translate the drawn instance(s) of `target` from `from` to `to` (ground
 * height from `ground`). Returns how many objects or instances moved, so a
 * caller can tell a preview from a miss (a node the map does not draw, a door
 * with no set piece).
 */
export function shiftMovedObjectInScene(
  scene: THREE.Object3D,
  target: MovedObjectPreview,
  from: { readonly x: number; readonly z: number },
  to: { readonly x: number; readonly z: number },
  ground: (x: number, z: number) => number,
): number {
  const d = new THREE.Vector3(
    to.x - from.x,
    ground(to.x, to.z) - ground(from.x, from.z),
    to.z - from.z,
  );
  if (d.lengthSq() === 0) return 0;
  let moved = 0;
  if (target.kind === 'dungeonDoor') {
    const name = DOOR_SET_PIECE_GROUPS[target.dungeonId];
    const group = name ? scene.getObjectByName(name) : undefined;
    if (group) {
      shiftObject(group, d);
      moved++;
    }
    return moved;
  }
  const instanceName =
    target.kind === 'farmBed'
      ? `farmPatches:bed:${target.patchId}`
      : target.kind === 'farmBin'
        ? `farmPatches:bin:${target.patchId}`
        : null;
  scene.traverse((object) => {
    if (instanceName !== null) {
      if (object instanceof THREE.InstancedMesh && object.name === instanceName) {
        if (shiftInstance(object, target.kind === 'farmBed' ? target.bedIndex : 0, d)) moved++;
      }
      return;
    }
    if (target.kind !== 'gatherNode') return;
    const ids = object.userData.gatherNodeIds;
    if (object instanceof THREE.InstancedMesh && Array.isArray(ids)) {
      const index = ids.indexOf(target.id);
      if (index >= 0 && shiftInstance(object, index, d)) moved++;
    } else if (object.userData.gatherNodeId === target.id) {
      shiftObject(object, d);
      moved++;
    }
  });
  return moved;
}
