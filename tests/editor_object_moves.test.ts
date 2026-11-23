// The Studio half of moving built-in gameplay objects: the roster and record
// edit (src/editor/object_moves_core.ts), the Select-mode controller's undo
// contract (src/editor/object_move_controller.ts), the document round trip
// and the playtest / publish projection (custom_map.ts), and the renderer's
// live preview shift (src/render/editor_api/moved_object_preview.ts).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { customMapToWorldContent, newCustomMap } from '../src/editor/custom_map';
import {
  ObjectMoveController,
  type ObjectMoveUndoEntry,
} from '../src/editor/object_move_controller';
import {
  MOVABLE_OBJECTS,
  movableObjectByKey,
  nearestMovableObject,
  objectPosition,
  practiceDummyKeyForTemplate,
  withObjectMovedTo,
} from '../src/editor/object_moves_core';
import { parseMap, serializeMap } from '../src/editor/persist';
import { shiftMovedObjectInScene } from '../src/render/editor_api/moved_object_preview';
import { FARM_PATCHES } from '../src/sim/content/farm_patches';
import { HUB_TRAINING_DUMMY_ID } from '../src/sim/content/practice_dummies';
import { DUNGEON_LIST, GATHER_NODES } from '../src/sim/data';
import { freezeObjectMoves, type ObjectMoves } from '../src/sim/moved_objects';

const BED_KEY = 'farmBed:bed_eastbrook_1';

describe('object_moves_core: the roster', () => {
  it('lists every movable object once, keyed by kind and stable id', () => {
    const keys = MOVABLE_OBJECTS.map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
    const beds = FARM_PATCHES.reduce((n, p) => n + p.beds.length, 0);
    const doors = DUNGEON_LIST.filter((d) => d.overworldDoor !== false).length;
    const count = (kind: string) => MOVABLE_OBJECTS.filter((o) => o.kind === kind).length;
    expect(count('farmBed')).toBe(beds);
    expect(count('gatherNode')).toBe(GATHER_NODES.length);
    expect(count('dungeonDoor')).toBe(doors);
    expect(count('practiceDummy')).toBe(7);
    const bed = movableObjectByKey(BED_KEY);
    expect(bed).toMatchObject({ kind: 'farmBed', id: 'bed_eastbrook_1', bedIndex: 0 });
    expect(practiceDummyKeyForTemplate(HUB_TRAINING_DUMMY_ID)).toBe(
      `practiceDummy:${HUB_TRAINING_DUMMY_ID}`,
    );
    expect(practiceDummyKeyForTemplate('wild_boar')).toBeNull();
  });
});

describe('object_moves_core: the record edit', () => {
  const bed = movableObjectByKey(BED_KEY);
  if (!bed) throw new Error('no bed');

  it('writes a fresh frozen record, and a move home drops the entry', () => {
    const moved = withObjectMovedTo(undefined, BED_KEY, { x: 1, z: 2 });
    expect(moved).toEqual({ [BED_KEY]: { x: 1, z: 2 } });
    expect(Object.isFrozen(moved)).toBe(true);
    expect(objectPosition(moved, bed)).toEqual({ x: 1, z: 2 });
    const again = withObjectMovedTo(moved, BED_KEY, { x: 3, z: 4 });
    expect(again).not.toBe(moved);
    expect(moved).toEqual({ [BED_KEY]: { x: 1, z: 2 } });
    expect(withObjectMovedTo(again, BED_KEY, bed.builtin)).toBeUndefined();
    expect(objectPosition(undefined, bed)).toEqual(bed.builtin);
  });

  it('every overworld door stands on its own spot (a door move moves one door)', () => {
    const doors = MOVABLE_OBJECTS.filter((o) => o.kind === 'dungeonDoor');
    const spots = new Set(doors.map((o) => `${o.builtin.x},${o.builtin.z}`));
    expect(spots.size).toBe(doors.length);
  });

  it('leaves other entries alone and ignores an unknown key', () => {
    const start = freezeObjectMoves({ 'dungeonDoor:hollow_crypt': { x: 9, z: 9 } });
    const next = withObjectMovedTo(start, BED_KEY, { x: 1, z: 1 });
    expect(next).toEqual({ 'dungeonDoor:hollow_crypt': { x: 9, z: 9 }, [BED_KEY]: { x: 1, z: 1 } });
    expect(withObjectMovedTo(start, 'farmBed:not_a_bed', { x: 0, z: 0 })).toBe(start);
  });

  it('picks the object nearest the screen point within the radius, filtered', () => {
    // A flat top-down projection: screen = world.
    const project = (x: number, z: number) => ({ x, y: z });
    const at = bed.builtin;
    expect(nearestMovableObject(undefined, project, at.x + 0.2, at.z, 2)?.key).toBe(BED_KEY);
    expect(
      nearestMovableObject(undefined, project, at.x, at.z, 2, (o) => o.kind !== 'farmBed'),
    ).toBeNull();
    // A moved bed is picked where it stands now, not where it shipped.
    const moves = withObjectMovedTo(undefined, BED_KEY, { x: at.x + 500, z: at.z });
    expect(nearestMovableObject(moves, project, at.x + 500, at.z, 2)?.key).toBe(BED_KEY);
    expect(nearestMovableObject(moves, project, at.x, at.z, 0.5)?.key).not.toBe(BED_KEY);
  });
});

describe('object_move_controller: one undo step per gesture', () => {
  function rig() {
    let moves: ObjectMoves | undefined;
    const undo: ObjectMoveUndoEntry[] = [];
    const live: [string, ObjectMoves | undefined, ObjectMoves | undefined][] = [];
    const shown: (string | null)[] = [];
    let commits = 0;
    const controller = new ObjectMoveController({
      getMoves: () => moves,
      setMoves: (next) => {
        moves = next;
      },
      moveLive: (key, before, after) => live.push([key, before, after]),
      showSelection: (key) => shown.push(key),
      pushUndo: (entry) => undo.push(entry),
      committed: () => {
        commits++;
      },
    });
    return {
      controller,
      undo,
      live,
      shown,
      moves: () => moves,
      commits: () => commits,
    };
  }

  it('a drag streams live moves and commits once; undo and redo round-trip', () => {
    const r = rig();
    expect(r.controller.beginDrag(BED_KEY)).toBe(true);
    expect(r.controller.selectedKey).toBe(BED_KEY);
    expect(r.shown).toEqual([BED_KEY]);
    r.controller.dragMove({ x: 10, z: 10 });
    r.controller.dragMove({ x: 12, z: 11 });
    expect(r.live).toHaveLength(2);
    expect(r.undo).toHaveLength(0);
    r.controller.endDrag();
    expect(r.undo).toHaveLength(1);
    expect(r.moves()).toEqual({ [BED_KEY]: { x: 12, z: 11 } });
    const after = r.moves();
    r.undo[0].undo();
    expect(r.moves()).toBeUndefined();
    expect(r.live.at(-1)).toEqual([BED_KEY, after, undefined]);
    r.undo[0].redo();
    expect(r.moves()).toBe(after);
  });

  it('a drag that moved nothing pushes no undo', () => {
    const r = rig();
    r.controller.beginDrag(BED_KEY);
    r.controller.endDrag();
    expect(r.undo).toHaveLength(0);
    expect(r.commits()).toBe(0);
  });

  it('a nudge volley folds into one undo step; Reset is its own', () => {
    const r = rig();
    const bed = movableObjectByKey(BED_KEY);
    if (!bed) throw new Error('no bed');
    expect(r.controller.nudge(1, 0)).toBe(false);
    r.controller.select(BED_KEY);
    r.controller.nudge(1, 0);
    r.controller.nudge(1, 0);
    r.controller.nudge(0, -2);
    r.controller.commitPending();
    expect(r.undo).toHaveLength(1);
    expect(r.moves()).toEqual({ [BED_KEY]: { x: bed.builtin.x + 2, z: bed.builtin.z - 2 } });
    r.controller.resetSelected();
    expect(r.undo).toHaveLength(2);
    expect(r.moves()).toBeUndefined();
  });

  it('selecting another object or nothing commits the open gesture', () => {
    const r = rig();
    r.controller.select(BED_KEY);
    r.controller.nudge(1, 1);
    r.controller.select(null);
    expect(r.undo).toHaveLength(1);
    expect(r.shown).toEqual([BED_KEY, null]);
    r.controller.select('farmBed:not_a_bed');
    expect(r.controller.selectedKey).toBeNull();
  });
});

describe('custom map: the moves ride the document, playtest and publish', () => {
  it('round-trip through the saved document and project frozen into the world', () => {
    const map = newCustomMap('Moves', 'moves', 1);
    map.objectMoves = withObjectMovedTo(undefined, BED_KEY, { x: 5, z: 6 });
    const reloaded = parseMap(JSON.parse(serializeMap(map)));
    expect(reloaded?.objectMoves).toEqual({ [BED_KEY]: { x: 5, z: 6 } });
    const world = customMapToWorldContent(map);
    expect(world.objectMoves).toEqual({ [BED_KEY]: { x: 5, z: 6 } });
    expect(Object.isFrozen(world.objectMoves)).toBe(true);
    const untouched = customMapToWorldContent(newCustomMap('Plain', 'plain', 1));
    expect('objectMoves' in untouched).toBe(false);
  });

  it('a linked map projects no moves (its objects stay put in the full world)', () => {
    const map = newCustomMap('Linked', 'linked', 1);
    map.objectMoves = withObjectMovedTo(undefined, BED_KEY, { x: 5, z: 6 });
    map.worldAnchor = { x: -200, z: 800 };
    expect(customMapToWorldContent(map).objectMoves).toBeUndefined();
  });
});

describe('moved_object_preview: the live shift', () => {
  const ground = (x: number, z: number) => x * 0.1 + z * 0.01;

  it('translates one bed instance and one gather-node instance by the move', () => {
    const scene = new THREE.Scene();
    const geo = new THREE.BoxGeometry();
    const mat = new THREE.MeshBasicMaterial();
    const beds = new THREE.InstancedMesh(geo, mat, 3);
    beds.name = 'farmPatches:bed:patch_eastbrook';
    const nodes = new THREE.InstancedMesh(geo, mat, 2);
    nodes.userData.gatherNodeIds = ['a', 'b'];
    for (let i = 0; i < 3; i++) {
      beds.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i, ground(i, 0), 0));
    }
    nodes.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, 0));
    nodes.setMatrixAt(1, new THREE.Matrix4().makeTranslation(50, ground(50, 0), 0));
    scene.add(beds, nodes);
    const from = { x: 1, z: 0 };
    const to = { x: 11, z: 5 };
    const moved = shiftMovedObjectInScene(
      scene,
      { kind: 'farmBed', patchId: 'patch_eastbrook', bedIndex: 1 },
      from,
      to,
      ground,
    );
    expect(moved).toBe(1);
    const m = new THREE.Matrix4();
    beds.getMatrixAt(1, m);
    expect(m.elements[12]).toBeCloseTo(11);
    expect(m.elements[13]).toBeCloseTo(ground(11, 5));
    expect(m.elements[14]).toBeCloseTo(5);
    beds.getMatrixAt(0, m);
    expect(m.elements[12]).toBeCloseTo(0);
    // Hidden batches (count 0, the reach hide) still shift by their capacity.
    nodes.count = 0;
    expect(
      shiftMovedObjectInScene(
        scene,
        { kind: 'gatherNode', id: 'b' },
        { x: 50, z: 0 },
        { x: 60, z: 0 },
        ground,
      ),
    ).toBe(1);
    nodes.getMatrixAt(1, m);
    expect(m.elements[12]).toBeCloseTo(60);
    expect(
      shiftMovedObjectInScene(scene, { kind: 'gatherNode', id: 'zzz' }, from, to, ground),
    ).toBe(0);
  });

  it('moves a patch compost bin instance', () => {
    const scene = new THREE.Scene();
    const bin = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1);
    bin.name = 'farmPatches:bin:patch_eastbrook';
    bin.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-27, 0, -84));
    scene.add(bin);
    const n = shiftMovedObjectInScene(
      scene,
      { kind: 'farmBin', patchId: 'patch_eastbrook' },
      { x: -27, z: -84 },
      { x: -27, z: -85 },
      () => 0,
    );
    expect(n).toBe(1);
    const m = new THREE.Matrix4();
    bin.getMatrixAt(0, m);
    expect(m.elements[14]).toBeCloseTo(-85);
  });

  it('moves a door set piece as a whole, and a plain door has none to move', () => {
    const scene = new THREE.Scene();
    const piece = new THREE.Group();
    piece.name = 'hollowCryptEntrance';
    piece.matrixAutoUpdate = false;
    scene.add(piece);
    const n = shiftMovedObjectInScene(
      scene,
      { kind: 'dungeonDoor', dungeonId: 'hollow_crypt' },
      { x: 0, z: 0 },
      { x: 4, z: -3 },
      () => 0,
    );
    expect(n).toBe(1);
    expect(piece.position.toArray()).toEqual([4, 0, -3]);
    expect(piece.matrixWorld.elements[12]).toBe(4);
    expect(
      shiftMovedObjectInScene(
        scene,
        { kind: 'dungeonDoor', dungeonId: 'sanctum_without_piece' },
        { x: 0, z: 0 },
        { x: 4, z: -3 },
        () => 0,
      ),
    ).toBe(0);
  });
});
