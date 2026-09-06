import { afterEach, describe, expect, it } from 'vitest';
import { isBlocked, moverHeight, resolveMovement } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { moveSpeedMult, type PlayerMotionDeps, stepPlayerMotion } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import type { Entity, MoveInput, WorldContent } from '../src/sim/types';
import {
  groundHeight,
  terrainDownhill,
  terrainHeight,
  terrainSteepnessAt,
  WATER_LEVEL,
} from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// Bug: a grounded body that stood on a standable prop top (a bridge deck, a
// sunk rock) kept following that top through the slope-glue branch even
// where the terrain rose ABOVE it, so a walk up the hillside next to the
// prop seated the player under the ground, walled in by the terrain gate
// on every side ("fell through the ground walking down the slope; only
// Heroic Leap got me out"). The terrain is always the floor: a glued top
// below it must hand the body back to the terrain, never bury it.

const SEED = 42;

afterEach(() => {
  setActiveWorldContent(null);
});

function world(props: Partial<WorldContent['props']>): WorldContent {
  return { ...BUILTIN_WORLD, props: { ...BUILTIN_WORLD.props, ...props } };
}

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

const mi = (over: Partial<MoveInput> = {}): MoveInput => ({
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
  dive: false,
  surface: false,
  ...over,
});

function actorAt(sim: Sim, x: number, z: number, y: number, facing: number): Entity {
  const p = sim.player;
  const a: Entity = { ...p, pos: { x, y, z }, prevPos: { x, y, z } };
  a.fallStartY = y;
  a.facing = facing;
  a.onGround = true;
  a.jumping = false;
  a.vx = 0;
  a.vz = 0;
  a.vy = 0;
  return a;
}

// Walk `ticks` forward: the deepest the grounded feet ever sat below the
// terrain (0 when they never did), the highest the body climbed, and how
// many grounded ticks a prop top (not the terrain) carried the feet. The
// last one anchors a shipped-world pin: a walk that never stood on the
// planks proves nothing about the glue.
function walk(
  deps: PlayerMotionDeps,
  a: Entity,
  ticks: number,
): { buried: number; peakY: number; onPropTicks: number } {
  let buried = 0;
  let peakY = -Infinity;
  let onPropTicks = 0;
  for (let i = 0; i < ticks; i++) {
    a.prevPos = { ...a.pos };
    stepPlayerMotion(deps, a, mi({ forward: true }));
    if (a.onGround) {
      const ground = groundHeight(a.pos.x, a.pos.z, deps.seed);
      buried = Math.max(buried, ground - a.pos.y);
      peakY = Math.max(peakY, a.pos.y);
      if (a.pos.y > ground + 1e-3) onPropTicks++;
    }
  }
  return { buried, peakY, onPropTicks };
}

// Drop a body onto whatever is under it the way a real landing does.
function settle(deps: PlayerMotionDeps, a: Entity): void {
  a.onGround = false;
  for (let i = 0; i < 100 && !a.onGround; i++) {
    a.prevPos = { ...a.pos };
    a.fallStartY = a.pos.y;
    stepPlayerMotion(deps, a, mi());
  }
}

// A walkable hillside (steeper than the glue's per-tick tolerance can hide,
// shallower than the climb gate) with room for a wide prop and a run uphill.
function findHillside(seed: number): { x: number; z: number; uphill: { x: number; z: number } } {
  for (let x = -120; x <= 120; x += 2) {
    for (let z = -120; z <= 120; z += 2) {
      if (terrainHeight(x, z, seed) < WATER_LEVEL + 3) continue;
      const steep = terrainSteepnessAt(x, z, seed);
      if (steep < 0.8 || steep > 1.2) continue;
      const down = terrainDownhill(x, z, seed);
      if (!down) continue;
      const ux = -down.x;
      const uz = -down.z;
      let clear = true;
      for (let d = -4; d <= 10 && clear; d += 1) {
        const px = x + ux * d;
        const pz = z + uz * d;
        if (terrainHeight(px, pz, seed) < WATER_LEVEL + 1) clear = false;
        if (isBlocked(seed, px, pz, 1.2)) clear = false;
        const s = terrainSteepnessAt(px, pz, seed);
        if (s > 1.3) clear = false;
      }
      if (clear) return { x, z, uphill: { x: ux, z: uz } };
    }
  }
  throw new Error('no hillside found');
}

describe('slope glue never seats a body below the terrain', () => {
  it('walking uphill off a prop top the hillside buries hands the body to the terrain', () => {
    const hill = findHillside(SEED);
    const top = 1.0;
    setActiveWorldContent(
      world({
        decorProps: [
          { key: 'hexCannonballs', x: hill.x, z: hill.z, scale: 5, r: 3, standableTop: top },
        ],
      }),
    );
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(60);
    const deps = clientDeps(SEED);
    const topY = groundHeight(hill.x, hill.z, SEED) + top;
    // The disc's uphill rim is under the hillside: that is the trap.
    const rimX = hill.x + hill.uphill.x * 3;
    const rimZ = hill.z + hill.uphill.z * 3;
    expect(groundHeight(rimX, rimZ, SEED)).toBeGreaterThan(topY + 0.5);

    const facing = Math.atan2(hill.uphill.x, hill.uphill.z);
    const a = actorAt(sim, hill.x, hill.z, topY, facing);
    const { buried, peakY } = walk(deps, a, 60);
    expect(buried).toBeLessThanOrEqual(1e-6);
    // ...and the walk actually carried the body up the hillside above the
    // prop top, so the assertion is exercising the hand-off, not a stall.
    expect(peakY).toBeGreaterThan(topY + 0.5);
    expect(a.onGround).toBe(true);
    expect(a.pos.y).toBeCloseTo(groundHeight(a.pos.x, a.pos.z, SEED), 6);
  });

  // The bridge planks at (444.1, 2197.75) sit under the mainland shore
  // slope at their far end; the sweep that found this bug walked down the
  // shore across them and sat 2.9 yd under the ground on the far side.
  const DECK = { x: 444.1, z: 2197.75 };
  const SHORE = { x: 437.35, z: 2193.85 };
  // Where the buried walk ended: plain terrain over the planks' far end.
  const FAR_BANK = { x: 448.26, z: 2200.15 };

  function shippedActor(sim: Sim, from: { x: number; z: number }, to: { x: number; z: number }) {
    const deps = clientDeps(WORLD_SEED);
    const facing = Math.atan2(to.x - from.x, to.z - from.z);
    const a = actorAt(sim, from.x, from.z, groundHeight(from.x, from.z, WORLD_SEED) + 3, facing);
    settle(deps, a);
    expect(a.onGround).toBe(true);
    // A plain terrain start: nothing but the ground under the feet.
    expect(a.pos.y).toBeCloseTo(groundHeight(from.x, from.z, WORLD_SEED), 6);
    return { deps, a };
  }

  it('shipped world: walking down the Drakelands shore across the bridge planks never swallows the walker', () => {
    setActiveWorldContent(null);
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(60);
    const { deps, a } = shippedActor(sim, SHORE, DECK);
    const { buried, onPropTicks } = walk(deps, a, 60);
    expect(onPropTicks).toBeGreaterThan(5); // the planks really carried the feet
    expect(buried).toBeLessThanOrEqual(1e-6);
    expect(a.pos.y).toBeCloseTo(groundHeight(a.pos.x, a.pos.z, WORLD_SEED), 6);
  });

  it('shipped world: the mirror walk back down onto the planks lands on them, no invisible wall', () => {
    // The hand-off must be two-sided: from the far bank the body walks back
    // down the slope and steps onto the planks where they emerge from the
    // ground, instead of stalling against them or sinking under them.
    setActiveWorldContent(null);
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(60);
    const { deps, a } = shippedActor(sim, FAR_BANK, DECK);
    const { buried, onPropTicks } = walk(deps, a, 60);
    expect(buried).toBeLessThanOrEqual(1e-6);
    expect(onPropTicks).toBeGreaterThan(5);
    const travelled = Math.hypot(a.pos.x - FAR_BANK.x, a.pos.z - FAR_BANK.z);
    expect(travelled).toBeGreaterThan(12);
  });
});
