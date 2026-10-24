// Deleting, turning and resizing the built-in gameplay objects a Studio map
// can change (src/sim/moved_objects.ts, src/editor/object_moves_core.ts,
// src/editor/object_move_controller.ts, render/editor_api/moved_object_preview.ts).
// Pinned here:
//  - the shared sanitizer keeps a turn, a size and a deletion only where the
//    kind allows them, wraps and clamps the values, and drops no-op fields;
//  - a deleted bed, node, dummy or door leaves every table it lived in, while
//    every other entity keeps its id (a deleted dummy or door still consumes
//    its id) and the rng stream is untouched;
//  - a deleted door takes its jambs, set-piece walls and clear ring with it;
//  - a resized node's collider scales, and a turned or resized bed keeps its
//    patch's pin where it was;
//  - the editor rule keeps a deleted object's pose for Restore, drops the
//    entry when everything is back home, and never picks a deleted object;
//  - delete, restore, turn and resize are one undo step each;
//  - the live preview turns, resizes, hides and restores the drawn instance
//    by id, and hides and restores a door's set piece.
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ObjectMoveController,
  type ObjectMoveUndoEntry,
} from '../src/editor/object_move_controller';
import {
  movableObjectByKey,
  nearestMovableObject,
  objectPose,
  removedObjects,
  withObjectEdited,
} from '../src/editor/object_moves_core';
import { shiftMovedObjectInScene } from '../src/render/editor_api/moved_object_preview';
import {
  type Collider,
  invalidateStaticColliders,
  queryOpenWorldColliders,
} from '../src/sim/colliders';
import { FARM_PATCHES } from '../src/sim/content/farm_patches';
import { HEALING_TRAINING_GROUND_SPAWNS } from '../src/sim/content/healing_training';
import { HUB_HEALING_DUMMY_ID, HUB_TRAINING_DUMMY_ID } from '../src/sim/content/practice_dummies';
import {
  BUILTIN_WORLD,
  DUNGEON_LIST,
  GATHER_NODES,
  gatherNodesInActiveWorld,
  setActiveWorldContent,
} from '../src/sim/data';
import { projectOutsideDungeonDoors } from '../src/sim/dungeon_door_clearance';
import { dungeonDoorJambColliders } from '../src/sim/dungeon_door_jambs';
import {
  farmBedFor,
  farmPatchesFor,
  freezeObjectMoves,
  gatherNodesFor,
  MAX_OBJECT_SCALE,
  type ObjectMove,
  type ObjectMoves,
  objectMoveKey,
  sanitizeObjectMoves,
} from '../src/sim/moved_objects';
import { Sim } from '../src/sim/sim';
import type { WorldContent } from '../src/sim/types';
import { overworldDungeonPortals } from '../src/ui/map_dungeon_portals';

function editedWorld(moves: Record<string, ObjectMove>): WorldContent {
  return { ...BUILTIN_WORLD, objectMoves: freezeObjectMoves(moves) };
}

afterEach(() => {
  setActiveWorldContent(null);
  invalidateStaticColliders();
});

describe('object edits: the shared record', () => {
  it('keeps a turn and a size only where the kind allows, wrapped and clamped', () => {
    const clean = sanitizeObjectMoves(
      {
        'farmBed:bed_eastbrook_1': { x: 1, z: 2, rotY: Math.PI * 3, scale: 99 },
        'practiceDummy:training_dummy': { x: 1, z: 2, rotY: 0.5, scale: 2 },
        'dungeonDoor:hollow_crypt': { x: 1, z: 2, rotY: 1, scale: 2, removed: true },
        'gatherNode:node_x': { x: 1, z: 2, rotY: 0, scale: 1, removed: false },
      },
      10_000,
    );
    expect(clean?.['farmBed:bed_eastbrook_1']).toEqual({
      x: 1,
      z: 2,
      rotY: Math.PI,
      scale: MAX_OBJECT_SCALE,
    });
    // A dummy turns but keeps its template's size; a door neither turns nor
    // resizes, but can be deleted.
    expect(clean?.['practiceDummy:training_dummy']).toEqual({ x: 1, z: 2, rotY: 0.5 });
    expect(clean?.['dungeonDoor:hollow_crypt']).toEqual({ x: 1, z: 2, removed: true });
    // A size of 1 and removed: false are dropped; a turn of 0 is kept, since
    // for an object that faces elsewhere by default it is a real turn.
    expect(clean?.['gatherNode:node_x']).toEqual({ x: 1, z: 2, rotY: 0 });
  });

  it('a deleted bed leaves its patch, and a patch with no beds left goes too', () => {
    const patch = FARM_PATCHES[0];
    const [first, ...rest] = patch.beds;
    const one = freezeObjectMoves({
      [objectMoveKey('farmBed', first.id)]: { x: first.x, z: first.z, removed: true },
    });
    const after = farmPatchesFor(one, FARM_PATCHES);
    expect(after.find((p) => p.id === patch.id)?.beds.map((b) => b.id)).toEqual(
      rest.map((b) => b.id),
    );
    expect(farmBedFor(one, first)).toBeUndefined();
    const all = freezeObjectMoves(
      Object.fromEntries(
        patch.beds.map((b) => [objectMoveKey('farmBed', b.id), { x: b.x, z: b.z, removed: true }]),
      ),
    );
    expect(farmPatchesFor(all, FARM_PATCHES).some((p) => p.id === patch.id)).toBe(false);
    expect(farmPatchesFor(all, FARM_PATCHES)).toHaveLength(FARM_PATCHES.length - 1);
  });

  it('a turned or resized bed keeps the patch pin and carries its turn and size', () => {
    const patch = FARM_PATCHES[0];
    const bed = patch.beds[0];
    const moves = freezeObjectMoves({
      [objectMoveKey('farmBed', bed.id)]: { x: bed.x, z: bed.z, rotY: 0.75, scale: 1.5 },
    });
    const after = farmPatchesFor(moves, FARM_PATCHES).find((p) => p.id === patch.id);
    expect(after?.x).toBe(patch.x);
    expect(after?.z).toBe(patch.z);
    expect(after?.beds[0]).toEqual({ id: bed.id, x: bed.x, z: bed.z, rotY: 0.75, scale: 1.5 });
  });

  it('a deleted gather node leaves the table; a resized one scales its collider', () => {
    const ore = GATHER_NODES.find((n) => n.type === 'ore');
    const other = GATHER_NODES.find((n) => n.type === 'ore' && n.id !== ore?.id);
    if (!ore || !other) throw new Error('no ore nodes');
    const moves = freezeObjectMoves({
      [objectMoveKey('gatherNode', ore.id)]: { x: ore.pos.x, z: ore.pos.z, removed: true },
      [objectMoveKey('gatherNode', other.id)]: { x: other.pos.x, z: other.pos.z, scale: 2 },
    });
    const nodes = gatherNodesFor(moves, GATHER_NODES);
    expect(nodes).toHaveLength(GATHER_NODES.length - 1);
    expect(nodes.some((n) => n.id === ore.id)).toBe(false);
    expect(nodes.find((n) => n.id === other.id)?.scale).toBe(2);
    const circleAt = (p: { x: number; z: number }): Collider | undefined =>
      queryOpenWorldColliders(20061, p.x - 0.5, p.z - 0.5, p.x + 0.5, p.z + 0.5, []).find(
        (c) => c.type === 'circle' && Math.hypot(c.x - p.x, c.z - p.z) < 0.01,
      );
    invalidateStaticColliders();
    const shipped = circleAt(other.pos);
    setActiveWorldContent(editedWorld({ ...moves }));
    invalidateStaticColliders();
    expect(gatherNodesInActiveWorld().some((n) => n.id === ore.id)).toBe(false);
    const grown = circleAt(other.pos);
    const gone = circleAt(ore.pos);
    expect(shipped && grown && grown.type === 'circle' && shipped.type === 'circle').toBe(true);
    if (grown?.type === 'circle' && shipped?.type === 'circle') expect(grown.r).toBe(shipped.r * 2);
    expect(gone).toBeUndefined();
  });
});

describe('object edits: entities keep their ids', () => {
  const ids = (sim: Sim) =>
    [...sim.entities.values()]
      .map((e) => [e.id, e.templateId] as const)
      .sort((a, b) => a[0] - b[0]);

  it('a deleted dummy never spawns, a turned one faces its turn, and every other id stays', () => {
    const healing = HEALING_TRAINING_GROUND_SPAWNS[1];
    const world = editedWorld({
      [objectMoveKey('practiceDummy', HUB_TRAINING_DUMMY_ID)]: { x: 0, z: 0, removed: true },
      [objectMoveKey('practiceDummy', healing.mobId)]: {
        x: healing.pos.x,
        z: healing.pos.z,
        rotY: 1.25,
      },
    });
    const shipped = new Sim({ seed: 5, playerClass: 'priest', world: { ...BUILTIN_WORLD } });
    const edited = new Sim({ seed: 5, playerClass: 'priest', world });
    const shippedIds = ids(shipped);
    const gone = shippedIds.find(([, t]) => t === HUB_TRAINING_DUMMY_ID);
    expect(gone).toBeDefined();
    expect(ids(edited)).toEqual(shippedIds.filter((row) => row !== gone));
    expect(edited.rng.next()).toBe(shipped.rng.next());
    const turned = [...edited.entities.values()].find((e) => e.templateId === healing.mobId);
    expect(turned?.facing).toBe(1.25);
  });

  it('a deleted hub healing dummy or healing-ground dummy never spawns; every other id stays', () => {
    const ground = HEALING_TRAINING_GROUND_SPAWNS[2];
    const world = editedWorld({
      [objectMoveKey('practiceDummy', HUB_HEALING_DUMMY_ID)]: { x: 0, z: 0, removed: true },
      [objectMoveKey('practiceDummy', ground.mobId)]: { ...ground.pos, removed: true },
    });
    const shipped = new Sim({ seed: 7, playerClass: 'priest', world: { ...BUILTIN_WORLD } });
    const edited = new Sim({ seed: 7, playerClass: 'priest', world });
    const shippedIds = ids(shipped);
    const gone = shippedIds.filter(([, t]) => t === HUB_HEALING_DUMMY_ID || t === ground.mobId);
    expect(gone).toHaveLength(2);
    expect(ids(edited)).toEqual(shippedIds.filter((row) => !gone.includes(row)));
  });

  it('a deleted door spawns no entity, keeps every later id, and drops its walls and ring', () => {
    const crypt = DUNGEON_LIST.find((d) => d.id === 'hollow_crypt');
    if (!crypt) throw new Error('no hollow crypt');
    const world = editedWorld({
      [objectMoveKey('dungeonDoor', crypt.id)]: { ...crypt.doorPos, removed: true },
    });
    const shipped = new Sim({ seed: 3, playerClass: 'warrior', world: { ...BUILTIN_WORLD } });
    const edited = new Sim({ seed: 3, playerClass: 'warrior', world });
    const shippedIds = ids(shipped);
    const door = shippedIds.find(
      ([id, t]) => t === 'dungeon_door' && shipped.entities.get(id)?.dungeonId === crypt.id,
    );
    expect(door).toBeDefined();
    expect(ids(edited)).toEqual(shippedIds.filter((row) => row !== door));
    const near = (cs: Collider[]) =>
      cs.filter((c) => 'x' in c && Math.hypot(c.x - crypt.doorPos.x, c.z - crypt.doorPos.z) < 12)
        .length;
    const topY = () => 3;
    expect(near(dungeonDoorJambColliders(20061, topY))).toBeGreaterThan(0);
    setActiveWorldContent(world);
    expect(near(dungeonDoorJambColliders(20061, topY))).toBe(0);
    const inside = { x: crypt.doorPos.x + 1, z: crypt.doorPos.z };
    expect(projectOutsideDungeonDoors(inside.x, inside.z, world.objectMoves)).toEqual(inside);
    // No map pin for the deleted door; the others keep theirs.
    const pins = overworldDungeonPortals(DUNGEON_LIST, -1e9, 1e9).map((p) => p.id);
    expect(pins).not.toContain(crypt.id);
    expect(pins.length).toBeGreaterThan(0);
  });
});

describe('object edits: the editor rule', () => {
  const healing = HEALING_TRAINING_GROUND_SPAWNS[0];
  const dummyKey = objectMoveKey('practiceDummy', healing.mobId);
  const bed = FARM_PATCHES[0].beds[0];
  const bedKey = objectMoveKey('farmBed', bed.id);

  it('keeps a deleted object pose for Restore, and drops the entry once all is home', () => {
    let moves = withObjectEdited(undefined, bedKey, { x: bed.x + 3, rotY: 0.5, scale: 1.5 });
    moves = withObjectEdited(moves, bedKey, { removed: true });
    expect(moves?.[bedKey]).toEqual({
      x: bed.x + 3,
      z: bed.z,
      rotY: 0.5,
      scale: 1.5,
      removed: true,
    });
    expect(removedObjects(moves).map((o) => o.key)).toEqual([bedKey]);
    moves = withObjectEdited(moves, bedKey, { removed: false });
    expect(moves?.[bedKey]).toEqual({ x: bed.x + 3, z: bed.z, rotY: 0.5, scale: 1.5 });
    moves = withObjectEdited(moves, bedKey, { x: bed.x, rotY: 0, scale: 1 });
    expect(moves).toBeUndefined();
  });

  it('measures a dummy turn from its built-in facing, and never resizes a dummy', () => {
    const object = movableObjectByKey(dummyKey);
    if (!object) throw new Error('no dummy');
    expect(object.builtinFacing).toBe(-Math.PI / 2);
    expect(withObjectEdited(undefined, dummyKey, { rotY: -Math.PI / 2 })).toBeUndefined();
    const turned = withObjectEdited(undefined, dummyKey, { rotY: 0.3, scale: 3 });
    expect(turned?.[dummyKey]).toEqual({ x: healing.pos.x, z: healing.pos.z, rotY: 0.3 });
    expect(objectPose(undefined, object).rotY).toBe(-Math.PI / 2);
  });

  it('keeps a turn to 0 on a dummy that faces west by default', () => {
    const turned = withObjectEdited(undefined, dummyKey, { rotY: 0 });
    expect(turned?.[dummyKey]).toEqual({ x: healing.pos.x, z: healing.pos.z, rotY: 0 });
    const object = movableObjectByKey(dummyKey);
    if (!object) throw new Error('no dummy');
    expect(objectPose(turned, object).rotY).toBe(0);
    const sim = new Sim({ seed: 5, playerClass: 'priest', world: editedWorld({ ...turned }) });
    const dummy = [...sim.entities.values()].find((e) => e.templateId === healing.mobId);
    expect(dummy?.facing).toBe(0);
  });

  it('never picks a deleted object', () => {
    const moves = withObjectEdited(undefined, bedKey, { removed: true });
    const project = (x: number, z: number) => ({ x: x - bed.x, y: z - bed.z });
    const only = (o: { key: string }) => o.key === bedKey;
    expect(nearestMovableObject(undefined, project, 0, 0, 5, only)?.key).toBe(bedKey);
    expect(nearestMovableObject(moves, project, 0, 0, 5, only)).toBeNull();
  });

  it('delete, restore, turn and resize are one undo step each', () => {
    let moves: ObjectMoves | undefined;
    const undo: ObjectMoveUndoEntry[] = [];
    const live: string[] = [];
    const controller = new ObjectMoveController({
      getMoves: () => moves,
      setMoves: (next) => {
        moves = next;
      },
      moveLive: (key) => live.push(key),
      showSelection: () => {},
      pushUndo: (entry) => undo.push(entry),
      committed: () => {},
    });
    controller.select(bedKey);
    controller.turnSelected(0.2, false);
    controller.turnSelected(0.4, false);
    controller.turnSelected(0.6, true);
    expect(undo.map((u) => u.label)).toEqual(['turn-object']);
    expect(moves?.[bedKey]?.rotY).toBeCloseTo(0.6);
    controller.resizeSelected(2, true);
    expect(controller.deleteSelected()).toBe(true);
    expect(controller.selectedKey).toBeNull();
    expect(moves?.[bedKey]?.removed).toBe(true);
    // A deleted object cannot be selected; it comes back through Restore.
    controller.select(bedKey);
    expect(controller.selectedKey).toBeNull();
    controller.restore(bedKey);
    expect(moves?.[bedKey]).toEqual({ x: bed.x, z: bed.z, rotY: 0.6, scale: 2 });
    expect(undo.map((u) => u.label)).toEqual([
      'turn-object',
      'resize-object',
      'delete-object',
      'restore-object',
    ]);
    undo[3].undo();
    expect(moves?.[bedKey]?.removed).toBe(true);
    undo[2].undo();
    expect(moves?.[bedKey]?.removed).toBeUndefined();
  });
});

describe('object edits: the live preview', () => {
  const ground = () => 0;

  it('turns, resizes, hides and restores one bed instance found by its id', () => {
    const scene = new THREE.Scene();
    const beds = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 2);
    beds.name = 'farmPatches:bed:patch_a';
    beds.userData.farmBedIds = ['bed_b', 'bed_c'];
    beds.setMatrixAt(0, new THREE.Matrix4().makeTranslation(10, 0, 0));
    beds.setMatrixAt(1, new THREE.Matrix4().makeTranslation(20, 0, 0));
    scene.add(beds);
    const target = { kind: 'farmBed' as const, patchId: 'patch_a', bedId: 'bed_c' };
    const at = { x: 20, z: 0 };
    const pose = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const size = new THREE.Vector3();
    const read = () => {
      const m = new THREE.Matrix4();
      beds.getMatrixAt(1, m);
      m.decompose(pose, quat, size);
    };
    expect(
      shiftMovedObjectInScene(scene, target, at, { ...at, rotY: Math.PI / 2, scale: 2 }, ground),
    ).toBe(1);
    read();
    expect(pose.x).toBeCloseTo(20);
    expect(size.x).toBeCloseTo(2);
    expect(new THREE.Euler().setFromQuaternion(quat).y).toBeCloseTo(Math.PI / 2);
    const turned = { ...at, rotY: Math.PI / 2, scale: 2 };
    shiftMovedObjectInScene(scene, target, turned, { ...turned, removed: true }, ground);
    // Hidden: a zero-size matrix (read raw; decompose treats it as degenerate).
    const hidden = new THREE.Matrix4();
    beds.getMatrixAt(1, hidden);
    expect(hidden.elements.slice(0, 11).every((v) => v === 0)).toBe(true);
    shiftMovedObjectInScene(scene, target, { ...turned, removed: true }, turned, ground);
    read();
    expect(size.x).toBeCloseTo(2);
    expect(pose.x).toBeCloseTo(20);
    // The other bed never moved.
    const other = new THREE.Matrix4();
    beds.getMatrixAt(0, other);
    expect(other.elements[12]).toBeCloseTo(10);
  });

  it('hides and restores a door set piece', () => {
    const scene = new THREE.Scene();
    const piece = new THREE.Group();
    piece.name = 'hollowCryptEntrance';
    scene.add(piece);
    const target = { kind: 'dungeonDoor' as const, dungeonId: 'hollow_crypt' };
    const at = { x: 0, z: 0 };
    shiftMovedObjectInScene(scene, target, at, { ...at, removed: true }, ground);
    expect(piece.scale.x).toBe(0);
    shiftMovedObjectInScene(scene, target, { ...at, removed: true }, at, ground);
    expect(piece.scale.x).toBe(1);
  });
});
