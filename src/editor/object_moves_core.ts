// The built-in GAMEPLAY objects a Studio map can move (sim/moved_objects.ts):
// the farming garden beds, the Eastbrook practice dummies, the gather nodes
// and the overworld dungeon doors. Pure and DOM-free: the roster, the edit
// rule that writes a move into the document's record, and the pick that
// finds the object nearest a screen point. object_move_controller.ts is the
// thin consumer app.ts composes.
//
// An edit is per map: a position, a turn and a size (where the kind allows,
// OBJECT_EDIT_CAPS) or a deletion. The ids are persisted save keys and spawn
// slots, so the roster names each object by `<kind>:<id>` and never reorders
// or re-keys anything.

import { FARM_PATCHES } from '../sim/content/farm_patches';
import { HEALING_TRAINING_GROUND_SPAWNS } from '../sim/content/healing_training';
import {
  HUB_HEALING_DUMMY_ID,
  HUB_HEALING_DUMMY_POS,
  HUB_TRAINING_DUMMY_ID,
  HUB_TRAINING_DUMMY_POS,
} from '../sim/content/practice_dummies';
import { DUNGEON_LIST, GATHER_NODES } from '../sim/data';
import {
  freezeObjectMoves,
  type MovableObjectKind,
  OBJECT_EDIT_CAPS,
  type ObjectMove,
  type ObjectMoves,
  objectMoveKey,
  wrapObjectAngle,
} from '../sim/moved_objects';

export interface MovableObject {
  readonly key: string;
  readonly kind: MovableObjectKind;
  readonly id: string;
  /** Where the built-in world stands it (the reset target). */
  readonly builtin: ObjectMove;
  /** The facing the built-in world gives it (radians; 0 unless a dummy row
   *  faces elsewhere), what a cleared turn returns to. */
  readonly builtinFacing: number;
  /** The farm patch a bed belongs to, and its index in the patch (the render
   *  preview addresses the bed's instance by it). */
  readonly patchId?: string;
  readonly bedIndex?: number;
}

function roster(): MovableObject[] {
  const out: MovableObject[] = [];
  for (const patch of FARM_PATCHES) {
    patch.beds.forEach((bed, bedIndex) => {
      out.push({
        key: objectMoveKey('farmBed', bed.id),
        kind: 'farmBed',
        id: bed.id,
        builtin: { x: bed.x, z: bed.z },
        builtinFacing: 0,
        patchId: patch.id,
        bedIndex,
      });
    });
  }
  // The facings the spawners give each dummy (sim/hub_practice.ts,
  // sim/healing_training.ts).
  const dummies: { id: string; pos: ObjectMove; facing: number }[] = [
    { id: HUB_TRAINING_DUMMY_ID, pos: HUB_TRAINING_DUMMY_POS, facing: 0 },
    { id: HUB_HEALING_DUMMY_ID, pos: HUB_HEALING_DUMMY_POS, facing: 0 },
    ...HEALING_TRAINING_GROUND_SPAWNS.map((row) => ({
      id: row.mobId,
      pos: row.pos,
      facing: -Math.PI / 2,
    })),
  ];
  for (const dummy of dummies) {
    out.push({
      key: objectMoveKey('practiceDummy', dummy.id),
      kind: 'practiceDummy',
      id: dummy.id,
      builtin: { x: dummy.pos.x, z: dummy.pos.z },
      builtinFacing: dummy.facing,
    });
  }
  for (const node of GATHER_NODES) {
    out.push({
      key: objectMoveKey('gatherNode', node.id),
      kind: 'gatherNode',
      id: node.id,
      builtin: { x: node.pos.x, z: node.pos.z },
      builtinFacing: 0,
    });
  }
  for (const dungeon of DUNGEON_LIST) {
    if (dungeon.overworldDoor === false) continue;
    out.push({
      key: objectMoveKey('dungeonDoor', dungeon.id),
      kind: 'dungeonDoor',
      id: dungeon.id,
      builtin: { x: dungeon.doorPos.x, z: dungeon.doorPos.z },
      builtinFacing: 0,
    });
  }
  return out;
}

/** Every movable built-in object, in a stable order (content order per kind). */
export const MOVABLE_OBJECTS: readonly MovableObject[] = Object.freeze(roster());

const BY_KEY: ReadonlyMap<string, MovableObject> = new Map(
  MOVABLE_OBJECTS.map((object) => [object.key, object]),
);

export function movableObjectByKey(key: string): MovableObject | undefined {
  return BY_KEY.get(key);
}

/** The practice-dummy key for a runtime mob's template id, or null. */
export function practiceDummyKeyForTemplate(templateId: string): string | null {
  const key = objectMoveKey('practiceDummy', templateId);
  return BY_KEY.has(key) ? key : null;
}

/** Where this map stands the object: its move, else the built-in spot. */
export function objectPosition(moves: ObjectMoves | undefined, object: MovableObject): ObjectMove {
  return moves?.[object.key] ?? object.builtin;
}

/** Whether the map moved the object at all. */
export function objectIsMoved(moves: ObjectMoves | undefined, key: string): boolean {
  return moves?.[key] !== undefined;
}

const SAME_SPOT_YD = 1e-6;
const SAME_TURN_RAD = 1e-6;
const SAME_SIZE = 1e-6;

/** The object's whole pose on this map: position, turn (its built-in facing
 *  when untouched), size (1 when untouched) and whether it was deleted. */
export interface ObjectPose {
  readonly x: number;
  readonly z: number;
  readonly rotY: number;
  readonly scale: number;
  readonly removed: boolean;
}

export function objectPose(moves: ObjectMoves | undefined, object: MovableObject): ObjectPose {
  const edit = moves?.[object.key];
  return {
    x: edit?.x ?? object.builtin.x,
    z: edit?.z ?? object.builtin.z,
    rotY: edit?.rotY ?? object.builtinFacing,
    scale: edit?.scale ?? 1,
    removed: edit?.removed === true,
  };
}

/** A change to one object's pose; absent fields keep their current value. */
export interface ObjectEditPatch {
  readonly x?: number;
  readonly z?: number;
  readonly rotY?: number;
  readonly scale?: number;
  readonly removed?: boolean;
}

/**
 * The document's record with one object's pose changed. Only what the kind
 * may change is kept (OBJECT_EDIT_CAPS). A pose back at the built-in spot,
 * facing and size, and not deleted, drops the entry (so Reset, or dragging it
 * home, leaves the record as if it was never touched), and an empty record is
 * undefined. A deletion keeps the pose it had, so a restore puts it back as it
 * was. Always a fresh frozen record, never an in-place write: the resolvers
 * memoize on the record's identity.
 */
export function withObjectEdited(
  moves: ObjectMoves | undefined,
  key: string,
  patch: ObjectEditPatch,
): ObjectMoves | undefined {
  const object = BY_KEY.get(key);
  if (!object) return moves;
  const caps = OBJECT_EDIT_CAPS[object.kind];
  const pose = objectPose(moves, object);
  const x = patch.x ?? pose.x;
  const z = patch.z ?? pose.z;
  const rotY = caps.rotate ? wrapObjectAngle(patch.rotY ?? pose.rotY) : object.builtinFacing;
  const scale = caps.scale ? (patch.scale ?? pose.scale) : 1;
  const removed = patch.removed ?? pose.removed;
  const home =
    Math.abs(x - object.builtin.x) <= SAME_SPOT_YD &&
    Math.abs(z - object.builtin.z) <= SAME_SPOT_YD;
  const facingHome = Math.abs(wrapObjectAngle(rotY - object.builtinFacing)) <= SAME_TURN_RAD;
  const sizeHome = Math.abs(scale - 1) <= SAME_SIZE;
  const next: Record<string, ObjectMove> = { ...(moves ?? {}) };
  if (home && facingHome && sizeHome && !removed) delete next[key];
  else {
    const entry: { x: number; z: number; rotY?: number; scale?: number; removed?: true } = {
      x,
      z,
    };
    if (!facingHome) entry.rotY = rotY;
    if (!sizeHome) entry.scale = scale;
    if (removed) entry.removed = true;
    next[key] = entry;
  }
  return freezeObjectMoves(next);
}

/**
 * The document's record with one object at `to` (its turn, size and
 * deletion state kept). A move back onto the built-in spot of an otherwise
 * untouched object drops the entry.
 */
export function withObjectMovedTo(
  moves: ObjectMoves | undefined,
  key: string,
  to: ObjectMove,
): ObjectMoves | undefined {
  return withObjectEdited(moves, key, { x: to.x, z: to.z });
}

/** The objects this map deleted, in roster order (the restore list). */
export function removedObjects(moves: ObjectMoves | undefined): MovableObject[] {
  if (!moves) return [];
  return MOVABLE_OBJECTS.filter((object) => moves[object.key]?.removed === true);
}

/** A screen-space projection of a world point, or null when it is behind the
 *  camera or off the far plane. */
export type ProjectToScreen = (x: number, z: number) => { x: number; y: number } | null;

/**
 * The movable object whose projected position lies nearest the screen point,
 * within `maxPx`. `include` filters the roster (the viewport offers only what
 * it actually draws). Ties keep roster order, so the answer is stable.
 */
export function nearestMovableObject(
  moves: ObjectMoves | undefined,
  project: ProjectToScreen,
  screenX: number,
  screenY: number,
  maxPx: number,
  include: (object: MovableObject) => boolean = () => true,
): MovableObject | null {
  let best: MovableObject | null = null;
  let bestPx = maxPx;
  for (const object of MOVABLE_OBJECTS) {
    if (!include(object)) continue;
    // A deleted object is not drawn, so it is never under the cursor.
    if (moves?.[object.key]?.removed) continue;
    const pos = objectPosition(moves, object);
    const screen = project(pos.x, pos.z);
    if (!screen) continue;
    const px = Math.hypot(screen.x - screenX, screen.y - screenY);
    if (px < bestPx) {
      bestPx = px;
      best = object;
    }
  }
  return best;
}
