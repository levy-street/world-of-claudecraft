import { WISP_MAZE_QUEST_ID } from './content/world_quest_wisp_maze';
import {
  WISP_MAZE_LAYOUT,
  WISP_MAZE_PROFILES,
  type WispMazeState,
  wispMazeResult,
  wispMazeWalkable,
} from './minigames/wisp_maze';

const MAX_TICK = Number.MAX_SAFE_INTEGER - 10000;
function integer(value: unknown, max = MAX_TICK): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}
function coordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 22;
}
/** One bounded private owner readout. Never used by character save restoration. */
export function decodeWispMazeState(
  value: unknown,
  questId: string,
): (WispMazeState & { paused?: boolean }) | undefined {
  if (questId !== WISP_MAZE_QUEST_ID || !value || typeof value !== 'object') return;
  const row = value as Partial<WispMazeState> & { paused?: unknown };
  if (
    !['countdown', 'active', 'won'].includes(row.phase ?? '') ||
    !['easy', 'normal', 'hard'].includes(row.difficulty ?? '') ||
    !['ready', 'collect', 'power', 'hit', 'reset', 'banish', 'won'].includes(row.feedback ?? '') ||
    !integer(row.tick) ||
    !integer(row.seed, 0xffffffff) ||
    !integer(row.lives, 3) ||
    row.lives < 1 ||
    !coordinate(row.playerX) ||
    !coordinate(row.playerZ) ||
    !wispMazeWalkable(row.playerX, row.playerZ) ||
    (row.paused !== undefined && typeof row.paused !== 'boolean') ||
    !Array.isArray(row.collected) ||
    row.collected.length > WISP_MAZE_LAYOUT.openCells.length ||
    !row.collected.every(
      (cell) => integer(cell, 120) && WISP_MAZE_LAYOUT.openCells.includes(cell),
    ) ||
    new Set(row.collected).size !== row.collected.length ||
    !Array.isArray(row.enemies) ||
    row.enemies.length > 4
  )
    return;
  for (const field of [
    'powerUntilTick',
    'graceUntilTick',
    'hits',
    'resets',
    'banishedCount',
    'feedbackSerial',
  ] as const)
    if (!integer(row[field])) return;
  const enemies: WispMazeState['enemies'] = [];
  const profile = WISP_MAZE_PROFILES[row.difficulty as keyof typeof WISP_MAZE_PROFILES];
  if (row.enemies.length !== profile.enemyCount) return;
  for (const enemy of row.enemies) {
    if (
      !enemy ||
      typeof enemy !== 'object' ||
      !integer(enemy.id, profile.enemyCount - 1) ||
      !['chaser', 'ambusher', 'patroller', 'wanderer'].includes(enemy.kind) ||
      !WISP_MAZE_LAYOUT.openCells.includes(enemy.cell) ||
      !WISP_MAZE_LAYOUT.openCells.includes(enemy.targetCell) ||
      !coordinate(enemy.x) ||
      !coordinate(enemy.z) ||
      !wispMazeWalkable(enemy.x, enemy.z, 0.1) ||
      !integer(enemy.banishedUntilTick) ||
      !integer(enemy.shieldUntilTick)
    )
      return;
    enemies.push({
      id: enemy.id,
      kind: enemy.kind,
      cell: enemy.cell,
      targetCell: enemy.targetCell,
      x: enemy.x,
      z: enemy.z,
      banishedUntilTick: enemy.banishedUntilTick,
      shieldUntilTick: enemy.shieldUntilTick,
    });
  }
  if (new Set(enemies.map((enemy) => enemy.id)).size !== enemies.length) return;
  const result: WispMazeState & { paused?: boolean } = {
    phase: row.phase as WispMazeState['phase'],
    difficulty: row.difficulty as keyof typeof WISP_MAZE_PROFILES,
    tick: row.tick,
    seed: row.seed,
    lives: row.lives,
    playerX: row.playerX,
    playerZ: row.playerZ,
    collected: [...row.collected].sort((a, b) => a - b),
    enemies,
    powerUntilTick: row.powerUntilTick!,
    graceUntilTick: row.graceUntilTick!,
    hits: row.hits!,
    resets: row.resets!,
    banishedCount: row.banishedCount!,
    feedbackSerial: row.feedbackSerial!,
    feedback: row.feedback as WispMazeState['feedback'],
    ...(row.paused === undefined ? {} : { paused: row.paused as boolean }),
  };
  if (result.phase === 'won') {
    if (result.collected.length !== WISP_MAZE_LAYOUT.openCells.length) return;
    result.result = wispMazeResult(result);
  }
  return result;
}
