import { afterEach, describe, expect, it } from 'vitest';
import {
  bankerChestSpots,
  colliderInternalsForTest,
  isBlocked,
  resolveMovement,
  resolvePosition,
} from '../src/sim/colliders';
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

describe('station furniture colliders follow the active bundle', () => {
  const furnitureNear = (x: number, z: number, r: number): { x: number; z: number }[] =>
    colliderInternalsForTest
      .staticWorldColliders(SEED)
      .filter(
        (c) =>
          c.type === 'circle' &&
          Math.hypot((c as { x: number }).x - x, (c as { z: number }).z - z) < r,
      )
      .map((c) => ({ x: (c as { x: number }).x, z: (c as { z: number }).z }));
  const circlesNear = (x: number, z: number, r: number): number => furnitureNear(x, z, r).length;

  it('a bundle without services gets NO builtin station furniture', () => {
    const anchor = BUILTIN_WORLD.services?.stations?.[0]?.pos;
    if (!anchor) throw new Error('builtin stations missing');
    setActiveWorldContent(world({}));
    const withStations = circlesNear(anchor.x, anchor.z, 8);
    expect(withStations).toBeGreaterThan(0);
    // Same map, services stripped: the furniture must vanish with them (the
    // old builtin read left invisible anvils on every custom map).
    setActiveWorldContent(world({ services: undefined }));
    expect(circlesNear(anchor.x, anchor.z, 8)).toBeLessThan(withStations);
  });

  it('the furniture veto reads the ACTIVE npcs: an npc on the anchor suppresses furniture', () => {
    const builtin = BUILTIN_WORLD.services;
    if (!builtin?.stations?.length) throw new Error('builtin stations missing');
    const custom = {
      id: 's_veto_test',
      type: builtin.stations[0].type,
      zoneId: 'eastbrook_vale',
      pos: { x: 0, z: -960 },
      masterNpcId: builtin.stations[0].masterNpcId,
    };
    setActiveWorldContent(world({ services: { ...builtin, stations: [custom] } }));
    const before = furnitureNear(0, -960, 10);
    expect(before.length).toBeGreaterThan(0);
    // The SAME bundle plus a custom npc standing ON one of the furniture
    // spots: the never-wall-off-an-npc veto must read the active npcs and
    // suppress that piece. A builtin-NPCS read cannot see this npc and
    // changes nothing.
    setActiveWorldContent(
      world({
        services: { ...builtin, stations: [custom] },
        npcs: {
          ...BUILTIN_WORLD.npcs,
          npc_veto_probe: { pos: { x: before[0].x, z: before[0].z } },
        } as unknown as WorldContent['npcs'],
      }),
    );
    expect(furnitureNear(0, -960, 10).length).toBeLessThan(before.length);
  });

  it('the furniture veto reads the ACTIVE graveyards the same way', () => {
    const builtin = BUILTIN_WORLD.services;
    if (!builtin?.stations?.length) throw new Error('builtin stations missing');
    const custom = {
      id: 's_grave_test',
      type: builtin.stations[0].type,
      zoneId: 'eastbrook_vale',
      pos: { x: 0, z: -960 },
      masterNpcId: builtin.stations[0].masterNpcId,
    };
    setActiveWorldContent(world({ services: { ...builtin, stations: [custom] } }));
    const before = furnitureNear(0, -960, 10);
    expect(before.length).toBeGreaterThan(0);
    setActiveWorldContent(
      world({
        services: {
          ...builtin,
          stations: [custom],
          graveyards: [...(builtin.graveyards ?? []), { x: before[0].x, z: before[0].z }],
        } as typeof builtin,
      }),
    );
    expect(furnitureNear(0, -960, 10).length).toBeLessThan(before.length);
  });

  it('a custom station collides at ITS anchor', () => {
    const builtin = BUILTIN_WORLD.services;
    if (!builtin?.stations?.length) throw new Error('builtin stations missing');
    const custom = {
      id: 's_custom_test',
      type: builtin.stations[0].type,
      zoneId: 'eastbrook_vale',
      pos: { x: 0, z: -960 }, // the open simulation lane: nothing else here
      masterNpcId: builtin.stations[0].masterNpcId,
    };
    setActiveWorldContent(world({ services: { ...builtin, stations: [custom] } }));
    const pieces = furnitureNear(0, -960, 10);
    expect(pieces.length).toBeGreaterThan(0);
    // The OBSERVABLE production path once, through the cached grid isBlocked
    // reads (the internals drive above never touches staticColliderGrid):
    // a furniture piece blocks in THIS bundle's grid, and the same point is
    // open in a services-stripped bundle's grid (per-content cache keying).
    expect(isBlocked(SEED, pieces[0].x, pieces[0].z, 0.4)).toBe(true);
    setActiveWorldContent(world({ services: undefined }));
    expect(isBlocked(SEED, pieces[0].x, pieces[0].z, 0.4)).toBe(false);
  });
});

describe('the banker chest follows the ACTIVE npc roster', () => {
  const noBankerNpcs = (): WorldContent['npcs'] =>
    Object.fromEntries(
      Object.entries(BUILTIN_WORLD.npcs).filter(([, n]) => !(n as { banker?: true }).banker),
    ) as WorldContent['npcs'];

  it('a bundle whose roster has no banker gets NO chest (and no ghost OBB)', () => {
    // Builtin control first: the vale bursar's strongbox resolves.
    setActiveWorldContent(null);
    const builtinSpots = bankerChestSpots(SEED);
    expect(builtinSpots.length).toBeGreaterThan(0);
    // Same map, bankers stripped from the roster: the pre-fix builtin-NPCS
    // walk would still emit every builtin chest into a world whose bankers
    // do not exist.
    setActiveWorldContent(world({ npcs: noBankerNpcs() }));
    expect(bankerChestSpots(SEED)).toHaveLength(0);
  });

  it("a custom map's OWN banker gets a chest at ITS anchor", () => {
    const npcs = {
      ...noBankerNpcs(),
      custom_banker: {
        id: 'custom_banker',
        name: 'Custom Banker',
        pos: { x: 0, z: -960 }, // the open simulation lane
        facing: 0,
        banker: true,
      },
    } as unknown as WorldContent['npcs'];
    setActiveWorldContent(world({ npcs }));
    const spots = bankerChestSpots(SEED);
    expect(spots).toHaveLength(1);
    expect(spots[0].anchorX).toBe(0);
    expect(spots[0].anchorZ).toBe(-960);
  });
});
