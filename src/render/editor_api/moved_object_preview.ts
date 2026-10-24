// The map editor's live preview of an edited built-in gameplay object
// (sim/moved_objects.ts): move, turn, resize or hide what the renderer already
// drew, in place, so the maker sees a farm bed, a gather node or a dungeon
// entrance change the moment they edit it, without rebuilding the world.
//
// Editor-only and approximate on purpose: the beds and nodes are instanced
// batches baked at build time, so the preview re-poses one instance about its
// base point (its ground tilt is the old spot's), and an entrance set piece
// moves as a whole rather than re-seating every stone. A deleted object
// collapses to zero size, its last pose kept on the mesh so a restore (undo)
// brings it back. The next build of the renderer reads the edited tables
// (Sim.farmPatches, activeGatherNodes, activeDungeonDoorPos) and draws
// everything exactly. The shipped game never calls this.

import * as THREE from 'three';
import { DROWNED_TEMPLE_ENTRANCE_DUNGEON_ID } from '../../sim/drowned_temple_entrance';
import { HOLLOW_CRYPT_ENTRANCE_DUNGEON_ID } from '../../sim/hollow_crypt_entrance';
import { SANCTUM_SEAL_GATE_DUNGEON_ID } from '../../sim/sanctum_seal_gate';
import { SUNKEN_BASTION_ENTRANCE_DUNGEON_ID } from '../../sim/sunken_bastion_entrance';
import { WILDHEART_BASIN_ENTRANCE_DUNGEON_ID } from '../../sim/wildheart_basin_entrance';
import { type FarmBedSeat, farmBedSeatsOf } from '../farm_patches';
import { farmSeatAfterBedMove } from '../farm_patches_core';

export type MovedObjectPreview =
  | {
      readonly kind: 'farmBed';
      readonly patchId: string;
      /** The bed's id: its instance is found through the mesh's farmBedIds. */
      readonly bedId?: string;
      /** Fallback slot when a mesh carries no id table. */
      readonly bedIndex?: number;
    }
  | { readonly kind: 'farmBin'; readonly patchId: string }
  | { readonly kind: 'gatherNode'; readonly id: string }
  | { readonly kind: 'dungeonDoor'; readonly dungeonId: string };

/** One state of an edited object: where it stands, its turn and size, and
 *  whether the map deleted it. Plain {x, z} is an untouched pose. */
export interface PreviewPose {
  readonly x: number;
  readonly z: number;
  readonly rotY?: number;
  readonly scale?: number;
  readonly removed?: boolean;
}

/** The entrance set pieces each built door carries (static_world_features.ts),
 *  by the root group name its builder gives it. */
const DOOR_SET_PIECE_GROUPS: Readonly<Record<string, string>> = {
  [SANCTUM_SEAL_GATE_DUNGEON_ID]: 'sanctumSealGate',
  [SUNKEN_BASTION_ENTRANCE_DUNGEON_ID]: 'sunkenBastionEntrance',
  [HOLLOW_CRYPT_ENTRANCE_DUNGEON_ID]: 'hollowCryptEntrance',
  [DROWNED_TEMPLE_ENTRANCE_DUNGEON_ID]: 'drownedTempleEntrance',
  [WILDHEART_BASIN_ENTRANCE_DUNGEON_ID]: 'wildheartBasinEntrance',
};

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

/** The world transform that carries the `from` pose onto the `to` pose: about
 *  the base point, turn by the yaw change and resize by the size ratio, then
 *  translate (ground height included). */
function poseDelta(
  from: PreviewPose,
  to: PreviewPose,
  ground: (x: number, z: number) => number,
): THREE.Matrix4 {
  const y0 = ground(from.x, from.z);
  const y1 = ground(to.x, to.z);
  const turn = (to.rotY ?? 0) - (from.rotY ?? 0);
  const ratio = (to.scale ?? 1) / (from.scale ?? 1);
  return new THREE.Matrix4()
    .makeTranslation(to.x, y1, to.z)
    .multiply(new THREE.Matrix4().makeRotationY(turn))
    .multiply(new THREE.Matrix4().makeScale(ratio, ratio, ratio))
    .multiply(new THREE.Matrix4().makeTranslation(-from.x, -y0, -from.z));
}

function poseChanged(from: PreviewPose, to: PreviewPose): boolean {
  return (
    from.x !== to.x ||
    from.z !== to.z ||
    (from.rotY ?? 0) !== (to.rotY ?? 0) ||
    (from.scale ?? 1) !== (to.scale ?? 1) ||
    (from.removed === true) !== (to.removed === true)
  );
}

function editInstance(
  mesh: THREE.InstancedMesh,
  index: number,
  from: PreviewPose,
  to: PreviewPose,
  ground: (x: number, z: number) => number,
): boolean {
  if (index < 0 || index >= mesh.instanceMatrix.count) return false;
  const hidden: Map<number, THREE.Matrix4> = mesh.userData.removedInstances ?? new Map();
  mesh.userData.removedInstances = hidden;
  const m = new THREE.Matrix4();
  // A hidden instance re-poses from the pose it had when it was deleted.
  const stashed = hidden.get(index);
  if (stashed) m.copy(stashed);
  else mesh.getMatrixAt(index, m);
  m.premultiply(poseDelta(from, to, ground));
  if (to.removed) {
    hidden.set(index, m);
    mesh.setMatrixAt(index, ZERO);
  } else {
    hidden.delete(index);
    mesh.setMatrixAt(index, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return true;
}

function editObject(
  object: THREE.Object3D,
  from: PreviewPose,
  to: PreviewPose,
  ground: (x: number, z: number) => number,
): void {
  const stashed: THREE.Vector3 | undefined = object.userData.removedScale;
  if (stashed) object.scale.copy(stashed);
  const y0 = ground(from.x, from.z);
  const y1 = ground(to.x, to.z);
  object.position.add(new THREE.Vector3(to.x - from.x, y1 - y0, to.z - from.z));
  object.rotation.y += (to.rotY ?? 0) - (from.rotY ?? 0);
  object.scale.multiplyScalar((to.scale ?? 1) / (from.scale ?? 1));
  if (to.removed) {
    object.userData.removedScale = object.scale.clone();
    object.scale.setScalar(0);
  } else {
    delete object.userData.removedScale;
  }
  // The static dressing freezes its matrices, so recompute them by hand.
  object.updateMatrix();
  object.updateMatrixWorld(true);
}

// The seats of beds the editor deleted, per renderer seat map, until a restore.
const PARKED_SEATS = new WeakMap<Map<string, FarmBedSeat>, Map<string, FarmBedSeat>>();

/**
 * The crops growing in a dragged bed go with it. The farm visuals seat a plot
 * from the renderer's bed-seat map (farmBedSeatsOf), so the seat is re-posed
 * there: its position replaced and its orientation turned IN PLACE (the same
 * world-up turn the bed instance takes), because a drawn plot keeps that very
 * quaternion and composes its idle sway onto it every frame. Every drawn group
 * of the plot moves by the same delta (a stage rebuild still linking keeps the
 * outgoing stage drawing beside it), keeping its height above the soil.
 *
 * A deleted bed leaves the seat map, parked here until a restore, so no
 * rebuild or flourish can draw its crop meanwhile, and its groups shrink to
 * nothing at once (the next plot read then drops them). Hidden by size, never
 * by `visible`: a plot's compile gate owns that flag (gated_scene_attach.ts).
 */
function reseatFarmCrops(
  scene: THREE.Object3D,
  bedId: string,
  from: PreviewPose,
  to: PreviewPose,
  ground: (x: number, z: number) => number,
): number {
  const seats = farmBedSeatsOf(scene.getObjectByName('farmPatches'));
  if (!seats) return 0;
  let parked = PARKED_SEATS.get(seats);
  if (!parked) {
    parked = new Map();
    PARKED_SEATS.set(seats, parked);
  }
  const seat = seats.get(bedId) ?? parked.get(bedId);
  if (!seat) return 0;
  const next = farmSeatAfterBedMove(seat, from, to, ground);
  seat.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, next.turn));
  const moved: FarmBedSeat = { ...seat, x: next.x, y: next.y, z: next.z };
  if (to.removed === true) {
    seats.delete(bedId);
    parked.set(bedId, moved);
  } else {
    parked.delete(bedId);
    seats.set(bedId, moved);
  }
  const name = `farmPlot:${bedId}`;
  let drawn = 0;
  scene.traverse((plot) => {
    if (plot.name !== name) return;
    plot.position.set(
      plot.position.x + next.x - seat.x,
      plot.position.y + next.y - seat.y,
      plot.position.z + next.z - seat.z,
    );
    plot.quaternion.copy(seat.quat);
    plot.scale.setScalar(to.removed === true ? 0 : 1);
    plot.updateMatrix();
    plot.updateMatrixWorld(true);
    drawn++;
  });
  return drawn > 0 ? 1 : 0;
}

/**
 * Re-pose the drawn instance(s) of `target` from the `from` pose to the `to`
 * pose (ground height from `ground`). Returns how many objects or instances
 * changed, so a caller can tell a preview from a miss (a node the map does
 * not draw, a door with no set piece). A farm bed carries its growing crops.
 */
export function shiftMovedObjectInScene(
  scene: THREE.Object3D,
  target: MovedObjectPreview,
  from: PreviewPose,
  to: PreviewPose,
  ground: (x: number, z: number) => number,
): number {
  if (!poseChanged(from, to)) return 0;
  let moved = 0;
  if (target.kind === 'dungeonDoor') {
    const name = DOOR_SET_PIECE_GROUPS[target.dungeonId];
    const group = name ? scene.getObjectByName(name) : undefined;
    if (group) {
      editObject(group, from, to, ground);
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
      if (!(object instanceof THREE.InstancedMesh) || object.name !== instanceName) return;
      let index = 0;
      if (target.kind === 'farmBed') {
        const ids = object.userData.farmBedIds;
        index =
          Array.isArray(ids) && target.bedId !== undefined
            ? ids.indexOf(target.bedId)
            : (target.bedIndex ?? -1);
      }
      if (editInstance(object, index, from, to, ground)) moved++;
      return;
    }
    if (target.kind !== 'gatherNode') return;
    const ids = object.userData.gatherNodeIds;
    if (object instanceof THREE.InstancedMesh && Array.isArray(ids)) {
      const index = ids.indexOf(target.id);
      if (index >= 0 && editInstance(object, index, from, to, ground)) moved++;
    } else if (object.userData.gatherNodeId === target.id) {
      editObject(object, from, to, ground);
      moved++;
    }
  });
  if (target.kind === 'farmBed' && target.bedId !== undefined) {
    moved += reseatFarmCrops(scene, target.bedId, from, to, ground);
  }
  return moved;
}
