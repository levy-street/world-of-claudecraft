// A walkable storey stacked over another floor (a castle deck over a cabin, a
// gallery over a hall) must leave the room under it a room:
//  - the terrain-wall standoff reads the ground at the body's feet, so the
//    storey's edge over a doorway is not a cliff that shoves the walker back
//    out of the doorway (wall_standoff.ts);
//  - an airborne landing reaches ramp decks and planes only as far as a
//    mantle, so a hop in the room comes back down on the room's floor
//    instead of on the storey (the walking deck reach used to stack on the
//    mantle, making any storey within ~4.5 yd a landing), and a rising head
//    bumps the storey's underside rather than passing through it
//    (player_motion.ts verticalPass, deck_ceiling.ts).
// Driven through the live Sim: its player movement IS the kernel under test.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { GRAVITY, JUMP_VELOCITY, PLAYER_HEAD_CLEARANCE } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import type { ColliderVolume, MoveInput, PlacedAsset, WorldContent } from '../src/sim/types';
import { terrainWallStandoff } from '../src/sim/wall_standoff';
import { terrainHeight } from '../src/sim/world';

const SEED = 20061;
// Open sea in the builtin world: flat seabed at -9.3, well under every floor.
const AX = 300;
const AZ = -900;
const FLOOR = 5; // the room's floor: a flat ramp deck
const APEX = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);

/** A pure walkable-deck placement: flat per-placement decks, no blockers. */
function decks(x: number, z: number, groundY: number, ramps: PlacedAsset['ramps']): PlacedAsset {
  return {
    path: '/models/props/stacked_deck_fixture.glb',
    x,
    z,
    rotY: 0,
    scale: 1,
    collideRadius: 0.8,
    detached: true,
    groundY,
    ramps,
  } as PlacedAsset;
}

const flat = (x: number, z: number, hx: number, hz: number) => ({ x, z, hx, hz, y0: 0, y1: 0 });

const PLANE: ColliderVolume = {
  kind: 'plane',
  x: AX + 8,
  z: AZ - 10,
  rotY: 0,
  sizeX: 8,
  sizeY: 0,
  sizeZ: 8,
  detached: true,
  groundY: FLOOR + 3.0,
};

const WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
  placements: [
    // the room's floor, 32 x 32
    decks(AX, AZ, FLOOR, [flat(0, 0, 16, 16)]),
    // a storey 3.6 over the west half; its edge at x = AX is the doorway line
    decks(AX, AZ, FLOOR + 3.6, [flat(-8, 0, 8, 16)]),
    // a low storey (2.7 over the floor) over the north-east quarter
    decks(AX, AZ, FLOOR + 2.7, [flat(8, 10, 4, 4)]),
    // a step 0.7 over the floor, east of the doorway
    decks(AX, AZ, FLOOR + 0.7, [flat(6, 0, 2, 2)]),
  ],
  colliderVolumes: [PLANE],
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
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  p.facing = facing;
}

function hold(sim: Sim, input: Partial<MoveInput>): void {
  const meta = sim.players.get(sim.player.id);
  if (!meta) throw new Error('missing player meta');
  Object.assign(meta.moveInput, mi(input));
}

/** One hop from where the body stands: the highest feet of the arc and the
 *  height it comes to rest at. */
function hop(sim: Sim, forward = false): { peak: number; rest: number } {
  let peak = sim.player.pos.y;
  hold(sim, { jump: true, forward });
  sim.tick();
  hold(sim, { forward });
  for (let i = 0; i < 60 && !sim.player.onGround; i++) {
    peak = Math.max(peak, sim.player.pos.y);
    sim.tick();
  }
  hold(sim, {});
  for (let i = 0; i < 4; i++) sim.tick();
  return { peak: Math.max(peak, sim.player.pos.y), rest: sim.player.pos.y };
}

describe('a storey stacked over a room', () => {
  // the Sim reads terrain and decks from the ACTIVE content (sim.ts: a caller
  // passing cfg.world installs it too)
  beforeEach(() => setActiveWorldContent(WORLD));
  afterEach(() => setActiveWorldContent(BUILTIN_WORLD));

  it('stands over open sea, so the seabed never decides a floor here', () => {
    expect(terrainHeight(AX, AZ, SEED)).toBeLessThan(FLOOR - 10);
  });

  it('reads the storey overhead as a ceiling, not a wall, at the doorway under its edge', () => {
    const x = AX + 0.3; // a body's width outside the storey's footprint
    const at = terrainWallStandoff(x, AZ, SEED, PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE, FLOOR);
    expect(at).toEqual({ x, z: AZ });
    // height-blind (no feet), the same spot reads a 3.6 yd cliff and is pushed
    // back out of the doorway: the case the feet exist for
    const blind = terrainWallStandoff(x, AZ, SEED, PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE);
    expect(blind.x).toBeGreaterThan(x + 0.2);
  });

  it('walks a body through the doorway and on under the storey', () => {
    const sim = makeSim();
    standAt(sim, AX + 3, AZ - 4, FLOOR, -Math.PI / 2); // facing -x, into the room
    hold(sim, { forward: true });
    for (let i = 0; i < 30; i++) sim.tick();
    hold(sim, {});
    expect(sim.player.pos.x).toBeLessThan(AX - 5);
    expect(sim.player.pos.y).toBeCloseTo(FLOOR, 3);
  });

  it('lands a hop in the room back on its floor, never on the storey above', () => {
    const sim = makeSim();
    standAt(sim, AX - 8, AZ, FLOOR, 0);
    const { peak, rest } = hop(sim);
    expect(peak).toBeLessThan(FLOOR + APEX + 0.05);
    expect(rest).toBeCloseTo(FLOOR, 3);
    expect(sim.player.onGround).toBe(true);
  });

  it('bumps a rising head on a low storey instead of carrying it through the floor above', () => {
    const sim = makeSim();
    standAt(sim, AX + 8, AZ + 10, FLOOR, 0);
    const { peak, rest } = hop(sim);
    // the head (feet + clearance) stops under the storey's planks
    expect(peak + PLAYER_HEAD_CLEARANCE).toBeLessThanOrEqual(FLOOR + 2.7 + 1e-6);
    expect(peak).toBeGreaterThan(FLOOR + 0.3); // it still hopped
    expect(rest).toBeCloseTo(FLOOR, 3);
  });

  it('treats a collider/plane storey the same way', () => {
    const sim = makeSim();
    standAt(sim, PLANE.x, PLANE.z, FLOOR, 0);
    const { peak, rest } = hop(sim);
    expect(peak + PLAYER_HEAD_CLEARANCE).toBeLessThanOrEqual(FLOOR + 3.0 + 1e-6);
    expect(rest).toBeCloseTo(FLOOR, 3);
  });

  it('still lands an arc on a deck within reach, and a walker off the storey on the floor', () => {
    const sim = makeSim();
    // a hop east onto the 0.7 step
    standAt(sim, AX + 2.6, AZ, FLOOR, Math.PI / 2);
    const onto = hop(sim, true);
    expect(onto.rest).toBeCloseTo(FLOOR + 0.7, 3);
    expect(Math.abs(sim.player.pos.x - (AX + 6))).toBeLessThan(2);
    // off the storey's edge, down to the room's floor
    standAt(sim, AX - 1.5, AZ - 4, FLOOR + 3.6, Math.PI / 2); // a lane clear of the other decks
    hold(sim, { forward: true });
    for (let i = 0; i < 12; i++) sim.tick();
    hold(sim, {});
    for (let i = 0; i < 20 && !sim.player.onGround; i++) sim.tick();
    expect(sim.player.pos.x).toBeGreaterThan(AX);
    expect(sim.player.pos.y).toBeCloseTo(FLOOR, 3);
  });
});
