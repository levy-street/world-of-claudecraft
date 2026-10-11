import { describe, expect, it } from 'vitest';
import {
  EASTBROOK_FERRY_HULL,
  EASTBROOK_NIGHTBLOOM_FERRY,
} from '../src/sim/content/transport_ships';
import { platformGlueAt, platformSupportAt } from '../src/sim/physics';
import { Sim } from '../src/sim/sim';
import {
  aboardDeck,
  carryWithDeck,
  DeckPlatform,
  deckToWorld,
  sailingDeckVolume,
  toDeckLocal,
  worldToDeck,
} from '../src/sim/transport_deck';
import { transportClock } from '../src/sim/transport_ferry';
import {
  angleDelta,
  type TransportPose,
  transportShipPoseAt,
  transportVoyageSeconds,
} from '../src/sim/transport_schedule';
import { DT, type Entity, type MoveInput } from '../src/sim/types';
import { WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// Phase 3 of the Eastbrook ferry: the deck under way is a kinematic platform
// (src/sim/transport_deck.ts) the movement kernel stands a passenger on, and
// the ferry system (src/sim/transport_ferry.ts) carries them rigidly with the
// ship between ticks. These drive the REAL Sim and its real kernel on the
// real sea lanes: a passenger walks, jumps, climbs and leans on the rails of
// a moving, turning ship exactly as on the moored one, and steps off the
// gangway opening into the sea.

const ROUTE = EASTBROOK_NIGHTBLOOM_FERRY;
const HULL = EASTBROOK_FERRY_HULL;
const DEPART_EAST = ROUTE.timings.docked;
const VOYAGE_EAST = transportVoyageSeconds(ROUTE, 0);
const DECK = WATER_LEVEL + HULL.mainDeckY;
const QUARTERDECK = WATER_LEVEL + HULL.captainDeckY;

const idle: MoveInput = {
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
  dive: false,
  surface: false,
};

function setClock(sim: Sim, clock: number): void {
  sim.transportClockOffset = clock - sim.time;
}

function poseAt(sim: Sim): TransportPose {
  const pose: TransportPose = { x: 0, z: 0, rot: 0 };
  return transportShipPoseAt(ROUTE, transportClock(sim.ctx), pose);
}

/** The body's spot in the ship's frame at the current clock. */
function local(sim: Sim, e: Entity): { x: number; y: number; z: number; f: number } {
  const out = { x: 0, y: 0, z: 0, f: 0 };
  return toDeckLocal(poseAt(sim), WATER_LEVEL, e.pos.x, e.pos.y, e.pos.z, e.facing, out);
}

/** Put the body on the deck at ship-frame (lx, lz), facing `lf` off the bow. */
function placeOnDeck(sim: Sim, e: Entity, lx: number, lz: number, lf = 0, y = DECK): void {
  const pose = poseAt(sim);
  const at = deckToWorld(pose, lx, lz, { x: 0, z: 0 });
  e.pos = { x: at.x, y, z: at.z };
  e.prevPos = { ...e.pos };
  e.facing = pose.rot + lf;
  e.vx = 0;
  e.vy = 0;
  e.vz = 0;
  e.onGround = true;
  e.jumping = false;
  e.fallStartY = y;
  sim.ctx.rebucket(e);
}

function hold(sim: Sim, input: Partial<MoveInput>, seconds: number): void {
  const meta = sim.players.get(sim.player.id);
  if (!meta) throw new Error('meta');
  Object.assign(meta.moveInput, idle, input);
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) sim.tick();
  Object.assign(meta.moveInput, idle);
}

/** The voyage second at which the Eastbrook lane turns hardest. */
function hardestTurn(): number {
  const a: TransportPose = { x: 0, z: 0, rot: 0 };
  const b: TransportPose = { x: 0, z: 0, rot: 0 };
  let best = 0;
  let at = 0;
  for (let t = 1; t < VOYAGE_EAST - 1; t += 0.25) {
    transportShipPoseAt(ROUTE, DEPART_EAST + t, a);
    transportShipPoseAt(ROUTE, DEPART_EAST + t + 0.25, b);
    const turn = Math.abs(angleDelta(a.rot, b.rot));
    const moved = Math.hypot(b.x - a.x, b.z - a.z);
    // a real turn under way, not the pivot off the berth
    if (moved > 1 && turn > best) {
      best = turn;
      at = t;
    }
  }
  return at;
}

function sailingSim(voyageSecond: number): Sim {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
  sim.setPlayerLevel(20);
  setClock(sim, DEPART_EAST + voyageSecond);
  return sim;
}

describe('the deck platform (pure)', () => {
  it('keeps every hull volume but the stowed boarding gear, placed at the pose', () => {
    const deck = new DeckPlatform(HULL);
    const pose: TransportPose = { x: 100, z: -40, rot: 0.7 };
    const colliders = deck.at(pose, WATER_LEVEL);
    const kept = HULL.volumes.filter(sailingDeckVolume);
    expect(colliders.length).toBe(kept.length);
    expect(kept.some((v) => v.kind === 'gangplank' || v.kind === 'gangway')).toBe(false);
    expect(HULL.volumes.some((v) => v.kind === 'gangplank')).toBe(true);
    // each collider sits where its volume lies in the ship frame
    kept.forEach((v, i) => {
      const at = deckToWorld(pose, v.x, v.z, { x: 0, z: 0 });
      expect(colliders[i].x).toBeCloseTo(at.x, 9);
      expect(colliders[i].z).toBeCloseTo(at.z, 9);
      expect(colliders[i].moveTopY).toBeCloseTo(WATER_LEVEL + v.top, 9);
      expect(colliders[i].standable === true).toBe(v.standable);
    });
    // the same pose hands back the same live list; a new pose re-places it
    expect(deck.at(pose, WATER_LEVEL)).toBe(colliders);
    const firstX = colliders[0].x;
    const moved = deck.at({ x: 101, z: -40, rot: 0.7 }, WATER_LEVEL);
    expect(moved).toBe(colliders);
    expect(moved[0].x).toBeCloseTo(firstX + 1, 9);
  });

  it('stands a body on the main deck, the quarterdeck and the hatch, and nowhere off the hull', () => {
    const pose: TransportPose = { x: -40, z: 60, rot: -1.1 };
    const platform = new DeckPlatform(HULL).at(pose, WATER_LEVEL);
    const top = (lx: number, lz: number) => {
      const at = deckToWorld(pose, lx, lz, { x: 0, z: 0 });
      return platformSupportAt(platform, at.x, at.z, 0.5, WATER_LEVEL + 20);
    };
    expect(top(2, 3)).toBeCloseTo(DECK, 9);
    expect(top(0, -11)).toBeCloseTo(QUARTERDECK, 9);
    expect(top(0, -1)).toBeCloseTo(DECK + 0.22, 9);
    expect(top(9, 0)).toBe(-Infinity);
    expect(top(0, 20)).toBe(-Infinity);
    // the glue holds a body on the plank it stood on right to the edge
    const from = deckToWorld(pose, 2, 3, { x: 0, z: 0 });
    const to = deckToWorld(pose, 2.2, 3, { x: 0, z: 0 });
    expect(platformGlueAt(platform, from.x, from.z, to.x, to.z, 0.5, DECK)).toBeCloseTo(DECK, 9);
    expect(platformGlueAt(null, from.x, from.z, to.x, to.z, 0.5, DECK)).toBe(-Infinity);
  });

  it('knows who is aboard: over the hull, at deck height or in the air above it', () => {
    const pose: TransportPose = { x: 10, z: 10, rot: 2 };
    const on = (lx: number, lz: number, y: number) => {
      const at = deckToWorld(pose, lx, lz, { x: 0, z: 0 });
      return aboardDeck(HULL, pose, WATER_LEVEL, at.x, y, at.z);
    };
    expect(on(0, 0, DECK)).toBe(true);
    expect(on(3, -12, QUARTERDECK)).toBe(true);
    expect(on(0, 0, DECK + 1.1)).toBe(true); // mid-jump
    expect(on(0, 0, WATER_LEVEL - 0.75)).toBe(false); // swimming under the hull
    expect(on(6, 0, DECK)).toBe(false); // off the port side
    expect(on(0, 16, DECK)).toBe(false); // past the stem
  });

  it('carries a body rigidly: same deck spot, heading and velocity turned with the hull', () => {
    const from: TransportPose = { x: 5, z: -3, rot: 0.4 };
    const to: TransportPose = { x: 6.2, z: -2.1, rot: 0.47 };
    const e = { pos: { x: 0, y: DECK, z: 0 }, facing: 1, vx: 2, vz: -1 } as Entity;
    const at = deckToWorld(from, 1.5, -4, { x: 0, z: 0 });
    e.pos.x = at.x;
    e.pos.z = at.z;
    carryWithDeck(from, to, e);
    const spot = worldToDeck(to, e.pos.x, e.pos.z, { x: 0, z: 0 });
    expect(spot.x).toBeCloseTo(1.5, 9);
    expect(spot.z).toBeCloseTo(-4, 9);
    expect(e.pos.y).toBe(DECK);
    expect(e.facing).toBeCloseTo(1.07, 9);
    // the velocity keeps its speed and turns by the same yaw
    expect(Math.hypot(e.vx, e.vz)).toBeCloseTo(Math.hypot(2, 1), 9);
    const turned = Math.atan2(e.vx, e.vz) - Math.atan2(2, -1);
    expect(angleDelta(0, turned)).toBeCloseTo(0.07, 9);
  });
});

describe('walking the deck under way (the real Sim and kernel)', () => {
  it('walks forward on a turning ship and stays aboard, moving relative to the deck', () => {
    const turn = hardestTurn();
    expect(turn).toBeGreaterThan(0);
    const sim = sailingSim(turn - 1);
    const p = sim.player;
    // clear of the hatch and the mainmast on the centre line
    placeOnDeck(sim, p, -2.2, -3);
    sim.tick();
    expect(p.ferryRide).toBeTruthy();
    const start = local(sim, p);
    const before = poseAt(sim);
    hold(sim, { forward: true }, 1);
    const after = poseAt(sim);
    // the ship really turned and moved under them...
    expect(Math.abs(angleDelta(before.rot, after.rot))).toBeGreaterThan(0.05);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(2);
    // ...and they walked about a run-second toward the bow, on the deck
    const end = local(sim, p);
    expect(end.z - start.z).toBeGreaterThan(5.5);
    expect(end.z - start.z).toBeLessThan(7.5);
    expect(Math.abs(end.x - start.x)).toBeLessThan(0.5);
    expect(end.y).toBeCloseTo(HULL.mainDeckY, 3);
    expect(aboardDeck(HULL, after, WATER_LEVEL, p.pos.x, p.pos.y, p.pos.z)).toBe(true);
    expect(p.onGround).toBe(true);
  });

  it('standing still, a passenger stays on the same deck spot for the whole voyage', () => {
    const sim = sailingSim(0);
    setClock(sim, DEPART_EAST - 1);
    const p = sim.player;
    placeOnDeck(sim, p, -1.2, 2.5);
    const drift: number[] = [];
    for (let t = 0; t < VOYAGE_EAST + 1; t += 5) {
      hold(sim, {}, 5);
      const at = local(sim, p);
      drift.push(Math.hypot(at.x + 1.2, at.z - 2.5), Math.abs(at.y - HULL.mainDeckY));
    }
    expect(Math.max(...drift)).toBeLessThan(0.02);
    // moored at Wickharbor with the voyage over
    expect(p.ferryRide ?? null).toBeNull();
    const wick = ROUTE.berths[1];
    const spot = worldToDeck(wick, p.pos.x, p.pos.z, { x: 0, z: 0 });
    expect(spot.x).toBeCloseTo(-1.2, 1);
    expect(spot.z).toBeCloseTo(2.5, 1);
  }, 120_000);

  it('jumps on a moving deck and lands on the deck, near where it left', () => {
    const sim = sailingSim(40);
    const p = sim.player;
    placeOnDeck(sim, p, -1, 3);
    sim.tick();
    const start = local(sim, p);
    hold(sim, { jump: true }, DT);
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      sim.tick();
      peak = Math.max(peak, local(sim, p).y);
    }
    const end = local(sim, p);
    expect(peak).toBeGreaterThan(HULL.mainDeckY + 0.9);
    expect(p.onGround).toBe(true);
    expect(end.y).toBeCloseTo(HULL.mainDeckY, 3);
    expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeLessThan(0.2);
  });

  it('the rails hold a passenger on deck (walking and jumping into them)', () => {
    const sim = sailingSim(60);
    const p = sim.player;
    // face starboard (-x in the ship frame is the bow's right: facing -PI/2)
    placeOnDeck(sim, p, -2.5, 4, -Math.PI / 2);
    hold(sim, { forward: true, jump: true }, 3);
    const at = local(sim, p);
    expect(at.x).toBeGreaterThan(-HULL.beam / 2 + 0.3);
    expect(at.y).toBeGreaterThanOrEqual(HULL.mainDeckY - 0.01);
    expect(aboardDeck(HULL, poseAt(sim), WATER_LEVEL, p.pos.x, p.pos.y, p.pos.z)).toBe(true);
    // and the other side, away from the gangway opening
    placeOnDeck(sim, p, 2.5, 5.5, Math.PI / 2);
    hold(sim, { forward: true }, 2);
    expect(local(sim, p).x).toBeLessThan(HULL.beam / 2 - 0.3);
    expect(p.ferryRide).toBeTruthy();
  });

  it('climbs the quarterdeck stair under way', () => {
    const sim = sailingSim(55);
    const p = sim.player;
    // at the foot of the port flight, facing aft (the stern is +PI off the bow)
    placeOnDeck(sim, p, 3.72, -1.8, Math.PI);
    hold(sim, { forward: true }, 2.5);
    const at = local(sim, p);
    expect(at.y).toBeCloseTo(HULL.captainDeckY, 2);
    expect(at.z).toBeLessThan(-7.4);
    expect(p.ferryRide).toBeTruthy();
  });

  it('steps off the gangway opening into the sea, and the ship sails on without them', () => {
    const sim = sailingSim(62);
    const p = sim.player;
    // the port gangway opening (ship x 5.15, z 0.8), facing port
    placeOnDeck(sim, p, 3.5, 0.8, Math.PI / 2);
    hold(sim, { forward: true }, 1.2);
    hold(sim, {}, 3);
    expect(p.ferryRide ?? null).toBeNull();
    // swimming at the surface where they fell in
    expect(sim.isSwimming(p)).toBe(true);
    expect(p.pos.y).toBeLessThan(WATER_LEVEL);
    const pose = poseAt(sim);
    expect(Math.hypot(pose.x - p.pos.x, pose.z - p.pos.z)).toBeGreaterThan(25);
  });

  it('a swimmer alongside cannot climb aboard a ship under way (the hull is a wall)', () => {
    const sim = sailingSim(70);
    const p = sim.player;
    placeOnDeck(sim, p, 6.5, 0, -Math.PI / 2, WATER_LEVEL - 0.75);
    p.onGround = true;
    hold(sim, { forward: true, jump: true }, 1);
    expect(p.pos.y).toBeLessThan(DECK - 1);
    expect(p.ferryRide ?? null).toBeNull();
  });

  it('is deterministic: two worlds with the same inputs agree bit for bit', () => {
    const run = () => {
      const sim = sailingSim(30);
      const p = sim.player;
      placeOnDeck(sim, p, 0.5, 2, 0.3);
      hold(sim, { forward: true, strafeLeft: true }, 1.5);
      hold(sim, { jump: true, turnLeft: true }, 0.4);
      hold(sim, { back: true }, 1);
      return [p.pos.x, p.pos.y, p.pos.z, p.facing, p.vx, p.vz];
    };
    expect(run()).toEqual(run());
  });
});
