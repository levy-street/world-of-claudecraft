// The online client's movement prediction on a sailing ship's deck (Phase 3
// of the Eastbrook ferry). The reconciling predictor (self_prediction.ts)
// replays the local player's input through the same kernel the server runs
// (src/sim/player_motion.ts); this module is the step it replays with, made
// deck-aware the way the server's tick is (src/sim/transport_ferry.ts):
//  - the deck under way is solved as a kinematic platform placed at the
//    ship's pose for the step's schedule clock (the same DeckPlatform the
//    server builds, src/sim/transport_deck.ts), so walking, jumping, the
//    stairs and the rails predict exactly;
//  - while the player is aboard, the predicted state is kept in the HULL'S
//    FRAME (position x port, z bow; heading off the bow; velocity turned
//    with it; height left in world yards, since the sim's hull never heaves,
//    so every vertical test lands on the same tick bit for bit as the
//    server's). The ship's own motion then cancels out
//    of the prediction: a guess of which server tick consumes a frame (the
//    clock estimate) can only nudge the step's heading by a hair of the
//    ship's turn, never slide the player a yard along its course. The server
//    acknowledges a deck-frame pose (`rdk` on the reconciliation wire), so a
//    replay starts from the same frame it predicts in;
//  - a world-frame state standing on a ship that casts off is carried with
//    it exactly like the server carries it, then continues in the deck frame;
//    one that walks off the gangway opening drops back to the world frame
//    and falls into the sea.
// Pure (no three.js, no DOM): tests/deck_prediction.test.ts steps it against
// the live Sim.

import type { Collider } from '../sim/colliders';
import { TRANSPORT_ROUTES, TRANSPORT_SHIP_HULLS } from '../sim/content/transport_ships';
import { type PlayerMotionDeps, stepPlayerMotion } from '../sim/player_motion';
import {
  aboardDeck,
  carryWithDeck,
  DeckPlatform,
  deckToWorld,
  nearDeck,
  worldToDeck,
} from '../sim/transport_deck';
import {
  newTransportPhaseState,
  type TransportPose,
  transportShipPoseAt,
} from '../sim/transport_schedule';
import type { ShipHullLayout } from '../sim/transport_ship';
import { DT, type Entity, normAngle } from '../sim/types';
import { WATER_LEVEL } from '../sim/world';
import type { MotionState, PredictionFrame, PredictionStep } from './self_prediction_core';

interface RouteSlot {
  hull: ShipHullLayout;
  platform: DeckPlatform;
  now: TransportPose;
  prev: TransportPose;
  sailingNow: boolean;
  sailingPrev: boolean;
}

const pt = { x: 0, z: 0 };

function rotate(x: number, z: number, rot: number, out: { x: number; z: number }): void {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  out.x = x * c + z * s;
  out.z = -x * s + z * c;
}

/** A deck-frame state into the world at `pose` (position, facing unless the
 *  frame already set a world heading, velocity). */
function toWorld(state: MotionState, pose: TransportPose, worldFacing: boolean): void {
  deckToWorld(pose, state.pos.x, state.pos.z, pt);
  state.pos.x = pt.x;
  state.pos.z = pt.z;
  deckToWorld(pose, state.prevPos.x, state.prevPos.z, pt);
  state.prevPos.x = pt.x;
  state.prevPos.z = pt.z;
  if (!worldFacing) state.facing = normAngle(state.facing + pose.rot);
  rotate(state.vx, state.vz, pose.rot, pt);
  state.vx = pt.x;
  state.vz = pt.z;
}

/** A world state into the frame of the ship at `pose`. */
function toDeck(state: MotionState, pose: TransportPose): void {
  worldToDeck(pose, state.pos.x, state.pos.z, pt);
  state.pos.x = pt.x;
  state.pos.z = pt.z;
  worldToDeck(pose, state.prevPos.x, state.prevPos.z, pt);
  state.prevPos.x = pt.x;
  state.prevPos.z = pt.z;
  state.facing = normAngle(state.facing - pose.rot);
  rotate(state.vx, state.vz, -pose.rot, pt);
  state.vx = pt.x;
  state.vz = pt.z;
}

/**
 * The prediction step: `deps` is the client's kernel binding (its `platform`
 * is taken over here), `clockFor` the schedule clock the server will most
 * likely run a given client tick at.
 */
export function createDeckAwareStep(
  deps: PlayerMotionDeps,
  clockFor: (clientTick: number) => number,
): PredictionStep {
  const slots: (RouteSlot | null)[] = TRANSPORT_ROUTES.map((route) => {
    const hull = Object.hasOwn(TRANSPORT_SHIP_HULLS, route.ship)
      ? TRANSPORT_SHIP_HULLS[route.ship]
      : null;
    if (!hull) return null;
    return {
      hull,
      platform: new DeckPlatform(hull),
      now: { x: 0, z: 0, rot: 0 },
      prev: { x: 0, z: 0, rot: 0 },
      sailingNow: false,
      sailingPrev: false,
    };
  });
  const phase = newTransportPhaseState();
  let platform: readonly Collider[] | null = null;
  const stepDeps: PlayerMotionDeps = { ...deps, platform: () => platform };
  return (state: MotionState, frame: PredictionFrame): void => {
    const clock = clockFor(frame.ct);
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!slot) continue;
      const route = TRANSPORT_ROUTES[i];
      transportShipPoseAt(route, clock, slot.now, phase);
      slot.sailingNow = phase.phase === 'sailing';
      transportShipPoseAt(route, clock - DT, slot.prev, phase);
      slot.sailingPrev = phase.phase === 'sailing';
    }
    const body = state as Entity;
    const onDeck = state.deck ?? null;
    const slot = onDeck === null ? null : (slots[onDeck] ?? null);
    if (slot && onDeck !== null) {
      toWorld(state, slot.now, frame.facing !== null);
      // the deck stays under their feet even on the tick it moors: the moored
      // deck's grid gates follow the last snapshot's clock, a step or two
      // behind this predicted one (the platform and an open gate are the same
      // geometry, so both at once changes nothing)
      platform = slot.platform.at(slot.now, WATER_LEVEL);
      stepPlayerMotion(stepDeps, body, frame.mi);
      if (
        slot.sailingNow &&
        aboardDeck(slot.hull, slot.now, WATER_LEVEL, body.pos.x, body.pos.y, body.pos.z)
      ) {
        toDeck(state, slot.now);
      } else {
        // off the deck (overboard), or the ship has moored: the world frame
        state.deck = null;
      }
      return;
    }
    state.deck = null;
    let boarded = -1;
    platform = null;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s || !(s.sailingNow || s.sailingPrev)) continue;
      const p = body.pos;
      if (aboardDeck(s.hull, s.prev, WATER_LEVEL, p.x, p.y, p.z)) {
        // the server carries a body standing on a ship that moves, before
        // the step (its prevPos is the carried spot too)
        carryWithDeck(s.prev, s.now, body);
        body.prevPos.x = body.pos.x;
        body.prevPos.y = body.pos.y;
        body.prevPos.z = body.pos.z;
        boarded = i;
      }
      if (s.sailingNow && nearDeck(s.hull, s.now, body.pos.x, body.pos.z)) {
        platform = s.platform.at(s.now, WATER_LEVEL);
      }
    }
    stepPlayerMotion(stepDeps, body, frame.mi);
    const s = boarded >= 0 ? slots[boarded] : null;
    if (
      s?.sailingNow &&
      aboardDeck(s.hull, s.now, WATER_LEVEL, body.pos.x, body.pos.y, body.pos.z)
    ) {
      toDeck(state, s.now);
      state.deck = boarded;
    }
  };
}
