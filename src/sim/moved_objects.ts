// Gameplay objects a Studio map can MOVE: the farming garden beds, the
// Eastbrook practice dummies, the gather nodes and the overworld dungeon
// doors. Every one of them is a static content row the game logic reads by
// position (the plant/harvest range check, a dummy's spawn mark, a vein's
// collider and harvest reach, a door's trigger and exit drop), so a map moves
// one by naming it in WorldContent.objectMoves, and every reader resolves the
// position through this module with the built-in row as the fallback.
//
// IDS NEVER MOVE: a farm bed id is a persisted save key (farm_patches.ts), a
// gather node id keys the per-viewer respawn timers, a practice dummy keeps
// its spawn slot, a door keeps its dungeon. Per map, an entry may change the
// object's x/z, turn it (rotY: beds, dummies, nodes), resize it (scale: beds,
// nodes; OBJECT_EDIT_CAPS) or delete it (removed). A deleted dummy or door
// still consumes its entity id at spawn, so every later id stays the same.
//
// THE BUILT-IN WORLD CANNOT DRIFT: it carries no objectMoves, and every
// resolver hands back the very table object it was given when a world moves
// nothing of that kind, so the shipped path reads the same frozen rows by
// reference (tests/moved_objects.test.ts pins the identity).
//
// TWO SOURCES, ONE ANSWER ON EVERY HOST: the Sim's own systems (plant and
// harvest range, gathering, the door exit drop, the death graveyard) read the
// Sim's world through ctx.objectMoves, while the host-agnostic readers
// (colliders, door jambs, quest map areas, the render and HUD helpers) read
// the active world, the same split the Sim constructor's world INVARIANT
// draws for terrain and colliders. Every host that boots a moved world
// (editor playtest, published maps) activates that same world first, so the
// two agree; the server only ever runs the built-in world.
//
// Terrain stays put: the calm pads under these objects
// (terrain_calm_anchors.ts) are cached per seed from the built-in tables, the
// same as an authored NPC move today, so moving an object never reshapes the
// ground under it or where it stood.
//
// Pure leaf: no SimContext, no rng, no clock. The tables arrive as
// parameters so data.ts can call in without an import cycle.

import type { FarmBedDef, FarmPatchDef } from './content/farm_patches';
import type { DungeonDef, GatherNodeDef } from './types';

export interface ObjectMove {
  readonly x: number;
  readonly z: number;
  /** Yaw in radians; absent = the object's built-in facing. */
  readonly rotY?: number;
  /** Uniform size multiplier; absent = 1. */
  readonly scale?: number;
  /** The map deleted the object: no entity, collider, drawing or use. */
  readonly removed?: true;
}

/** Moved objects keyed `<kind>:<id>` (objectMoveKey). Only moved entries are
 *  present; an absent key means the built-in position. */
export type ObjectMoves = Readonly<Record<string, ObjectMove>>;

export type MovableObjectKind = 'farmBed' | 'practiceDummy' | 'gatherNode' | 'dungeonDoor';

export const MOVABLE_OBJECT_KINDS: readonly MovableObjectKind[] = [
  'farmBed',
  'practiceDummy',
  'gatherNode',
  'dungeonDoor',
];

/** A document carries at most this many moves (every movable object in the
 *  built-in world is a few hundred; the cap only bounds a hostile document). */
export const MAX_OBJECT_MOVES = 1024;

/** The size range an edited object may take. */
export const MIN_OBJECT_SCALE = 0.25;
export const MAX_OBJECT_SCALE = 4;

/** What each kind may change besides its position (every kind can be moved
 *  and deleted). A door's arch, jambs, set piece and exit drop are built on
 *  world axes, and a mob's size is its template's, so those stay fixed. */
export const OBJECT_EDIT_CAPS: Readonly<
  Record<MovableObjectKind, { readonly rotate: boolean; readonly scale: boolean }>
> = {
  farmBed: { rotate: true, scale: true },
  practiceDummy: { rotate: true, scale: false },
  gatherNode: { rotate: true, scale: true },
  dungeonDoor: { rotate: false, scale: false },
};

/** An angle folded into (-PI, PI]. */
export function wrapObjectAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let r = a % twoPi;
  if (r <= -Math.PI) r += twoPi;
  else if (r > Math.PI) r -= twoPi;
  return r;
}

/** One frozen entry with only the fields its kind may carry. A size of 1
 *  and removed: false are every object's defaults and are dropped. A turn is
 *  kept whenever present, even 0: some objects face elsewhere by default (the
 *  healing-ground dummies face west), so 0 can be a real turn. */
function freezeMove(kind: MovableObjectKind, m: ObjectMove): ObjectMove {
  const caps = OBJECT_EDIT_CAPS[kind];
  const out: { x: number; z: number; rotY?: number; scale?: number; removed?: true } = {
    x: m.x,
    z: m.z,
  };
  if (caps.rotate && typeof m.rotY === 'number' && Number.isFinite(m.rotY)) {
    out.rotY = wrapObjectAngle(m.rotY);
  }
  if (caps.scale && typeof m.scale === 'number' && Number.isFinite(m.scale)) {
    const scale = Math.min(MAX_OBJECT_SCALE, Math.max(MIN_OBJECT_SCALE, m.scale));
    if (scale !== 1) out.scale = scale;
  }
  if (m.removed === true) out.removed = true;
  return Object.freeze(out);
}

/** Whether the map deleted this object. */
export function objectRemoved(
  moves: ObjectMoves | undefined,
  kind: MovableObjectKind,
  id: string,
): boolean {
  return moves?.[`${kind}:${id}`]?.removed === true;
}

const KEY_PATTERN = /^(farmBed|practiceDummy|gatherNode|dungeonDoor):([a-z0-9_]{1,64})$/;

export function objectMoveKey(kind: MovableObjectKind, id: string): string {
  return `${kind}:${id}`;
}

export function parseObjectMoveKey(key: string): { kind: MovableObjectKind; id: string } | null {
  const match = KEY_PATTERN.exec(key);
  return match ? { kind: match[1] as MovableObjectKind, id: match[2] } : null;
}

/**
 * The shared sanitizer arm (map_doc.ts): well-formed keys with finite
 * coordinates inside `bound`, at most MAX_OBJECT_MOVES, frozen. An unknown id
 * of a known kind is kept (it is inert: no resolver looks it up) so a document
 * never loses a move to a content rename it cannot know about. Undefined when
 * nothing survives.
 */
export function sanitizeObjectMoves(raw: unknown, bound: number): ObjectMoves | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, ObjectMove> = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= MAX_OBJECT_MOVES) break;
    const parsed = parseObjectMoveKey(key);
    if (!parsed || !value || typeof value !== 'object') continue;
    const { x, z, rotY, scale, removed } = value as Record<string, unknown>;
    if (typeof x !== 'number' || typeof z !== 'number') continue;
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    if (Math.abs(x) > bound || Math.abs(z) > bound) continue;
    out[key] = freezeMove(parsed.kind, {
      x,
      z,
      rotY: typeof rotY === 'number' ? rotY : undefined,
      scale: typeof scale === 'number' ? scale : undefined,
      removed: removed === true ? true : undefined,
    });
    count++;
  }
  return count > 0 ? Object.freeze(out) : undefined;
}

/** A frozen copy, the form every resolver can cache on. Undefined for an
 *  empty record, so an untouched map stays byte-identical to one that never
 *  had the field. */
export function freezeObjectMoves(
  moves: Readonly<Record<string, ObjectMove>> | undefined,
): ObjectMoves | undefined {
  if (!moves) return undefined;
  const keys = Object.keys(moves);
  if (keys.length === 0) return undefined;
  if (Object.isFrozen(moves) && keys.every((key) => Object.isFrozen(moves[key]))) return moves;
  const out: Record<string, ObjectMove> = {};
  for (const key of keys) {
    const parsed = parseObjectMoveKey(key);
    out[key] = parsed
      ? freezeMove(parsed.kind, moves[key])
      : Object.freeze({ x: moves[key].x, z: moves[key].z });
  }
  return Object.freeze(out);
}

/** Whether the record moves anything of this kind (allocation-free). */
export function movesKind(moves: ObjectMoves | undefined, kind: MovableObjectKind): boolean {
  if (!moves) return false;
  const prefix = `${kind}:`;
  for (const key in moves) if (key.startsWith(prefix)) return true;
  return false;
}

const hasKind = movesKind;

// Records proven frozen through and through (outer object and every entry),
// the only ones a memo may key on: an unfrozen entry could change under it.
const DEEP_FROZEN = new WeakSet<ObjectMoves>();
function deepFrozen(moves: ObjectMoves): boolean {
  if (DEEP_FROZEN.has(moves)) return true;
  if (!Object.isFrozen(moves)) return false;
  for (const key in moves) if (!Object.isFrozen(moves[key])) return false;
  DEEP_FROZEN.add(moves);
  return true;
}

// Derived-output memos keyed on the (frozen) moves record and the (frozen or
// shared) table it was resolved against, so a world asks once per table, and
// two worlds, or one world's two tables, never answer for each other. A record
// that is not frozen through and through is resolved uncached, so a caller
// that mutated one in place could never read a stale answer, and every output
// is frozen, so no reader can poison the answer the next one gets.
type Memo<T> = WeakMap<ObjectMoves, WeakMap<object, T>>;

function memoized<T>(memo: Memo<T>, moves: ObjectMoves, table: object, build: () => T): T {
  if (!deepFrozen(moves)) return build();
  let byTable = memo.get(moves);
  if (!byTable) {
    byTable = new WeakMap();
    memo.set(moves, byTable);
  }
  const hit = byTable.get(table);
  if (hit !== undefined) return hit;
  const built = build();
  byTable.set(table, built);
  return built;
}

const FARM_MEMO: Memo<readonly FarmPatchDef[]> = new WeakMap();
const GATHER_MEMO: Memo<GatherNodeDef[]> = new WeakMap();

/**
 * The garden-bed geography with this world's moved beds. A patch with a moved
 * bed re-centres its anchor (the map pin) on its beds, and the compost bin,
 * derived from the beds (render/farm_patches_core.ts), follows them; every
 * other patch is the shared built-in row. Deep-frozen, like the table.
 */
export function farmPatchesFor(
  moves: ObjectMoves | undefined,
  patches: readonly FarmPatchDef[],
): readonly FarmPatchDef[] {
  if (!moves || !hasKind(moves, 'farmBed')) return patches;
  return memoized(FARM_MEMO, moves, patches, () => {
    const out: FarmPatchDef[] = [];
    for (const patch of patches) {
      if (!patch.beds.some((bed) => moves[objectMoveKey('farmBed', bed.id)])) {
        out.push(patch);
        continue;
      }
      const beds = Object.freeze(
        patch.beds
          .filter((bed) => moves[objectMoveKey('farmBed', bed.id)]?.removed !== true)
          .map((bed) => farmBedFor(moves, bed) as FarmBedDef),
      );
      // Every bed deleted: the patch (its pin, bin and quest area) goes too.
      if (beds.length === 0) continue;
      // Re-centre the anchor only when a bed moved or left; a turn or a
      // resize keeps the patch's authored pin exactly where it was.
      const shifted = patch.beds.some((bed) => {
        const move = moves[objectMoveKey('farmBed', bed.id)];
        return move !== undefined && (move.removed || move.x !== bed.x || move.z !== bed.z);
      });
      if (!shifted) {
        out.push(Object.freeze({ ...patch, beds }));
        continue;
      }
      const x = beds.reduce((sum, bed) => sum + bed.x, 0) / beds.length;
      const z = beds.reduce((sum, bed) => sum + bed.z, 0) / beds.length;
      out.push(Object.freeze({ ...patch, x, z, beds }));
    }
    return Object.freeze(out);
  });
}

/** A bed's row in this world (the plant/harvest range check): the built-in
 *  row, or a frozen copy at its moved position with its turn and size.
 *  Undefined for a deleted bed (so planting and harvesting it are refused),
 *  and undefined stays undefined. */
export function farmBedFor(
  moves: ObjectMoves | undefined,
  bed: FarmBedDef | undefined,
): FarmBedDef | undefined {
  const move = bed && moves?.[objectMoveKey('farmBed', bed.id)];
  if (!move || !bed) return bed;
  if (move.removed) return undefined;
  const row: { id: string; x: number; z: number; rotY?: number; scale?: number } = {
    id: bed.id,
    x: move.x,
    z: move.z,
  };
  if (move.rotY !== undefined) row.rotY = move.rotY;
  if (move.scale !== undefined) row.scale = move.scale;
  return Object.freeze(row);
}

/** A practice dummy's facing on this map, or `builtin` when untouched. */
export function practiceDummyFacing(
  moves: ObjectMoves | undefined,
  mobId: string,
  builtin: number,
): number {
  return moves?.[objectMoveKey('practiceDummy', mobId)]?.rotY ?? builtin;
}

/** A practice dummy's spawn mark (keyed by its mob template id). */
export function practiceDummyPos(
  moves: ObjectMoves | undefined,
  mobId: string,
  builtin: { readonly x: number; readonly z: number },
): { readonly x: number; readonly z: number } {
  return moves?.[objectMoveKey('practiceDummy', mobId)] ?? builtin;
}

/** The gather-node table with this world's moved nodes (same order, same
 *  rows except the moved ones, which are fresh copies at the new pos). */
export function gatherNodesFor(
  moves: ObjectMoves | undefined,
  nodes: GatherNodeDef[],
): GatherNodeDef[] {
  if (!moves || !hasKind(moves, 'gatherNode')) return nodes;
  return memoized(GATHER_MEMO, moves, nodes, () => {
    const out: GatherNodeDef[] = [];
    for (const node of nodes) {
      const move = moves[objectMoveKey('gatherNode', node.id)];
      if (!move) {
        out.push(node);
        continue;
      }
      // A deleted node leaves every table: no collider, drawing or harvest.
      if (move.removed) continue;
      const row: GatherNodeDef = { ...node, pos: Object.freeze({ x: move.x, z: move.z }) };
      if (move.rotY !== undefined) row.rotY = move.rotY;
      if (move.scale !== undefined) row.scale = move.scale;
      out.push(Object.freeze(row));
    }
    return Object.freeze(out) as GatherNodeDef[];
  });
}

/** An overworld dungeon door's position in this world. */
export function dungeonDoorPos(
  moves: ObjectMoves | undefined,
  dungeon: Pick<DungeonDef, 'id' | 'doorPos'>,
): { readonly x: number; readonly z: number } {
  return moves?.[objectMoveKey('dungeonDoor', dungeon.id)] ?? dungeon.doorPos;
}
