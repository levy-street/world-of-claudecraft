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
// its spawn slot, a door keeps its dungeon. Only x/z change, per map.
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
    if (!parseObjectMoveKey(key) || !value || typeof value !== 'object') continue;
    const { x, z } = value as { x?: unknown; z?: unknown };
    if (typeof x !== 'number' || typeof z !== 'number') continue;
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    if (Math.abs(x) > bound || Math.abs(z) > bound) continue;
    out[key] = Object.freeze({ x, z });
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
  for (const key of keys) out[key] = Object.freeze({ x: moves[key].x, z: moves[key].z });
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
  return memoized(FARM_MEMO, moves, patches, () =>
    Object.freeze(
      patches.map((patch) => {
        if (!patch.beds.some((bed) => moves[objectMoveKey('farmBed', bed.id)])) return patch;
        const beds = Object.freeze(
          patch.beds.map((bed) => {
            const move = moves[objectMoveKey('farmBed', bed.id)];
            return move ? Object.freeze({ id: bed.id, x: move.x, z: move.z }) : bed;
          }),
        );
        const x = beds.reduce((sum, bed) => sum + bed.x, 0) / beds.length;
        const z = beds.reduce((sum, bed) => sum + bed.z, 0) / beds.length;
        return Object.freeze({ ...patch, x, z, beds });
      }),
    ),
  );
}

/** A bed's row in this world (the plant/harvest range check): the built-in
 *  row, or a frozen copy at its moved position. Undefined stays undefined. */
export function farmBedFor(
  moves: ObjectMoves | undefined,
  bed: FarmBedDef | undefined,
): FarmBedDef | undefined {
  const move = bed && moves?.[objectMoveKey('farmBed', bed.id)];
  return move && bed ? Object.freeze({ id: bed.id, x: move.x, z: move.z }) : bed;
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
  return memoized(
    GATHER_MEMO,
    moves,
    nodes,
    () =>
      Object.freeze(
        nodes.map((node) => {
          const move = moves[objectMoveKey('gatherNode', node.id)];
          return move
            ? Object.freeze({ ...node, pos: Object.freeze({ x: move.x, z: move.z }) })
            : node;
        }),
      ) as GatherNodeDef[],
  );
}

/** An overworld dungeon door's position in this world. */
export function dungeonDoorPos(
  moves: ObjectMoves | undefined,
  dungeon: Pick<DungeonDef, 'id' | 'doorPos'>,
): { readonly x: number; readonly z: number } {
  return moves?.[objectMoveKey('dungeonDoor', dungeon.id)] ?? dungeon.doorPos;
}
