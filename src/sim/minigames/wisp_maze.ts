import {
  WISP_MAZE_ENEMY_SPAWNS,
  WISP_MAZE_GRID,
  WISP_MAZE_PITCH,
  WISP_MAZE_POWER_CELLS,
  WISP_MAZE_PRESSURE,
  WISP_MAZE_PROFILES,
  WISP_MAZE_SPAWN_CELL,
} from '../content/wisp_maze_layouts';
import { Rng } from '../rng';

export { WISP_MAZE_PROFILES } from '../content/wisp_maze_layouts';
export const WISP_MAZE_COUNTDOWN_TICKS = 60;
/** Wire safety bound, not a gameplay timeout. Leave room for every expiry timer. */
export const WISP_MAZE_MAX_TICKS = Number.MAX_SAFE_INTEGER - 1000;
export const WISP_MAZE_PLAYER_SPEED = 7;
export const WISP_MAZE_BANISH_TICKS = 100;
export const WISP_MAZE_GRACE_TICKS = 60;
const DT = 0.05;
const BODY_RADIUS = 0.5;
const PICKUP_RADIUS = 1.05;
export type WispMazeDifficulty = keyof typeof WISP_MAZE_PROFILES;
export type WispMazeEnemyKind = 'chaser' | 'ambusher' | 'patroller' | 'wanderer';
export interface WispMazeEnemy {
  id: number;
  kind: WispMazeEnemyKind;
  cell: number;
  targetCell: number;
  x: number;
  z: number;
  banishedUntilTick: number;
  shieldUntilTick: number;
}
export interface WispMazeResult {
  elapsed: number;
  collected: number;
  hits: number;
  resets: number;
  banished: number;
  score: number;
  rating: 'bronze' | 'silver' | 'gold';
}
export interface WispMazeState {
  phase: 'countdown' | 'active' | 'won';
  tick: number;
  difficulty: WispMazeDifficulty;
  playerX: number;
  playerZ: number;
  lives: number;
  collected: number[];
  powerUntilTick: number;
  graceUntilTick: number;
  enemies: WispMazeEnemy[];
  hits: number;
  resets: number;
  banishedCount: number;
  seed: number;
  feedbackSerial: number;
  feedback: 'ready' | 'collect' | 'power' | 'hit' | 'reset' | 'banish' | 'won';
  result?: WispMazeResult;
}

export interface WispMazeDefinition {
  grid: readonly string[];
  pitch: number;
  spawnCell: number;
  powerCells: readonly number[];
  enemySpawnCells: readonly number[];
}

/** Active sim time only: pausing freezes pressure; speed always stays below the player. */
export function wispMazeEnemySpeed(
  state: Pick<WispMazeState, 'tick' | 'difficulty' | 'powerUntilTick'>,
): number {
  const profile = WISP_MAZE_PROFILES[state.difficulty];
  const elapsed = Math.max(0, state.tick - WISP_MAZE_COUNTDOWN_TICKS) * DT;
  const pressure = Math.min(
    1,
    Math.max(
      0,
      (elapsed - WISP_MAZE_PRESSURE.startSeconds) /
        (WISP_MAZE_PRESSURE.maxSeconds - WISP_MAZE_PRESSURE.startSeconds),
    ),
  );
  const speed = profile.enemySpeed + (profile.enemyMaxSpeed - profile.enemySpeed) * pressure;
  return (
    speed * (state.powerUntilTick > state.tick ? WISP_MAZE_PRESSURE.frightenedSpeedMultiplier : 1)
  );
}

/** Builds an isolated ruleset from authored data, with no mutable gameplay state in the closure. */
export function createWispMazeKernel(definition: WispMazeDefinition) {
  const {
    grid: WISP_MAZE_GRID,
    pitch: WISP_MAZE_PITCH,
    spawnCell: WISP_MAZE_SPAWN_CELL,
    powerCells: WISP_MAZE_POWER_CELLS,
    enemySpawnCells: WISP_MAZE_ENEMY_SPAWNS,
  } = definition;
  const cols = WISP_MAZE_GRID[0]?.length ?? 0;
  const rows = WISP_MAZE_GRID.length;
  if (
    cols < 3 ||
    rows < 3 ||
    cols > 25 ||
    rows > 25 ||
    !Number.isFinite(WISP_MAZE_PITCH) ||
    WISP_MAZE_PITCH < 2 ||
    WISP_MAZE_GRID.some((row) => row.length !== cols || /[^#.]/.test(row))
  )
    throw new Error('Invalid wisp maze definition');
  const openCells = Array.from({ length: cols * rows }, (_, cell) => cell).filter(
    (cell) => WISP_MAZE_GRID[Math.floor(cell / cols)][cell % cols] !== '#',
  );
  const open = new Set(openCells);
  const neighbors = Array.from({ length: cols * rows }, (_, cell) =>
    open.has(cell)
      ? [cell - cols, cell + 1, cell + cols, cell - 1].filter(
          (next) =>
            open.has(next) &&
            Math.abs((next % cols) - (cell % cols)) +
              Math.abs(Math.floor(next / cols) - Math.floor(cell / cols)) ===
              1,
        )
      : [],
  );
  const WISP_MAZE_LAYOUT = {
    cols,
    rows,
    pitch: WISP_MAZE_PITCH,
    grid: WISP_MAZE_GRID,
    openCells,
    neighbors,
    spawnCell: WISP_MAZE_SPAWN_CELL,
    powerCells: WISP_MAZE_POWER_CELLS,
    enemySpawnCells: WISP_MAZE_ENEMY_SPAWNS,
  };

  function wispMazeCellCenter(cell: number): { x: number; z: number } {
    return {
      x: ((cell % cols) - (cols - 1) / 2) * WISP_MAZE_PITCH,
      z: (Math.floor(cell / cols) - (rows - 1) / 2) * WISP_MAZE_PITCH,
    };
  }
  function wispMazeCellAt(x: number, z: number): number {
    const col = Math.round(x / WISP_MAZE_PITCH + (cols - 1) / 2);
    const row = Math.round(z / WISP_MAZE_PITCH + (rows - 1) / 2);
    return col < 0 || col >= cols || row < 0 || row >= rows ? -1 : row * cols + col;
  }
  /** Circle versus neighboring solid tile boxes, including the sealed outer shell. */
  function wispMazeWalkable(x: number, z: number, radius = BODY_RADIUS): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius) || radius < 0)
      return false;
    const half = WISP_MAZE_PITCH / 2;
    if (Math.abs(x) + radius > cols * half || Math.abs(z) + radius > rows * half) return false;
    const cx = Math.round(x / WISP_MAZE_PITCH + (cols - 1) / 2);
    const cz = Math.round(z / WISP_MAZE_PITCH + (rows - 1) / 2);
    for (let row = Math.max(0, cz - 1); row <= Math.min(rows - 1, cz + 1); row++) {
      for (let col = Math.max(0, cx - 1); col <= Math.min(cols - 1, cx + 1); col++) {
        if (open.has(row * cols + col)) continue;
        const center = wispMazeCellCenter(row * cols + col);
        const dx = Math.max(0, Math.abs(x - center.x) - half);
        const dz = Math.max(0, Math.abs(z - center.z) - half);
        if (dx * dx + dz * dz < radius * radius - 1e-9 || (dx === 0 && dz === 0)) return false;
      }
    }
    return true;
  }

  /** Small swept steps prevent tunneling and permit sliding without cutting diagonal corners. */
  function moveWispMazePlayer(state: WispMazeState, input: { x: number; z: number }): void {
    let x = Number.isFinite(input.x) ? input.x : 0;
    let z = Number.isFinite(input.z) ? input.z : 0;
    const length = Math.hypot(x, z);
    if (length > 1) {
      x /= length;
      z /= length;
    }
    x *= WISP_MAZE_PLAYER_SPEED * DT;
    z *= WISP_MAZE_PLAYER_SPEED * DT;
    const steps = Math.max(1, Math.ceil(Math.hypot(x, z) / 0.15));
    for (let step = 0; step < steps; step++) {
      if (wispMazeWalkable(state.playerX + x / steps, state.playerZ)) state.playerX += x / steps;
      if (wispMazeWalkable(state.playerX, state.playerZ + z / steps)) state.playerZ += z / steps;
    }
  }

  /** One bounded graph traversal, at most the authored grid's cell count. */
  function wispMazeDistances(goal: number): number[] {
    const distances = Array<number>(cols * rows).fill(Infinity);
    if (!open.has(goal)) return distances;
    distances[goal] = 0;
    const queue = [goal];
    for (let index = 0; index < queue.length; index++) {
      for (const next of neighbors[queue[index]]) {
        if (distances[next] !== Infinity) continue;
        distances[next] = distances[queue[index]] + 1;
        queue.push(next);
      }
    }
    return distances;
  }

  function createWispMaze(seed: number, difficulty: WispMazeDifficulty = 'easy'): WispMazeState {
    const spawn = wispMazeCellCenter(WISP_MAZE_SPAWN_CELL);
    // The fifth shadow (hard only) is a second chaser: the profile's pressure comes
    // from pursuit, not from another wanderer.
    const kinds: WispMazeEnemyKind[] = ['chaser', 'ambusher', 'patroller', 'wanderer', 'chaser'];
    return {
      phase: 'countdown',
      tick: 0,
      difficulty,
      playerX: spawn.x,
      playerZ: spawn.z,
      lives: 3,
      collected: [],
      powerUntilTick: 0,
      graceUntilTick: 0,
      hits: 0,
      resets: 0,
      banishedCount: 0,
      seed: seed >>> 0,
      feedbackSerial: 0,
      feedback: 'ready',
      enemies: kinds.slice(0, WISP_MAZE_PROFILES[difficulty].enemyCount).map((kind, id) => {
        const cell = WISP_MAZE_ENEMY_SPAWNS[id];
        return {
          id,
          kind,
          cell,
          targetCell: cell,
          ...wispMazeCellCenter(cell),
          banishedUntilTick: 0,
          shieldUntilTick: 0,
        };
      }),
    };
  }

  function note(state: WispMazeState, feedback: WispMazeState['feedback']) {
    state.feedback = feedback;
    state.feedbackSerial++;
  }

  function wispMazeResult(state: WispMazeState): WispMazeResult {
    const elapsed = Math.max(0, state.tick - WISP_MAZE_COUNTDOWN_TICKS) * DT;
    const score = Math.max(
      0,
      state.collected.length * 10 + state.banishedCount * 15 - state.hits * 25,
    );
    return {
      elapsed,
      collected: state.collected.length,
      hits: state.hits,
      resets: state.resets,
      banished: state.banishedCount,
      score,
      rating: state.hits <= 1 ? 'gold' : state.hits <= 4 ? 'silver' : 'bronze',
    };
  }

  function resetEnemies(state: WispMazeState): void {
    for (const enemy of state.enemies) {
      const cell = WISP_MAZE_ENEMY_SPAWNS[enemy.id];
      Object.assign(enemy, wispMazeCellCenter(cell), {
        cell,
        targetCell: cell,
        banishedUntilTick: 0,
        shieldUntilTick: state.tick + WISP_MAZE_GRACE_TICKS,
      });
    }
  }

  function moveEnemy(
    state: WispMazeState,
    enemy: WispMazeEnemy,
    input: { x: number; z: number },
  ): void {
    if (enemy.banishedUntilTick > state.tick) return;
    if (enemy.banishedUntilTick > 0) {
      enemy.banishedUntilTick = 0;
      enemy.shieldUntilTick = state.tick + WISP_MAZE_GRACE_TICKS;
    }
    if (enemy.cell === enemy.targetCell) {
      let goal = wispMazeCellAt(state.playerX, state.playerZ);
      const fleeing = state.powerUntilTick > state.tick;
      if (!fleeing && enemy.kind === 'ambusher') {
        const dx = Math.abs(input.x) >= Math.abs(input.z) ? Math.sign(input.x) : 0;
        const dz = dx ? 0 : Math.sign(input.z);
        for (let i = 0; i < 2; i++) {
          const next = goal + dx + dz * cols;
          if (neighbors[goal]?.includes(next)) goal = next;
        }
      } else if (!fleeing && enemy.kind === 'patroller') {
        goal = WISP_MAZE_POWER_CELLS[Math.floor(state.tick / 160) % WISP_MAZE_POWER_CELLS.length];
      }
      const distances = wispMazeDistances(goal);
      const options = neighbors[enemy.cell];
      if (!fleeing && enemy.kind === 'wanderer') {
        enemy.targetCell =
          options[
            new Rng(state.seed ^ Math.imul(state.tick, 7919) ^ enemy.id).int(0, options.length - 1)
          ];
      } else {
        enemy.targetCell = options.reduce(
          (best, next) =>
            fleeing
              ? distances[next] > distances[best]
                ? next
                : best
              : distances[next] < distances[best]
                ? next
                : best,
          options[0],
        );
      }
    }
    const target = wispMazeCellCenter(enemy.targetCell);
    const dx = target.x - enemy.x,
      dz = target.z - enemy.z;
    const distance = Math.hypot(dx, dz);
    const step = wispMazeEnemySpeed(state) * DT;
    if (distance <= step) {
      enemy.x = target.x;
      enemy.z = target.z;
      enemy.cell = enemy.targetCell;
    } else {
      enemy.x += (dx / distance) * step;
      enemy.z += (dz / distance) * step;
    }
  }

  function tickWispMaze(state: WispMazeState, input: { x: number; z: number }): void {
    if (state.phase === 'won') return;
    state.tick++;
    if (state.phase === 'countdown') {
      if (state.tick < WISP_MAZE_COUNTDOWN_TICKS) return;
      state.phase = 'active';
      state.graceUntilTick = state.tick + WISP_MAZE_GRACE_TICKS;
    }
    moveWispMazePlayer(state, input);
    const cell = wispMazeCellAt(state.playerX, state.playerZ);
    if (open.has(cell) && !state.collected.includes(cell)) {
      const center = wispMazeCellCenter(cell);
      if (Math.hypot(state.playerX - center.x, state.playerZ - center.z) <= PICKUP_RADIUS) {
        state.collected.push(cell);
        state.collected.sort((a, b) => a - b);
        if ((WISP_MAZE_POWER_CELLS as readonly number[]).includes(cell)) {
          state.powerUntilTick =
            state.tick + WISP_MAZE_PROFILES[state.difficulty].powerSeconds * 20;
          note(state, 'power');
        } else note(state, 'collect');
        // Pickup wins a same-tick collision. Finishing is never taken away by contact.
        if (state.collected.length === openCells.length) {
          state.phase = 'won';
          note(state, 'won');
          state.result = wispMazeResult(state);
          return;
        }
      }
    }
    for (const enemy of state.enemies) {
      moveEnemy(state, enemy, input);
      if (
        enemy.banishedUntilTick > state.tick ||
        enemy.shieldUntilTick > state.tick ||
        Math.hypot(enemy.x - state.playerX, enemy.z - state.playerZ) >
          WISP_MAZE_PRESSURE.contactRadius
      )
        continue;
      if (state.powerUntilTick > state.tick) {
        const spawn = WISP_MAZE_ENEMY_SPAWNS[enemy.id];
        Object.assign(enemy, wispMazeCellCenter(spawn), {
          cell: spawn,
          targetCell: spawn,
          banishedUntilTick: state.tick + WISP_MAZE_BANISH_TICKS,
        });
        state.banishedCount++;
        note(state, 'banish');
      } else if (state.graceUntilTick <= state.tick) {
        state.hits++;
        state.lives--;
        if (state.lives === 0) {
          state.lives = 3;
          state.resets++;
          note(state, 'reset');
        } else note(state, 'hit');
        const spawn = wispMazeCellCenter(WISP_MAZE_SPAWN_CELL);
        state.playerX = spawn.x;
        state.playerZ = spawn.z;
        state.powerUntilTick = 0;
        state.graceUntilTick = state.tick + WISP_MAZE_GRACE_TICKS;
        resetEnemies(state);
        break;
      }
    }
  }

  const distances = wispMazeDistances(WISP_MAZE_SPAWN_CELL);
  if (
    WISP_MAZE_ENEMY_SPAWNS.length < 4 ||
    WISP_MAZE_POWER_CELLS.length === 0 ||
    ![WISP_MAZE_SPAWN_CELL, ...WISP_MAZE_ENEMY_SPAWNS, ...WISP_MAZE_POWER_CELLS].every((cell) =>
      open.has(cell),
    ) ||
    openCells.some((cell) => !Number.isFinite(distances[cell]) || neighbors[cell].length < 1) ||
    WISP_MAZE_GRID[0].includes('.') ||
    WISP_MAZE_GRID[rows - 1].includes('.') ||
    WISP_MAZE_GRID.some((row) => row[0] !== '#' || row[cols - 1] !== '#')
  )
    throw new Error('Disconnected or unsafe wisp maze definition');
  return {
    WISP_MAZE_LAYOUT,
    wispMazeCellCenter,
    wispMazeCellAt,
    wispMazeWalkable,
    moveWispMazePlayer,
    wispMazeDistances,
    createWispMaze,
    wispMazeResult,
    tickWispMaze,
  };
}

/** Default shipped ruleset; another authored definition uses the exact same kernel factory. */
export const {
  WISP_MAZE_LAYOUT,
  wispMazeCellCenter,
  wispMazeCellAt,
  wispMazeWalkable,
  moveWispMazePlayer,
  wispMazeDistances,
  createWispMaze,
  wispMazeResult,
  tickWispMaze,
} = createWispMazeKernel({
  grid: WISP_MAZE_GRID,
  pitch: WISP_MAZE_PITCH,
  spawnCell: WISP_MAZE_SPAWN_CELL,
  powerCells: WISP_MAZE_POWER_CELLS,
  enemySpawnCells: WISP_MAZE_ENEMY_SPAWNS,
});
