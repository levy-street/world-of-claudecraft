// Underwater swimming: the dive input, the depth column, and the speed ramp.
//
// The vertical half of swimming is neutrally buoyant on purpose — released
// controls hold your depth rather than floating you back to the top — so these
// pin the three things that could strand a player: you can always get down, you
// can always get back up, and you can never sink into the lake bed.

import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import {
  isSubmerged,
  SWIM_DIVE_CRUISE_MULT,
  SWIM_DIVE_SPEED_MULT,
  SWIM_FLOOR_CLEARANCE,
  SWIM_SPEED_MULT,
  SWIM_STEER_MIN_RATE,
  SWIM_STROKE_PERIOD,
  swimSpeedMult,
  swimSteerRate,
  swimSurfaceY,
  WADE_FULL_DEPTH,
  WADE_MIN_DEPTH,
  WADE_SPEED_MULT,
  wadeSpeedMult,
} from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import type { HeightStamp, MoveInput, WorldContent } from '../src/sim/types';
import { groundHeight, WATER_LEVEL } from '../src/sim/world';

const SEED = 42;
const TPS = 20;
// The built-in zone 1 lake (declared water body at -92, 88, r30): levelled to a
// flat bed 6 yards under the waterline, so there is a real column to dive into.
const LAKE = { x: -92, z: 88 };
const DEEP_EDITS: HeightStamp[] = [
  { x: LAKE.x, z: LAKE.z, radius: 14, delta: WATER_LEVEL - 6, falloff: 'flat', mode: 'level' },
];

function deepWorld(): WorldContent {
  return { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [], terrainEdits: DEEP_EDITS };
}

function makeSim(): Sim {
  const world = deepWorld();
  setActiveWorldContent(world);
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true, world });
  sim.setPlayerLevel(60);
  const p = sim.player;
  p.pos.x = LAKE.x;
  p.pos.z = LAKE.z;
  p.pos.y = swimSurfaceY(LAKE.x, LAKE.z, SEED);
  p.prevPos = { ...p.pos };
  p.fallStartY = p.pos.y;
  p.onGround = true;
  p.vx = p.vy = p.vz = 0;
  return sim;
}

afterEach(() => setActiveWorldContent(null));

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

describe('swimming underwater', () => {
  it('starts at the surface and is not submerged', () => {
    const sim = makeSim();
    expect(sim.player.pos.y).toBeCloseTo(swimSurfaceY(LAKE.x, LAKE.z, SEED), 4);
    expect(isSubmerged(sim.player, sim.cfg.seed)).toBe(false);
  });

  it('dives below the waterline while the dive input is held', () => {
    const sim = makeSim();
    const surface = swimSurfaceY(LAKE.x, LAKE.z, SEED);
    hold(sim, mi({ dive: true }), TPS); // one second of descent
    expect(sim.player.pos.y).toBeLessThan(surface - 1);
    expect(isSubmerged(sim.player, sim.cfg.seed)).toBe(true);
  });

  it('floats a body that never dove back to the surface', () => {
    // The long-standing rule the rest of the game leans on: a teleport, a spawn
    // or a knockback into deep water must never park anyone on the lake bed.
    // Since the plunge-entry work the float is RATE-based (SWIM_ASCEND_RATE)
    // rather than a one-tick snap, so the surface arrives in seconds, not
    // ticks — the invariant is the destination, not the teleport.
    const sim = makeSim();
    const p = sim.player;
    p.pos.y = groundHeight(p.pos.x, p.pos.z, sim.cfg.seed); // dumped on the bed
    p.prevPos = { ...p.pos };
    const bed = p.pos.y;
    hold(sim, mi(), 1);
    expect(p.pos.y).toBeGreaterThan(bed); // rising from the first tick
    hold(sim, mi(), TPS * 3);
    expect(p.pos.y).toBeCloseTo(swimSurfaceY(LAKE.x, LAKE.z, SEED), 4);
    expect(p.swimDiving).toBe(false);
  });

  it('ends the dive once the body reaches the line again', () => {
    const sim = makeSim();
    hold(sim, mi({ dive: true }), TPS);
    expect(sim.player.swimDiving).toBe(true);
    hold(sim, mi({ jump: true }), TPS * 3);
    expect(sim.player.swimDiving).toBe(false);
    // ...and having surfaced, releasing everything keeps you there
    hold(sim, mi(), TPS);
    expect(sim.player.pos.y).toBeCloseTo(swimSurfaceY(LAKE.x, LAKE.z, SEED), 4);
  });

  it('holds its depth when the controls are released (neutral buoyancy)', () => {
    const sim = makeSim();
    hold(sim, mi({ dive: true }), TPS);
    const depth = sim.player.pos.y;
    hold(sim, mi(), TPS * 3);
    expect(sim.player.pos.y).toBeCloseTo(depth, 5);
    expect(isSubmerged(sim.player, sim.cfg.seed)).toBe(true);
  });

  it('never sinks into the lake bed', () => {
    const sim = makeSim();
    hold(sim, mi({ dive: true }), TPS * 10); // far longer than the column is deep
    const bed = groundHeight(sim.player.pos.x, sim.player.pos.z, sim.cfg.seed);
    expect(sim.player.pos.y).toBeGreaterThanOrEqual(bed + SWIM_FLOOR_CLEARANCE - 1e-6);
  });

  it('surfaces again on jump, and stops at the waterline', () => {
    const sim = makeSim();
    hold(sim, mi({ dive: true }), TPS * 2);
    expect(isSubmerged(sim.player, sim.cfg.seed)).toBe(true);
    hold(sim, mi({ jump: true }), TPS * 3);
    expect(isSubmerged(sim.player, sim.cfg.seed)).toBe(false);
    // ...and the very next jump at the line is the shore hop, not a rocket
    expect(sim.player.pos.y).toBeLessThan(swimSurfaceY(LAKE.x, LAKE.z, SEED) + 2);
  });

  it('lets jump win when both vertical inputs are held', () => {
    // `dive` is a latched camera BAND as well as a key, and a swimmer
    // naturally looks down at where they are going — when dive outranked
    // jump, the space bar silently did nothing whenever the camera was
    // pitched past the dive line (the "controls stop working underwater"
    // report). An explicit jump press is always deliberate, so it climbs.
    const sim = makeSim();
    const surface = swimSurfaceY(LAKE.x, LAKE.z, SEED);
    hold(sim, mi({ dive: true }), TPS * 2);
    expect(sim.player.pos.y).toBeLessThan(surface - 1);
    hold(sim, mi({ dive: true, jump: true }), TPS * 2);
    expect(sim.player.pos.y).toBeGreaterThan(surface - 0.5);
  });

  it('rises on `surface` (the look-up camera) without hopping out of the water', () => {
    // `jump` at the line hops you onto a bank, which is right for a keypress and
    // very wrong for a held camera angle: aiming the view up while floating must
    // leave you floating, not launch you once a second.
    const sim = makeSim();
    const line = swimSurfaceY(LAKE.x, LAKE.z, SEED);
    hold(sim, mi({ dive: true }), TPS * 2);
    expect(isSubmerged(sim.player, sim.cfg.seed)).toBe(true);

    hold(sim, mi({ surface: true }), TPS * 3);
    expect(sim.player.pos.y).toBeCloseTo(line, 4);
    expect(isSubmerged(sim.player, sim.cfg.seed)).toBe(false);

    // held at the line: still floating, never airborne
    hold(sim, mi({ surface: true }), TPS * 2);
    expect(sim.player.pos.y).toBeCloseTo(line, 4);
    expect(sim.player.jumping).toBe(false);
  });

  it('still lets dive win over a look-up camera', () => {
    const sim = makeSim();
    hold(sim, mi({ dive: true, surface: true }), TPS);
    expect(sim.player.pos.y).toBeLessThan(swimSurfaceY(LAKE.x, LAKE.z, SEED) - 1);
  });

  it('banks stroke time only while submerged, and resets on surfacing', () => {
    const sim = makeSim();
    hold(sim, mi({ dive: true, forward: true }), TPS * 2);
    expect(sim.player.swimStroke).toBeGreaterThan(0);
    hold(sim, mi({ jump: true }), TPS * 4);
    expect(sim.player.swimStroke).toBe(0);
  });
});

describe('swim speed ramp', () => {
  it('leaves surface swimming untouched', () => {
    expect(swimSpeedMult(0, false)).toBe(SWIM_SPEED_MULT);
    expect(swimSpeedMult(SWIM_STROKE_PERIOD, false)).toBe(SWIM_SPEED_MULT);
  });

  it('opens a dive slow and reaches the cruise after one stroke', () => {
    expect(swimSpeedMult(0, true)).toBeCloseTo(SWIM_DIVE_SPEED_MULT, 6);
    expect(swimSpeedMult(SWIM_STROKE_PERIOD, true)).toBeCloseTo(SWIM_DIVE_CRUISE_MULT, 6);
  });

  it('is monotonic across the ramp, and never beats the surface pace', () => {
    let previous = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const v = swimSpeedMult((SWIM_STROKE_PERIOD * i) / 20, true);
      expect(v).toBeGreaterThanOrEqual(previous);
      expect(v).toBeLessThan(SWIM_SPEED_MULT);
      previous = v;
    }
  });

  it('actually travels farther per tick once the stroke is banked', () => {
    const sim = makeSim();
    const travelled = (from: { x: number; z: number }): number =>
      Math.hypot(sim.player.pos.x - from.x, sim.player.pos.z - from.z);

    hold(sim, mi({ dive: true }), TPS); // get under; the stroke timer stays cold
    const coldFrom = { x: sim.player.pos.x, z: sim.player.pos.z };
    hold(sim, mi({ forward: true }), 4);
    const opening = travelled(coldFrom);
    hold(sim, mi({ forward: true }), TPS * 2); // bank a full stroke
    const cruiseFrom = { x: sim.player.pos.x, z: sim.player.pos.z };
    hold(sim, mi({ forward: true }), 4);
    const cruising = travelled(cruiseFrom);
    expect(opening).toBeGreaterThan(0);
    expect(cruising).toBeGreaterThan(opening);
  });
});

// The camera steer: how STEEPLY the view is aimed into the dive scales the
// rate, so easing it over the threshold is a drift and burying it is a plunge.
// Everything that does not send one (the dive key, a bot, an older client, and
// every hand-built MoveInput in this file) keeps the original full rate.
describe('camera-steered dive rate', () => {
  it('reads an absent or malformed steer as the full rate', () => {
    expect(swimSteerRate(undefined)).toBe(1);
    expect(swimSteerRate(Number.NaN)).toBe(1);
  });

  it('ramps from the floor to the full rate, and clamps outside 0..1', () => {
    expect(swimSteerRate(0)).toBeCloseTo(SWIM_STEER_MIN_RATE, 6);
    expect(swimSteerRate(1)).toBe(1);
    expect(swimSteerRate(0.5)).toBeGreaterThan(swimSteerRate(0));
    expect(swimSteerRate(0.5)).toBeLessThan(swimSteerRate(1));
    expect(swimSteerRate(-3)).toBeCloseTo(SWIM_STEER_MIN_RATE, 6);
    expect(swimSteerRate(9)).toBe(1);
  });

  it('descends further on a steep steer than on a shallow one, in the same time', () => {
    const depthAfter = (steer: number | undefined): number => {
      const sim = makeSim();
      const start = sim.player.pos.y;
      hold(sim, mi({ dive: true, swimSteer: steer }), TPS / 2);
      return start - sim.player.pos.y;
    };
    const shallow = depthAfter(0);
    const steep = depthAfter(1);
    const ungraded = depthAfter(undefined);
    expect(shallow).toBeGreaterThan(0); // a gentle look still moves you
    expect(steep).toBeGreaterThan(shallow * 2);
    expect(ungraded).toBeCloseTo(steep, 6); // no steer == the old behaviour
  });

  it('grades the camera ascent but never the jump key', () => {
    const roseBy = (input: MoveInput): number => {
      const sim = makeSim();
      hold(sim, mi({ dive: true }), TPS * 2); // get down to the bed first
      const from = sim.player.pos.y;
      hold(sim, input, 3);
      return sim.player.pos.y - from;
    };
    const gentle = roseBy(mi({ surface: true, swimSteer: 0 }));
    const hard = roseBy(mi({ surface: true, swimSteer: 1 }));
    const jump = roseBy(mi({ jump: true, swimSteer: 0 }));
    expect(gentle).toBeGreaterThan(0);
    expect(hard).toBeGreaterThan(gentle);
    expect(jump).toBeCloseTo(hard, 6);
  });
});

// Wading: water over the feet, ground still under them. The swim latch takes
// over once the bed is PLAYER_SWIM_DEPTH under the line, so this band is
// shallow by construction — and crossing it should read as effort, without ever
// becoming a snare at the shoreline.
describe('wading through shallow water', () => {
  it('is inert on dry ground and in a puddle', () => {
    expect(wadeSpeedMult(Number.NEGATIVE_INFINITY)).toBe(1);
    expect(wadeSpeedMult(0)).toBe(1);
    expect(wadeSpeedMult(WADE_MIN_DEPTH)).toBe(1);
  });

  it('ramps with depth rather than stepping, so a beach has no speed cliff', () => {
    const shallow = wadeSpeedMult(WADE_MIN_DEPTH + 0.1);
    const mid = wadeSpeedMult((WADE_MIN_DEPTH + WADE_FULL_DEPTH) / 2);
    const deep = wadeSpeedMult(WADE_FULL_DEPTH);
    expect(shallow).toBeLessThan(1);
    expect(mid).toBeLessThan(shallow);
    expect(deep).toBeLessThan(mid);
    expect(deep).toBeCloseTo(WADE_SPEED_MULT, 6);
    expect(wadeSpeedMult(WADE_FULL_DEPTH + 5)).toBeCloseTo(WADE_SPEED_MULT, 6); // clamped
  });

  it('actually covers less ground than the same run on dry land', () => {
    // A pond levelled to half a yard under the line: too shallow to swim in
    // (PLAYER_SWIM_DEPTH is 0.8), which is exactly the wade band.
    const world: WorldContent = {
      ...BUILTIN_WORLD,
      camps: [],
      npcs: {},
      groundObjects: [],
      terrainEdits: [
        {
          x: LAKE.x,
          z: LAKE.z,
          radius: 14,
          delta: WATER_LEVEL - 0.5,
          falloff: 'flat',
          mode: 'level',
        },
      ],
    };
    setActiveWorldContent(world);
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true, world });
    sim.setPlayerLevel(60);
    const runFrom = (x: number, z: number): number => {
      const p = sim.player;
      p.pos.x = x;
      p.pos.z = z;
      p.pos.y = groundHeight(x, z, sim.cfg.seed);
      p.prevPos = { ...p.pos };
      p.facing = 0;
      p.vx = p.vy = p.vz = 0;
      p.onGround = true;
      const from = { x: p.pos.x, z: p.pos.z };
      hold(sim, mi({ forward: true }), TPS / 2);
      return Math.hypot(p.pos.x - from.x, p.pos.z - from.z);
    };
    const inWater = runFrom(LAKE.x, LAKE.z);
    const onLand = runFrom(LAKE.x + 400, LAKE.z + 400);
    expect(inWater).toBeGreaterThan(0);
    expect(inWater).toBeLessThan(onLand * 0.95);
  });
});
