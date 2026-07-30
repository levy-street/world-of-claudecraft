// Keeper Bram keeps the Old Beacon from its MID-LEVEL BALCONY: the wide
// railed deck where the stair's second flight tops out (BEACON_SPIRAL.deck2,
// +19 on a tower that stands about 40 tall). The bug this pins: his authored
// pos sat 2.83 yd from the tower axis, INSIDE the unwalkable column plug
// (coreR 2.9), so the spawn-time ground snap handed him the plug's sheer
// height (coreH 45) and he floated on the roof cap above the lamp. Nothing
// corrected it because Sim.findSafePos only rejects spots that are too LOW,
// blocked, or wet, never implausibly high.

import { describe, expect, it } from 'vitest';
import { BEACON_SPIRAL, beaconSpiralLift } from '../src/sim/beacon_spiral';
import { GALECREST_NPCS } from '../src/sim/content/galecrest';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { groundHeight, terrainHeight, waterLevel } from '../src/sim/world';

const SEED = 20061; // the fixed world seed (WORLD_SEED in src/main.ts and server/game.ts)
const S = BEACON_SPIRAL;
/** the rendered tower stack tops out just under this; the roof cap is above it */
const ROOF_CAP_LIFT = 40;
/** how far he must stay from every edge of the deck2 balcony region */
const DECK_EDGE_MARGIN = 0.5;

const bramDef = GALECREST_NPCS.keeper_bram;

const spawnedBram = (): Entity => {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
  const bram = [...sim.entities.values()].find(
    (e) => e.kind === 'npc' && e.templateId === 'keeper_bram',
  );
  expect(bram, 'Keeper Bram spawned in the built-in world').toBeDefined();
  return bram as Entity;
};

describe('Keeper Bram stands on the Old Beacon balcony', () => {
  it('is authored on the upper balcony deck, clear of the column plug', () => {
    const d = Math.hypot(bramDef.pos.x - S.x, bramDef.pos.z - S.z);
    expect(d, 'outside the unwalkable tower column').toBeGreaterThan(S.coreR);
    expect(d, 'inside the balcony rim').toBeLessThan(S.balconyOut);
    expect(beaconSpiralLift(bramDef.pos.x, bramDef.pos.z), 'on the deck2 balcony').toBe(S.deck2);
  });

  it('spawns one deck2 above the terrain, not on the roof cap', () => {
    const bram = spawnedBram();
    const lift = bram.pos.y - terrainHeight(bram.pos.x, bram.pos.z, SEED);
    expect(lift, 'standing on the mid-level balcony').toBeCloseTo(S.deck2, 6);
    expect(lift, 'not floating above the lamp on the roof cap').toBeLessThan(ROOF_CAP_LIFT);
  });

  it('keeps the authored spot: findSafePos has no reason to move him', () => {
    const bram = spawnedBram();
    expect(bram.pos.x, 'authored x survived the safe-pos search').toBe(bramDef.pos.x);
    expect(bram.pos.z, 'authored z survived the safe-pos search').toBe(bramDef.pos.z);
    // the two conditions findSafePos actually tests: dry enough, and unblocked
    // (an unblocked spot is what the x/z assertions above already prove)
    expect(groundHeight(bramDef.pos.x, bramDef.pos.z, SEED)).toBeGreaterThan(waterLevel() + 0.6);
  });

  it('sits comfortably interior to the balcony, not on a deck edge', () => {
    for (const [dx, dz] of [
      [DECK_EDGE_MARGIN, 0],
      [-DECK_EDGE_MARGIN, 0],
      [0, DECK_EDGE_MARGIN],
      [0, -DECK_EDGE_MARGIN],
    ]) {
      const x = bramDef.pos.x + dx;
      const z = bramDef.pos.z + dz;
      expect(beaconSpiralLift(x, z), `still deck2 at (${x}, ${z})`).toBe(S.deck2);
    }
  });

  it('faces the stair arrival, so a climber comes up to his face', () => {
    // the top of flight two, where the deck2 balcony begins
    const arrivalA = S.a0 + S.flight2End;
    const arrivalR = (S.coreR + S.balconyOut) / 2;
    const arrival = {
      x: S.x + Math.sin(arrivalA) * arrivalR,
      z: S.z + Math.cos(arrivalA) * arrivalR,
    };
    const want = Math.atan2(arrival.x - bramDef.pos.x, arrival.z - bramDef.pos.z);
    const delta = Math.abs(((bramDef.facing - want + Math.PI) % (Math.PI * 2)) - Math.PI);
    expect(delta, 'looking at the top of the stair').toBeLessThan(0.4);
    // and he is far enough along the balcony not to stand in the arrival itself
    expect(Math.hypot(arrival.x - bramDef.pos.x, arrival.z - bramDef.pos.z)).toBeGreaterThan(1.5);
  });
});
