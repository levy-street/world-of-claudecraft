// A body standing on a lower deck with another deck overhead must not be
// mistaken for a body buried in rock.
//
// `sheetWallBlocksStep` and `solidRockAtBody` decide "is this mover under a
// sheet?" by comparing its feet against the ground height in that column.
// Read BLIND, that height is the highest walkable surface there - which on
// anything stacked is the deck over the mover's HEAD. On a map that owns a
// carve (so the cheap early-out does not fire) a player amidships on a
// two-deck ship read as twelve yards underground and every step became a walk
// into solid rock: a real-solver flood from amidships reached ONE cell.
// The proxy now reads the body-aware ground, which drops only decks and plane
// volumes out of reach above the feet. Terrain is never filtered, so a body
// genuinely inside a hillside is still walled - the second test pins that.
import { afterEach, describe, expect, it } from 'vitest';
import { customMapToWorldContent, newFlatCustomMap } from '../src/editor/custom_map';
import { setActiveWorldContent } from '../src/sim/data';
import type { ColliderVolume, WorldContent } from '../src/sim/types';
import { sheetWallBlocksStep, terrainHeight } from '../src/sim/world';

const SEED = 4242;
const X = 60;
const Z = 60;

/** A walkable plane volume whose floor sits `h` above y=0. */
const deck = (h: number): ColliderVolume => ({
  kind: 'plane',
  x: X,
  z: Z,
  rotY: 0,
  sizeX: 40,
  sizeY: h,
  sizeZ: 40,
  detached: true,
  groundY: 0,
});

/** A real blank authored map (so every field the ground stack reads exists),
 *  carrying a carve somewhere far away and the given collider volumes. */
function world(volumes: ColliderVolume[]): WorldContent {
  const doc = newFlatCustomMap('rock-gate', 'rock-gate', 0);
  const w = customMapToWorldContent(doc);
  w.colliderVolumes = volumes;
  // Far from (X, Z): its only job is to make the cut list non-empty, which is
  // what arms sheetWallBlocksStep in the first place. On a map with neither a
  // cave nor a cut the gate returns early and the bug cannot show.
  w.holes = [{ x: 900, y: 0, z: 900, radius: 8, carve: true }];
  return w;
}

afterEach(() => setActiveWorldContent(null));

describe('a stacked deck is not solid rock', () => {
  it('does not wall a body on the lower deck of two', () => {
    setActiveWorldContent(world([deck(8), deck(20)]));
    // Feet on the lower deck, another deck twelve yards overhead.
    expect(sheetWallBlocksStep(SEED, X, Z, 8, X + 0.5, Z)).toBe(false);
  });

  it('does not wall it for a deck at any height overhead', () => {
    for (const above of [11, 14, 20, 30, 45]) {
      setActiveWorldContent(world([deck(8), deck(above)]));
      expect(sheetWallBlocksStep(SEED, X, Z, 8, X + 0.5, Z), `deck at ${above}`).toBe(false);
    }
  });

  it('still walls a body genuinely buried in the hillside', () => {
    setActiveWorldContent(world([]));
    const surface = terrainHeight(X, Z, SEED);
    // Six yards inside the ground, with no deck anywhere in the column.
    expect(sheetWallBlocksStep(SEED, X, Z, surface - 6, X + 0.5, Z)).toBe(true);
  });

  it('an overhead deck does not rescue a buried body either', () => {
    setActiveWorldContent(world([deck(20)]));
    const surface = terrainHeight(X, Z, SEED);
    expect(sheetWallBlocksStep(SEED, X, Z, surface - 6, X + 0.5, Z)).toBe(true);
  });
});
