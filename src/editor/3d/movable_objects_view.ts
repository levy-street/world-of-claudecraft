// The 3D viewport's half of moving built-in gameplay objects
// (sim/moved_objects.ts): picking a farm bed, practice dummy, gather node or
// dungeon door under the cursor, moving its live representation while the
// maker drags it, and the selection ring. The decisions (the roster, the
// record edit, the nearest-object pick) live in ../object_moves_core.ts; this
// module only touches the live Sim entities and the renderer's preview hook,
// so the viewport keeps thin delegates.

import * as THREE from 'three';
import { farmCompostBinPosition } from '../../render/farm_patches_core';
import type { Renderer } from '../../render/renderer';
import { FARM_PATCHES } from '../../sim/content/farm_patches';
import { activeGatherNodes } from '../../sim/data';
import { DROWNED_TEMPLE_ENTRANCE_DUNGEON_ID } from '../../sim/drowned_temple_entrance';
import { HOLLOW_CRYPT_ENTRANCE_DUNGEON_ID } from '../../sim/hollow_crypt_entrance';
import { farmPatchesFor, type ObjectMoves } from '../../sim/moved_objects';
import { SANCTUM_SEAL_GATE_DUNGEON_ID } from '../../sim/sanctum_seal_gate';
import type { Sim } from '../../sim/sim';
import { SUNKEN_BASTION_ENTRANCE_DUNGEON_ID } from '../../sim/sunken_bastion_entrance';
import type { Entity } from '../../sim/types';
import { WILDHEART_BASIN_ENTRANCE_DUNGEON_ID } from '../../sim/wildheart_basin_entrance';
import { terrainHeight } from '../../sim/world';
import {
  type MovableObject,
  movableObjectByKey,
  nearestMovableObject,
  objectPose,
  objectPosition,
  practiceDummyKeyForTemplate,
} from '../object_moves_core';

/** The loose pass, after placements miss (the NPC loose pass's reach). */
const LOOSE_PICK_PX = 44;

export interface MovableObjectsViewHost {
  renderer(): Renderer | null;
  sim(): Sim | null;
  seed(): number;
  canvas(): HTMLCanvasElement;
  moves(): ObjectMoves | undefined;
  /** False on a map that cannot move built-in objects (a linked map). */
  enabled(): boolean;
}

export class MovableObjectsView {
  private selectedKey: string | null = null;
  /** The live entities of deleted dummies and doors, kept so undo or Restore
   *  puts the very same entity back (keyed `<kind>:<id>`). */
  private readonly removedEntities = new Map<string, Entity>();
  private ring: THREE.Mesh | null = null;
  private readonly ringMat = new THREE.MeshBasicMaterial({
    color: 0xffc04d,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    side: THREE.DoubleSide,
  });

  constructor(private readonly host: MovableObjectsViewHost) {}

  /** The movable object under the cursor, as its `<kind>:<id>` key. The
   *  exact passes first: the entity pick (a dummy, a door) and the gather-node
   *  raycast, both occlusion-correct, so they may beat a placement's slack
   *  radius. `directOnly` stops there; otherwise the loose projected pass runs
   *  too (the only way to a bed, which is no entity), which the viewport asks
   *  only after placements miss. */
  pick(clientX: number, clientY: number, directOnly: boolean): string | null {
    const renderer = this.host.renderer();
    const sim = this.host.sim();
    if (!renderer || !sim || !this.host.enabled()) return null;
    const rect = this.host.canvas().getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const id = renderer.picking.pickDirect(localX, localY);
    const entity = id === null ? undefined : sim.entities.get(id);
    if (entity?.kind === 'mob' && entity.ownerId === null) {
      const key = practiceDummyKeyForTemplate(entity.templateId);
      if (key) return key;
    }
    if (entity?.templateId === 'dungeon_door' && entity.dungeonId) {
      const key = `dungeonDoor:${entity.dungeonId}`;
      if (movableObjectByKey(key)) return key;
    }
    const nodeId = renderer.picking.pickGatherNode(localX, localY);
    if (nodeId !== null) {
      const key = `gatherNode:${nodeId}`;
      if (movableObjectByKey(key)) return key;
    }
    if (directOnly) return null;
    return this.nearest(clientX, clientY, LOOSE_PICK_PX, (o) => this.drawn(o))?.key ?? null;
  }

  /** Re-pose the object's live representation from how `before` had it to
   *  how `after` does (moved, turned, resized, deleted or restored): the Sim
   *  entity for a dummy or a door, the renderer's drawn instance for a bed
   *  (and its patch's compost bin), a node, or a door's entrance set piece.
   *  Colliders are the caller's (one rebuild per gesture, not per sample).
   *  False when a restored object has nothing live to bring back (it was
   *  already deleted when the view was built), so the caller can say it
   *  appears after the next rebuild. */
  moveLive(key: string, before: ObjectMoves | undefined, after: ObjectMoves | undefined): boolean {
    const object = movableObjectByKey(key);
    const sim = this.host.sim();
    const renderer = this.host.renderer();
    if (!object) return true;
    const from = objectPose(before, object);
    const to = objectPose(after, object);
    let shown = true;
    const seed = this.host.seed();
    const ground = { x: to.x, y: terrainHeight(to.x, to.z, seed), z: to.z };
    if ((object.kind === 'practiceDummy' || object.kind === 'dungeonDoor') && sim) {
      const matches = (entity: Entity): boolean =>
        object.kind === 'practiceDummy'
          ? entity.kind === 'mob' && entity.ownerId === null && entity.templateId === object.id
          : entity.templateId === 'dungeon_door' && entity.dungeonId === object.id;
      if (to.removed && !from.removed) {
        for (const entity of [...sim.entities.values()]) {
          if (!matches(entity)) continue;
          this.removedEntities.set(key, entity);
          sim.removeEntity(entity.id);
        }
      } else if (from.removed && !to.removed) {
        const entity = this.removedEntities.get(key);
        this.removedEntities.delete(key);
        if (entity && !sim.entities.has(entity.id)) sim.addEntity(entity);
        else if (!entity) shown = false;
      }
      for (const entity of sim.entities.values()) {
        if (!matches(entity)) continue;
        Object.assign(entity.pos, ground);
        Object.assign(entity.prevPos, ground);
        if (object.kind === 'practiceDummy') {
          Object.assign(entity.spawnPos, ground);
          if (entity.leashAnchor) Object.assign(entity.leashAnchor, ground);
          entity.facing = to.rotY;
          entity.prevFacing = to.rotY;
        }
      }
    }
    if (object.kind === 'dungeonDoor') {
      const n = renderer?.editor.previewObjectMove(
        { kind: 'dungeonDoor', dungeonId: object.id },
        from,
        to,
      );
      // A door with a set piece that was built hidden cannot come back live.
      if (from.removed && !to.removed && n === 0 && this.hasSetPiece(object.id)) shown = false;
    } else if (object.kind === 'gatherNode') {
      const n = renderer?.editor.previewObjectMove({ kind: 'gatherNode', id: object.id }, from, to);
      if (from.removed && !to.removed && n === 0) shown = false;
    } else if (object.kind === 'farmBed' && object.patchId !== undefined && renderer) {
      const n = renderer.editor.previewObjectMove(
        { kind: 'farmBed', patchId: object.patchId, bedId: object.id },
        from,
        to,
      );
      if (from.removed && !to.removed && n === 0) shown = false;
      const binFrom = this.binOf(before, object.patchId);
      const binTo = this.binOf(after, object.patchId);
      if (binFrom && binTo) {
        renderer.editor.previewObjectMove(
          { kind: 'farmBin', patchId: object.patchId },
          binFrom,
          binTo,
        );
      }
    }
    this.syncRing();
    return shown;
  }

  /** Whether a door carries an entrance set piece (the five built ones). */
  private hasSetPiece(dungeonId: string): boolean {
    return [
      SANCTUM_SEAL_GATE_DUNGEON_ID,
      SUNKEN_BASTION_ENTRANCE_DUNGEON_ID,
      HOLLOW_CRYPT_ENTRANCE_DUNGEON_ID,
      DROWNED_TEMPLE_ENTRANCE_DUNGEON_ID,
      WILDHEART_BASIN_ENTRANCE_DUNGEON_ID,
    ].includes(dungeonId);
  }

  /** Ring the selected object (or clear it with null). */
  setSelected(key: string | null): void {
    this.selectedKey = key && movableObjectByKey(key) ? key : null;
    this.syncRing();
  }

  /** Re-seat the ring on the selected object's current spot. */
  syncRing(): void {
    const renderer = this.host.renderer();
    const object = this.selectedKey ? movableObjectByKey(this.selectedKey) : undefined;
    if (!renderer || !object) {
      if (this.ring) this.ring.visible = false;
      return;
    }
    if (!this.ring || this.ring.parent !== renderer.scene) {
      this.disposeRing();
      const geometry = new THREE.RingGeometry(1.4, 1.75, 40);
      geometry.rotateX(-Math.PI / 2);
      this.ring = new THREE.Mesh(geometry, this.ringMat);
      this.ring.name = 'editor-object-selection';
      this.ring.renderOrder = 3;
      renderer.scene.add(this.ring);
    }
    const pos = objectPosition(this.host.moves(), object);
    this.ring.position.set(pos.x, terrainHeight(pos.x, pos.z, this.host.seed()) + 0.14, pos.z);
    this.ring.visible = true;
  }

  dispose(): void {
    this.disposeRing();
    this.ringMat.dispose();
  }

  private disposeRing(): void {
    if (!this.ring) return;
    this.ring.removeFromParent();
    this.ring.geometry.dispose();
    this.ring = null;
  }

  /** Whether the viewport actually draws this object, so the loose pass never
   *  picks something invisible (a node on a map that hides the veins, a dummy
   *  on a map without the practice yard). */
  private drawn(object: MovableObject): boolean {
    if (object.kind === 'gatherNode') return activeGatherNodes().length > 0;
    if (object.kind === 'practiceDummy') {
      const sim = this.host.sim();
      if (!sim) return false;
      for (const entity of sim.entities.values()) {
        if (entity.kind === 'mob' && entity.templateId === object.id) return true;
      }
      return false;
    }
    return true;
  }

  private binOf(moves: ObjectMoves | undefined, patchId: string): { x: number; z: number } | null {
    const patch = farmPatchesFor(moves, FARM_PATCHES).find((p) => p.id === patchId);
    return patch ? farmCompostBinPosition(patch) : null;
  }

  private nearest(
    clientX: number,
    clientY: number,
    maxPx: number,
    include: (object: MovableObject) => boolean,
  ): MovableObject | null {
    const renderer = this.host.renderer();
    if (!renderer) return null;
    const rect = this.host.canvas().getBoundingClientRect();
    const seed = this.host.seed();
    const v = new THREE.Vector3();
    return nearestMovableObject(
      this.host.moves(),
      (x, z) => {
        v.set(x, terrainHeight(x, z, seed) + 0.5, z).project(renderer.camera);
        if (v.z < -1 || v.z > 1) return null;
        return {
          x: rect.left + ((v.x + 1) / 2) * rect.width,
          y: rect.top + ((1 - v.y) / 2) * rect.height,
        };
      },
      clientX,
      clientY,
      maxPx,
      include,
    );
  }
}
