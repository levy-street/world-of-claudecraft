// Wickharbor's stilt-pier harbor (src/sim/gale_harbor.ts): every deck's
// surface stays level with its shore anchor and above the waterline, the
// connected deck network joins flush (no step taller than a stride), the
// surface is -Infinity off the planks, and a real player must be able to
// WALK from the shore out to a pier tip through the live movement kernel.

import { describe, expect, it } from 'vitest';
import { resolveMovement } from '../src/sim/colliders';
import { EASTBROOK_HARBOR_DECKS } from '../src/sim/eastbrook_harbor';
import { FERRY_PIER_DECKS } from '../src/sim/ferry_piers';
import {
  GALE_DECK_FREEBOARD,
  GALE_HARBOR_DECKS,
  type GaleDeckDef,
  galeDeckAlong,
  galeDeckContains,
  galeDeckSurface,
  galeDeckSurfaceAt,
} from '../src/sim/gale_harbor';
import { REACH_DECKS } from '../src/sim/reach_decks';
import { groundHeight, terrainHeight, WATER_LEVEL } from '../src/sim/world';

const SEED = 20061;
const terrain = (x: number, z: number): number => terrainHeight(x, z, SEED);

describe('the deck footprint: a rectangle trimmed by straight cuts', () => {
  // a 10 x 4 deck heading +z (rot 0: along = z, across = x), cut by the line x + z = 4 (the
  // deck keeps the side the normal points into, away from the origin)
  const n = Math.SQRT1_2;
  const deck: GaleDeckDef = {
    x: 0,
    z: 0,
    rot: 0,
    hl: 5,
    hw: 2,
    ax: 0,
    az: 0,
    cuts: [{ x: 2, z: 2, nx: -n, nz: -n }],
  };

  it('keeps the rectangle on the cut side, and drops what lies past the cut', () => {
    expect(galeDeckAlong(deck, 0, 0)).toBe(0);
    expect(galeDeckAlong(deck, 1.5, -3)).toBe(-3);
    // inside the rectangle but past the cut line
    expect(galeDeckAlong(deck, 1.9, 4)).toBeNull();
    expect(galeDeckContains(deck, 1.9, 4)).toBe(false);
    // outside the rectangle, whatever the cut says
    expect(galeDeckAlong(deck, 0, 6)).toBeNull();
    expect(galeDeckAlong(deck, 3, 0)).toBeNull();
    // the surface query of a plain rectangle is unchanged by the helper
    const plain: GaleDeckDef = { ...deck, cuts: undefined };
    expect(galeDeckAlong(plain, 1.9, 4)).toBe(4);
  });

  it('insets every edge alike, the cut included', () => {
    // 0.3 from the cut line (x + z = 4), well inside the rectangle
    const onCut = { x: 2 - 0.3 * n, z: 2 - 0.3 * n };
    expect(galeDeckContains(deck, onCut.x, onCut.z, 0.2)).toBe(true);
    expect(galeDeckContains(deck, onCut.x, onCut.z, 0.4)).toBe(false);
    // 0.3 from the rectangle's long side
    expect(galeDeckContains(deck, 1.7, -3, 0.2)).toBe(true);
    expect(galeDeckContains(deck, 1.7, -3, 0.4)).toBe(false);
  });
});

describe('only the Wickharbor harbor carries deck cuts', () => {
  // the other walkway surface queries (Eastbrook's quay, the ferry piers, Palmreach's
  // walkways) lay plain rectangles: a cut on one of their decks would be silently ignored
  it('keeps every other walkway deck a plain rectangle', () => {
    for (const d of [...EASTBROOK_HARBOR_DECKS, ...FERRY_PIER_DECKS, ...REACH_DECKS]) {
      expect(d.cuts, `deck at ${d.x}, ${d.z}`).toBeUndefined();
    }
    expect(GALE_HARBOR_DECKS.some((d) => (d.cuts?.length ?? 0) > 0)).toBe(true);
  });
});

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
    // ten yards past the pier's head there is only sea (its south side is the great quay's)
    const off = {
      x: mid.x + dirx * (pier.hl + 10),
      z: mid.z + dirz * (pier.hl + 10),
    };
    expect(galeDeckSurface(off.x, off.z, terrain, WATER_LEVEL)).toBe(-Infinity);
    expect(groundHeight(off.x, off.z, SEED)).toBeLessThan(WATER_LEVEL);
  });

  it('joins the north shore network flush: no step taller than a stride', () => {
    // walk the seam points where piers meet the boardwalk
    const seams: [number, number][] = [
      [469.5, 351], // north pier root on the boardwalk
      [467, 361.5], // mid pier root near the boardwalk elbow
      [466.4, 366.0], // the boardwalk's south end, where the ferry wharf's flight stands
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
