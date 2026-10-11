/** Original fixed courtyard. Every corridor belongs to a loop; no procedural generation. */
export const WISP_MAZE_GRID = [
  '###########',
  '#.........#',
  '#.#.#.#.#.#',
  '#.........#',
  '#.###.###.#',
  '#.........#',
  '#.#.#.#.#.#',
  '#.........#',
  '#.###.###.#',
  '#.........#',
  '###########',
] as const;

export const WISP_MAZE_PITCH = 4;
export const WISP_MAZE_SPAWN_CELL = 104;
export const WISP_MAZE_POWER_CELLS = [12, 20, 100, 108] as const;
// Five posts: the fifth (cell 38, the open lane north of the centre) only fills
// on the hard profile, well away from the player's start cell at 104.
export const WISP_MAZE_ENEMY_SPAWNS = [16, 34, 42, 60, 38] as const;

// Normal and hard are the two profiles the keeper offers; easy stays for the
// developer selector. Hard is normal plus two shadows, faster and with a shorter
// radiant surge, and pays a bonus purse (sim/world_quest_bonus.ts).
export const WISP_MAZE_PROFILES = {
  easy: { enemyCount: 2, enemySpeed: 4.2, enemyMaxSpeed: 5.6, powerSeconds: 8 },
  normal: { enemyCount: 3, enemySpeed: 4.6, enemyMaxSpeed: 6, powerSeconds: 7 },
  hard: { enemyCount: 5, enemySpeed: 5, enemyMaxSpeed: 6.4, powerSeconds: 6 },
} as const;

export const WISP_MAZE_PRESSURE = {
  startSeconds: 15,
  maxSeconds: 90,
  contactRadius: 1.65,
  frightenedSpeedMultiplier: 0.75,
} as const;
