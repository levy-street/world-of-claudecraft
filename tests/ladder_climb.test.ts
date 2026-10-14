// Climbable ladders (sim/ladders.ts): an asset's authored ladder is a rung face
// a body latches onto by walking into it, then climbs CS2-style (W up, W with
// the view aimed down or S down, strafe to slide along it, jump to push off),
// with no gravity and no fall damage, stepping off onto the floor at the top
// and the bottom. Driven through the live Sim, whose player movement IS the
// kernel under test.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applySessionCollisionOverride } from '../src/sim/asset_collision';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { CLIMB_SPEED } from '../src/sim/ladders';
import { Sim } from '../src/sim/sim';
import type { MoveInput, PlacedAsset, WorldContent } from '../src/sim/types';

const SEED = 20061;
// Open sea in the builtin world: flat seabed at -9.3, under every floor here.
const AX = 300;
const AZ = -900;
const FLOOR = 5;
const TOP = 8; // the lookout platform, over the pole's base
const ASSET = 'props/ladder_fixture';

/** A mast with a ladder up its -X face to a 4 x 4 lookout deck; the mast
 *  carries on above the deck (a topmast), as the galleon's does. */
const POLE_OVERRIDE = {
  mode: 'baked' as const,
  boxes: [{ x: 0, y: (TOP + 4) / 2, z: 0, hx: 0.45, hy: (TOP + 4) / 2, hz: 0.45 }],
  ramps: [{ x: 0, z: 0, hx: 2, hz: 2, y0: TOP, y1: TOP }],
  ladders: [{ x: -0.6, z: 0, ry: Math.PI, hw: 0.45, y0: 0, y1: TOP }],
};

const WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
  placements: [
    {
      path: '/models/props/stacked_deck_fixture.glb',
      x: AX,
      z: AZ,
      rotY: 0,
      scale: 1,
      collideRadius: 0.8,
      detached: true,
      groundY: FLOOR,
      ramps: [{ x: 0, z: 0, hx: 16, hz: 16, y0: 0, y1: 0 }],
    } as PlacedAsset,
    {
      path: `/models/${ASSET}.glb`,
      x: AX,
      z: AZ,
      rotY: 0,
      scale: 1,
      collideRadius: 0.8,
      detached: true,
      groundY: FLOOR,
    } as PlacedAsset,
  ],
};

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

function makeSim(): Sim {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true, world: WORLD });
  sim.setPlayerLevel(60);
  return sim;
}

function standAt(sim: Sim, x: number, z: number, y: number, facing: number): void {
  const p = sim.player;
  p.pos = { x, y, z };
  p.prevPos = { ...p.pos };
  p.fallStartY = y;
  p.onGround = true;
  p.climbing = false;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  p.facing = facing;
}

function hold(sim: Sim, input: Partial<MoveInput>, ticks: number): void {
  const meta = sim.players.get(sim.player.id);
  if (!meta) throw new Error('missing player meta');
  Object.assign(meta.moveInput, mi(input));
  for (let i = 0; i < ticks; i++) sim.tick();
  Object.assign(meta.moveInput, mi());
}

const EAST = Math.PI / 2; // facing +X: toward the ladder from its climbing side

describe('ladders', () => {
  beforeEach(() => {
    applySessionCollisionOverride(ASSET, POLE_OVERRIDE);
    setActiveWorldContent(WORLD);
  });
  afterEach(() => {
    setActiveWorldContent(BUILTIN_WORLD);
    applySessionCollisionOverride(ASSET, null);
  });

  it('latches a body that walks into the rungs and climbs it onto the lookout', () => {
    const sim = makeSim();
    standAt(sim, AX - 4, AZ, FLOOR, EAST);
    hold(sim, { forward: true }, 16); // walk up to the pole and grab on
    expect(sim.player.climbing).toBe(true);
    const onRungs = sim.player.pos.y;
    hold(sim, { forward: true }, 6);
    // up at the climb rate, no gravity pulling back
    expect(sim.player.pos.y - onRungs).toBeCloseTo(6 * 0.05 * CLIMB_SPEED, 1);
    // the rest of the way: W until the climber steps off at the top
    for (let i = 0; i < 80 && sim.player.climbing; i++) hold(sim, { forward: true }, 1);
    expect(sim.player.climbing).toBe(false);
    expect(sim.player.pos.y).toBeCloseTo(FLOOR + TOP, 2);
    hold(sim, {}, 10); // and it stands there
    expect(sim.player.pos.y).toBeCloseTo(FLOOR + TOP, 2);
    expect(sim.player.onGround).toBe(true);
  });

  it('holds a climber in place with nothing pressed, and brings them down on S', () => {
    const sim = makeSim();
    standAt(sim, AX - 1.4, AZ, FLOOR, EAST);
    hold(sim, { forward: true }, 20);
    expect(sim.player.climbing).toBe(true);
    const y = sim.player.pos.y;
    hold(sim, {}, 20);
    expect(sim.player.pos.y).toBeCloseTo(y, 5); // hanging, not falling
    expect(sim.player.climbing).toBe(true);
    hold(sim, { back: true }, 60);
    expect(sim.player.climbing).toBe(false);
    expect(sim.player.pos.y).toBeCloseTo(FLOOR, 2);
  });

  it('goes down on S even with the view level or raised (the look-up band)', () => {
    const sim = makeSim();
    standAt(sim, AX - 1.4, AZ, FLOOR, EAST);
    hold(sim, { forward: true }, 40);
    expect(sim.player.climbing).toBe(true);
    const y = sim.player.pos.y;
    // the input layer sets `surface` whenever a move key is held with the
    // camera at or above level, S included
    hold(sim, { back: true, surface: true }, 6);
    expect(sim.player.pos.y).toBeCloseTo(y - 6 * 0.05 * CLIMB_SPEED, 1);
    hold(sim, { forward: true, surface: true }, 6);
    expect(sim.player.pos.y).toBeCloseTo(y, 1);
  });

  it('takes a body at the top down the ladder when the view is aimed down', () => {
    const sim = makeSim();
    standAt(sim, AX - 1.16, AZ, FLOOR + TOP, EAST);
    hold(sim, { forward: true }, 6); // level view: walking at the pole, not down it
    expect(sim.player.climbing ?? false).toBe(false);
    expect(sim.player.pos.y).toBeCloseTo(FLOOR + TOP, 2);
    hold(sim, { forward: true, dive: true }, 4);
    expect(sim.player.climbing).toBe(true);
    hold(sim, { forward: true, dive: true }, 60);
    expect(sim.player.climbing).toBe(false);
    expect(sim.player.pos.y).toBeCloseTo(FLOOR, 2);
  });

  it('pushes off on jump and falls clear without re-grabbing', () => {
    const sim = makeSim();
    standAt(sim, AX - 1.4, AZ, FLOOR, EAST);
    hold(sim, { forward: true }, 40); // well up the pole
    expect(sim.player.climbing).toBe(true);
    const x = sim.player.pos.x;
    hold(sim, { jump: true }, 1);
    expect(sim.player.climbing).toBe(false);
    hold(sim, {}, 60);
    expect(sim.player.pos.x).toBeLessThan(x - 0.5); // pushed back off the rungs
    expect(sim.player.pos.y).toBeCloseTo(FLOOR, 2);
    expect(sim.player.climbing ?? false).toBe(false);
  });

  it('slides along the rungs on strafe and drops off past the side rail', () => {
    const sim = makeSim();
    standAt(sim, AX - 1.4, AZ, FLOOR, EAST);
    hold(sim, { forward: true }, 30);
    expect(sim.player.climbing).toBe(true);
    const z = sim.player.pos.z;
    hold(sim, { strafeRight: true }, 4);
    expect(sim.player.climbing).toBe(true);
    expect(Math.abs(sim.player.pos.z - z)).toBeGreaterThan(0.2);
    hold(sim, { strafeRight: true }, 30);
    expect(sim.player.climbing).toBe(false);
    hold(sim, {}, 60);
    expect(sim.player.pos.y).toBeCloseTo(FLOOR, 2);
  });
});
