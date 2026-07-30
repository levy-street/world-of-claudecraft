// Overworld half of "never aggro on entry": keep a clear ring around every
// dungeon's overworld door so a player walking up to (or zoning out of) a dungeon
// is never standing inside a camp mob's aggro radius. The interior half (the
// arrival point and interior packs) is handled by the dungeon entry/spawn data +
// the aggro-radius clamp; this covers the OUTSIDE door.
//
// Pure and deterministic (no rng, no clock): the camp spawner projects each rolled
// mob position out of any door's clear ring BEFORE resolving safe ground, so the
// draw order is untouched and only the resulting position changes.

import { DUNGEONS } from './data';
import { MAX_AGGRO_RADIUS } from './mob/locomotion';

// The clear radius around a door is exactly the aggro-radius clamp (imported, not a
// re-typed literal), so a mob spawned strictly outside this ring can never aggro a
// player standing on the door. Retuning the clamp in locomotion.ts moves this in
// lockstep, and the guard test pins the same imported constant.
export const DOOR_CLEAR_RADIUS = MAX_AGGRO_RADIUS;

// Every dungeon's overworld door, deduped (some share one entrance, e.g. the
// Nythraxis crypt + raid arena). Computed once at module load from the merged table.
export const DUNGEON_DOORS: ReadonlyArray<{ x: number; z: number }> = (() => {
  const seen = new Set<string>();
  const doors: { x: number; z: number }[] = [];
  for (const d of Object.values(DUNGEONS)) {
    const door = d.doorPos;
    if (!door) continue;
    const key = `${door.x},${door.z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    doors.push({ x: door.x, z: door.z });
  }
  return doors;
})();

// If (x,z) falls inside any door's clear ring, push it straight out to the ring's
// edge (along the door-to-point direction); a point exactly on a door is pushed
// along +x so the result is deterministic. Points already clear are returned as-is.
export function projectOutsideDungeonDoors(x: number, z: number): { x: number; z: number } {
  let px = x;
  let pz = z;
  for (const door of DUNGEON_DOORS) {
    const dx = px - door.x;
    const dz = pz - door.z;
    const dist = Math.hypot(dx, dz);
    if (dist >= DOOR_CLEAR_RADIUS) continue;
    if (dist < 1e-6) {
      px = door.x + DOOR_CLEAR_RADIUS;
      pz = door.z;
    } else {
      const s = DOOR_CLEAR_RADIUS / dist;
      px = door.x + dx * s;
      pz = door.z + dz * s;
    }
  }
  return { x: px, z: pz };
}
