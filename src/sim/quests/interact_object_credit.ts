// Per-object credit ledger for multi-count `interact` quest objectives.
//
// An interact objective is keyed on targetObjectItemId, and the interact path
// (interactObjectForQuests) deliberately does NOT consume the object the way the
// collect path does: the object stays lootable so a party can share it and so the
// Nythraxis ritual circle can re-summon a lost Bound Guardian. Without a ledger
// that means one object credits an objective without limit, and "ring three
// watchbells" is finishable by pressing interact three times on one bell.
//
// The ledger keys on the object's AUTHORED SPAWN POSITION rather than its entity
// id: ids are assigned by world-build order and shift whenever content is added,
// so an id ledger would go stale across a deploy and could refuse a bell the
// player never rang (a dead-ended quest). Authored positions are content data
// (GroundObjectDef.positions, spawned verbatim through Sim.groundPos), so the key
// is stable across restarts and deploys.
//
// That stability holds only for OVERWORLD placements. A dungeon-instance object
// spawns at `origin + offset` with a per-slot origin (instances/dungeons.ts), so
// its world position differs per instance copy and a position key on one would be
// per-slot, not per-object. Every interact target today is an overworld
// GROUND_OBJECTS placement, and tests/interact_object_credit.test.ts pins that:
// an interact objective on an instance-spawned object needs a different key.
//
// src/sim-pure: no imports beyond sibling sim types (no render/ui/game/net/DOM/
// Three, no Math.random/Date.now), so it runs unchanged in Node, the browser, and
// the headless RL env.

import type { QuestProgress, Vec3 } from '../types';

/** Decimals kept in a credit key. Authored spots are whole or half yards; one
 *  decimal absorbs float drift without merging two distinct nearby objects. */
const KEY_PRECISION = 1;

/** Hard bounds for a ledger read back out of untrusted JSONB. Real play cannot
 *  approach either: an entry is recorded 1:1 with an objective count that is
 *  capped at `required` (4 in the widest content today), and the whole entry
 *  leaves questLog on turn-in or abandon. These exist so a tampered or
 *  malformed row cannot stall the join path (which runs inside the server tick)
 *  or bloat the character row forever. */
const MAX_CREDITED_OBJECTS = 64;
const MAX_KEY_LENGTH = 64;

/** The exact grammar interactObjectCreditKey emits, derived from KEY_PRECISION
 *  so the two cannot drift. A key that does not match it was never produced by
 *  this module, so it can only be tamper or a bug elsewhere: drop it rather than
 *  keep it in the row forever. Dropping is fail-OPEN by design (the player
 *  regains that interact), which is the safe direction: a retained bad key would
 *  refuse an object the player never used and dead-end the quest. */
const KEY_SHAPE = new RegExp(
  `^\\d+@-?\\d+\\.\\d{${KEY_PRECISION}},-?\\d+\\.\\d{${KEY_PRECISION}}$`,
);

/**
 * Stable ledger key for "this objective, credited off the object at this spot".
 * The objective index is part of the key so two interact objectives in one quest
 * (or the same spot reused by another objective) never consume each other.
 */
export function interactObjectCreditKey(
  objectiveIndex: number,
  pos: Pick<Vec3, 'x' | 'z'>,
): string {
  return `${objectiveIndex}@${coord(pos.x)},${coord(pos.z)}`;
}

/** Round to KEY_PRECISION, then collapse a negative zero: both -0 and a tiny
 *  negative drift (-0.00000001) must key the same as the authored 0, or an
 *  axis-crossing spot would take two different ledger entries. */
function coord(v: number): string {
  const rounded = Number(v.toFixed(KEY_PRECISION));
  return (rounded === 0 ? 0 : rounded).toFixed(KEY_PRECISION);
}

/** Has this player already taken credit off this object for this objective? */
export function hasInteractObjectCredit(qp: QuestProgress, key: string): boolean {
  return qp.creditedObjects?.includes(key) === true;
}

/** Record the credit. The field stays absent until the first credit so saves
 *  written by a player who touched no interact objective are byte-identical. */
export function recordInteractObjectCredit(qp: QuestProgress, key: string): void {
  if (hasInteractObjectCredit(qp, key)) return;
  if (qp.creditedObjects) qp.creditedObjects.push(key);
  else qp.creditedObjects = [key];
}

/**
 * Wire form of a QuestProgress. The ledger is server-only bookkeeping the client
 * never reads (the server is authoritative for quest credit), and `qlog` rides
 * the heavy self-snapshot whose build + stringify is the dominant avoidable
 * broadcast cost, so it is stripped at the boundary rather than shipped to every
 * client. Returns the same object untouched when there is no ledger, so the
 * common case allocates nothing.
 */
export function questProgressForWire(qp: QuestProgress): QuestProgress {
  if (qp.creditedObjects === undefined) return qp;
  const { creditedObjects: _dropped, ...rest } = qp;
  return rest;
}

/**
 * Load-side normalization (normalize on load, never crash): a persisted ledger
 * is untrusted JSONB, so keep only distinct strings and drop the field entirely
 * when nothing survives. A save written before this field existed loads as
 * `undefined`, which grants the player their remaining interacts rather than
 * dead-ending a quest that is already part-way done.
 */
export function sanitizeCreditedObjects(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  for (const v of raw) {
    // Length first: it bounds the work the shape test does on a hostile string.
    if (typeof v !== 'string' || v.length > MAX_KEY_LENGTH || !KEY_SHAPE.test(v)) continue;
    seen.add(v);
    if (seen.size >= MAX_CREDITED_OBJECTS) break;
  }
  return seen.size > 0 ? [...seen] : undefined;
}
