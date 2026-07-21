import { afterEach, describe, expect, it } from 'vitest';
import { isBlocked, resolveMovement, resolvePosition } from '../src/sim/colliders';
import { BUILTIN_WORLD, PLAYER_START, setActiveWorldContent } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { BlockerDef, PlacedAsset, WorldContent } from '../src/sim/types';

// Invisible blocker walls (WorldContent.blockers) and the per-placement
// collideRadius override, at the sim collision layer: buildStaticColliders
// turns each blocker segment into a fence-width OBB (but NOT a fence: no jump
// clearance) and each colliding placement into a circle at its EFFECTIVE
// radius. Purely static data: no rng draws, no render mesh.

const SEED = 4242;

function world(extra: Partial<WorldContent>): WorldContent {
  // A fresh object per test: the collider grid cache is keyed per content.
  return { ...BUILTIN_WORLD, ...extra };
}

afterEach(() => {
  setActiveWorldContent(null);
});

describe('blocker wall colliders', () => {
  // An east-west wall through z = 40, far from the built-in village props.
  const WALL: BlockerDef = { x1: -10, z1: 40, x2: 10, z2: 40 };

  it('does not block without the blocker, blocks with it (same spot)', () => {
    const spot = { x: 0, z: 40 };
    setActiveWorldContent(world({}));
    expect(isBlocked(SEED, spot.x, spot.z, 0.5)).toBe(false);

    setActiveWorldContent(world({ blockers: [WALL] }));
    expect(isBlocked(SEED, spot.x, spot.z, 0.5)).toBe(true);
  });

  it('resolvePosition pushes a mover out of the wall', () => {
    setActiveWorldContent(world({ blockers: [WALL] }));
    const res = resolvePosition(SEED, 0, 40.2, 0.5);
    // Pushed out along the wall normal: |z - 40| >= hd (0.35) + body radius.
    expect(Math.abs(res.z - 40)).toBeGreaterThanOrEqual(0.85 - 1e-6);
    expect(res.x).toBeCloseTo(0, 5);
  });

  it('resolveMovement cannot cross the wall head-on', () => {
    setActiveWorldContent(world({ blockers: [WALL] }));
    const res = resolveMovement(SEED, 0, 37, 0, 43, 0.5);
    expect(res.z).toBeLessThan(40);
  });

  it('slides along the wall like a fence instead of sticking', () => {
    setActiveWorldContent(world({ blockers: [WALL] }));
    const res = resolveMovement(SEED, 0, 38.5, 6, 41.5, 0.5);
    expect(res.z).toBeLessThan(40); // never through
    expect(res.x).toBeGreaterThan(1); // but progress parallel to it
  });

  it('a jump does NOT clear a blocker (unlike a fence, ignoreFences changes nothing)', () => {
    setActiveWorldContent(world({ blockers: [WALL] }));
    const res = resolveMovement(SEED, 0, 37, 0, 43, 0.5, true);
    expect(res.z).toBeLessThan(40);
  });

  it('a player walking into the wall across ticks stops at it', () => {
    const content = world({
      blockers: [{ x1: -10, z1: PLAYER_START.z + 4, x2: 10, z2: PLAYER_START.z + 4 }],
    });
    setActiveWorldContent(content);
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', world: content });
    const p = sim.player;
    p.facing = 0; // facing = (sin f, cos f), so 0 walks toward +z
    sim.moveInput.forward = true;
    for (let i = 0; i < 20 * 4; i++) sim.tick();
    expect(p.pos.z).toBeGreaterThan(PLAYER_START.z + 1); // it did move forward
    expect(p.pos.z).toBeLessThan(PLAYER_START.z + 4); // but never through the wall
  });
});

describe('placement collideRadius override', () => {
  function placement(collideRadius: number): PlacedAsset {
    return { path: '/models/props/well.glb', x: 0, z: 60, rotY: 0, scale: 1, collideRadius };
  }

  it('blocks at the overridden radius, not the scale-derived one', () => {
    // Derived radius for scale 1 is 0.8 (collideRadiusFor): a probe 3yd out
    // is clear under the derived radius but inside an override of 5.
    setActiveWorldContent(world({ placements: [placement(0.8)] }));
    expect(isBlocked(SEED, 3, 60, 0.5)).toBe(false);

    setActiveWorldContent(world({ placements: [placement(5)] }));
    expect(isBlocked(SEED, 3, 60, 0.5)).toBe(true);
    const res = resolvePosition(SEED, 3, 60, 0.5);
    const d = Math.hypot(res.x, res.z - 60);
    expect(d).toBeGreaterThanOrEqual(5.5 - 1e-6); // pushed to override + body radius
  });
});
