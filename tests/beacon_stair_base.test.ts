// The Old Beacon's invisible wall (player report: stopped on the open lawn at
// (505, 305) with nothing on screen in the way). beaconSpiralLift is a
// single-valued heightfield, so the ground under the upper balcony IS the
// balcony's deck: the whole column of air below its rim is walled off by the
// player climb gate, and the renderer drew only the deck slab 19yd overhead.
// These pin the SIM side of that diagnosis (the wall is the lift rim, not a
// collider and not terrain steepness, and every walled cell sits inside
// balconyOut under deck2) and then assert the RENDER fix: the blocked volume
// is solid stone on screen, while the stair-foot mouth stays open air.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildGaleFeatures } from '../src/render/gale_features';
import { BEACON_SPIRAL, beaconSpiralLift } from '../src/sim/beacon_spiral';
import { isBlocked } from '../src/sim/colliders';
import { GALECREST_PROPS } from '../src/sim/content/galecrest';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { rideSteepnessAt } from '../src/sim/ride_height';
import { groundHeight, terrainHeight } from '../src/sim/world';

const SEED = 20061;
const S = BEACON_SPIRAL;
const SPOT = { x: 505, z: 305 }; // the reported spot, open lawn beside the tower
const RUN_STEP = 0.35; // one 20Hz tick of run

const at = (bearing: number, r: number): { x: number; z: number } => ({
  x: S.x + Math.sin(bearing) * r,
  z: S.z + Math.cos(bearing) * r,
});
const spotBearing = Math.atan2(SPOT.x - S.x, SPOT.z - S.z);
const spotR = Math.hypot(SPOT.x - S.x, SPOT.z - S.z);

let built: ReturnType<typeof buildGaleFeatures> | null = null;
const galeFeatures = (): ReturnType<typeof buildGaleFeatures> => {
  built ??= buildGaleFeatures(SEED);
  return built;
};

describe('the Old Beacon stair base', () => {
  it('the reported spot is open lawn a step or two outside the upper balcony rim', () => {
    expect(spotR).toBeCloseTo(7.616, 3);
    expect(spotR).toBeGreaterThan(S.balconyOut);
    expect(spotR - S.balconyOut).toBeLessThan(2 * RUN_STEP);
    expect(beaconSpiralLift(SPOT.x, SPOT.z)).toBe(0);
    expect(isBlocked(SEED, SPOT.x, SPOT.z, PLAYER_BODY_RADIUS)).toBe(false);
    expect(rideSteepnessAt(SPOT.x, SPOT.z, SEED)).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE);
  });

  it('the wall is the lift rim alone: no collider, no terrain steepness', () => {
    const outside = at(spotBearing, S.balconyOut + 0.05);
    const inside = at(spotBearing, S.balconyOut - 0.05);
    expect(beaconSpiralLift(outside.x, outside.z)).toBe(0);
    expect(beaconSpiralLift(inside.x, inside.z)).toBeCloseTo(S.deck2, 5);

    const rise = groundHeight(inside.x, inside.z, SEED) - groundHeight(outside.x, outside.z, SEED);
    expect(rise).toBeCloseTo(S.deck2, 2);
    expect(rise / 0.1).toBeGreaterThan(PLAYER_MAX_CLIMB_SLOPE);

    for (const p of [outside, inside]) {
      expect(isBlocked(SEED, p.x, p.z, PLAYER_BODY_RADIUS)).toBe(false);
      expect(rideSteepnessAt(p.x, p.z, SEED)).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE);
    }
    const terrainStep = Math.abs(
      terrainHeight(inside.x, inside.z, SEED) - terrainHeight(outside.x, outside.z, SEED),
    );
    expect(terrainStep).toBeLessThan(0.05);
  });

  it('every walled cell sits inside balconyOut and under deck2', () => {
    let widest = 0;
    let tallest = 0;
    for (let i = 0; i < 720; i++) {
      const bearing = (i / 720) * Math.PI * 2;
      for (let r = S.coreR + 0.05; r <= S.balconyOut + 1.2; r += 0.02) {
        const p = at(bearing, r);
        const lift = beaconSpiralLift(p.x, p.z);
        if (lift <= 0) continue;
        if (r > widest) widest = r;
        if (lift > tallest) tallest = lift;
      }
    }
    expect(widest).toBeLessThanOrEqual(S.balconyOut);
    expect(tallest).toBeCloseTo(S.deck2, 5);
  });

  it('keeps every nearby campfire out of the stair footprint', () => {
    const near = GALECREST_PROPS.campfires.filter(([x, z]) => Math.hypot(x - S.x, z - S.z) < 12);
    expect(near.length).toBeGreaterThan(0);
    for (const [x, z] of near) {
      const d = Math.hypot(x - S.x, z - S.z);
      // props seat on terrainHeight while the stair rides groundHeight, so a
      // campfire inside the lift footprint is buried in the plinth AND its
      // height-less collider pinches the flight overhead
      expect(beaconSpiralLift(x, z), `campfire (${x}, ${z}) under the stair`).toBe(0);
      expect(groundHeight(x, z, SEED)).toBeCloseTo(terrainHeight(x, z, SEED), 5);
      expect(d, `campfire (${x}, ${z}) inside the lift gate`).toBeGreaterThan(S.balconyOut + 0.6);
      // and off the stair-foot approach, which the mouth leaves open
      const bearing = ((Math.atan2(x - S.x, z - S.z) * 180) / Math.PI + 360) % 360;
      expect(bearing < 116 || bearing > 138, `campfire (${x}, ${z}) in the mouth`).toBe(true);
    }
  });

  it('draws the blocked volume as solid stone from the lawn up', () => {
    const view = galeFeatures();
    const lawnY = terrainHeight(SPOT.x, SPOT.z, SEED);
    const inward = new THREE.Vector3(S.x - SPOT.x, 0, S.z - SPOT.z).normalize();
    for (const eye of [0.6, 1.4, 6, 12, 17, 18.5]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(SPOT.x, lawnY + eye, SPOT.z), inward, 0, 4);
      const hits = ray.intersectObject(view.group, true);
      expect(hits.length, `masonry at eye ${eye}`).toBeGreaterThan(0);
      expect(hits[0].distance, `rim face at eye ${eye}`).toBeCloseTo(spotR - S.balconyOut, 1);
    }
  });

  it('never draws masonry wider than the rim that blocks the step', () => {
    const view = galeFeatures();
    let widest = 0;
    for (let i = 0; i < 360; i++) {
      const bearing = (i / 360) * Math.PI * 2;
      const o = at(bearing, 12);
      const ray = new THREE.Raycaster(
        new THREE.Vector3(o.x, terrainHeight(o.x, o.z, SEED) + 1, o.z),
        new THREE.Vector3(S.x - o.x, 0, S.z - o.z).normalize(),
        0,
        12 - S.coreR,
      );
      const hits = ray.intersectObject(view.group, true);
      if (hits.length) widest = Math.max(widest, 12 - hits[0].distance);
    }
    expect(widest).toBeGreaterThan(S.balconyOut - 0.1);
    expect(widest).toBeLessThan(S.balconyOut + 0.1);
  });

  it('leaves the stair-foot mouth open air, so the approach is unchanged', () => {
    const view = galeFeatures();
    const mouthBearing = S.a0 + (S.balcony2End + Math.PI * 2) / 2;
    const start = at(mouthBearing, S.balconyOut + 0.6);
    const end = at(mouthBearing, S.coreR + 0.4);
    expect(beaconSpiralLift(start.x, start.z)).toBe(0);
    expect(beaconSpiralLift(end.x, end.z)).toBe(0);

    const lawnY = terrainHeight(start.x, start.z, SEED);
    const inward = new THREE.Vector3(S.x - start.x, 0, S.z - start.z).normalize();
    const reach = S.balconyOut + 0.6 - (S.coreR + 0.4);
    const ray = new THREE.Raycaster(
      new THREE.Vector3(start.x, lawnY + 1.4, start.z),
      inward,
      0,
      reach,
    );
    expect(ray.intersectObject(view.group, true).length).toBe(0);
  });
});
