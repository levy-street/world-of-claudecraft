import { describe, expect, it } from 'vitest';
import {
  createWispMaze,
  createWispMazeKernel,
  moveWispMazePlayer,
  tickWispMaze,
  WISP_MAZE_LAYOUT,
  WISP_MAZE_PROFILES,
  wispMazeCellAt,
  wispMazeCellCenter,
  wispMazeDistances,
  wispMazeEnemySpeed,
  wispMazeWalkable,
} from '../src/sim/minigames/wisp_maze';

const idle = { x: 0, z: 0 };
function active(difficulty: 'easy' | 'normal' | 'hard' = 'easy') {
  const state = createWispMaze(42, difficulty);
  for (let tick = 0; tick < 60; tick++) tickWispMaze(state, idle);
  return state;
}

describe('original world-space wisp maze', () => {
  it.each(['easy', 'normal', 'hard'] as const)(
    'ramps %s guardian speed smoothly after 15 seconds and caps it at 90',
    (difficulty) => {
      const state = active(difficulty);
      const profile = WISP_MAZE_PROFILES[difficulty];
      for (const seconds of [0, 15]) {
        state.tick = 60 + seconds * 20;
        expect(wispMazeEnemySpeed(state)).toBe(profile.enemySpeed);
      }
      state.tick = 60 + 52.5 * 20;
      expect(wispMazeEnemySpeed(state)).toBeCloseTo(
        (profile.enemySpeed + profile.enemyMaxSpeed) / 2,
      );
      for (const seconds of [90, 3600]) {
        state.tick = 60 + seconds * 20;
        expect(wispMazeEnemySpeed(state)).toBe(profile.enemyMaxSpeed);
        expect(wispMazeEnemySpeed(state)).toBeLessThan(7);
      }
      state.powerUntilTick = state.tick + 1;
      expect(wispMazeEnemySpeed(state)).toBeCloseTo(profile.enemyMaxSpeed * 0.75);
      state.powerUntilTick = state.tick;
      expect(wispMazeEnemySpeed(state)).toBe(profile.enemyMaxSpeed);
    },
  );

  it('applies the ramp to actual guardian movement, not only the speed readout', () => {
    for (const [seconds, speed] of [
      [0, 4.6],
      [90, 6],
    ] as const) {
      const state = active('normal');
      state.tick = 60 + seconds * 20;
      const enemy = state.enemies[0];
      const start = wispMazeCellCenter(16);
      Object.assign(enemy, start, { cell: 16, targetCell: 17 });
      tickWispMaze(state, idle);
      expect(Math.hypot(enemy.x - start.x, enemy.z - start.z)).toBeCloseTo(speed * 0.05);
    }
  });

  it('catches a player squeezing alongside a guardian in a narrow corridor', () => {
    const state = active();
    state.graceUntilTick = 0;
    // One-cell vertical corridor: the player hugs its edge, 1.4 yards from center.
    const center = wispMazeCellCenter(23);
    state.playerX = center.x + 1.4;
    state.playerZ = center.z;
    expect(wispMazeWalkable(state.playerX, state.playerZ)).toBe(true);
    Object.assign(state.enemies[0], center, { cell: 23, targetCell: 34, shieldUntilTick: 0 });
    const collected = [...state.collected];
    tickWispMaze(state, idle);
    expect(state.hits).toBe(1);
    expect(state.lives).toBe(2);
    expect(state.collected).toEqual(collected);
  });

  it('does not hit a player beyond the contact reach', () => {
    const state = active();
    state.graceUntilTick = 0;
    state.enemies[1].banishedUntilTick = state.tick + 100;
    const center = wispMazeCellCenter(34);
    state.playerX = center.x + 2;
    state.playerZ = center.z;
    Object.assign(state.enemies[0], center, { cell: 34, targetCell: 23, shieldUntilTick: 0 });
    tickWispMaze(state, idle);
    expect(state.hits).toBe(0);
  });

  it('runs another authored definition through the same movement, collection and enemy kernel', () => {
    const other = createWispMazeKernel({
      grid: ['#######', '#.....#', '#.###.#', '#.###.#', '#.###.#', '#.....#', '#######'],
      pitch: 3,
      spawnCell: 38,
      powerCells: [8, 12, 36, 40],
      enemySpawnCells: [8, 9, 10, 11],
    });
    expect(other.WISP_MAZE_LAYOUT.openCells).toHaveLength(16);
    const state = other.createWispMaze(42);
    for (let tick = 0; tick < 60; tick++) other.tickWispMaze(state, idle);
    expect(state.collected).toEqual([38]);
    expect(state.playerX).toBe(0);
    expect(state.playerZ).toBe(6);
    for (let tick = 0; tick < 10; tick++) other.tickWispMaze(state, { x: 1, z: 0 });
    expect(state.playerX).toBeCloseTo(3.5);
    expect(state.collected).toContain(39);
    expect(other.wispMazeWalkable(state.playerX, state.playerZ)).toBe(true);
    expect(WISP_MAZE_LAYOUT.openCells).toHaveLength(61);
    expect(() =>
      createWispMazeKernel({ ...other.WISP_MAZE_LAYOUT, grid: ['...', '...', '...'] }),
    ).toThrow();
  });

  it('guards against repeated spawn contacts and makes guardians flee while empowered', () => {
    const state = active('hard');
    const cell = 38;
    const center = wispMazeCellCenter(cell);
    const player = wispMazeCellCenter(36);
    state.playerX = player.x;
    state.playerZ = player.z;
    state.powerUntilTick = state.tick + 160;
    for (const enemy of state.enemies) Object.assign(enemy, center, { cell, targetCell: cell });
    const distances = wispMazeDistances(36);
    tickWispMaze(state, idle);
    for (const enemy of state.enemies)
      expect(distances[enemy.targetCell]).toBeGreaterThan(distances[cell]);
    state.powerUntilTick = 0;
    state.graceUntilTick = state.tick + 3;
    for (let tick = 0; tick < 2; tick++) {
      Object.assign(state.enemies[0], {
        x: state.playerX,
        z: state.playerZ,
        cell: 36,
        targetCell: 36,
      });
      tickWispMaze(state, idle);
      expect(state.hits).toBe(0);
    }
    Object.assign(state.enemies[0], {
      x: state.playerX,
      z: state.playerZ,
      cell: 36,
      targetCell: 36,
    });
    tickWispMaze(state, idle);
    expect(state.hits).toBe(1);
  });

  it('uses distinct pursuit, interception and patrol goals at an intersection', () => {
    const state = active('hard');
    const center = wispMazeCellCenter(38);
    const player = wispMazeCellCenter(36);
    state.playerX = player.x;
    state.playerZ = player.z;
    for (const enemy of state.enemies) Object.assign(enemy, center, { cell: 38, targetCell: 38 });
    tickWispMaze(state, { x: 1, z: 0 });
    expect(state.enemies[0].targetCell).toBe(37);
    expect(state.enemies[1].targetCell).toBe(27);
    const patrolDistances = wispMazeDistances(WISP_MAZE_LAYOUT.powerCells[0]);
    expect(patrolDistances[state.enemies[2].targetCell]).toBeLessThan(patrolDistances[38]);
    expect(WISP_MAZE_LAYOUT.neighbors[38]).toContain(state.enemies[3].targetCell);
  });
  it('authors a compact connected loop graph with safe separate spawns and reachable power', () => {
    const layout = WISP_MAZE_LAYOUT;
    expect(layout.cols * layout.pitch).toBeLessThanOrEqual(50);
    expect(layout.rows * layout.pitch).toBeLessThanOrEqual(50);
    expect(layout.openCells.length).toBeGreaterThanOrEqual(40);
    expect(layout.openCells.length).toBeLessThanOrEqual(80);
    const distances = wispMazeDistances(layout.spawnCell);
    for (const cell of layout.openCells) {
      expect(distances[cell]).toBeLessThan(Infinity);
      expect(layout.neighbors[cell].length).toBeGreaterThanOrEqual(2);
      const p = wispMazeCellCenter(cell);
      expect(wispMazeWalkable(p.x, p.z)).toBe(true);
    }
    for (const cell of [...layout.powerCells, ...layout.enemySpawnCells])
      expect(layout.openCells).toContain(cell);
    for (const cell of layout.enemySpawnCells) expect(distances[cell]).toBeGreaterThanOrEqual(4);
  });

  it('locks countdown, normalizes diagonal input and clamps extreme or nonfinite input', () => {
    const state = createWispMaze(0);
    const spawn = { x: state.playerX, z: state.playerZ };
    tickWispMaze(state, { x: 1, z: 0 });
    expect(state.playerX).toBe(spawn.x);
    expect(state.phase).toBe('countdown');
    const a = active(),
      b = active();
    moveWispMazePlayer(a, { x: 1, z: 0 });
    moveWispMazePlayer(b, { x: 999, z: 999 });
    expect(Math.hypot(a.playerX - spawn.x, a.playerZ - spawn.z)).toBeCloseTo(0.35);
    expect(Math.hypot(b.playerX - spawn.x, b.playerZ - spawn.z)).toBeCloseTo(0.35);
    const before = structuredClone(b);
    moveWispMazePlayer(b, { x: Infinity, z: NaN });
    expect(b).toEqual(before);
  });

  it('sweeps real continuous movement into walls and corners without crossing the shell', () => {
    const state = active();
    for (let tick = 0; tick < 500; tick++) moveWispMazePlayer(state, { x: 1, z: 1 });
    expect(wispMazeWalkable(state.playerX, state.playerZ)).toBe(true);
    expect(state.playerX).toBeLessThan(18);
    expect(state.playerZ).toBeLessThan(18);
    const wall = wispMazeCellCenter(24);
    expect(wispMazeWalkable(wall.x, wall.z)).toBe(false);
  });

  it('has configurable guardian counts, power durations and deterministic isolated replay', () => {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const a = active(difficulty),
        b = active(difficulty);
      expect(a.enemies).toHaveLength(WISP_MAZE_PROFILES[difficulty].enemyCount);
      for (let tick = 0; tick < 400; tick++) {
        const input = tick % 100 < 50 ? { x: 1, z: 0 } : { x: 0, z: -1 };
        tickWispMaze(a, input);
        tickWispMaze(b, input);
      }
      expect(a).toEqual(b);
      a.collected.length = 0;
      expect(b.collected.length).toBeGreaterThan(0);
    }
  });

  it('collects once, grants exact profile power and banishes a guardian for five seconds', () => {
    const state = active();
    const power = wispMazeCellCenter(WISP_MAZE_LAYOUT.powerCells[0]);
    state.playerX = power.x;
    state.playerZ = power.z;
    tickWispMaze(state, idle);
    expect(state.powerUntilTick).toBe(state.tick + 160);
    const count = state.collected.length;
    const enemy = state.enemies[0];
    Object.assign(enemy, power, {
      cell: WISP_MAZE_LAYOUT.powerCells[0],
      targetCell: WISP_MAZE_LAYOUT.powerCells[0],
      shieldUntilTick: 0,
    });
    tickWispMaze(state, idle);
    expect(state.collected).toHaveLength(count);
    expect(enemy.banishedUntilTick).toBe(state.tick + 100);
    const returnTick = enemy.banishedUntilTick;
    while (state.tick < returnTick - 1) tickWispMaze(state, idle);
    expect(enemy.banishedUntilTick).toBe(returnTick);
    tickWispMaze(state, idle);
    expect(enemy.banishedUntilTick).toBe(0);
    expect(enemy.shieldUntilTick).toBe(state.tick + 60);
  });

  it('loses a life exactly when power expires and restores three without erasing wisps', () => {
    const state = active();
    const collected = [...state.collected];
    for (let hit = 0; hit < 3; hit++) {
      state.graceUntilTick = state.tick;
      state.powerUntilTick = state.tick + 1;
      const enemy = state.enemies[0];
      Object.assign(enemy, {
        x: state.playerX,
        z: state.playerZ,
        cell: WISP_MAZE_LAYOUT.spawnCell,
        targetCell: WISP_MAZE_LAYOUT.spawnCell,
        shieldUntilTick: 0,
        banishedUntilTick: 0,
      });
      tickWispMaze(state, idle);
      expect(state.hits).toBe(hit + 1);
      expect(state.graceUntilTick).toBe(state.tick + 60);
      expect(state.collected).toEqual(collected);
    }
    expect(state.lives).toBe(3);
    expect(state.resets).toBe(1);
    expect(state.phase).toBe('active');
  });

  it('gives final pickup priority over same-tick contact and freezes completed results', () => {
    const state = active();
    const cell = WISP_MAZE_LAYOUT.spawnCell;
    state.collected = WISP_MAZE_LAYOUT.openCells.filter((value) => value !== cell);
    state.graceUntilTick = 0;
    Object.assign(state.enemies[0], {
      x: state.playerX,
      z: state.playerZ,
      cell,
      targetCell: cell,
      shieldUntilTick: 0,
    });
    tickWispMaze(state, idle);
    expect(state.phase).toBe('won');
    expect(state.hits).toBe(0);
    expect(state.result?.collected).toBe(WISP_MAZE_LAYOUT.openCells.length);
    const won = structuredClone(state);
    tickWispMaze(state, { x: 1, z: 0 });
    expect(state).toEqual(won);
  });

  it.each(['easy', 'normal', 'hard'] as const)(
    'a real-movement route collects the whole %s layout with active guardians',
    (difficulty) => {
      const state = active(difficulty);
      let waypoint = wispMazeCellAt(state.playerX, state.playerZ);
      let previousHits = 0;
      for (let tick = 0; tick < 4800 && state.phase !== 'won'; tick++) {
        if (state.hits !== previousHits) {
          waypoint = WISP_MAZE_LAYOUT.spawnCell;
          previousHits = state.hits;
        }
        let target = wispMazeCellCenter(waypoint);
        if (Math.hypot(target.x - state.playerX, target.z - state.playerZ) < 0.1) {
          const current = wispMazeCellAt(state.playerX, state.playerZ);
          const distances = wispMazeDistances(current);
          const remaining = WISP_MAZE_LAYOUT.openCells.filter(
            (cell) => !state.collected.includes(cell),
          );
          const goal = remaining.reduce(
            (best, cell) => (distances[cell] < distances[best] ? cell : best),
            remaining[0],
          );
          const toGoal = wispMazeDistances(goal);
          waypoint = WISP_MAZE_LAYOUT.neighbors[current].reduce(
            (best, cell) => (toGoal[cell] < toGoal[best] ? cell : best),
            WISP_MAZE_LAYOUT.neighbors[current][0],
          );
          target = wispMazeCellCenter(waypoint);
        }
        const dx = target.x - state.playerX,
          dz = target.z - state.playerZ;
        const d = Math.hypot(dx, dz);
        tickWispMaze(state, { x: dx / Math.max(d, 0.35), z: dz / Math.max(d, 0.35) });
        expect(wispMazeWalkable(state.playerX, state.playerZ)).toBe(true);
        for (const enemy of state.enemies) expect(wispMazeWalkable(enemy.x, enemy.z)).toBe(true);
      }
      expect(state.phase).toBe('won');
      expect(state.result?.elapsed).toBeLessThan(120);
    },
  );
});
