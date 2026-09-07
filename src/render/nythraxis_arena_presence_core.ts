// Is the Nythraxis crypt the room the camera is standing in? The two
// aura-driven painters (the Bound cage and the Soul Rend markers) have no row
// of their own to reconcile: they answer by walking the entity roster, and the
// mechanic facade fans out unconditionally from the renderer's per-frame sync,
// so without this gate both of them walked every entity in every zone, forever,
// for an encounter one dungeon can host.
//
// The signal is the player's own instance frame. Dungeon interiors live in
// their own x-bands far from the world origin (sim/data.ts), so
// `dungeonInstanceAt` answers which interior a point sits in from arithmetic
// plus one memoised lookup, with no allocation and no roster touch. It is the
// same interior key the encounter prewarm keys off
// (interior_encounter_prewarm.ts INTERIOR_ENCOUNTER_PREWARM.nythraxis), so the
// gate and the warm-up can never disagree about which room is live.
//
// FAIRNESS: this gates WORK, never a read. It only ever short-circuits a
// painter that has nothing live, and a painter holding live visuals keeps
// syncing wherever the player stands, so no hazard is hidden, delayed, or
// shrunk by it. A player outside the crypt's x-band cannot see the crypt.
//
// Node-only (RENDER_PURE_CORES): no three.js, no DOM, no randomness.

import { dungeonInstanceAt } from '../sim/dungeon_floor';

/** The DungeonDef.interior key of Nythraxis' raid room (sim/dungeon_floor.ts). */
export const NYTHRAXIS_INTERIOR_ID = 'nythraxis';

/** All the gate needs: where the local player is standing. */
export interface NythraxisArenaPresenceWorld {
  player: { pos: { x: number; z: number } };
}

/** True while the local player stands inside the Nythraxis crypt instance. */
export function nythraxisArenaPresent(world: NythraxisArenaPresenceWorld): boolean {
  const pos = world.player.pos;
  return dungeonInstanceAt(pos.x, pos.z)?.interior === NYTHRAXIS_INTERIOR_ID;
}
