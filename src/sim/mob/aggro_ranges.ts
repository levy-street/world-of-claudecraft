// The two distances that decide how far a mob can reach a player who is just standing
// there. Split out of mob/locomotion.ts (which enforces them) into a DEPENDENCY-FREE leaf
// so the modules that have to clear those distances can import the same numbers instead of
// re-typing them: sim/dungeon_door_clearance.ts (the overworld door ring) and
// sim/rift/entry_clearance.ts (the generated-floor arrival clearance). rift_gen.ts is a
// leaf generator and locomotion.ts imports rift/runs.ts, so importing the constants from
// locomotion directly would close an import cycle and read them back as undefined.
//
// locomotion.ts re-exports MAX_AGGRO_RADIUS and MAX_WANDER_RADIUS, so existing consumers
// and their guard tests keep their current import path and still see one shared value.

/** Hard ceiling on a mob's effective aggro/detection radius, whatever its template
 * aggroRadius or level advantage: locomotion's idle scans clamp to this and detect
 * strictly (d < radius), so a mob at exactly this distance can never aggro. */
export const MAX_AGGRO_RADIUS = 20;

/** Idle wander picks a target in this ring around the mob's spawnPos, so an out-of-combat
 * mob is never further than MAX_WANDER_RADIUS from where it spawned. */
export const MIN_WANDER_RADIUS = 2;
export const MAX_WANDER_RADIUS = 9;
