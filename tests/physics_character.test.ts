import { afterEach, describe, expect, it } from 'vitest';
import {
  campCrateShape,
  isBlocked,
  lineOfSightClear,
  MANTLE_REACH,
  queryOpenWorldColliders,
  SIGHT_HEIGHT,
  supportHeightAt,
} from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import {
  ROCK_COLLIDER_MIN_SCALE,
  ROCK_HEIGHT_PER_SCALE,
  rockHeight,
} from '../src/sim/decoration_dims';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import {
  type CharacterMoveParams,
  type CharacterMoveResult,
  floorHeightAt,
  MAX_STEP_HEIGHT,
  moveCharacter,
  physicsStats,
  resetPhysicsStats,
} from '../src/sim/physics';
import { LEDGE_GRAB_MIN } from '../src/sim/physics/ledge';
import { GRAVITY, JUMP_VELOCITY } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import type { WorldContent } from '../src/sim/types';
import { RUN_SPEED } from '../src/sim/types';
import {
  generateDecorations,
  groundHeight,
  terrainHeight,
  terrainSteepnessAt,
  WATER_LEVEL,
} from '../src/sim/world';

// The character physics solver: swept collision, multi-plane sliding,
// depenetration, step-up, and the terrain wall/contour gate. These pin the
// contract the movement kernel depends on; tests/parkour.test.ts covers the
// same behavior end to end through a live Sim.

const SEED = 42;
const R = PLAYER_BODY_RADIUS;

afterEach(() => {
  setActiveWorldContent(null);
});

function world(props: Partial<WorldContent['props']>): WorldContent {
  return { ...BUILTIN_WORLD, props: { ...BUILTIN_WORLD.props, ...props } };
}

function params(over: Partial<CharacterMoveParams> = {}): CharacterMoveParams {
  return {
    seed: SEED,
    radius: R,
    stepHeight: MAX_STEP_HEIGHT,
    maxSlope: PLAYER_MAX_CLIMB_SLOPE,
    grounded: true,
    swimming: false,
    ignoreFences: false,
    ...over,
  };
}

const out: CharacterMoveResult = { x: 0, y: 0, z: 0, blocked: false, stepped: 0 };

// A flat, dry, collider-free strip to build cases on.
function findFlatSpot(): { x: number; z: number } {
  for (let x = -120; x <= 120; x += 3) {
    for (let z = -120; z <= 120; z += 3) {
      const h = terrainHeight(x, z, SEED);
      if (h < WATER_LEVEL + 1.5) continue;
      let ok = true;
      for (let dz = -3; dz <= 6 && ok; dz += 1) {
        if (Math.abs(terrainHeight(x, z + dz, SEED) - h) > 0.4) ok = false;
        if (isBlocked(SEED, x, z + dz, 2)) ok = false;
      }
      if (ok) return { x, z };
    }
  }
  throw new Error('no flat spot found');
}

const SPOT = findFlatSpot();

// Signed side of an XZ segment: same sign means the body never crossed it.
function sideOf(
  l: { x1: number; z1: number; x2: number; z2: number },
  x: number,
  z: number,
): number {
  return (x - l.x1) * (l.z2 - l.z1) - (z - l.z1) * (l.x2 - l.x1);
}

// A genuinely unwalkable rising face (the world rim), collider-free and dry.

// A collidable stone whose climb from the approach footing is inside the step
// reach, standing alone on flat dry ground: the isolated "walk over a stone"
// fixture. Selecting by the TRUE climb (top minus the approach foot, not the
// stone's own height) is what the solver actually tests.
function findStrideableStone(): { x: number; z: number; scale: number } | undefined {
  for (const d of generateDecorations(SEED)) {
    if (d.kind !== 'rock' || d.scale < ROCK_COLLIDER_MIN_SCALE) continue;
    if (Math.abs(d.x) > 160) continue; // stay off the world rim
    const top = groundHeight(d.x, d.z, SEED) + rockHeight(d.x, d.z, d.scale, SEED);
    if (top - groundHeight(d.x, d.z - 1.2, SEED) > MAX_STEP_HEIGHT) continue;
    let clean = true;
    for (let t = -2.6; t <= 1.6 && clean; t += 0.4) {
      const z = d.z + t;
      if (terrainSteepnessAt(d.x, z, SEED) > 0.4) clean = false;
      if (terrainHeight(d.x, z, SEED) < WATER_LEVEL + 2) clean = false;
    }
    if (!clean) continue;
    // Nothing else blocking the approach corridor, so the stone is the only
    // thing under test (a tree five yards to the side is fine).
    const near: ReturnType<typeof queryOpenWorldColliders> = [];
    queryOpenWorldColliders(SEED, d.x - 5, d.z - 5, d.x + 5, d.z + 5, near);
    const blocksCorridor = near.some((c) => {
      const cx = c.x ?? 0;
      const cz = c.z ?? 0;
      if (Math.hypot(cx - d.x, cz - d.z) <= 0.25) return false; // the stone itself
      if (cz < d.z - 3 || cz > d.z + 2) return false; // outside the walk
      const reach = (c.type === 'circle' ? c.r : Math.hypot(c.hw, c.hd)) + 0.6;
      return Math.abs(cx - d.x) < reach;
    });
    if (blocksCorridor) continue;
    return { x: d.x, z: d.z, scale: d.scale };
  }
  return undefined;
}

function findSteepFace(): { x: number; z: number } | undefined {
  for (let z = -60; z <= 200; z += 7) {
    for (let x = -130; x >= -184; x -= 0.25) {
      if (terrainHeight(x, z, SEED) < WATER_LEVEL + 0.5) break;
      if (isBlocked(SEED, x, z, 0.6)) break;
      const rise = terrainHeight(x - 0.5, z, SEED) - terrainHeight(x, z, SEED);
      if (rise > MAX_STEP_HEIGHT * 2) return { x, z };
    }
  }
  return undefined;
}

describe('swept collision and sliding', () => {
  it('moves freely when nothing is in the way', () => {
    setActiveWorldContent(world({}));
    moveCharacter(params(), SPOT.x, 0, SPOT.z, 0, 1, out);
    expect(out.x).toBeCloseTo(SPOT.x, 6);
    expect(out.z).toBeCloseTo(SPOT.z + 1, 6);
    expect(out.blocked).toBe(false);
    expect(out.stepped).toBe(0);
  });

  it('stops at the surface of a tall obstacle instead of entering it', () => {
    // A crate is 1.35 tall: above the step height, so it is a wall on foot.
    const cz = SPOT.z + 2;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    moveCharacter(params(), SPOT.x, g, SPOT.z, 0, 4, out);
    expect(out.blocked).toBe(true);
    // Stopped clear of the crate: distance from its center is at least the
    // sum of the radii (crate 0.65 + body 0.5), inside a skin's tolerance.
    expect(Math.hypot(out.x - SPOT.x, out.z - cz)).toBeGreaterThan(0.65 + R - 0.02);
    expect(out.z).toBeLessThan(cz);
  });

  it('slides along an obstacle rather than sticking to it', () => {
    const cz = SPOT.z + 2;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    // Approach at an angle: the body must keep making lateral progress.
    moveCharacter(params(), SPOT.x - 0.5, g, SPOT.z, 0.35, 1, out);
    expect(out.blocked).toBe(true);
    expect(Math.abs(out.x - (SPOT.x - 0.5))).toBeGreaterThan(0.05);
  });

  it('never tunnels through a thin obstacle at high speed', () => {
    const cz = SPOT.z + 2;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    // A 12 yard step in one call, far beyond any per-tick motion.
    moveCharacter(params(), SPOT.x, g, SPOT.z, 0, 12, out);
    expect(out.z).toBeLessThan(cz);
  });

  it('pushes a body that starts inside an obstacle back out', () => {
    const cz = SPOT.z + 2;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    moveCharacter(params(), SPOT.x, g, cz, 0, 0, out);
    expect(Math.hypot(out.x - SPOT.x, out.z - cz)).toBeGreaterThanOrEqual(
      campCrateShape(SPOT.x, cz, 0).r + R - 1e-6,
    );
  });
});

describe('step up: walking over low obstacles', () => {
  it('never steps onto a full-height blocker (an editor placement is a wall)', () => {
    const cz = SPOT.z + 2;
    const g = groundHeight(SPOT.x, cz, SEED);
    const placed = {
      ...world({}),
      placements: [
        {
          path: '/models/foliage/rock_1.glb',
          x: SPOT.x,
          z: cz,
          rotY: 0,
          scale: 1,
          collideRadius: 1,
        },
      ],
    } as WorldContent;
    setActiveWorldContent(placed);
    moveCharacter(params(), SPOT.x, g, SPOT.z, 0, 4, out);
    expect(out.stepped).toBe(0);
    expect(out.blocked).toBe(true);
    expect(out.y).toBe(g);
  });

  it('walks clean over a real low field stone', () => {
    setActiveWorldContent(null);
    // The "I cannot walk over stones" case, driven against real world data.
    const stone = findStrideableStone();
    expect(stone).toBeDefined();
    if (!stone) return;

    const g = groundHeight(stone.x, stone.z, SEED);
    // Approach from 3 yards south, walking north straight through it.
    let px = stone.x;
    let pz = stone.z - 3;
    let py = groundHeight(px, pz, SEED);
    let stepped = 0;
    for (let i = 0; i < 30; i++) {
      moveCharacter(params(), px, py, pz, 0, 0.35, out);
      px = out.x;
      pz = out.z;
      stepped += out.stepped;
      // The kernel's vertical pass SNAPS to the floor (it does not keep a
      // raised foot that nothing supports), so model it faithfully here: a
      // step-up that fails to land the body on the surface must show up as a
      // stall, not be hidden by a max() that props the feet up artificially.
      py = floorHeightAt(SEED, px, pz, R, out.y + 0.01);
    }
    // It walked clean past the stone rather than stalling against it.
    expect(pz).toBeGreaterThan(stone.z + 1);
    expect(stepped).toBeGreaterThan(0); // it really did climb, not slip round
    // And it ended SUPPORTED: the faithful vertical model above would have
    // dropped it otherwise, which is what the step-commit fix guarantees.
    expect(py).toBeCloseTo(floorHeightAt(SEED, px, pz, R, py + 0.01), 6);
    expect(g).toBeGreaterThan(-1000); // fixture sanity
  });

  it('never locks a slow mover against a stone (backpedal and snare speeds)', () => {
    setActiveWorldContent(null);
    const stone = findStrideableStone();
    expect(stone).toBeDefined();
    if (!stone) return;
    // A step-up that raises the feet at the CONTACT radius without carrying
    // the body onto the surface deadlocks against the vertical pass: the feet
    // drop, depenetration pushes back out, and net progress is zero forever.
    // Crossing must therefore work at every speed, not just at a full run.
    for (const perTick of [0.35, 0.2275 /* backpedal */, 0.1 /* heavy snare */]) {
      let px = stone.x;
      let pz = stone.z - 2;
      let py = floorHeightAt(SEED, px, pz, R, groundHeight(px, pz, SEED) + 0.01);
      let stalled = 0;
      for (let i = 0; i < 200; i++) {
        const beforeZ = pz;
        moveCharacter(params(), px, py, pz, 0, perTick, out);
        px = out.x;
        pz = out.z;
        py = floorHeightAt(SEED, px, pz, R, out.y + 0.01);
        stalled = pz - beforeZ < perTick * 0.05 ? stalled + 1 : 0;
        // A body may pause a tick or two while committing a step, never lock.
        expect(stalled, `locked at ${perTick} yd/tick, z=${pz}`).toBeLessThan(12);
        if (pz > stone.z + 1) break;
      }
      expect(pz, `never crossed at ${perTick} yd/tick`).toBeGreaterThan(stone.z + 1);
    }
  });

  it('every collidable stone is traversable: strideable, or reachable by a jump', () => {
    setActiveWorldContent(null);
    // The design contract for the whole rock field: nothing is a dead end.
    // A jump's apex is JUMP_VELOCITY^2 / 2g above the takeoff surface, and the
    // mantle assist adds MANTLE_REACH on top, so every stone top must sit
    // inside that reach. A meaningful share must also be plain strideable, or
    // "walking over stones" would be theory rather than something you feel.
    const apex = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);
    const reach = apex + MANTLE_REACH;
    let total = 0;
    let strideable = 0;
    let tallest = 0;
    for (const d of generateDecorations(SEED)) {
      if (d.kind !== 'rock' || d.scale < ROCK_COLLIDER_MIN_SCALE) continue;
      const h = rockHeight(d.x, d.z, d.scale, SEED);
      total++;
      if (h <= MAX_STEP_HEIGHT) strideable++;
      tallest = Math.max(tallest, h);
    }
    expect(total).toBeGreaterThan(100);
    expect(tallest).toBeLessThanOrEqual(reach);
    expect(strideable / total).toBeGreaterThan(0.12);
  });

  it('refuses to step up while airborne (no mid-air stairs)', () => {
    setActiveWorldContent(null);
    const stone = findStrideableStone();
    expect(stone).toBeDefined();
    if (!stone) return;
    const g = groundHeight(stone.x, stone.z, SEED);
    moveCharacter(params({ grounded: false }), stone.x, g, stone.z - 2, 0, 4, out);
    expect(out.stepped).toBe(0);
  });

  it('pins the airborne allowance to the grounded stride band', () => {
    // One number, three consumers: the horizontal gates (blocksAt here,
    // passesOver in colliders.ts) and the vertical support query in
    // player_motion.ts all read MANTLE_REACH. Holding it equal to the stride
    // band means leaving the ground never costs a body a top it could have
    // strided over, and holding it equal to LEDGE_GRAB_MIN leaves no band
    // between "vault over it" and "grab it" for a top to be a wall in.
    expect(MANTLE_REACH).toBe(MAX_STEP_HEIGHT);
    expect(LEDGE_GRAB_MIN).toBe(MAX_STEP_HEIGHT);
  });

  it('admits exactly the airborne tops the landing pass can seat', () => {
    // The pass-over gate and the landing snap must agree on every top. A top
    // the horizontal solver waves through but floorHeightAt refuses is a top
    // the body tunnels INTO: it lands on the terrain inside the prop and gets
    // ejected sideways the next grounded tick. So both arms are asserted, on
    // both sides of the allowance, at a realistic per-tick displacement.
    const cz = SPOT.z + 2;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    const top = g + campCrateShape(SPOT.x, cz, 0).top;
    // Feet just INSIDE the allowance: crosses, and lands on the crate top.
    const inBand = top - MANTLE_REACH + 0.02;
    let px = SPOT.x;
    let pz = SPOT.z;
    for (let i = 0; i < 20 && pz < cz; i++) {
      moveCharacter(params({ grounded: false }), px, inBand, pz, 0, 0.35, out);
      expect(out.blocked).toBe(false);
      px = out.x;
      pz = out.z;
    }
    expect(pz).toBeGreaterThanOrEqual(cz);
    expect(floorHeightAt(SEED, px, pz, R, inBand + MANTLE_REACH)).toBeCloseTo(top, 6);
    // Feet just OUTSIDE it: still a wall, and the landing pass agrees by
    // refusing the same top. This is the negative arm the allowance needs:
    // raising the horizontal gate alone would turn this into a tunnel.
    const below = top - MANTLE_REACH - 0.05;
    moveCharacter(params({ grounded: false }), SPOT.x, below, SPOT.z, 0, 4, out);
    expect(out.blocked).toBe(true);
    expect(out.z).toBeLessThan(cz);
    expect(floorHeightAt(SEED, SPOT.x, cz, R, below + MANTLE_REACH)).toBeLessThan(top);
  });

  it('never steps onto something taller than the step height', () => {
    const cz = SPOT.z + 2;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    expect(0.878 * 1.3).toBeGreaterThan(MAX_STEP_HEIGHT); // min crate top, fixture premise
    moveCharacter(params(), SPOT.x, g, SPOT.z, 0, 4, out);
    expect(out.stepped).toBe(0);
    expect(out.y).toBe(g);
  });
});

describe('terrain gate', () => {
  it('keeps an unwalkable rise a wall, and slides along it', () => {
    setActiveWorldContent(null);
    const found = findSteepFace();
    expect(found).toBeDefined();
    if (!found) return;
    const g = groundHeight(found.x, found.z, SEED);
    moveCharacter(params(), found.x, g, found.z, -1, 0, out);
    // Did not climb the face.
    expect(out.x).toBeGreaterThan(found.x - 0.6);
  });

  it('never terrain-gates a swimmer, and never walls an airborne body below its feet', () => {
    setActiveWorldContent(null);
    const steep = findSteepFace();
    expect(steep).toBeDefined();
    if (!steep) return;
    const g = groundHeight(steep.x, steep.z, SEED);
    // Grounded: the face is a wall (the long-standing rule).
    moveCharacter(params(), steep.x, g, steep.z, -0.5, 0, out);
    expect(Math.abs(out.x - steep.x)).toBeLessThan(0.45);
    // Treading water: never gated.
    moveCharacter(params({ swimming: true, grounded: false }), steep.x, g, steep.z, -0.5, 0, out);
    expect(Math.abs(out.x - steep.x)).toBeGreaterThan(0.4);
    // Airborne well above the ground ahead: the arc must not be stopped by a
    // slope far below (this is what makes a jump onto a bank possible).
    moveCharacter(params({ grounded: false }), steep.x, g + 40, steep.z, -0.5, 0, out);
    expect(Math.abs(out.x - steep.x)).toBeGreaterThan(0.4);
  });
});

describe('oriented boxes (fences, blocker walls, dock huts)', () => {
  // Every open-world OBB now resolves through the physics sweep, so the slab
  // test, the rounded corners, and the rotated normals need real coverage.
  const FX = () => SPOT.x;
  const FZ = () => SPOT.z + 2;

  it('blocks a grounded body head-on and slides it along the rail', () => {
    // A diagonal fence: exercises rot != 0 in both the sweep and the normal.
    setActiveWorldContent(
      world({ fences: [{ x1: SPOT.x - 6, z1: FZ() - 6, x2: SPOT.x + 6, z2: FZ() + 6 }] }),
    );
    const g = groundHeight(SPOT.x, SPOT.z, SEED);
    // Head-on into the rail (perpendicular to it) must not cross.
    const line = { x1: SPOT.x - 6, z1: FZ() - 6, x2: SPOT.x + 6, z2: FZ() + 6 };
    const start = { x: SPOT.x + 2, z: FZ() - 2 };
    moveCharacter(params(), start.x, g, start.z, -2, 2, out);
    expect(out.blocked).toBe(true);
    // Never crossed: the body stays on the side of the rail it started on.
    expect(Math.sign(sideOf(line, out.x, out.z))).toBe(Math.sign(sideOf(line, start.x, start.z)));
  });

  it('lets a jumping body clear a fence, and never a grounded one', () => {
    setActiveWorldContent(
      world({ fences: [{ x1: SPOT.x - 6, z1: FZ(), x2: SPOT.x + 6, z2: FZ() }] }),
    );
    const g = groundHeight(SPOT.x, SPOT.z, SEED);
    moveCharacter(params(), SPOT.x, g, FZ() - 1.5, 0, 3, out);
    expect(out.z).toBeLessThan(FZ());
    moveCharacter(
      params({ grounded: false, ignoreFences: true }),
      SPOT.x,
      g + 1,
      FZ() - 1.5,
      0,
      3,
      out,
    );
    expect(out.z).toBeGreaterThan(FZ());
  });

  it('resolves a rotated blocker wall without leaking through its corner', () => {
    const wall = { x1: SPOT.x - 3, z1: FZ() - 3, x2: SPOT.x + 3, z2: FZ() + 3 };
    setActiveWorldContent({ ...world({}), blockers: [wall] } as WorldContent);
    const g = groundHeight(SPOT.x, SPOT.z, SEED);
    // Aim straight at the wall's midpoint from the near side.
    const from = { x: SPOT.x + 2, z: FZ() - 2 };
    moveCharacter(params(), from.x, g, from.z, -4, 4, out);
    expect(out.blocked).toBe(true);
    expect(Math.sign(sideOf(wall, out.x, out.z))).toBe(Math.sign(sideOf(wall, from.x, from.z)));
  });
});

describe('floor query', () => {
  it('reports the terrain on open ground and a crate top when standing on one', () => {
    const cz = SPOT.z + 2;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    expect(floorHeightAt(SEED, SPOT.x, SPOT.z, R, 1000)).toBeCloseTo(
      groundHeight(SPOT.x, SPOT.z, SEED),
      6,
    );
    expect(
      floorHeightAt(SEED, SPOT.x, cz, R, g + campCrateShape(SPOT.x, cz, 0).top + 0.01),
    ).toBeCloseTo(g + campCrateShape(SPOT.x, cz, 0).top, 6);
  });
});

describe('rock dimensions match the rendered silhouette', () => {
  it('keeps every collidable stone within the documented height band', () => {
    setActiveWorldContent(null);
    let checked = 0;
    for (const d of generateDecorations(SEED)) {
      if (d.kind !== 'rock' || d.scale < ROCK_COLLIDER_MIN_SCALE) continue;
      const h = rockHeight(d.x, d.z, d.scale, SEED);
      // The model: scale * ROCK_HEIGHT_PER_SCALE * (0.8 .. 1.3).
      expect(h).toBeGreaterThanOrEqual(d.scale * ROCK_HEIGHT_PER_SCALE * 0.8 - 1e-9);
      expect(h).toBeLessThanOrEqual(d.scale * ROCK_HEIGHT_PER_SCALE * 1.3 + 1e-9);
      checked++;
      if (checked > 400) break;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('is deterministic for a given seed', () => {
    const a = rockHeight(12.5, -33.25, 1.1, SEED);
    const b = rockHeight(12.5, -33.25, 1.1, SEED);
    expect(a).toBe(b);
    expect(rockHeight(12.5, -33.25, 1.1, SEED + 1)).not.toBe(a);
  });
});

describe('efficiency: the solver does bounded work per tick', () => {
  // Wall-clock budgets rot across machines; the WORK a solve performs does
  // not. These bound what the hot path may touch, which is what keeps the
  // engine cheap enough to run for every player on the authoritative server.
  it('prunes the broadphase down to what is actually in reach', () => {
    setActiveWorldContent(null);
    const stone = findStrideableStone();
    expect(stone).toBeDefined();
    if (!stone) return;
    resetPhysicsStats();
    // Walk a 200-tick route straight through the stone at run speed.
    let px = stone.x;
    let pz = stone.z - 4;
    let py = floorHeightAt(SEED, px, pz, R, groundHeight(px, pz, SEED) + 0.01);
    for (let i = 0; i < 200; i++) {
      moveCharacter(params(), px, py, pz, 0, 0.35, out);
      px = out.x;
      pz = out.z;
      py = floorHeightAt(SEED, px, pz, R, out.y + 0.01);
    }
    expect(physicsStats.solves).toBe(200);
    // A 16 yd grid cell can hold dozens of colliders; after the prune a solve
    // must consider only the handful within a step of the body.
    const perSolve = physicsStats.candidates / physicsStats.solves;
    expect(perSolve).toBeLessThan(4);
    // Sweeps and overlap tests stay proportional to that handful, never to
    // the cell population, and never blow up per slide iteration.
    expect(physicsStats.sweeps / physicsStats.solves).toBeLessThan(6);
    expect(physicsStats.overlaps / physicsStats.solves).toBeLessThan(12);
  });

  it('costs nothing extra on empty ground', () => {
    setActiveWorldContent(world({}));
    resetPhysicsStats();
    for (let i = 0; i < 100; i++) {
      moveCharacter(params(), SPOT.x, groundHeight(SPOT.x, SPOT.z, SEED), SPOT.z, 0, 0.35, out);
    }
    // Open ground: nothing survives the prune, so no sweep or overlap runs.
    expect(physicsStats.candidates).toBe(0);
    expect(physicsStats.sweeps).toBe(0);
    expect(physicsStats.overlaps).toBe(0);
  });

  it('reuses the caller result object rather than minting poses', () => {
    setActiveWorldContent(world({}));
    const before = out;
    moveCharacter(params(), SPOT.x, 0, SPOT.z, 0.1, 0.1, out);
    expect(out).toBe(before);
  });
});

describe('the pruned support query matches the collider-grid query', () => {
  it('agrees with supportHeightAt across a sampled route', () => {
    setActiveWorldContent(null);
    const stone = findStrideableStone();
    expect(stone).toBeDefined();
    if (!stone) return;
    // The solver computes support from its own pruned list; drift between the
    // two would silently change what a body can stand on.
    for (let t = -3; t <= 3; t += 0.25) {
      const x = stone.x + t * 0.3;
      const z = stone.z + t;
      const maxY = groundHeight(x, z, SEED) + MAX_STEP_HEIGHT + 1;
      const viaGrid = supportHeightAt(SEED, x, z, R, maxY);
      // Drive one zero-length solve so the solver's prune covers this point,
      // then compare the floor it would land on.
      moveCharacter(params(), x, groundHeight(x, z, SEED), z, 0, 0, out);
      const viaFloor = floorHeightAt(SEED, x, z, R, maxY);
      expect(viaFloor).toBe(Math.max(groundHeight(x, z, SEED), viaGrid));
    }
  });
});

describe('air control cannot manufacture speed', () => {
  // Quake-lineage air steering is a classic source of exploit speed: steering
  // perpendicular to your velocity in the air can ADD to it if the
  // acceleration is applied without regard to the current speed. This solver
  // steers velocity TOWARD the wish vector instead, so the airborne speed can
  // converge on the run speed but never exceed it, whatever the input does.
  it('never exceeds run speed however the wish vector is steered', () => {
    setActiveWorldContent(world({}));
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(60);
    const p = sim.player;
    p.pos.x = SPOT.x;
    p.pos.z = SPOT.z;
    p.pos.y = terrainHeight(SPOT.x, SPOT.z, SEED);
    p.prevPos = { ...p.pos };
    p.onGround = true;
    p.facing = 0;
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('missing player meta');
    const input = {
      forward: true,
      back: false,
      turnLeft: false,
      turnRight: false,
      strafeLeft: false,
      strafeRight: false,
      jump: true,
    };
    Object.assign(meta.moveInput, input);
    sim.tick();
    expect(p.onGround).toBe(false);
    let peak = 0;
    // Spin the wish vector while airborne, the classic air-strafe input.
    for (let i = 0; i < 200; i++) {
      p.facing += 0.35;
      Object.assign(meta.moveInput, { ...input, jump: false, strafeRight: i % 2 === 0 });
      sim.tick();
      peak = Math.max(peak, Math.hypot(p.vx, p.vz));
      if (p.onGround) {
        Object.assign(meta.moveInput, { ...input, jump: true });
        sim.tick();
      }
    }
    expect(peak).toBeLessThanOrEqual(RUN_SPEED + 1e-6);
  });
});

describe('rock tops below eye height no longer block line of sight', () => {
  // Making the collider top match the silhouette also changed what a rock
  // OCCLUDES: a boulder you can see over no longer blocks a cast. That is a
  // deliberate gameplay consequence of the fix, and it is pinned here so it
  // cannot change again by accident.
  it('lets a cast cross a stone shorter than the sight line', () => {
    setActiveWorldContent(null);
    const stone = findStrideableStone();
    expect(stone).toBeDefined();
    if (!stone) return;
    const top = rockHeight(stone.x, stone.z, stone.scale, SEED);
    expect(top).toBeLessThan(SIGHT_HEIGHT);
    const from = { x: stone.x, z: stone.z - 4 };
    const to = { x: stone.x, z: stone.z + 4 };
    expect(lineOfSightClear(SEED, from, to)).toBe(true);
  });
});
