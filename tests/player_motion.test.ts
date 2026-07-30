import { describe, expect, it } from 'vitest';
import { isBlocked, moverHeight, resolveMovement } from '../src/sim/colliders';
import { BUILTIN_WORLD } from '../src/sim/data';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { moveSpeedMult, type PlayerMotionDeps, stepPlayerMotion } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import type { Entity, MoveInput, WorldContent } from '../src/sim/types';
import {
  groundHeight,
  terrainHeight,
  terrainSteepness,
  terrainSteepnessAt,
  terrainWallStandoff,
  WATER_LEVEL,
} from '../src/sim/world';
import { wallFootFixture } from './helpers/wall_foot';

// The parity gate for the movement-kernel extraction (MV1) and the foundation
// of the online self extrapolator: stepPlayerMotion driven with CLIENT-shaped
// deps (pure resolveMovement, moveSpeedMult(e, 0), no-op callbacks) must
// reproduce the live Sim's player movement tick for tick, bit for bit. If a
// future kernel or Sim change forks the two paths, this fails.

const SEED = 42;
const CLIMB_LIMIT = 1.5;

// Every assertion here compares the live player pose against the kernel mirror
// (terrain, colliders, water); ambient camps/npcs/ground objects never appear in
// an assertion, so strip them (dot_final_tick pattern) to keep each tick cheap.
const MOTION_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function makeSim(): Sim {
  const sim = new Sim({
    seed: SEED,
    playerClass: 'warrior',
    autoEquip: true,
    world: MOTION_TEST_WORLD,
  });
  sim.setPlayerLevel(60); // mobs along the routes must not decide these tests
  return sim;
}

function teleport(sim: Sim, x: number, z: number): void {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  p.fallStartY = p.pos.y;
  p.onGround = true;
  p.vx = 0;
  p.vz = 0;
  p.vy = 0;
}

// The client dep shape: pure static collision, aura-only speed, no live-Sim
// callbacks. Mirrors what src/render/self_motion.ts binds.
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

// Scratch actor: a shallow Entity clone owning its pose/velocity while sharing
// the aura array (the client reads the mirrored auras the same way).
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

// Advance both worlds one tick with the same held input and assert the poses
// stayed identical. The sim snapshots prevPos at tick start (entity_roster's
// despawn-decay pass); the kernel harness mirrors that.
function tickBoth(sim: Sim, actor: Entity, deps: PlayerMotionDeps, input: MoveInput): void {
  const meta = sim.players.get(sim.player.id);
  if (!meta) throw new Error('missing player meta');
  Object.assign(meta.moveInput, input);
  actor.prevPos = { ...actor.pos };
  stepPlayerMotion(deps, actor, input);
  sim.tick();
}

function expectSamePose(sim: Sim, actor: Entity, label: string): void {
  const p = sim.player;
  expect(actor.pos.x, `${label}: pos.x`).toBe(p.pos.x);
  expect(actor.pos.y, `${label}: pos.y`).toBe(p.pos.y);
  expect(actor.pos.z, `${label}: pos.z`).toBe(p.pos.z);
  expect(actor.facing, `${label}: facing`).toBe(p.facing);
  expect(actor.vy, `${label}: vy`).toBe(p.vy);
  expect(actor.onGround, `${label}: onGround`).toBe(p.onGround);
}

function runParity(sim: Sim, input: MoveInput, ticks: number, label: string): void {
  const deps = clientDeps(SEED);
  const actor = mirrorActor(sim);
  for (let i = 0; i < ticks; i++) {
    tickBoth(sim, actor, deps, input);
    expectSamePose(sim, actor, `${label} tick ${i}`);
  }
}

// A steep on-wall footing for the slide/uphill gates (same scan as
// tests/climb_slope.test.ts, trimmed: first dry, collider-free, steep point
// on the west rim away from camps).
function findSteepFooting(seed: number): { x: number; z: number } {
  for (let z = -60; z <= 820; z += 7) {
    for (let x = -130; x >= -184; x -= 0.25) {
      if (terrainHeight(x, z, seed) < WATER_LEVEL + 0.5) break;
      if (isBlocked(seed, x, z, 0.6)) break;
      if (terrainSteepness(x, z, seed) > CLIMB_LIMIT + 0.4) return { x, z };
    }
  }
  throw new Error('no steep footing found');
}

// A deep-water spot: ground well under the water line, no colliders.
function findDeepWater(seed: number): { x: number; z: number } {
  for (let z = -300; z <= 300; z += 8) {
    for (let x = -300; x <= 300; x += 8) {
      if (terrainHeight(x, z, seed) < WATER_LEVEL - 1.2 && !isBlocked(seed, x, z, 1)) {
        return { x, z };
      }
    }
  }
  throw new Error('no deep water found');
}

describe('player motion kernel parity with the live Sim', () => {
  it('runs all 8 wish directions on flat ground identically', () => {
    const dirs: Partial<MoveInput>[] = [
      { forward: true },
      { back: true },
      { strafeLeft: true },
      { strafeRight: true },
      { forward: true, strafeLeft: true },
      { forward: true, strafeRight: true },
      { back: true, strafeLeft: true },
      { back: true, strafeRight: true },
    ];
    for (const d of dirs) {
      const sim = makeSim();
      teleport(sim, 0, -40); // flat vale ground near the hub
      sim.player.facing = 0.7;
      runParity(sim, mi(d), 20 * 3, JSON.stringify(d));
    }
  });

  it('integrates keyboard turns identically (turn while running)', () => {
    const sim = makeSim();
    teleport(sim, 0, -40);
    runParity(sim, mi({ forward: true, turnLeft: true }), 20 * 3, 'turnLeft+forward');
    runParity(sim, mi({ turnRight: true }), 20 * 2, 'turnRight in place');
  });

  it('applies the backpedal multiplier identically', () => {
    const sim = makeSim();
    teleport(sim, 0, -40);
    const before = { ...sim.player.pos };
    runParity(sim, mi({ back: true }), 20 * 2, 'backpedal');
    expect(Math.hypot(sim.player.pos.x - before.x, sim.player.pos.z - before.z)).toBeGreaterThan(1);
  });

  it('reproduces the jump arc, landing, and post-landing run identically', () => {
    const sim = makeSim();
    teleport(sim, 0, -40);
    const deps = clientDeps(SEED);
    const actor = mirrorActor(sim);
    tickBoth(sim, actor, deps, mi({ forward: true, jump: true }));
    expectSamePose(sim, actor, 'jump launch');
    expect(sim.player.onGround).toBe(false);
    for (let i = 0; i < 20 * 3; i++) {
      tickBoth(sim, actor, deps, mi({ forward: true }));
      expectSamePose(sim, actor, `jump arc tick ${i}`);
    }
    expect(sim.player.onGround).toBe(true);
  });

  it('crosses varied terrain (road pass climb) identically', () => {
    const sim = makeSim();
    teleport(sim, 0, 160);
    sim.player.facing = 0; // north, straight up the pass
    runParity(sim, mi({ forward: true }), 20 * 10, 'road pass');
    expect(sim.player.pos.z).toBeGreaterThan(200); // actually travelled
  });

  it('blocks uphill walls and slides off steep footing identically', () => {
    const sim = makeSim();
    const spot = findSteepFooting(SEED);
    teleport(sim, spot.x, spot.z);
    // slide down off the steep band, then keep pushing west into the wall
    runParity(sim, mi(), 20 * 8, 'steep slide');
    sim.player.facing = -Math.PI / 2; // west, into the rim wall
    const actor2pos = { ...sim.player.pos };
    runParity(sim, mi({ forward: true, jump: true }), 20 * 5, 'uphill push');
    expect(sim.player.pos.x).toBeGreaterThan(actor2pos.x - 40); // never crested the rim
  });

  it('routes terrain wall standoff through the collision sweep', () => {
    const standoffSeed = 20061;
    const sim = new Sim({
      seed: standoffSeed,
      playerClass: 'warrior',
      autoEquip: true,
      world: MOTION_TEST_WORLD,
    });
    // A pinned wall foot validated against the generated heightfield (the strip
    // world's old western-rim literal is open ground in the 2D atlas-grid world).
    const foot = wallFootFixture(standoffSeed, PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE);
    const start = { x: foot.x, z: foot.z };
    teleport(sim, start.x, start.z);
    expect(terrainSteepnessAt(start.x, start.z, standoffSeed)).toBeLessThan(1.0);

    const actor = mirrorActor(sim);
    let swept = false;
    const deps: PlayerMotionDeps = {
      ...clientDeps(standoffSeed),
      resolveMove: (fromX, fromZ, nx, nz, _r, _e, ignoreFences) => {
        swept = true;
        expect(fromX).toBe(start.x);
        expect(fromZ).toBe(start.z);
        expect(Math.hypot(nx - fromX, nz - fromZ)).toBeGreaterThan(0.1);
        expect(ignoreFences).toBe(false);
        return { x: fromX, z: fromZ };
      },
    };

    stepPlayerMotion(deps, actor, mi());

    expect(swept).toBe(true);
    expect(actor.pos.x).toBe(start.x);
    expect(actor.pos.z).toBe(start.z);
  });

  it('enters deep water, treads the surface, and shore-hops identically', () => {
    const sim = makeSim();
    const spot = findDeepWater(SEED);
    teleport(sim, spot.x, spot.z);
    // first ticks settle onto the swim surface, then swim forward and hop
    runParity(sim, mi(), 5, 'settle to surface');
    runParity(sim, mi({ forward: true }), 20 * 3, 'swim forward');
    runParity(sim, mi({ forward: true, jump: true }), 20 * 2, 'shore hop');
  });

  it('runs at ghost speed identically (snare-immune multiplier)', () => {
    const sim = makeSim();
    teleport(sim, 0, -40);
    sim.player.ghost = true;
    runParity(sim, mi({ forward: true }), 20 * 2, 'ghost run');
  });

  it('is deterministic: the same kernel trajectory twice', () => {
    const trace = (): string => {
      const sim = makeSim();
      teleport(sim, 0, -40);
      const deps = clientDeps(SEED);
      const actor = mirrorActor(sim);
      const out: number[] = [];
      for (let i = 0; i < 60; i++) {
        actor.prevPos = { ...actor.pos };
        stepPlayerMotion(deps, actor, mi({ forward: true, turnLeft: i % 2 === 0, jump: i === 20 }));
        out.push(actor.pos.x, actor.pos.y, actor.pos.z, actor.facing);
      }
      return JSON.stringify(out);
    };
    expect(trace()).toBe(trace());
  });
});

// The wall-standoff ACCEPTANCE GATE inside stepPlayerMotion (distinct from the
// terrainWallStandoff iteration itself, covered by
// tests/terrain_wall_standoff.test.ts): committing a push once it strictly
// improves on the player's current steepness, not only once it fully clears
// the climb limit. Pinned at a concave pocket (production seed 20061, 2D
// atlas-grid world) where a single standoff resolves the player to steepness
// ~1.56, well over the ~1.5 climb limit, but a strict improvement over the
// ~10.14 the player started at. The OLD gate (accept only if standSteep <=
// climb limit) would have discarded this push outright, leaving the player
// wedged; the NEW gate (accept if standSteep <= climb limit OR standSteep <=
// current steepness) commits it.
describe('stepPlayerMotion wall-standoff acceptance gate', () => {
  const GATE_SEED = 20061; // the fixed production seed (src/main.ts, server/game.ts)
  const GATE_R = PLAYER_BODY_RADIUS;
  const GATE_SLOPE = PLAYER_MAX_CLIMB_SLOPE;
  const PIN = { x: -620, z: -172 };

  it('commits a standoff push that strictly improves steepness but stays above the climb limit', () => {
    const steepStart = terrainSteepnessAt(PIN.x, PIN.z, GATE_SEED);
    const standoff = terrainWallStandoff(PIN.x, PIN.z, GATE_SEED, GATE_R, GATE_SLOPE);
    const steepStand = terrainSteepnessAt(standoff.x, standoff.z, GATE_SEED);
    // Pin the scenario itself: still above the climb limit (so the OLD gate,
    // which only ever accepted full clearance, would reject this push), but a
    // strict improvement over the starting steepness (so the NEW gate accepts).
    expect(steepStand).toBeGreaterThan(GATE_SLOPE);
    expect(steepStand).toBeLessThan(steepStart);

    // Drive the real gate via stepPlayerMotion. The player's own position is
    // steep enough here to also trigger the downhill-slide movement earlier in
    // the same tick (a separate code path from the standoff gate under test).
    // That slide no longer routes through this dep: the open-world horizontal
    // step resolves inside the physics kernel (src/sim/physics/character.ts),
    // and PlayerMotionDeps.resolveMove now serves the instanced path and the
    // standoff pass only. So there is nothing left to stub out by call order,
    // and the assertions below measure the standoff FROM the slid position
    // rather than from the pin.
    const deps: PlayerMotionDeps = {
      seed: GATE_SEED,
      moveSpeedMult: (e) => moveSpeedMult(e, 0),
      resolveMove: (fromX, fromZ, nx, nz, r, _e, ignoreFences) =>
        resolveMovement(GATE_SEED, fromX, fromZ, nx, nz, r, ignoreFences),
      resolvedAbility: () => null,
      cancelCast: () => {},
      standUp: () => {},
      dealDamage: () => {},
    };
    const p = {
      pos: { x: PIN.x, z: PIN.z, y: groundHeight(PIN.x, PIN.z, GATE_SEED) },
      prevPos: { x: PIN.x, z: PIN.z, y: groundHeight(PIN.x, PIN.z, GATE_SEED) },
      facing: 0,
      onGround: true,
      jumping: false,
      vx: 0,
      vz: 0,
      vy: 0,
      fallStartY: groundHeight(PIN.x, PIN.z, GATE_SEED),
      auras: [],
      sitting: false,
      maxHp: 100,
    } as unknown as Entity;

    stepPlayerMotion(deps, p, mi());

    // The gate committed. Stated as three claims rather than one coordinate
    // equality: the tick's downhill slide runs inside the physics kernel now
    // and is allowed to move the body a little before the standoff pass sees
    // it, so an exact-point pin would be measuring the slide, not the gate.
    //
    // The pin sits a full yard from the standoff point and the body radius is
    // half that, so "within a body radius of the standoff" still fails outright
    // if the push is discarded and the body is left wedged at the pin.
    expect(p.pos.x === PIN.x && p.pos.z === PIN.z).toBe(false);
    expect(Math.hypot(p.pos.x - standoff.x, p.pos.z - standoff.z)).toBeLessThan(GATE_R);
    // ...and the push really improved things, which is the acceptance rule
    // under test: the OLD gate would have rejected this one for still being
    // over the climb limit.
    const steepEnd = terrainSteepnessAt(p.pos.x, p.pos.z, GATE_SEED);
    expect(steepEnd).toBeLessThan(steepStart);
    expect(steepEnd).toBeGreaterThan(GATE_SLOPE);
  });
});
