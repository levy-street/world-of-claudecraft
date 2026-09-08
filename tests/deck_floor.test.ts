// deckFloorHeight: the terrain, or a walkable deck standing at most
// DECK_FLOOR_REACH above it. Each arm is pinned on a real world spot so the
// helper cannot drift into "any standable top wins" (a parapet or roof would
// then hoist a spawn onto it) or into terrain-only (the Crucible Quartermaster
// would sink into the keep's landing plate again).

import { describe, expect, it } from 'vitest';
import { DECK_FLOOR_REACH, supportHeightAt } from '../src/sim/colliders';
import { CRUCIBLE_VENDOR_ENTRANCE_POS } from '../src/sim/content/ignivar_loot';
import { battlegroundOrigin } from '../src/sim/data';
import { deckFloorHeight } from '../src/sim/deck_floor';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const SEED = WORLD_SEED;
const BODY_RADIUS = 0.5;
// A support cap far above any deck: "is there ANY standable top here at all".
const UNCAPPED = 1000;

// Static colliders are built for the active world content; one Sim makes it live.
new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });

describe('deckFloorHeight', () => {
  it('seats a body on a walkable deck within reach above the terrain (the keep landing plate)', () => {
    const { x, z } = CRUCIBLE_VENDOR_ENTRANCE_POS;
    const ground = groundHeight(x, z, SEED);
    const floor = deckFloorHeight(SEED, x, z);
    expect(floor).toBeGreaterThan(ground);
    expect(floor - ground).toBeLessThanOrEqual(DECK_FLOOR_REACH);
    expect(floor).toBeCloseTo(15.34, 2);
  });

  it('returns exactly the terrain where nothing standable is underfoot (the Eastbrook road)', () => {
    const x = 0;
    const z = -40;
    expect(supportHeightAt(SEED, x, z, BODY_RADIUS, UNCAPPED)).toBe(-Infinity);
    expect(deckFloorHeight(SEED, x, z)).toBe(groundHeight(x, z, SEED));
  });

  it('never pulls the floor below the terrain for a deck that sits under it', () => {
    // Beside the Forgefather cannon tower the middle-court plate top (6.94) lies
    // under the raised ground (7.48); the ground wins.
    const x = 509;
    const z = 2222.5;
    const ground = groundHeight(x, z, SEED);
    const deck = supportHeightAt(SEED, x, z, BODY_RADIUS, ground + DECK_FLOOR_REACH);
    expect(deck).not.toBe(-Infinity);
    expect(deck).toBeLessThan(ground);
    expect(deckFloorHeight(SEED, x, z)).toBe(ground);
  });

  it('rejects a standable top higher than DECK_FLOOR_REACH above the terrain (a rampart deck)', () => {
    // The Thornhollow battleground ramparts are the canonical overhead deck
    // (placementFloorHeight leaves them as obstacles): a deterministic scan of
    // the slot-0 field finds the first rampart top standing above the reach.
    const origin = battlegroundOrigin(0);
    let perch: { x: number; z: number; ground: number } | null = null;
    for (let dz = -150; dz <= 150 && !perch; dz += 1) {
      for (let dx = -60; dx <= 60; dx += 1) {
        const x = origin.x + dx;
        const z = origin.z + dz;
        const ground = groundHeight(x, z, SEED);
        const top = supportHeightAt(SEED, x, z, BODY_RADIUS, ground + UNCAPPED);
        if (top > ground + DECK_FLOOR_REACH) {
          perch = { x, z, ground };
          break;
        }
      }
    }
    if (!perch) throw new Error('no battleground deck stands above the deck reach');
    expect(deckFloorHeight(SEED, perch.x, perch.z)).toBe(perch.ground);
  });
});
