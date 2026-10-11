import { describe, expect, it } from 'vitest';
import { createClientPlayerMotionDeps } from '../src/render/client_player_motion';
import { createDeckAwareStep } from '../src/render/deck_prediction';
import { type MotionState, PredictionRing, predictTick } from '../src/render/self_prediction_core';
import { setColliderGateOpen } from '../src/sim/colliders';
import {
  EASTBROOK_FERRY_HULL,
  EASTBROOK_NIGHTBLOOM_FERRY,
} from '../src/sim/content/transport_ships';
import { Sim } from '../src/sim/sim';
import { deckToWorld, worldToDeck } from '../src/sim/transport_deck';
import { transportClock } from '../src/sim/transport_ferry';
import { syncTransportGates } from '../src/sim/transport_gates';
import { type TransportPose, transportShipPoseAt } from '../src/sim/transport_schedule';
import { DT, emptyMoveInput, type MoveInput } from '../src/sim/types';
import { WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// The online prediction's deck-aware step (src/render/deck_prediction.ts)
// against the live Sim: the client replays a passenger's input in the
// sailing ship's own frame, the server carries them in the world; one sim,
// three hosts means the two must land on the same deck spot, tick by tick,
// through walking, a turn, a jump and a step off the gangway opening.

const ROUTE = EASTBROOK_NIGHTBLOOM_FERRY;
const DECK = WATER_LEVEL + EASTBROOK_FERRY_HULL.mainDeckY;

function poseAt(clock: number): TransportPose {
  return transportShipPoseAt(ROUTE, clock, { x: 0, z: 0, rot: 0 });
}

function mi(over: Partial<MoveInput>): MoveInput {
  return { ...emptyMoveInput(), ...over };
}

describe('the deck-aware prediction step', () => {
  it('matches the live Sim on a sailing deck, walking, turning and jumping', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    sim.setPlayerLevel(20);
    // the western strait's elbow: the ship turns under the passenger
    sim.transportClockOffset = ROUTE.timings.docked + 16 - sim.time;
    const p = sim.player;
    const start = poseAt(transportClock(sim.ctx));
    const at = deckToWorld(start, -1.8, 4, { x: 0, z: 0 });
    p.pos = { x: at.x, y: DECK, z: at.z };
    p.prevPos = { ...p.pos };
    p.facing = start.rot + 0.3;
    sim.rebucket(p);
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('meta');

    // the client's state: the same body, in the ship's frame
    let state: MotionState = {
      deck: 0,
      id: p.id,
      pos: { x: -1.8, y: DECK, z: 4 },
      prevPos: { x: -1.8, y: DECK, z: 4 },
      facing: 0.3,
      vx: 0,
      vy: 0,
      vz: 0,
      onGround: true,
      jumping: false,
      fallStartY: DECK,
      swimStroke: 0,
      swimDiving: false,
      auras: [],
      ghost: false,
      sitting: false,
      castingAbility: null,
      maxHp: p.maxHp,
      mountKey: '',
      mountCastRemaining: 0,
      mountCastKey: '',
    };
    // client tick ct runs on the server tick that leaves the clock at base + ct
    // ticks (a perfect estimate: the parity of the step itself is on trial)
    const base = transportClock(sim.ctx);
    const step = createDeckAwareStep(
      createClientPlayerMotionDeps(WORLD_SEED),
      (ct) => base + ct * DT,
    );
    const ring = new PredictionRing();
    const script: MoveInput[] = [
      ...Array.from({ length: 20 }, () => mi({ forward: true })),
      ...Array.from({ length: 10 }, () => mi({ forward: true, turnLeft: true })),
      mi({ jump: true, forward: true }),
      ...Array.from({ length: 20 }, () => mi({ strafeRight: true })),
      ...Array.from({ length: 10 }, () => mi({})),
    ];
    let worst = 0;
    script.forEach((input, i) => {
      const ct = i + 1;
      Object.assign(meta.moveInput, input);
      sim.tick();
      state = predictTick(ring, state, { ct, mi: input, facing: null }, step);
      const pose = poseAt(transportClock(sim.ctx));
      const server = worldToDeck(pose, p.pos.x, p.pos.z, { x: 0, z: 0 });
      expect(state.deck).toBe(0);
      worst = Math.max(
        worst,
        Math.hypot(server.x - state.pos.x, server.z - state.pos.z),
        Math.abs(p.pos.y - state.pos.y),
      );
    });
    expect(p.ferryRide).toBeTruthy();
    expect(worst).toBeLessThan(1e-6);
  });

  it('carries a world-frame body standing on a ship that casts off, then leaves the deck frame overboard', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    const berth = ROUTE.berths[0];
    const depart = ROUTE.timings.docked;
    const at = deckToWorld(berth, 1, 0.8, { x: 0, z: 0 });
    let state: MotionState = {
      deck: null,
      id: 1,
      pos: { x: at.x, y: DECK, z: at.z },
      prevPos: { x: at.x, y: DECK, z: at.z },
      facing: berth.rot + Math.PI / 2,
      vx: 0,
      vy: 0,
      vz: 0,
      onGround: true,
      jumping: false,
      fallStartY: DECK,
      swimStroke: 0,
      swimDiving: false,
      auras: [],
      ghost: false,
      sitting: false,
      castingAbility: null,
      maxHp: 100,
      mountKey: '',
      mountCastRemaining: 0,
      mountCastKey: '',
    };
    void sim;
    const clockFor = (ct: number) => depart - 0.2 + ct * DT;
    const step = createDeckAwareStep(createClientPlayerMotionDeps(WORLD_SEED), clockFor);
    const ring = new PredictionRing();
    // the moored deck's gates follow the schedule, as the client re-applies
    // them from every snapshot
    const tick = (ct: number, input: MoveInput) => {
      syncTransportGates(WORLD_SEED, clockFor(ct), setColliderGateOpen);
      state = predictTick(ring, state, { ct, mi: input, facing: null }, step);
    };
    // idle through the cast-off: carried, then in the deck frame
    for (let ct = 1; ct <= 30; ct++) tick(ct, mi({}));
    expect(state.deck).toBe(0);
    expect(state.pos.x).toBeCloseTo(1, 3);
    expect(state.pos.z).toBeCloseTo(0.8, 3);
    // facing port, out through the gangway opening: back to the world frame,
    // falling into the sea
    for (let ct = 31; ct <= 80; ct++) tick(ct, mi({ forward: true }));
    expect(state.deck).toBeNull();
    expect(state.pos.y).toBeLessThan(WATER_LEVEL);
  });
});
