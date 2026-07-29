import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { PLAYER_SWIM_DEPTH } from '../src/sim/pathfind';
import { moveSpeedMult, type PlayerMotionDeps, stepPlayerMotion } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import type { Entity, HeightStamp, MoveInput, WorldContent } from '../src/sim/types';
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';

// Players must never be eternally stuck in water. Two field-reported traps, both
// born of the movement kernel gating slopes on the RAW lakebed height while the
// body actually rides at (or near) the water surface:
//
// 1. A shallow pocket (uneven ground under the water, e.g. where map seams
//    cross a waterway): too shallow to swim out (depth < PLAYER_SWIM_DEPTH),
//    with a submerged rim too steep to walk or jump up. The climb gate blocks
//    every exit forever.
// 2. A steep shoreline: swimming to shore transitions to wading, then the raw
//    bed slope blocks the walk up and out, wedging the player at the waterline.
//
// The fix mirrors pathfind.ts rideHeight: for slope/steepness gating, submerged
// ground is clamped to the waterline (a bumpy lake bed is not a cliff), and a
// swimmer or wader can step out onto a low standable bank near the surface.
// Dry-land climbing rules must stay byte-identical (last test).

const SEED = 42;
const TPS = 20; // ticks per second (DT = 1/20)

// Sculpt trap terrain with level stamps inside the built-in zone 1 lake
// (declared water body at -92, 88, r30), the same authoring surface the map
// editor uses, so waterLevelAt() is live over every stamped cell.
const LAKE = { x: -92, z: 88 };

function motionWorld(terrainEdits: HeightStamp[]): WorldContent {
  return {
    ...BUILTIN_WORLD,
    camps: [],
    npcs: {},
    groundObjects: [],
    terrainEdits,
  };
}

// terrainEdits are terrain-relevant, so the active content and cfg.world must
// agree (see the INVARIANT note in the Sim ctor).
function makeSim(world: WorldContent): Sim {
  setActiveWorldContent(world);
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true, world });
  sim.setPlayerLevel(60);
  return sim;
}

afterEach(() => setActiveWorldContent(null));

function teleport(sim: Sim, x: number, z: number, facing: number): void {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  p.fallStartY = p.pos.y;
  p.facing = facing;
  p.onGround = true;
  p.vx = 0;
  p.vz = 0;
  p.vy = 0;
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

function hold(sim: Sim, input: MoveInput, ticks: number): void {
  const meta = sim.players.get(sim.player.id);
  if (!meta) throw new Error('missing player meta');
  Object.assign(meta.moveInput, input);
  for (let i = 0; i < ticks; i++) sim.tick();
  Object.assign(meta.moveInput, mi());
}

// Trap 1: a wading-depth pocket sunk into a shallow submerged shelf. The rim
// rises 0.65yd in place (steeper than one tick's climbable rise), everything
// stays under the waterline, and the pocket floor is a hair too shallow to
// swim over.
const POCKET_EDITS: HeightStamp[] = [
  { x: LAKE.x, z: LAKE.z, radius: 8, delta: WATER_LEVEL - 0.1, falloff: 'flat', mode: 'level' },
  { x: LAKE.x, z: LAKE.z, radius: 3, delta: WATER_LEVEL - 0.75, falloff: 'flat', mode: 'level' },
];

// Trap 2: a steep concentric shoreline. Deep water to the west, then rising
// steps through the wading band, topped by a dry standable lip 0.6yd above the
// waterline.
const BANK = { x: -78, z: 88 };
const SHORE_EDITS: HeightStamp[] = [
  { x: BANK.x, z: BANK.z, radius: 12, delta: WATER_LEVEL - 2.0, falloff: 'flat', mode: 'level' },
  { x: BANK.x, z: BANK.z, radius: 9, delta: WATER_LEVEL - 1.3, falloff: 'flat', mode: 'level' },
  { x: BANK.x, z: BANK.z, radius: 7, delta: WATER_LEVEL - 0.65, falloff: 'flat', mode: 'level' },
  { x: BANK.x, z: BANK.z, radius: 5, delta: WATER_LEVEL - 0.05, falloff: 'flat', mode: 'level' },
  { x: BANK.x, z: BANK.z, radius: 3.5, delta: WATER_LEVEL + 0.6, falloff: 'flat', mode: 'level' },
];

// Kernel-direct harness: a scratch actor stepped with pass-through collision,
// so terrain gate behavior is isolated from decorations and prop slides.
function kernelActor(sim: Sim): Entity {
  return { ...sim.player, pos: { ...sim.player.pos }, prevPos: { ...sim.player.prevPos } };
}

function kernelDeps(): PlayerMotionDeps {
  return {
    seed: SEED,
    moveSpeedMult: (e) => moveSpeedMult(e, 0),
    resolveMove: (_fx, _fz, nx, nz) => ({ x: nx, z: nz }),
    resolvedAbility: () => null,
    cancelCast: () => {},
    standUp: () => {},
    dealDamage: () => {},
  };
}

function stepTicks(actor: Entity, deps: PlayerMotionDeps, input: MoveInput, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    actor.prevPos = { ...actor.pos };
    stepPlayerMotion(deps, actor, input);
  }
}

describe('players can always leave the water (stuck-in-water traps)', () => {
  it('walks out of a shallow steep-rimmed pocket (uneven submerged ground)', () => {
    const sim = makeSim(motionWorld(POCKET_EDITS));
    teleport(sim, LAKE.x, LAKE.z, Math.PI / 2); // facing east

    // sanity: the pocket floor is wading depth, not swimmable
    const floor = terrainHeight(LAKE.x, LAKE.z, SEED);
    expect(floor).toBeCloseTo(WATER_LEVEL - 0.75, 5);
    expect(floor).toBeGreaterThan(WATER_LEVEL - PLAYER_SWIM_DEPTH);

    hold(sim, mi({ forward: true }), TPS * 10);
    const p = sim.player;
    const dist = Math.hypot(p.pos.x - LAKE.x, p.pos.z - LAKE.z);
    expect(dist, 'escaped the 3yd pocket rim').toBeGreaterThan(4);
  });

  // Passes before the fix too (a flat rim within jump reach is escapable by
  // hopping); pinned so the fix never regresses the jump route.
  it('jump input does not wedge a wading player either', () => {
    const sim = makeSim(motionWorld(POCKET_EDITS));
    teleport(sim, LAKE.x, LAKE.z, Math.PI / 2);
    hold(sim, mi({ forward: true, jump: true }), TPS * 10);
    const p = sim.player;
    const dist = Math.hypot(p.pos.x - LAKE.x, p.pos.z - LAKE.z);
    expect(dist, 'escaped the 3yd pocket rim while jumping').toBeGreaterThan(4);
  });

  it('swims to a steep shoreline and climbs out onto a low standable bank', () => {
    const sim = makeSim(motionWorld(SHORE_EDITS));
    teleport(sim, BANK.x - 8, BANK.z, Math.PI / 2); // deep water, facing the bank

    // sanity: the start is deep water (a swimmer treads here)
    expect(terrainHeight(BANK.x - 8, BANK.z, SEED)).toBeLessThan(WATER_LEVEL - PLAYER_SWIM_DEPTH);

    // hold forward until the player first stands on dry ground (or time out)
    const meta = sim.players.get(sim.player.id);
    if (!meta) throw new Error('missing player meta');
    Object.assign(meta.moveInput, mi({ forward: true }));
    const p = sim.player;
    let dryAtTick = -1;
    for (let i = 0; i < TPS * 10; i++) {
      sim.tick();
      if (p.onGround && terrainHeight(p.pos.x, p.pos.z, SEED) > WATER_LEVEL) {
        dryAtTick = i;
        break;
      }
    }
    expect(dryAtTick, 'climbed out within 10s').toBeGreaterThanOrEqual(0);
    const dist = Math.hypot(p.pos.x - BANK.x, p.pos.z - BANK.z);
    expect(dist, 'first dry footing is the sculpted lip').toBeLessThan(4);
    expect(p.pos.y).toBeGreaterThan(WATER_LEVEL);
  });

  it('is deterministic: the same escape trajectory twice', () => {
    const trace = (): string => {
      const sim = makeSim(motionWorld(SHORE_EDITS));
      teleport(sim, BANK.x - 8, BANK.z, Math.PI / 2);
      const meta = sim.players.get(sim.player.id);
      if (!meta) throw new Error('missing player meta');
      Object.assign(meta.moveInput, mi({ forward: true }));
      const out: number[] = [];
      for (let i = 0; i < TPS * 8; i++) {
        sim.tick();
        out.push(sim.player.pos.x, sim.player.pos.y, sim.player.pos.z);
      }
      setActiveWorldContent(null);
      return JSON.stringify(out);
    };
    expect(trace()).toBe(trace());
  });

  it('grants no new climbing on dry land: a step too steep to climb still blocks', () => {
    // A 1.2yd instant dry step: within the shore step-out height, but with no
    // water under the player's feet the assist must not apply. Driven through
    // the kernel with pass-through collision so decorations cannot interfere,
    // and stamped as a 60yd-radius wall so the standoff's lateral slide cannot
    // steer the walker around it inside the tick budget.
    const DRY = { x: 30, z: 40 }; // open ground in zone 1, clear of the lake
    const dryStep: HeightStamp[] = [
      { x: DRY.x + 64, z: DRY.z, radius: 60, delta: 1.2, falloff: 'flat', mode: 'add' },
    ];
    const sim = makeSim(motionWorld(dryStep));
    teleport(sim, DRY.x, DRY.z, Math.PI / 2); // facing east, into the step
    const actor = kernelActor(sim);
    stepTicks(actor, kernelDeps(), mi({ forward: true }), TPS * 5);
    // the wall face sits at x = DRY.x + 4; the walker reaches it (or its
    // standoff apron) and never crests it
    expect(actor.pos.x, 'walked up to the wall').toBeGreaterThan(DRY.x + 2);
    expect(actor.pos.x, 'never climbed the dry step').toBeLessThan(DRY.x + 4.2);
  });

  it('a hop from wading footing carries over a too-steep lip (airborne step-out)', () => {
    // One jump tick, then NO input: only the airborne gate decides whether the
    // arc crosses onto the dry lip. Without the airborne shore step-out the
    // gate zeroes the arc's velocity at the lip and the actor falls back into
    // the water.
    const sim = makeSim(motionWorld(SHORE_EDITS));
    teleport(sim, BANK.x - 4.2, BANK.z, Math.PI / 2); // wading ring, facing the lip
    expect(terrainHeight(BANK.x - 4.2, BANK.z, SEED)).toBeCloseTo(WATER_LEVEL - 0.05, 5);
    const actor = kernelActor(sim);
    const deps = kernelDeps();
    stepTicks(actor, deps, mi({ forward: true, jump: true }), 1);
    expect(actor.onGround, 'launched').toBe(false);
    stepTicks(actor, deps, mi(), TPS * 2); // coast the arc, no further input
    expect(actor.onGround, 'landed').toBe(true);
    expect(
      terrainHeight(actor.pos.x, actor.pos.z, SEED),
      'landed on the dry lip, not back in the water',
    ).toBeGreaterThan(WATER_LEVEL);
  });

  it('the wall standoff never shoves a wading body off a submerged shelf', () => {
    // A wader resting beside a tall dry column: the standoff used to run while
    // wading (it only skipped while swimming) and would nudge the body away
    // from the wall every tick. With feet under the waterline it must not act.
    const columnEdits: HeightStamp[] = [
      {
        x: BANK.x,
        z: BANK.z,
        radius: 5,
        delta: WATER_LEVEL - 0.05,
        falloff: 'flat',
        mode: 'level',
      },
      { x: BANK.x, z: BANK.z, radius: 1.5, delta: WATER_LEVEL + 3, falloff: 'flat', mode: 'level' },
    ];
    const sim = makeSim(motionWorld(columnEdits));
    teleport(sim, BANK.x - 1.9, BANK.z, Math.PI / 2); // 0.4yd from the column face
    const actor = kernelActor(sim);
    const startX = actor.pos.x;
    const startZ = actor.pos.z;
    stepTicks(actor, kernelDeps(), mi(), TPS); // stand still for a second
    expect(actor.pos.x, 'not nudged').toBeCloseTo(startX, 9);
    expect(actor.pos.z, 'not nudged').toBeCloseTo(startZ, 9);
  });

  it('/follow crosses a shallow steep-bedded pocket instead of wedging on the rim', () => {
    // The follow executor in sim.ts shares the kernel's old raw-bed gate (as
    // does warrior Charge); it must ride the water surface too.
    setActiveWorldContent(motionWorld(POCKET_EDITS));
    const sim = new Sim({
      seed: SEED,
      playerClass: 'warrior',
      noPlayer: true,
      world: motionWorld(POCKET_EDITS),
    });
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const follower = sim.entities.get(a);
    const leader = sim.entities.get(b);
    if (!follower || !leader) throw new Error('missing players');
    const place = (e: Entity, x: number, z: number): void => {
      e.pos.x = x;
      e.pos.z = z;
      e.pos.y = terrainHeight(x, z, SEED);
      e.prevPos = { ...e.pos };
      e.fallStartY = e.pos.y;
      e.onGround = true;
    };
    place(follower, LAKE.x, LAKE.z); // wading on the pocket floor
    place(leader, LAKE.x + 7, LAKE.z); // on the shelf, across the rim
    sim.tick();
    sim.chat('/follow Bet', a);
    for (let i = 0; i < TPS * 10; i++) sim.tick();
    const d = Math.hypot(follower.pos.x - leader.pos.x, follower.pos.z - leader.pos.z);
    expect(d, 'closed to trail distance across the rim').toBeLessThanOrEqual(3.5);
  });
});
