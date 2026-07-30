import { afterEach, describe, expect, it } from 'vitest';
import {
  CAMPFIRE_MOVE_TOP,
  campCrateShape,
  isBlocked,
  MANTLE_REACH,
  moverHeight,
  resolveMovement,
  resolvePosition,
  seatGroundedAt,
  supportHeightAt,
} from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { rockHeightOf } from '../src/sim/decoration_dims';
import {
  COYOTE_TIME,
  GRAVITY,
  JUMP_VELOCITY,
  moveSpeedMult,
  type PlayerMotionDeps,
  stepPlayerMotion,
} from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import type { Entity, MoveInput, WorldContent } from '../src/sim/types';
import {
  generateDecorations,
  groundHeight,
  terrainHeight,
  terrainSteepness,
  terrainSteepnessAt,
  WATER_LEVEL,
} from '../src/sim/world';

// Parkour movement and height-aware prop collision:
//  - low prop tops (moveTopY) pass a mover whose feet clear them, so a jump
//    carries over a campfire that still blocks a grounded walk;
//  - standable tops (crates, rocks) are landing/walking surfaces via
//    supportHeightAt, with the MANTLE_REACH assist hoisting a jump onto rims
//    the raw apex cannot strictly clear;
//  - air control steers airborne velocity, walking off a ledge keeps momentum,
//    and a coyote window lets a just-walked-off jump still fire;
//  - movers with NO height profile (mobs, pathfinding) collide exactly as
//    before.
// The final suite pins kernel-vs-live-Sim parity across a parkour course, the
// same bit-for-bit contract tests/player_motion.test.ts pins on open ground.

const SEED = 42;

afterEach(() => {
  setActiveWorldContent(null);
});

function world(props: Partial<WorldContent['props']>): WorldContent {
  // Fresh object per test: the collider grid cache is keyed per content.
  return { ...BUILTIN_WORLD, props: { ...BUILTIN_WORLD.props, ...props } };
}

// A flat, dry, collider-free south-north strip to author the course on:
// steady height, walkable slope, nothing else colliding along it.
function findFlatCourse(len: number): { x: number; z0: number } {
  for (let x = -120; x <= 120; x += 3) {
    outer: for (let z0 = -120; z0 <= 120; z0 += 3) {
      const h0 = terrainHeight(x, z0, SEED);
      if (h0 < WATER_LEVEL + 1.5) continue;
      for (let dz = 0; dz <= len; dz += 1) {
        const z = z0 + dz;
        if (terrainHeight(x, z, SEED) < WATER_LEVEL + 1.5) continue outer;
        if (Math.abs(terrainHeight(x, z, SEED) - h0) > 0.5) continue outer;
        if (terrainSteepness(x, z, SEED) > 0.3) continue outer;
        if (isBlocked(SEED, x, z, 1.6)) continue outer;
      }
      return { x, z0 };
    }
  }
  throw new Error('no flat course found');
}

const COURSE = findFlatCourse(18);

// A steep on-wall footing on the west rim, measured with terrainSteepnessAt,
// the SAME rounded-cell sampler the kernel's slope and coyote gates read, so
// a returned point is guaranteed to trip them.
function findSteepFooting(seed: number): { x: number; z: number } {
  for (let z = -60; z <= 820; z += 7) {
    for (let x = -130; x >= -184; x -= 0.25) {
      if (terrainHeight(x, z, seed) < WATER_LEVEL + 0.5) break;
      if (isBlocked(seed, x, z, 0.6)) break;
      if (terrainSteepnessAt(x, z, seed) > 1.9) return { x, z };
    }
  }
  throw new Error('no steep footing found');
}

function makeSim(): Sim {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(60); // mobs along the course must not decide these tests
  return sim;
}

function teleport(sim: Sim, x: number, z: number): void {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  p.fallStartY = p.pos.y;
  p.facing = 0; // +z, straight down the course
  p.onGround = true;
  p.vx = 0;
  p.vz = 0;
  p.vy = 0;
}

// The client dep shape (mirrors src/render/self_motion.ts).
function clientDeps(seed: number): PlayerMotionDeps {
  return {
    seed,
    moveSpeedMult: (e) => moveSpeedMult(e, 0),
    resolveMove: (fromX, fromZ, nx, nz, r, e, ignoreFences) =>
      resolveMovement(seed, fromX, fromZ, nx, nz, r, ignoreFences, undefined, moverHeight(e)),
    resolvedAbility: () => null,
    cancelCast: () => {},
    standUp: () => {},
    dealDamage: () => {},
  };
}

function mirrorActor(sim: Sim): Entity {
  const p = sim.player;
  return { ...p, pos: { ...p.pos }, prevPos: { ...p.prevPos } };
}

const mi = (over: Partial<MoveInput> = {}): MoveInput => ({
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
  ...over,
});

// Drive the kernel alone for `ticks`, input chosen per tick.
function run(actor: Entity, deps: PlayerMotionDeps, ticks: number, at: (i: number) => MoveInput) {
  for (let i = 0; i < ticks; i++) {
    actor.prevPos = { ...actor.pos };
    stepPlayerMotion(deps, actor, at(i));
  }
}

describe('supportHeightAt: standable prop tops', () => {
  const CX = COURSE.x;
  const CZ = COURSE.z0 + 5;

  it('reports a crate top under the body, gated by maxY', () => {
    setActiveWorldContent(world({ crates: [[CX, CZ]] }));
    const top = groundHeight(CX, CZ, SEED) + campCrateShape(CX, CZ, 0).top;
    expect(supportHeightAt(SEED, CX, CZ, 0.5, top + 1)).toBeCloseTo(top, 6);
    // A top above the allowed reach never supports (no levitation).
    expect(supportHeightAt(SEED, CX, CZ, 0.5, top - 0.2)).toBe(-Infinity);
  });

  it('never supports on a campfire (passable but not standable)', () => {
    setActiveWorldContent(world({ campfires: [[CX, CZ]] }));
    expect(supportHeightAt(SEED, CX, CZ, 0.5, 1000)).toBe(-Infinity);
  });

  it('supports only when the center meaningfully overlaps the top', () => {
    setActiveWorldContent(world({ crates: [[CX, CZ]] }));
    const top = groundHeight(CX, CZ, SEED) + campCrateShape(CX, CZ, 0).top;
    // Inside the support reach (crate r 0.65 + half body 0.25).
    expect(supportHeightAt(SEED, CX, CZ + 0.8, 0.5, top + 1)).toBeCloseTo(top, 6);
    // Outside the support reach but inside the collision radius: a graze, no capture.
    expect(supportHeightAt(SEED, CX, CZ + 1.0, 0.5, top + 1)).toBe(-Infinity);
  });

  it('reports a decoration rock top at its scaled height', () => {
    setActiveWorldContent(null);
    const rock = generateDecorations(SEED).find(
      (d) => d.kind === 'rock' && d.scale >= 0.8 && terrainHeight(d.x, d.z, SEED) > WATER_LEVEL + 1,
    );
    expect(rock).toBeDefined();
    if (!rock) return;
    const top = groundHeight(rock.x, rock.z, SEED) + rockHeightOf(rock, SEED);
    expect(supportHeightAt(SEED, rock.x, rock.z, 0.5, top + 1)).toBeCloseTo(top, 6);
  });
});

describe('seatGroundedAt: instant-relocation end points', () => {
  const CX = COURSE.x;
  const CZ = COURSE.z0 + 5;

  it('seats on a crate top the mover previously stood level with', () => {
    setActiveWorldContent(world({ crates: [[CX, CZ]] }));
    const top = groundHeight(CX, CZ, SEED) + campCrateShape(CX, CZ, 0).top;
    const seat = seatGroundedAt(SEED, CX, CZ, 0.5, top);
    expect(seat.x).toBe(CX);
    expect(seat.z).toBe(CZ);
    expect(seat.y).toBeCloseTo(top, 6);
  });

  it('nudges clear of a passed-over campfire instead of embedding in it', () => {
    setActiveWorldContent(world({ campfires: [[CX, CZ]] }));
    const g = groundHeight(CX, CZ, SEED);
    const seat = seatGroundedAt(SEED, CX, CZ, 0.5, g + 2);
    expect(Math.hypot(seat.x - CX, seat.z - CZ)).toBeGreaterThanOrEqual(1.35 - 1e-6);
    expect(seat.y).toBeCloseTo(groundHeight(seat.x, seat.z, SEED), 6);
  });

  it('returns an open-ground point unchanged', () => {
    setActiveWorldContent(world({}));
    const g = groundHeight(CX, CZ, SEED);
    const seat = seatGroundedAt(SEED, CX, CZ, 0.5, g);
    expect(seat.x).toBe(CX);
    expect(seat.z).toBe(CZ);
    expect(seat.y).toBeCloseTo(g, 6);
  });
});

describe('height-gated prop collision', () => {
  const CX = COURSE.x;
  const CZ = COURSE.z0 + 5;

  it('campfire blocks a grounded mover, passes one whose feet clear the log pile', () => {
    setActiveWorldContent(world({ campfires: [[CX, CZ]] }));
    const g = groundHeight(CX, CZ, SEED);
    const grounded = resolvePosition(SEED, CX, CZ, 0.5, false, undefined, { y: g, lift: 0 });
    expect(Math.hypot(grounded.x - CX, grounded.z - CZ)).toBeGreaterThan(1e-4);
    const airborne = resolvePosition(SEED, CX, CZ, 0.5, false, undefined, {
      y: g + CAMPFIRE_MOVE_TOP + 0.01,
      lift: MANTLE_REACH,
    });
    expect(airborne.x).toBe(CX);
    expect(airborne.z).toBe(CZ);
    // The mantle lift never applies to a NON-standable top: feet below the
    // pile stay blocked even airborne.
    const tooLow = resolvePosition(SEED, CX, CZ, 0.5, false, undefined, {
      y: g + 0.2,
      lift: MANTLE_REACH,
    });
    expect(Math.hypot(tooLow.x - CX, tooLow.z - CZ)).toBeGreaterThan(1e-4);
  });

  it('crate passes a mover standing on its top and an airborne mantle within reach', () => {
    setActiveWorldContent(world({ crates: [[CX, CZ]] }));
    const top = groundHeight(CX, CZ, SEED) + campCrateShape(CX, CZ, 0).top;
    const onTop = resolvePosition(SEED, CX, CZ, 0.5, false, undefined, { y: top, lift: 0 });
    expect(onTop.x).toBe(CX);
    expect(onTop.z).toBe(CZ);
    const mantling = resolvePosition(SEED, CX, CZ, 0.5, false, undefined, {
      y: top - MANTLE_REACH + 0.01,
      lift: MANTLE_REACH,
    });
    expect(mantling.x).toBe(CX);
    expect(mantling.z).toBe(CZ);
    // Below mantle reach: still a wall, airborne or not.
    const below = resolvePosition(SEED, CX, CZ, 0.5, false, undefined, {
      y: top - MANTLE_REACH - 0.2,
      lift: MANTLE_REACH,
    });
    expect(Math.hypot(below.x - CX, below.z - CZ)).toBeGreaterThan(1e-4);
  });

  it('movers with no height profile (mobs, pathfinding) still collide fully', () => {
    setActiveWorldContent(world({ crates: [[CX, CZ]] }));
    const res = resolvePosition(SEED, CX, CZ, 0.5);
    expect(Math.hypot(res.x - CX, res.z - CZ)).toBeGreaterThan(1e-4);
    expect(isBlocked(SEED, CX, CZ, 0.5)).toBe(true);
  });
});

describe('parkour kernel: jump-over, mantle, momentum, coyote, air control', () => {
  const CX = COURSE.x;

  it('a jump clears a campfire that blocks the same run on the ground', () => {
    const fireZ = COURSE.z0 + 5;
    setActiveWorldContent(world({ campfires: [[CX, fireZ]] }));
    const sim = makeSim();
    const deps = clientDeps(SEED);

    // Grounded control: held forward never crosses the fire line.
    teleport(sim, CX, fireZ - 2.5);
    const walker = mirrorActor(sim);
    run(walker, deps, 60, () => mi({ forward: true }));
    expect(walker.pos.z).toBeLessThan(fireZ - 1.3);
    expect(walker.onGround).toBe(true);

    // Same run with a jump at the fire's edge sails over it.
    teleport(sim, CX, fireZ - 2.5);
    const jumper = mirrorActor(sim);
    run(jumper, deps, 60, (i) => mi({ forward: true, jump: i === 0 }));
    expect(jumper.pos.z).toBeGreaterThan(fireZ + 1.4);
    expect(jumper.onGround).toBe(true);
  });

  it('a jump at a crate mantles onto its top, runs across, and drops off the far side', () => {
    const crateZ = COURSE.z0 + 5;
    setActiveWorldContent(world({ crates: [[CX, crateZ]] }));
    const sim = makeSim();
    const deps = clientDeps(SEED);
    teleport(sim, CX, crateZ - 2.5);
    const actor = mirrorActor(sim);
    const top = groundHeight(CX, crateZ, SEED) + campCrateShape(CX, crateZ, 0).top;

    let stoodOnTop = false;
    for (let i = 0; i < 80; i++) {
      actor.prevPos = { ...actor.pos };
      stepPlayerMotion(deps, actor, mi({ forward: true, jump: i === 0 }));
      if (actor.onGround && Math.abs(actor.pos.y - top) < 1e-6) stoodOnTop = true;
    }
    // The raw apex (JUMP_VELOCITY^2 / 2g ~ 1.125) cannot clear the 1.35 rim:
    // only the mantle assist puts the body on top.
    expect(JUMP_VELOCITY ** 2 / (2 * GRAVITY)).toBeLessThan(0.878 * 1.3); // min crate top
    expect(stoodOnTop).toBe(true);
    // ...and momentum carried the run over and beyond the crate.
    expect(actor.pos.z).toBeGreaterThan(crateZ + 1.2);
    expect(actor.onGround).toBe(true);
    expect(actor.pos.y).toBeCloseTo(groundHeight(actor.pos.x, actor.pos.z, SEED), 6);
  });

  it('walking off a crate keeps horizontal momentum through the fall', () => {
    const crateZ = COURSE.z0 + 5;
    setActiveWorldContent(world({ crates: [[CX, crateZ]] }));
    const sim = makeSim();
    const deps = clientDeps(SEED);
    teleport(sim, CX, crateZ);
    const actor = mirrorActor(sim);
    actor.pos.y = groundHeight(CX, crateZ, SEED) + campCrateShape(CX, crateZ, 0).top;
    actor.prevPos = { ...actor.pos };
    actor.fallStartY = actor.pos.y;

    let leftAt: number | null = null;
    let zWhenLeft = 0;
    for (let i = 0; i < 40; i++) {
      actor.prevPos = { ...actor.pos };
      stepPlayerMotion(deps, actor, mi({ forward: true }));
      if (leftAt === null && !actor.onGround) {
        leftAt = i;
        zWhenLeft = actor.pos.z;
        expect(actor.vz).toBeGreaterThan(1); // momentum, not the old dead drop
      }
    }
    expect(leftAt).not.toBeNull();
    expect(actor.onGround).toBe(true);
    // Kept moving forward while falling.
    expect(actor.pos.z).toBeGreaterThan(zWhenLeft + 0.5);
  });

  it('coyote time: a jump just after walking off still fires, a late one does not', () => {
    const crateZ = COURSE.z0 + 5;
    setActiveWorldContent(world({ crates: [[CX, crateZ]] }));
    const sim = makeSim();
    const deps = clientDeps(SEED);

    const walkOff = (jumpDelay: number): Entity => {
      teleport(sim, CX, crateZ);
      const actor = mirrorActor(sim);
      actor.pos.y = groundHeight(CX, crateZ, SEED) + campCrateShape(CX, crateZ, 0).top;
      actor.prevPos = { ...actor.pos };
      actor.fallStartY = actor.pos.y;
      let airborneTicks = -1;
      for (let i = 0; i < 40; i++) {
        actor.prevPos = { ...actor.pos };
        if (airborneTicks >= 0) airborneTicks++;
        const jump = airborneTicks === jumpDelay;
        stepPlayerMotion(deps, actor, mi({ forward: airborneTicks < 0, jump }));
        if (airborneTicks < 0 && !actor.onGround) airborneTicks = 0;
        if (jump) return actor;
      }
      throw new Error('never reached the jump tick');
    };

    // One tick after leaving the ledge: inside the coyote window, jump fires
    // (vy ends the tick at JUMP_VELOCITY minus one gravity step).
    const early = walkOff(1);
    expect(early.vy).toBeCloseTo(JUMP_VELOCITY - GRAVITY * (1 / 20), 6);
    expect(early.jumping).toBe(true);

    // Past the window: the input is ignored and the fall continues.
    const lateDelay = Math.ceil(COYOTE_TIME * 20) + 2;
    const late = walkOff(lateDelay);
    expect(late.vy).toBeLessThan(0);
    expect(late.jumping).toBe(false);
  });

  it('never double-jumps: a held jump through a full arc launches exactly once', () => {
    setActiveWorldContent(world({}));
    const sim = makeSim();
    const deps = clientDeps(SEED);
    teleport(sim, CX, COURSE.z0 + 5);
    const actor = mirrorActor(sim);
    let launches = 0;
    let prevVy = 0;
    for (let i = 0; i < 40; i++) {
      actor.prevPos = { ...actor.pos };
      stepPlayerMotion(deps, actor, mi({ jump: true }));
      // A launch is the only way vy can RISE to a positive value while jump is
      // held: gravity only lowers it between launches and a landing resets it
      // to exactly 0. This fails if the coyote window (vy in
      // (0, -GRAVITY*COYOTE_TIME]) ever re-fires mid-descent.
      if (actor.vy > prevVy + 1e-9 && actor.vy > 0) launches++;
      prevVy = actor.vy;
      if (launches === 1 && actor.onGround) break; // full arc completed
    }
    expect(launches).toBe(1);
    expect(actor.onGround).toBe(true);
  });

  it('denies the coyote jump while hanging over unwalkably steep terrain', () => {
    setActiveWorldContent(world({}));
    const sim = makeSim();
    const deps = clientDeps(SEED);
    const steep = findSteepFooting(SEED);

    // Airborne one gravity-tick after a walk-off, over the steep face: denied.
    teleport(sim, steep.x, steep.z);
    const overCliff = mirrorActor(sim);
    overCliff.pos.y += 0.5;
    overCliff.prevPos = { ...overCliff.pos };
    overCliff.onGround = false;
    overCliff.jumping = false;
    overCliff.vy = -0.5;
    stepPlayerMotion(deps, overCliff, mi({ jump: true }));
    expect(overCliff.jumping).toBe(false);
    expect(overCliff.vy).toBeLessThan(0);

    // The same state over the flat course: the coyote jump fires.
    teleport(sim, CX, COURSE.z0 + 5);
    const overFlat = mirrorActor(sim);
    overFlat.pos.y += 0.5;
    overFlat.prevPos = { ...overFlat.pos };
    overFlat.onGround = false;
    overFlat.jumping = false;
    overFlat.vy = -0.5;
    stepPlayerMotion(deps, overFlat, mi({ jump: true }));
    expect(overFlat.jumping).toBe(true);
    expect(overFlat.vy).toBeCloseTo(JUMP_VELOCITY - GRAVITY * (1 / 20), 6);
  });

  it('air control steers a jump started in place; no input stays in place', () => {
    setActiveWorldContent(world({}));
    const sim = makeSim();
    const deps = clientDeps(SEED);
    const startZ = COURSE.z0 + 5;

    // No input after takeoff: a vertical hop lands where it started.
    teleport(sim, CX, startZ);
    const still = mirrorActor(sim);
    run(still, deps, 30, (i) => mi({ jump: i === 0 }));
    expect(still.onGround).toBe(true);
    expect(still.pos.x).toBeCloseTo(CX, 6);
    expect(still.pos.z).toBeCloseTo(startZ, 6);

    // Holding forward from mid-air steers the same hop well forward.
    teleport(sim, CX, startZ);
    const steered = mirrorActor(sim);
    run(steered, deps, 30, (i) => mi({ jump: i === 0, forward: i >= 2 }));
    expect(steered.pos.z).toBeGreaterThan(startZ + 1);
  });
});

describe('parkour course parity: kernel vs live Sim, bit for bit', () => {
  it('runs the campfire-and-crate course identically in both hosts', () => {
    const fireZ = COURSE.z0 + 4;
    const crateZ = COURSE.z0 + 10;
    setActiveWorldContent(world({ campfires: [[COURSE.x, fireZ]], crates: [[COURSE.x, crateZ]] }));
    const sim = makeSim();
    const deps = clientDeps(SEED);
    teleport(sim, COURSE.x, COURSE.z0 + 1);
    const actor = mirrorActor(sim);
    const meta = sim.players.get(sim.player.id);
    if (!meta) throw new Error('missing player meta');

    for (let i = 0; i < 120; i++) {
      // Jump at the fire edge, then again at the crate approach; held forward
      // throughout. Held jump also re-fires on landings, exercising the
      // mantle, the drop-off, and the coyote/air-control arms in both hosts.
      const input = mi({ forward: true, jump: i >= 20 && i <= 90 });
      Object.assign(meta.moveInput, input);
      actor.prevPos = { ...actor.pos };
      stepPlayerMotion(deps, actor, input);
      sim.tick();
      const p = sim.player;
      expect(actor.pos.x, `tick ${i}: pos.x`).toBe(p.pos.x);
      expect(actor.pos.y, `tick ${i}: pos.y`).toBe(p.pos.y);
      expect(actor.pos.z, `tick ${i}: pos.z`).toBe(p.pos.z);
      expect(actor.vy, `tick ${i}: vy`).toBe(p.vy);
      expect(actor.onGround, `tick ${i}: onGround`).toBe(p.onGround);
    }
    // The course was actually traversed: past the crate, back on the terrain.
    expect(sim.player.pos.z).toBeGreaterThan(crateZ + 1);
  });
});

describe('step-up cannot manufacture speed', () => {
  // The step commit advances the body up to STEP_COMMIT_DISTANCE while
  // consuming only the remaining motion, so a single step-up can gain a
  // fraction of one tick's run. This pins that the gain cannot COMPOUND: a
  // whole staircase of kerbs crossed at a held run stays within a bounded
  // margin of the same run on flat ground.
  it('a staircase of kerbs averages within 5 percent of flat run speed', () => {
    const CX = COURSE.x;
    const distanceOver = (benches: WorldContent['props']['benches']): number => {
      setActiveWorldContent(world({ benches }));
      const sim = makeSim();
      teleport(sim, CX, COURSE.z0 + 1);
      const meta = sim.players.get(sim.player.id);
      if (!meta) throw new Error('no meta');
      const startZ = sim.player.pos.z;
      for (let i = 0; i < 80; i++) {
        Object.assign(meta.moveInput, mi({ forward: true }));
        sim.tick();
      }
      return sim.player.pos.z - startZ;
    };
    // Kerb-height standables (the civic bench draws 0.40 tall, well inside
    // MAX_STEP_HEIGHT) laid across the lane every 1.8 yd: every crossing is
    // a fresh step-up commit (up, along the seat, off the far side).
    const staircase = Array.from({ length: 8 }, (_, i) => ({
      id: `kerb_${i}`,
      assetId: '/models/dungeon/bench.glb',
      x: CX,
      z: COURSE.z0 + 3 + i * 1.8,
      w: 1.8,
      d: 0.6,
      rot: 0,
      height: 1,
    }));
    const course = distanceOver(staircase);
    const flat = distanceOver([]);
    expect(course).toBeGreaterThan(flat * 0.5); // the staircase was crossed
    expect(course).toBeLessThanOrEqual(flat * 1.05);
  });
});
