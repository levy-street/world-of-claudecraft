// Regression for issue 1500: the fishing-dock plank deck had no collision, so the
// player walked straight through the pier and the barrels/crates on it while every
// other structure blocks. colliders.ts emitted only the dock hut OBB, never a deck
// collider. Both docks (zone1 + zone2) share the deck geometry, so one derived
// collider fixes both. This pins that the deck run is now solid, and that the
// footprint is bounded (open water a couple yards past the far end stays walkable).
import { afterEach, describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';

const SEED = 20061;

// Mirror colliders.ts rotY: rotate a local (lx,lz) offset by a rotation.y angle.
function rotY(lx: number, lz: number, rot: number): { x: number; z: number } {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}
// World point for a dock-local offset.
function dockLocal(
  dock: { x: number; z: number; rot: number },
  lx: number,
  lz: number,
): { x: number; z: number } {
  const o = rotY(lx, lz, dock.rot);
  return { x: dock.x + o.x, z: dock.z + o.z };
}

// The two docks from content (zone1.ts / zone2.ts); the deck-local mid-run point
// matches DECK_LOCAL_X/Z in colliders.ts.
const DOCKS = [
  { x: -64, z: 60, rot: -2.2 }, // zone 1
  { x: -66, z: 305, rot: 1.68 }, // zone 2 (Deepfen)
];
const DECK_LX = 0.1;
const DECK_LZ = -3.2;

describe('fishing dock deck collision (issue 1500)', () => {
  afterEach(() => setActiveWorldContent(null));

  it('blocks the plank deck at both docks (previously walk-through)', () => {
    setActiveWorldContent(BUILTIN_WORLD);
    for (const dock of DOCKS) {
      const p = dockLocal(dock, DECK_LX, DECK_LZ);
      expect(isBlocked(SEED, p.x, p.z), `deck of dock at ${dock.x},${dock.z}`).toBe(true);
    }
  });

  it('does not block open water a couple yards past the deck far end (footprint bounded)', () => {
    setActiveWorldContent(BUILTIN_WORLD);
    for (const dock of DOCKS) {
      // ~2.4u beyond the far deck-collider edge (DECK_LZ - halfDepth 3.3 = -6.5).
      const past = dockLocal(dock, DECK_LX, -8.9);
      expect(isBlocked(SEED, past.x, past.z), `past-deck of dock at ${dock.x},${dock.z}`).toBe(
        false,
      );
    }
  });
});
