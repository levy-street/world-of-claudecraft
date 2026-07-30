// Interior half of "never aggro on entry", for rifts. The overworld half (the clear
// ring around a dungeon's outside door) lives in sim/dungeon_door_clearance.ts; authored
// dungeons get the interior half from hand-placed spawn data, pinned by
// tests/dungeon_entry_clearance.test.ts. Rift floors are GENERATED, so the interior half
// has to be a property of the generator instead of a coordinate someone eyeballed.
//
// Pure and deterministic (no rng, no clock): callers derive a floor for the planned
// spawn band from the arrival point, so no draw is added or reordered.

// From the dependency-free leaf, not mob/locomotion (which enforces them): locomotion
// imports rift/runs.ts, so importing it from this generator-side module would close a
// cycle and read the constants back as undefined. Same values either way.
import { MAX_AGGRO_RADIUS, MAX_WANDER_RADIUS } from '../mob/aggro_ranges';

// A player standing on the arrival point must never be pulled by a mob they have not
// walked up to. Two terms, both imported rather than re-typed so retuning either one
// moves this clearance (and its guard test) in lockstep:
//   MAX_AGGRO_RADIUS  the hard ceiling on effective detection, whatever the mob's
//                     template aggroRadius or level advantage. Rift trash is level 22 to
//                     23 against a level 20 player cap, and aggro is a pure radius check
//                     (NOT line-of-sight gated), so walls and doors do not help: the
//                     effective radius really does reach the ceiling.
//   MAX_WANDER_RADIUS an idle mob drifts this far off its spawn point, so clearing only
//                     the aggro radius would hold at the instant of arrival and then
//                     decay as the front pack wandered toward the entry.
export const RIFT_ENTRY_CLEAR_RADIUS = MAX_AGGRO_RADIUS + MAX_WANDER_RADIUS;

/**
 * The shallowest instance-local z a spawn may occupy on a floor whose arrival point is
 * at `entryZ`. Deliberately a Z-AXIS floor rather than a radial ring: the generator runs
 * every spawn through a clearance march (rift_gen.ts toClear) that slides x toward the
 * centre spine, which is the entry's own x, so a radial guarantee would not survive the
 * march. z is untouched by it, and any x offset only increases the true distance, so a z
 * floor is both preserved and conservative.
 */
export function riftMinSpawnZ(entryZ: number): number {
  return entryZ + RIFT_ENTRY_CLEAR_RADIUS;
}

/** Whether a spawn at (x, z) is far enough from `entry` that it can never pull a player
 * standing on the arrival point, at any level difference and anywhere in its wander ring. */
export function isClearOfRiftEntry(entry: { x: number; z: number }, x: number, z: number): boolean {
  return Math.hypot(x - entry.x, z - entry.z) >= RIFT_ENTRY_CLEAR_RADIUS;
}
