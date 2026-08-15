// The Old Beacon's walkable stair (src/sim/beacon_spiral.ts): two flights
// of stone treads hug the tower column with no gap, each climbing at a
// slope the player climb gate accepts, the two C balconies hold flat at
// their deck heights with the mouth left open, the tower column refuses
// footing, and a real player must be able to WALK the whole way from the
// lawn up to the SECOND balcony through the live movement kernel.

import { describe, expect, it } from 'vitest';
import { BEACON_SPIRAL, beaconDeckHeightAt, beaconSpiralLift } from '../src/sim/beacon_spiral';
import { resolveMovement } from '../src/sim/colliders';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';

const SEED = 20061;
const S = BEACON_SPIRAL;
const stairMid = (S.coreR + S.stairOut) / 2;
const pathPoint = (rel: number): { x: number; z: number } => {
  const onBalcony =
    (rel > S.flight1End && rel <= S.balcony1End) || (rel > S.flight2End && rel <= S.balcony2End);
  const r = onBalcony ? (S.coreR + S.balconyOut) / 2 : stairMid;
  const a = S.a0 + rel;
  return { x: S.x + Math.sin(a) * r, z: S.z + Math.cos(a) * r };
};

describe('the Beacon stair surface', () => {
  it('climbs both flights under the climb gate, never dropping', () => {
    const steps = 300;
    let prev = groundHeight(pathPoint(0).x, pathPoint(0).z, SEED);
    for (let i = 1; i <= steps; i++) {
      const rel = (i / steps) * (S.balcony2End - 0.02);
      const p = pathPoint(rel);
      const h = groundHeight(p.x, p.z, SEED);
      const stepLen = ((S.balcony2End - 0.02) * stairMid) / steps;
      const slope = (h - prev) / stepLen;
      expect(slope, `slope at rel=${rel.toFixed(2)}`).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE);
      expect(h - prev, `no drop at rel=${rel.toFixed(2)}`).toBeGreaterThan(-0.6);
      prev = h;
    }
    expect(beaconDeckHeightAt(S.flight1End + 0.01)).toBeCloseTo(S.deck1, 5);
    expect(beaconDeckHeightAt(S.flight2End + 0.01)).toBeCloseTo(S.deck2, 5);
  });

  it('hugs the column: the tread band starts at the plug face with no gap', () => {
    const rel = S.flight1End * 0.5;
    const a = S.a0 + rel;
    const inner = beaconSpiralLift(
      S.x + Math.sin(a) * (S.coreR + 0.05),
      S.z + Math.cos(a) * (S.coreR + 0.05),
    );
    expect(inner).toBeCloseTo(beaconDeckHeightAt(rel), 5);
  });

  it('holds both balconies flat at their decks, wider than the stair', () => {
    const rBalc = (S.coreR + S.balconyOut) / 2;
    for (let i = 0; i <= 8; i++) {
      const rel1 = S.flight1End + 0.02 + (i / 8) * (S.balcony1End - S.flight1End - 0.04);
      const a1 = S.a0 + rel1;
      expect(beaconSpiralLift(S.x + Math.sin(a1) * rBalc, S.z + Math.cos(a1) * rBalc)).toBeCloseTo(
        S.deck1,
        5,
      );
      const rel2 = S.flight2End + 0.02 + (i / 8) * (S.balcony2End - S.flight2End - 0.04);
      const a2 = S.a0 + rel2;
      expect(beaconSpiralLift(S.x + Math.sin(a2) * rBalc, S.z + Math.cos(a2) * rBalc)).toBeCloseTo(
        S.deck2,
        5,
      );
    }
    expect(S.balconyOut).toBeGreaterThan(S.stairOut);
    // past the top balcony's end the mouth opens: nothing over the stair foot
    const mouthA = S.a0 + S.balcony2End + 0.06;
    expect(beaconSpiralLift(S.x + Math.sin(mouthA) * rBalc, S.z + Math.cos(mouthA) * rBalc)).toBe(
      0,
    );
  });

  it('keeps the column unwalkable', () => {
    expect(beaconSpiralLift(S.x, S.z)).toBe(S.coreH);
    const rim = S.coreR + 0.2;
    const inside = S.coreR - 0.2;
    const a = S.a0 + (S.flight2End + S.balcony2End) / 2;
    const rise =
      beaconSpiralLift(S.x + Math.sin(a) * inside, S.z + Math.cos(a) * inside) -
      beaconSpiralLift(S.x + Math.sin(a) * rim, S.z + Math.cos(a) * rim);
    expect(rise / 0.4).toBeGreaterThan(PLAYER_MAX_CLIMB_SLOPE);
  });

  it('is zero away from the Beacon', () => {
    expect(beaconSpiralLift(S.x + 20, S.z)).toBe(0);
    expect(beaconSpiralLift(420, 360)).toBe(0);
    expect(beaconSpiralLift(S.x, S.z + S.balconyOut + 1)).toBe(0);
  });

  it('a REAL player (the live kernel through Sim.tick) climbs to the upper balcony', () => {
    // The regression that motivated this: the movement kernel's destination
    // steepness gate sampled the raised deck itself, so the stair's tall rims
    // poisoned whole steepness cells and walled the climb off. Drive the
    // actual per-tick player path: facing + forward intent, full Sim ticks.
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    const p = sim.player;
    p.pos.x = 505;
    p.pos.z = 300;
    p.pos.y = groundHeight(505, 300, SEED);
    p.prevPos = { ...p.pos };
    const goalRel = S.flight2End + (S.balcony2End - S.flight2End) * 0.4;
    const waypoints: { x: number; z: number }[] = [pathPoint(0.02)];
    for (let rel = 0.08; rel < goalRel; rel += 0.07) waypoints.push(pathPoint(rel));
    waypoints.push(pathPoint(goalRel));
    const mv = sim.moveInput;
    for (const wp of waypoints) {
      for (let i = 0; i < 20 * 6; i++) {
        p.facing = Math.atan2(wp.x - p.pos.x, wp.z - p.pos.z);
        mv.forward = true;
        sim.tick();
        if (Math.hypot(p.pos.x - wp.x, p.pos.z - wp.z) < 0.7) break;
      }
    }
    mv.forward = false;
    const lawnH = groundHeight(S.x + 12, S.z, SEED);
    const finalH = groundHeight(p.pos.x, p.pos.z, SEED);
    expect(finalH - lawnH, 'the live kernel reached the upper balcony').toBeGreaterThan(
      S.deck2 - 2.5,
    );
    expect(Math.hypot(p.pos.x - S.x, p.pos.z - S.z)).toBeLessThan(S.balconyOut + 0.6);
  });

  it('a player can walk from the lawn all the way to the upper balcony', () => {
    const foot = pathPoint(0.02);
    let x = foot.x;
    let z = foot.z;
    const steps = 190;
    const goalRel = S.flight2End + (S.balcony2End - S.flight2End) * 0.5;
    for (let i = 1; i <= steps; i++) {
      const target = pathPoint(Math.min(goalRel, (i / (steps - 8)) * goalRel));
      const step = resolveMovement(SEED, x, z, target.x, target.z, 0.5);
      x = step.x;
      z = step.z;
    }
    const finalH = groundHeight(x, z, SEED);
    const lawnH = groundHeight(S.x + 12, S.z, SEED);
    expect(finalH - lawnH, 'stood on the upper balcony').toBeGreaterThan(S.deck2 - 2.5);
    expect(Math.hypot(x - S.x, z - S.z), 'hugging the tower').toBeLessThan(S.balconyOut + 0.6);
  });
});
