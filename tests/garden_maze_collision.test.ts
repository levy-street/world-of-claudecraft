// The Great Maze's hedges must stop a real player.
//
// They did not, and nothing said so. The hedge was never a collider: it was a
// bespoke segment test (crossesGardenHedge) wired into resolveMovement. When the
// parkour physics engine landed, the OPEN WORLD moved onto moveCharacter and
// resolveMovement became the instanced-interior path, so for a player on foot
// that test simply stopped being reached. Mobs, pets and Charge still routed
// through resolveMove and still collided, so the maze went on looking enforced
// while players walked straight through the hedges. Two branches, the modeled
// hedge and the physics engine, auto-merged with no conflict and no test in the
// tree exercised a PLAYER against a hedge, so the whole suite stayed green.
//
// The hedge is real collider boxes now, built from the same grid the renderer
// lays the GLBs from. These cases are deliberately about the PLAYER path: they
// would have been red the day the regression landed.
import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { Sim } from '../src/sim/sim';
import {
  groundHeight,
  inGardenMazeWall,
  MAZE_CELL,
  MAZE_COLS,
  MAZE_ROWS,
  MAZE_X0,
  MAZE_Z1,
} from '../src/sim/world';

const SEED = 20061;
const MAZE_Z0 = MAZE_Z1 - MAZE_ROWS * MAZE_CELL;
const MAZE_W = MAZE_COLS * MAZE_CELL;

function walker(spot: { x: number; z: number }) {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  const p = sim.player;
  const meta = (
    sim as unknown as { players: Map<number, { moveInput: { forward: boolean } }> }
  ).players.get((sim as unknown as { playerId: number }).playerId);
  if (!meta) throw new Error('no meta');
  p.pos.x = spot.x;
  p.pos.z = spot.z;
  p.pos.y = groundHeight(spot.x, spot.z, SEED) + 0.05;
  p.prevPos = { ...p.pos };
  for (let i = 0; i < 40; i++) {
    p.hp = p.maxHp;
    sim.tick();
  }
  return { sim, p, meta };
}

describe('the Great Maze hedges block a player', () => {
  it('stops a player walking into a hedge run, on the open-world movement path', () => {
    // west of the wall cell at column 6, row 1: its west face is x 348.9
    const { sim, p, meta } = walker({ x: 342, z: 1079.5 });
    for (let i = 0; i < 20 * 6; i++) {
      p.facing = Math.PI / 2; // due east, straight at the hedge
      meta.moveInput.forward = true;
      p.hp = p.maxHp;
      sim.tick();
    }
    meta.moveInput.forward = false;
    expect(p.pos.x, 'walked through the hedge').toBeLessThan(349);
    expect(inGardenMazeWall(p.pos.x, p.pos.z), 'ended up inside the hedge').toBe(false);
  });

  it('never leaves a player standing inside hedge stone', () => {
    // the collider set and the drawn hedge describe the same ground, so no spot
    // a body can occupy is inside a piece
    for (let x = MAZE_X0 + 1; x < MAZE_X0 + MAZE_W; x += 1.5) {
      for (let z = MAZE_Z0 + 1; z < MAZE_Z1; z += 1.5) {
        if (!inGardenMazeWall(x, z)) continue;
        expect(isBlocked(SEED, x, z, 0), `hedge at (${x}, ${z}) is walk-through`).toBe(true);
      }
    }
  });

  it('leaves the maze traversable end to end for a real body', () => {
    // The way this fix could brick the zone: crossesGardenHedge was a ZERO-RADIUS
    // point test, while a collider pushes a 0.5-radius body out, so every
    // corridor loses half a body on each side. Flood the corridors at the real
    // body radius and require the south entrance still reaches the north edge.
    const step = 0.5;
    const nx = Math.round(MAZE_W / step) + 1;
    const nz = Math.round((MAZE_Z1 - MAZE_Z0) / step) + 1;
    const free = new Uint8Array(nx * nz);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = MAZE_X0 + i * step;
        const z = MAZE_Z0 + j * step;
        if (!isBlocked(SEED, x, z, PLAYER_BODY_RADIUS)) free[i * nz + j] = 1;
      }
    }
    const queue: number[] = [];
    const seen = new Uint8Array(nx * nz);
    for (let i = 0; i < nx; i++) {
      if (free[i * nz]) {
        seen[i * nz] = 1;
        queue.push(i * nz);
      }
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const k = queue[qi];
      const i = Math.floor(k / nz);
      const j = k % nz;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
        const nk = ni * nz + nj;
        if (seen[nk] || !free[nk]) continue;
        seen[nk] = 1;
        queue.push(nk);
      }
    }
    let northReached = 0;
    for (let i = 0; i < nx; i++) if (seen[i * nz + nz - 1]) northReached++;
    expect(
      northReached,
      'the maze is sealed: no route from the south edge to the north',
    ).toBeGreaterThan(0);
  });
});
