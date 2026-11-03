// Test helper for the dungeon door level floor
// (src/sim/content/dungeon_entry_levels.ts, enforced by
// src/sim/instances/dungeon_level_gate.ts). A bare test join starts at level 1,
// below every gated door, so a test that walks a fixture character into a
// dungeon raises it first. Only the level field moves: stats, gear and talents
// stay exactly as the fixture built them, so a test keeps measuring what it
// measured before the floor existed.

import type { Sim } from '../../src/sim/sim';

/** The level cap: at or above every door floor, raid rooms included. */
export const DUNGEON_TEST_LEVEL = 20;

/** Raise each named player (default: every player now in the sim) to at least
 *  `level`. Never lowers a level a test already set. */
export function atDungeonLevel(
  sim: Sim,
  pids?: readonly number[],
  level = DUNGEON_TEST_LEVEL,
): void {
  const ids = pids ?? [...sim.players.keys()];
  for (const pid of ids) {
    const e = sim.entities.get(pid);
    if (e && e.kind === 'player' && e.level < level) e.level = level;
  }
}
