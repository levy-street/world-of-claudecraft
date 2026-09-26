import { describe, expect, it } from 'vitest';
import {
  advanceDeckFrame,
  deckCameraTurn,
  deckFramedPose,
  deckFrameFor,
  entityRenderPose,
  updateSelfRenderOnDeck,
} from '../src/render/deck_frame';
import { sampleStandingSurface } from '../src/render/entity_ground_sample';
import { createEntityGroundSample } from '../src/render/entity_ground_sample_core';
import { createSelfRenderPositionState } from '../src/render/self_render_position_core';
import {
  newWakeParticles,
  stepWakeParticles,
  WAKE_MIN_SPEED,
  type WakeEmitter,
  wakeParticleAlpha,
} from '../src/render/ship_wake_core';
import { EASTBROOK_NIGHTBLOOM_FERRY } from '../src/sim/content/transport_ships';
import { deckToWorld, worldToDeck } from '../src/sim/transport_deck';
import {
  emptyTransportFerryView,
  type TransportPose,
  transportFerryViewAt,
  transportShipPoseAt,
} from '../src/sim/transport_schedule';
import type { Entity } from '../src/sim/types';
import { WATER_LEVEL } from '../src/sim/world';

// The renderer's view of a sailing ship's frame (src/render/deck_frame.ts):
// passengers are drawn deck-relative on the DRAWN ship, the local player's
// display pose runs in the hull frame, and the chase camera rides the deck.
// Plus the wake and bow splash particle math (src/render/ship_wake_core.ts).

const ROUTE = EASTBROOK_NIGHTBLOOM_FERRY;
const SAILING = ROUTE.timings.docked + 40;

function world(clock: number) {
  const view = emptyTransportFerryView(ROUTE);
  const w = {
    cfg: { seed: 1 },
    clock,
    ferryView: () => transportFerryViewAt(ROUTE, w.clock, WATER_LEVEL, true, view),
  };
  return w;
}

function pose(clock: number): TransportPose {
  return transportShipPoseAt(ROUTE, clock, { x: 0, z: 0, rot: 0 });
}

/** An offline passenger standing at deck spot (lx, lz) at `clock`. */
function passenger(clock: number, lx: number, lz: number): Entity {
  const at = deckToWorld(pose(clock), lx, lz, { x: 0, z: 0 });
  const p = { x: at.x, y: WATER_LEVEL + 3.3, z: at.z };
  return {
    pos: { ...p },
    prevPos: { ...p },
    facing: pose(clock).rot,
    prevFacing: pose(clock).rot,
    ferryRide: { route: ROUTE.id, from: 0, to: 1, ship: pose(clock) },
  } as unknown as Entity;
}

describe('the deck frame', () => {
  it('draws a passenger on the drawn deck, at their deck spot, whatever the drawn clock', () => {
    const w = world(SAILING);
    const df = deckFrameFor(w);
    advanceDeckFrame(df, w, 0.016);
    const p = passenger(SAILING, 1.2, -3);
    // the drawn clock trails the world's (a glide), yet the body sits on the
    // drawn deck exactly at its spot
    w.clock = SAILING + 0.05;
    advanceDeckFrame(df, w, 0.016);
    const out = { x: 0, y: 0, z: 0, facing: 0 };
    const p2 = passenger(SAILING + 0.05, 1.2, -3);
    expect(deckFramedPose(df, p2, 0.5, out)).toBe(true);
    const spot = worldToDeck(df.ships[0].drawn, out.x, out.z, { x: 0, z: 0 });
    expect(spot.x).toBeCloseTo(1.2, 9);
    expect(spot.z).toBeCloseTo(-3, 9);
    expect(out.y).toBeCloseTo(WATER_LEVEL + 3.3, 9);
    expect(out.facing).toBeCloseTo(df.ships[0].drawn.rot, 9);
    void p;
  });

  it('interpolates an online passenger between the wire deck spots', () => {
    const w = world(SAILING);
    const df = deckFrameFor(w);
    advanceDeckFrame(df, w, 0.016);
    const e = {
      pos: { x: 0, y: 0, z: 0 },
      prevPos: { x: 0, y: 0, z: 0 },
      ferryRiding: true,
      ferryDeck: { route: 0, x: 2, y: 3.3, z: 4, f: 0.2 },
      ferryDeckPrev: { route: 0, x: 0, y: 3.3, z: 4, f: 0 },
    } as unknown as Entity;
    const out = entityRenderPose(w, e, 0.25, null);
    const spot = worldToDeck(df.ships[0].drawn, out.x, out.z, { x: 0, z: 0 });
    expect(spot.x).toBeCloseTo(0.5, 9);
    expect(spot.z).toBeCloseTo(4, 9);
    expect(out.facing).toBeCloseTo(df.ships[0].drawn.rot + 0.05, 9);
  });

  it('draws everyone else by plain interpolation, and the local player at its display pose', () => {
    const w = world(SAILING);
    const e = {
      pos: { x: 10, y: 1, z: 0 },
      prevPos: { x: 0, y: 1, z: 0 },
      facing: 1,
      prevFacing: 0,
    } as unknown as Entity;
    const out = entityRenderPose(w, e, 0.3, null);
    expect(out.x).toBeCloseTo(3, 9);
    expect(out.facing).toBeCloseTo(0.3, 9);
    const self = entityRenderPose(w, e, 0.3, { x: 7, y: 8, z: 9 });
    expect([self.x, self.y, self.z]).toEqual([7, 8, 9]);
  });

  it('keeps a passenger standing still glued to the drawn deck frame after frame', () => {
    const w = world(SAILING);
    const state = createSelfRenderPositionState();
    let clock = SAILING;
    const spots: { x: number; z: number }[] = [];
    for (let frame = 0; frame < 120; frame++) {
      // the world ticks every third frame (20 Hz under 60 fps)
      if (frame % 3 === 0) clock += 0.05;
      w.clock = clock;
      const p = passenger(clock, -2, 6);
      updateSelfRenderOnDeck(w, state, p, (frame % 3) / 3, 1 / 60, 0, null, false);
      const df = deckFrameFor(w);
      spots.push(
        worldToDeck(df.ships[0].drawn, state.position.x, state.position.z, { x: 0, z: 0 }),
      );
    }
    for (const s of spots.slice(5)) {
      expect(s.x).toBeCloseTo(-2, 6);
      expect(s.z).toBeCloseTo(6, 6);
    }
    // and the ship really moved under them
    expect(
      Math.hypot(pose(clock).x - pose(SAILING).x, pose(clock).z - pose(SAILING).z),
    ).toBeGreaterThan(20);
  });

  it('carries the camera spring with the deck and turns the view with the hull', () => {
    const w = world(ROUTE.timings.docked + 16);
    const df = deckFrameFor(w);
    advanceDeckFrame(df, w, 0.05);
    const p = passenger(w.clock, 0, 0);
    const state = createSelfRenderPositionState();
    updateSelfRenderOnDeck(w, state, p, 1, 0.05, 0, null, false);
    w.clock += 0.05;
    updateSelfRenderOnDeck(w, state, passenger(w.clock, 0, 0), 1, 0.05, 0, null, false);
    const ship = df.ships[0];
    const at = deckToWorld(ship.last, 1, -5, { x: 0, z: 0 });
    const boom = { x: at.x, z: at.z, vx: 1, vz: 0 };
    const last = { x: at.x, z: at.z };
    const mirror = { yaw: 0.5 };
    const turn = deckCameraTurn(w, boom, last, mirror);
    const spot = worldToDeck(ship.drawn, boom.x, boom.z, { x: 0, z: 0 });
    expect(spot.x).toBeCloseTo(1, 9);
    expect(spot.z).toBeCloseTo(-5, 9);
    expect(last.x).toBeCloseTo(boom.x, 9);
    expect(turn).not.toBe(0);
    expect(mirror.yaw).toBeCloseTo(0.5 + turn, 12);
    expect(Math.hypot(boom.vx, boom.vz)).toBeCloseTo(1, 9);
    // off the deck, nothing moves
    const off = world(5);
    const idle = { x: 3, z: 4, vx: 0, vz: 0 };
    expect(deckCameraTurn(off, idle, null, mirror)).toBe(0);
    expect(idle).toEqual({ x: 3, z: 4, vx: 0, vz: 0 });
  });
});

describe('a passenger stands on the drawn deck (the departure T-pose)', () => {
  // Bug: the renderer's airborne heuristic compared a passenger's feet with
  // the standing surface under them, which knew the terrain and the static
  // collider grid only. Once the ship cast off the moored deck left the grid,
  // so every passenger read three yards in the air and held the jump pose
  // (clamped, arms out) for the whole voyage.
  it('reads the sailing deck as the standing surface, at the drawn pose', () => {
    const w = { ...world(SAILING), riftFloor: null };
    const df = deckFrameFor(w);
    advanceDeckFrame(df, w, 0.016);
    const drawn = df.ships[0].drawn;
    const deckY = WATER_LEVEL + 3.3;
    const at = deckToWorld(drawn, -2, 3, { x: 0, z: 0 });
    const sample = createEntityGroundSample();
    expect(sampleStandingSurface(sample, w, at.x, deckY, at.z, 1 / 60, true)).toBeCloseTo(deckY, 6);
    // off the hull it is the sea again
    const off = deckToWorld(drawn, 12, 3, { x: 0, z: 0 });
    expect(sampleStandingSurface(sample, w, off.x, deckY, off.z, 1 / 60, true)).toBeLessThan(
      WATER_LEVEL,
    );
  });

  it('serves a body on the deck straight from it, never resampling the sea floor', () => {
    // under way the deck carries a body past the ground cache's displacement
    // gate every frame, so the terrain below would be resampled all voyage
    const w = { ...world(SAILING), riftFloor: null };
    const df = deckFrameFor(w);
    advanceDeckFrame(df, w, 0.016);
    const deckY = WATER_LEVEL + 3.3;
    const sample = createEntityGroundSample();
    for (let i = 0; i < 5; i++) {
      w.clock += 0.05;
      advanceDeckFrame(df, w, 0.05);
      const at = deckToWorld(df.ships[0].drawn, 1, -2, { x: 0, z: 0 });
      expect(sampleStandingSurface(sample, w, at.x, deckY, at.z, 0.05, false)).toBeCloseTo(
        deckY,
        6,
      );
    }
    expect(sample.valid).toBe(false);
  });

  it('counts only the passenger steps as locomotion, never the ship way', () => {
    const w = world(SAILING);
    const df = deckFrameFor(w);
    advanceDeckFrame(df, w, 0.016);
    const p = passenger(SAILING, 1, 1);
    const last = { lastX: 0, lastZ: 0 };
    const first = entityRenderPose(w, p, 1, null, last);
    last.lastX = first.x;
    last.lastZ = first.z;
    // the ship moves a frame on; the passenger stands still on the deck
    w.clock = SAILING + 0.05;
    advanceDeckFrame(df, w, 0.05);
    const p2 = passenger(SAILING + 0.05, 1, 1);
    const next = entityRenderPose(w, p2, 1, null, last);
    const shipMoved = Math.hypot(
      df.ships[0].drawn.x - df.ships[0].last.x,
      df.ships[0].drawn.z - df.ships[0].last.z,
    );
    expect(shipMoved).toBeGreaterThan(0.1);
    // the remembered spot rode with the deck: no displacement is left over
    expect(Math.hypot(next.x - last.lastX, next.z - last.lastZ)).toBeLessThan(1e-6);
  });
});

describe('the wake and bow splash (pure)', () => {
  const ship: WakeEmitter = {
    x: 0,
    z: 0,
    rot: 0,
    baseY: WATER_LEVEL,
    speed: 16,
    sternX: 0,
    sternZ: -15,
    bowX: 0,
    bowY: 0,
    bowZ: 15,
    sternHalfBeam: 3.4,
  };

  it('emits with speed, lays foam in the world, and lets it fade', () => {
    const p = newWakeParticles(200);
    for (let i = 0; i < 60; i++) stepWakeParticles(p, ship, 1 / 60);
    expect(p.live).toBeGreaterThan(20);
    // foam lies on the water behind the stern; spray flies off the bow
    let foamBehind = 0;
    for (let i = 0; i < p.capacity; i++) {
      if (wakeParticleAlpha(p, i) <= 0) continue;
      if (p.kind[i] === 0 && p.pz[i] < -10) foamBehind++;
    }
    expect(foamBehind).toBeGreaterThan(5);
    // a moored or creeping ship leaves nothing new, and the rest fades out
    const slow = { ...ship, speed: WAKE_MIN_SPEED / 2 };
    for (let i = 0; i < 60 * 6; i++) stepWakeParticles(p, slow, 1 / 60);
    expect(p.live).toBe(0);
  });

  it('is deterministic, and thinner on the low tier', () => {
    const run = (scale: number) => {
      const p = newWakeParticles(200);
      for (let i = 0; i < 30; i++) stepWakeParticles(p, ship, 1 / 30, scale);
      return p;
    };
    expect(Array.from(run(1).px)).toEqual(Array.from(run(1).px));
    expect(run(0.5).live).toBeLessThan(run(1).live);
  });
});
