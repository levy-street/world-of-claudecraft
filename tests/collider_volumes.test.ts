import { afterEach, describe, expect, it } from 'vitest';
import {
  COLLIDER_ASSET_IDS,
  colliderVolumeFromPlacement,
  colliderVolumesFromPlacements,
} from '../src/sim/collider_volumes';
import { isBlocked, resolveMovement } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import type { MapPlacement } from '../src/sim/map_doc';
import { sanitizeMapDoc, serializeMapDoc } from '../src/sim/map_doc';
import type { ColliderVolume, WorldContent } from '../src/sim/types';
import { groundHeight, terrainHeight } from '../src/sim/world';

// Editor-authored collider volumes (WorldContent.colliderVolumes): boxes and
// spheres become static movement colliders (full height, camGhost, no jump
// clearance), planes raise the walkable floor over their rotated footprint.
// Resolved from 'collider/<kind>' placements by sim/collider_volumes.ts.

const SEED = 4242;

function world(extra: Partial<WorldContent>): WorldContent {
  // A fresh object per test: the collider grid cache is keyed per content.
  return { ...BUILTIN_WORLD, ...extra };
}

afterEach(() => {
  setActiveWorldContent(null);
});

describe('collider volume resolution from placements', () => {
  it('resolves box/sphere/plane ids with scaled default dimensions', () => {
    const box: MapPlacement = {
      assetId: COLLIDER_ASSET_IDS.box,
      x: 1,
      z: 2,
      rotY: 0.5,
      scale: 2,
      collide: true,
    };
    const v = colliderVolumeFromPlacement(box);
    expect(v).toEqual({ kind: 'box', x: 1, z: 2, rotY: 0.5, sizeX: 8, sizeY: 8, sizeZ: 8 });
  });

  it('a plane floor offset is NOT scaled (Scale widens, never lifts)', () => {
    const plane: MapPlacement = {
      assetId: COLLIDER_ASSET_IDS.plane,
      x: 0,
      z: 0,
      rotY: 0,
      scale: 3,
      collide: true,
      sizeY: 2,
    };
    const v = colliderVolumeFromPlacement(plane);
    expect(v?.sizeX).toBe(36);
    expect(v?.sizeY).toBe(2);
  });

  it('skips ordinary placements and non-blocking colliders', () => {
    const ps: MapPlacement[] = [
      { assetId: 'props/well', x: 0, z: 0, rotY: 0, scale: 1, collide: true },
      { assetId: COLLIDER_ASSET_IDS.box, x: 0, z: 0, rotY: 0, scale: 1, collide: false },
      { assetId: COLLIDER_ASSET_IDS.sphere, x: 0, z: 0, rotY: 0, scale: 1, collide: true },
    ];
    const vols = colliderVolumesFromPlacements(ps);
    expect(vols).toHaveLength(1);
    expect(vols[0].kind).toBe('sphere');
  });
});

describe('box and sphere volumes block movement', () => {
  const BOX: ColliderVolume = { kind: 'box', x: 0, z: 40, rotY: 0, sizeX: 8, sizeY: 4, sizeZ: 2 };
  const SPHERE: ColliderVolume = {
    kind: 'sphere',
    x: 0,
    z: 60,
    rotY: 0,
    sizeX: 6,
    sizeY: 6,
    sizeZ: 6,
  };

  it('does not block without the volume, blocks with it (same spot)', () => {
    setActiveWorldContent(world({}));
    expect(isBlocked(SEED, 0, 40, 0.5)).toBe(false);
    setActiveWorldContent(world({ colliderVolumes: [BOX] }));
    expect(isBlocked(SEED, 0, 40, 0.5)).toBe(true);
  });

  it('a mover cannot walk through the box, jump or not', () => {
    setActiveWorldContent(world({ colliderVolumes: [BOX] }));
    expect(resolveMovement(SEED, 0, 36, 0, 44, 0.5).z).toBeLessThan(39);
    expect(resolveMovement(SEED, 0, 36, 0, 44, 0.5, true).z).toBeLessThan(39);
  });

  it('a sphere blocks as a circle of half its diameter', () => {
    setActiveWorldContent(world({ colliderVolumes: [SPHERE] }));
    expect(isBlocked(SEED, 2, 60, 0.5)).toBe(true);
    expect(isBlocked(SEED, 4.2, 60, 0.5)).toBe(false);
  });

  it('planes never block movement', () => {
    setActiveWorldContent(
      world({
        colliderVolumes: [{ kind: 'plane', x: 0, z: 40, rotY: 0, sizeX: 20, sizeY: 3, sizeZ: 20 }],
      }),
    );
    expect(isBlocked(SEED, 0, 40, 0.5)).toBe(false);
  });
});

describe('floor planes raise groundHeight', () => {
  it('raises the walkable floor inside the footprint, never lowers it', () => {
    const plane: ColliderVolume = {
      kind: 'plane',
      x: 0,
      z: 40,
      rotY: 0,
      sizeX: 20,
      sizeY: 3,
      sizeZ: 20,
    };
    setActiveWorldContent(world({ colliderVolumes: [plane] }));
    const floor = terrainHeight(0, 40, SEED) + 3;
    expect(groundHeight(0, 40, SEED)).toBeCloseTo(floor, 6);
    // Outside the footprint: plain terrain.
    expect(groundHeight(30, 40, SEED)).toBeCloseTo(terrainHeight(30, 40, SEED), 6);
  });

  it('respects the plane rotation (a corner outside the rotated rect is clear)', () => {
    const plane: ColliderVolume = {
      kind: 'plane',
      x: 0,
      z: 40,
      rotY: Math.PI / 4,
      sizeX: 10,
      sizeY: 5,
      sizeZ: 10,
    };
    setActiveWorldContent(world({ colliderVolumes: [plane] }));
    // The unrotated corner (4.9, 44.9) leaves the rect once rotated 45 degrees.
    const inside = groundHeight(0, 40, SEED);
    expect(inside).toBeCloseTo(terrainHeight(0, 40, SEED) + 5, 6);
    const corner = groundHeight(4.9, 44.9, SEED);
    expect(corner).toBeCloseTo(terrainHeight(4.9, 44.9, SEED), 6);
  });

  it('a tilted plane is a ramp: the floor slopes across the footprint', () => {
    // rotZ tilts the plane's local X axis: at tilt g, a point lx along local X
    // sits lx*sin(g) above the center (three.js Euler 'XYZ', rotY = 0).
    const tilt = Math.PI / 6;
    const plane: ColliderVolume = {
      kind: 'plane',
      x: 0,
      z: 40,
      rotY: 0,
      rotZ: tilt,
      sizeX: 20,
      sizeY: 5,
      sizeZ: 20,
    };
    setActiveWorldContent(world({ colliderVolumes: [plane] }));
    const center = terrainHeight(0, 40, SEED) + 5;
    expect(groundHeight(0, 40, SEED)).toBeCloseTo(center, 6);
    // World x maps to local lx = x / cos(tilt); height rises by lx * sin(tilt).
    const x = 4;
    const lift = (x / Math.cos(tilt)) * Math.sin(tilt);
    expect(groundHeight(x, 40, SEED)).toBeCloseTo(center + lift, 6);
    // The high side never dips below terrain, and the footprint still ends:
    // world |x| > sizeX/2 * cos(tilt) leaves the tilted rect.
    const beyond = 10 * Math.cos(tilt) + 0.1;
    expect(groundHeight(beyond, 40, SEED)).toBeCloseTo(terrainHeight(beyond, 40, SEED), 6);
  });

  it('a tilted plane keeps its yaw convention (rotY still rotates the footprint)', () => {
    const plane: ColliderVolume = {
      kind: 'plane',
      x: 0,
      z: 40,
      rotY: Math.PI / 4,
      rotX: 0.001, // force the tilted code path
      sizeX: 10,
      sizeY: 5,
      sizeZ: 10,
    };
    setActiveWorldContent(world({ colliderVolumes: [plane] }));
    // Same containment expectations as the flat rotated-plane case above.
    expect(groundHeight(0, 40, SEED)).toBeCloseTo(terrainHeight(0, 40, SEED) + 5, 2);
    const corner = groundHeight(4.9, 44.9, SEED);
    expect(corner).toBeCloseTo(terrainHeight(4.9, 44.9, SEED), 6);
  });
});

describe('sanitizer round-trips collider placements', () => {
  it('keeps the collider id and clamped size fields', () => {
    const doc = sanitizeMapDoc(
      serializeMapDoc({
        version: 2,
        meta: {
          id: 'm',
          name: 'M',
          description: '',
          createdAt: 0,
          updatedAt: 0,
          seed: SEED,
          parentId: '',
        },
        content: {
          zones: [
            {
              id: 'z',
              name: 'Z',
              zMin: 0,
              zMax: 100,
              levelRange: [1, 1],
              biome: 'vale',
              hub: { x: 0, z: 0, radius: 8, name: '' },
              graveyard: { x: 0, z: 0 },
              lakes: [],
              pois: [],
              welcome: '',
            },
          ],
          camps: [],
          npcs: {},
          objects: [],
          roads: [],
        },
        terrainEdits: [],
        placements: [
          {
            assetId: COLLIDER_ASSET_IDS.box,
            x: 1,
            z: 2,
            rotY: 0,
            scale: 1,
            collide: true,
            sizeX: 9999, // clamped to MAX_COLLIDER_SIZE
            sizeY: 5,
            sizeZ: 4,
          },
        ],
      }),
    );
    expect(doc).not.toBeNull();
    const p = doc?.placements[0];
    expect(p?.assetId).toBe(COLLIDER_ASSET_IDS.box);
    expect(p?.sizeX).toBe(200);
    expect(p?.sizeY).toBe(5);
    expect(p?.sizeZ).toBe(4);
  });

  it('round-trips the vertical offset (clamped)', () => {
    const doc = sanitizeMapDoc(
      JSON.stringify({
        version: 2,
        meta: { id: 'm', name: 'M', createdAt: 0, updatedAt: 0, seed: SEED, parentId: '' },
        content: {
          zones: [
            {
              id: 'z',
              name: 'Z',
              zMin: 0,
              zMax: 100,
              levelRange: [1, 1],
              biome: 'vale',
              hub: { x: 0, z: 0, radius: 8, name: '' },
              graveyard: { x: 0, z: 0 },
              lakes: [],
              pois: [],
              welcome: '',
            },
          ],
          camps: [],
          npcs: {},
          objects: [],
          roads: [],
        },
        terrainEdits: [],
        placements: [
          { assetId: 'props/well', x: 0, z: 0, rotY: 0, scale: 1, collide: false, y: 12.5 },
          { assetId: 'props/well', x: 0, z: 0, rotY: 0, scale: 1, collide: false, y: 9999 },
        ],
      }),
    );
    expect(doc?.placements[0]?.y).toBe(12.5);
    expect(doc?.placements[1]?.y).toBe(200); // clamped to MAX_PLACEMENT_Y_OFFSET
  });
});
