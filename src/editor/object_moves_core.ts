// The built-in GAMEPLAY objects a Studio map can move (sim/moved_objects.ts):
// the farming garden beds, the Eastbrook practice dummies, the gather nodes
// and the overworld dungeon doors. Pure and DOM-free: the roster, the edit
// rule that writes a move into the document's record, and the pick that
// finds the object nearest a screen point. object_move_controller.ts is the
// thin consumer app.ts composes.
//
// A move is per map and position only: the ids are persisted save keys and
// spawn slots, so the roster names each object by `<kind>:<id>` and never
// reorders or re-keys anything.

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
  type ObjectMove,
  type ObjectMoves,
  objectMoveKey,
} from '../sim/moved_objects';

export interface MovableObject {
  readonly key: string;
  readonly kind: MovableObjectKind;
  readonly id: string;
  /** Where the built-in world stands it (the reset target). */
  readonly builtin: ObjectMove;
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
        patchId: patch.id,
        bedIndex,
      });
    });
  }
  const dummies: { id: string; pos: ObjectMove }[] = [
    { id: HUB_TRAINING_DUMMY_ID, pos: HUB_TRAINING_DUMMY_POS },
    { id: HUB_HEALING_DUMMY_ID, pos: HUB_HEALING_DUMMY_POS },
    ...HEALING_TRAINING_GROUND_SPAWNS.map((row) => ({ id: row.mobId, pos: row.pos })),
  ];
  for (const dummy of dummies) {
    out.push({
      key: objectMoveKey('practiceDummy', dummy.id),
      kind: 'practiceDummy',
      id: dummy.id,
      builtin: { x: dummy.pos.x, z: dummy.pos.z },
    });
  }
  for (const node of GATHER_NODES) {
    out.push({
      key: objectMoveKey('gatherNode', node.id),
      kind: 'gatherNode',
      id: node.id,
      builtin: { x: node.pos.x, z: node.pos.z },
    });
  }
  for (const dungeon of DUNGEON_LIST) {
    if (dungeon.overworldDoor === false) continue;
    out.push({
      key: objectMoveKey('dungeonDoor', dungeon.id),
      kind: 'dungeonDoor',
      id: dungeon.id,
      builtin: { x: dungeon.doorPos.x, z: dungeon.doorPos.z },
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

/**
 * The document's record with one object at `to`. A move back onto the
 * built-in spot drops the entry (so Reset, or dragging it home, leaves the
 * record as if it was never touched), and an empty record is undefined. Always
 * a fresh frozen record, never an in-place write: the resolvers memoize on
 * the record's identity.
 */
export function withObjectMovedTo(
  moves: ObjectMoves | undefined,
  key: string,
  to: ObjectMove,
): ObjectMoves | undefined {
  const object = BY_KEY.get(key);
  if (!object) return moves;
  const next: Record<string, ObjectMove> = { ...(moves ?? {}) };
  const home =
    Math.abs(to.x - object.builtin.x) <= SAME_SPOT_YD &&
    Math.abs(to.z - object.builtin.z) <= SAME_SPOT_YD;
  if (home) delete next[key];
  else next[key] = { x: to.x, z: to.z };
  return freezeObjectMoves(next);
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
