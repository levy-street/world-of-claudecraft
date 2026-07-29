// Wickharbor's stilt-pier harbor (src/sim/gale_harbor.ts): every deck's
// surface stays level with its shore anchor and above the waterline, the
// connected deck network joins flush (no step taller than a stride), the
// surface is -Infinity off the planks, and a real player must be able to
// WALK from the shore out to a pier tip through the live movement kernel.

import { describe, expect, it } from 'vitest';
import { resolveMovement } from '../src/sim/colliders';
import {
  GALE_DECK_FREEBOARD,
  GALE_HARBOR_DECKS,
  galeDeckSurface,
  galeDeckSurfaceAt,
} from '../src/sim/gale_harbor';
import { groundHeight, terrainHeight, WATER_LEVEL } from '../src/sim/world';

const SEED = 20061;
const terrain = (x: number, z: number): number => terrainHeight(x, z, SEED);

describe('the harbor decks', () => {
  it('anchors every deck to dry shore ground, above the waterline', () => {
    for (const d of GALE_HARBOR_DECKS) {
      expect(terrain(d.ax, d.az), `anchor of deck at ${d.x},${d.z}`).toBeGreaterThan(WATER_LEVEL);
      for (const along of [-d.hl, 0, d.hl]) {
        const y = galeDeckSurfaceAt(d, along, terrain, WATER_LEVEL);
        expect(y, `surface of deck at ${d.x},${d.z}`).toBeGreaterThan(
          WATER_LEVEL + GALE_DECK_FREEBOARD - 1e-6,
        );
      }
    }
  });

  it('lifts groundHeight to the plank plane on a pier and not beside it', () => {
    const pier = GALE_HARBOR_DECKS[0];
    const dirx = Math.sin(pier.rot);
    const dirz = Math.cos(pier.rot);
    const mid = { x: pier.x, z: pier.z };
    const onDeck = groundHeight(mid.x, mid.z, SEED);
    expect(onDeck).toBeCloseTo(galeDeckSurfaceAt(pier, 0, terrain, WATER_LEVEL), 5);
    // ten yards off the pier's seaward side there is only sea
    const off = {
      x: mid.x - dirz * (pier.hw + 10),
      z: mid.z + dirx * (pier.hw + 10),
    };
    expect(galeDeckSurface(off.x, off.z, terrain, WATER_LEVEL)).toBe(-Infinity);
    expect(groundHeight(off.x, off.z, SEED)).toBeLessThan(WATER_LEVEL);
  });

  it('joins the north shore network flush: no step taller than a stride', () => {
    // walk the seam points where piers meet the boardwalk
    const seams: [number, number][] = [
      [469.5, 351], // north pier root on the boardwalk
      [467, 361.5], // mid pier root near the boardwalk elbow
      [453.5, 375.5], // ramp's south end at the deepwater pier root
    ];
    for (const [x, z] of seams) {
      const here = groundHeight(x, z, SEED);
      for (const [ox, oz] of [
        [1.2, 0],
        [-1.2, 0],
        [0, 1.2],
        [0, -1.2],
      ]) {
        const there = groundHeight(x + ox, z + oz, SEED);
        expect(Math.abs(there - here), `step at seam ${x},${z}`).toBeLessThan(1.1);
      }
    }
  });

  it('a player can walk from the shore out to the north pier tip', () => {
    const pier = GALE_HARBOR_DECKS[0];
    const dirx = Math.sin(pier.rot);
    const dirz = Math.cos(pier.rot);
    // start on dry land behind the boardwalk root
    let x = 468;
    let z = 347.5;
    const tip = { x: pier.x + dirx * (pier.hl - 1), z: pier.z + dirz * (pier.hl - 1) };
    // onto the boardwalk, then out along the pier centerline
    const waypoints = [{ x: 468.5, z: 351 }, { x: pier.x, z: pier.z }, tip];
    for (const wp of waypoints) {
      for (let i = 0; i < 60; i++) {
        const step = resolveMovement(SEED, x, z, wp.x, wp.z, 0.5);
        x = step.x;
        z = step.z;
        if (Math.hypot(x - wp.x, z - wp.z) < 0.6) break;
      }
    }
    expect(Math.hypot(x - tip.x, z - tip.z), 'reached the pier tip').toBeLessThan(1.5);
    const h = groundHeight(x, z, SEED);
    expect(h, 'standing on planks over the sea').toBeGreaterThan(WATER_LEVEL + 0.5);
    expect(terrain(x, z), 'water below the deck').toBeLessThan(WATER_LEVEL);
  });
});
