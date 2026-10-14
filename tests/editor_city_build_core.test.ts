// City Build pure core: snapping, wall-run generation, prefab rebase/stamp,
// road helpers. Drives src/editor/city_build_core.ts directly (DOM-free).

import { describe, expect, it } from 'vitest';
import { assetById } from '../src/editor/asset_catalog.generated';
import {
  cityGridLayout,
  cityPlacementIndices,
  combinedRoads,
  generateWallPieces,
  generateWallStairs,
  ghostBlocked,
  nextCityId,
  pathHasNode,
  polylineBounds,
  rebaseAsPrefab,
  rotatedPitch,
  sanitizeCityPrefabs,
  sanitizeCitySettings,
  snapAngleRad,
  snapCoord,
  snapPoint,
  stampPrefab,
  tileSnapPoint,
  WALL_STYLES,
  wallFootprintOrFallback,
  wallPiecesToPlacements,
  wallStyleById,
  wallTopModelY,
  wallTopRamps,
  withoutLastPathPoint,
} from '../src/editor/city_build_core';
import type { MapPlacement, WallRunDef } from '../src/sim/map_doc';

describe('city build snapping', () => {
  it('snaps coordinates to the grid and leaves them alone when off', () => {
    expect(snapCoord(3.4, 1)).toBe(3);
    expect(snapCoord(3.6, 1)).toBe(4);
    expect(snapCoord(3.4, 0)).toBe(3.4);
    expect(snapCoord(-1.3, 0.5)).toBe(-1.5);
    expect(snapPoint({ x: 2.2, z: -0.9 }, 2)).toEqual({ x: 2, z: 0 });
  });

  it('snaps angles to the step in degrees', () => {
    expect(snapAngleRad(0.1, 45)).toBe(0);
    expect(snapAngleRad(Math.PI / 3, 90)).toBeCloseTo(Math.PI / 2);
    expect(snapAngleRad(1.23, 0)).toBe(1.23);
  });

  it('sanitizes settings with defaults and clamps', () => {
    expect(sanitizeCitySettings(null)).toMatchObject({ gridSize: 1, rotSnapDeg: 45 });
    expect(sanitizeCitySettings({ gridSize: 2, rotSnapDeg: 15 })).toMatchObject({
      gridSize: 2,
      rotSnapDeg: 15,
    });
    expect(sanitizeCitySettings({ gridSize: -5, rotSnapDeg: 720 }).rotSnapDeg).toBe(180);
  });
});

describe('nextCityId', () => {
  it('is deterministic and skips past the highest existing id', () => {
    expect(nextCityId('wall', [])).toBe('wall_1');
    expect(nextCityId('wall', ['wall_1', 'wall_7', 'road_9'])).toBe('wall_8');
    expect(nextCityId('road', ['wall_7'])).toBe('road_1');
  });
});

describe('wall run generation', () => {
  const def: WallRunDef = {
    id: 'wall_1',
    points: [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ],
    segmentAssetId: 'dungeon/wall',
    postAssetId: 'dungeon/pillar',
    scale: 1,
    postEvery: 0,
  };
  const seg = { sizeX: 2, sizeZ: 0.5 };
  const post = { sizeX: 0.6, sizeZ: 0.6 };

  it('fits segments exactly along an edge', () => {
    const pieces = generateWallPieces(def, seg, post);
    const segments = pieces.filter((p) => p.assetId === 'dungeon/wall');
    // 10yd edge with 2yd pieces = 5 segments, stretch 1.
    expect(segments).toHaveLength(5);
    for (const s of segments) expect(s.stretch).toBeCloseTo(1);
    // Midpoints evenly spaced along the edge.
    expect(segments[0].x).toBeCloseTo(1);
    expect(segments[4].x).toBeCloseTo(9);
    for (const s of segments) expect(s.z).toBeCloseTo(0);
  });

  it('stretches segments to close a non-multiple edge', () => {
    const pieces = generateWallPieces(
      {
        ...def,
        points: [
          { x: 0, z: 0 },
          { x: 11, z: 0 },
        ],
      },
      seg,
      post,
    );
    const segments = pieces.filter((p) => p.assetId === 'dungeon/wall');
    // 11yd / 2yd rounds to 6 pieces stretched to 11/12 each... rounded to
    // nearest: 6 pieces of 1.833yd (stretch < 1) OR 5 of 2.2 (stretch > 1).
    const n = segments.length;
    const total = segments.reduce((sum, s) => sum + 2 * (s.stretch ?? 1), 0);
    expect(total).toBeCloseTo(11);
    expect(n === 5 || n === 6).toBe(true);
  });

  it('places posts at corners and generates both edges of a bend', () => {
    const bend: WallRunDef = {
      ...def,
      points: [
        { x: 0, z: 0 },
        { x: 4, z: 0 },
        { x: 4, z: 6 },
      ],
    };
    const pieces = generateWallPieces(bend, seg, post);
    const posts = pieces.filter((p) => p.assetId === 'dungeon/pillar');
    expect(posts).toHaveLength(3);
    const segments = pieces.filter((p) => p.assetId === 'dungeon/wall');
    expect(segments.length).toBeGreaterThanOrEqual(5);
  });

  it('closed loops add the seam edge', () => {
    const square: WallRunDef = {
      ...def,
      closed: true,
      points: [
        { x: 0, z: 0 },
        { x: 4, z: 0 },
        { x: 4, z: 4 },
        { x: 0, z: 4 },
      ],
    };
    const open = generateWallPieces({ ...square, closed: false }, seg, post);
    const closed = generateWallPieces(square, seg, post);
    expect(closed.filter((p) => p.assetId === 'dungeon/wall').length).toBeGreaterThan(
      open.filter((p) => p.assetId === 'dungeon/wall').length,
    );
  });

  it('converts pieces to placements tagged with the run id', () => {
    const pieces = generateWallPieces(def, seg, post);
    const placements = wallPiecesToPlacements(def, pieces);
    expect(placements.length).toBe(pieces.length);
    for (const p of placements) {
      expect(p.cityId).toBe('wall_1');
      expect(p.collide).toBe(true);
    }
    const indices = cityPlacementIndices(placements, 'wall_1');
    expect(indices).toHaveLength(placements.length);
    expect(cityPlacementIndices(placements, 'wall_2')).toHaveLength(0);
  });

  it('wall styles resolve with a safe fallback', () => {
    expect(wallStyleById('stone').segmentAssetId).toBe('dungeon/wall');
    expect(wallStyleById('nope')).toBe(WALL_STYLES[0]);
  });

  it('keeps every wall preset buildable when live model measurement is unavailable', () => {
    for (const style of WALL_STYLES) {
      expect(assetById(style.segmentAssetId), style.segmentAssetId).toBeDefined();
      const segment = wallFootprintOrFallback(style, style.segmentAssetId, null);
      expect(segment, style.id).not.toBeNull();
      if (!segment) continue;
      const run: WallRunDef = {
        id: `wall_${style.id}`,
        points: [
          { x: 0, z: 0 },
          { x: 12, z: 0 },
        ],
        segmentAssetId: style.segmentAssetId,
        scale: 2,
        postEvery: 0,
      };
      const pieces = generateWallPieces(run, segment);
      expect(
        pieces.some((piece) => piece.kind === 'segment'),
        style.id,
      ).toBe(true);
    }
  });

  it('applies independent height and thickness controls to wall placements', () => {
    const shaped: WallRunDef = {
      ...def,
      heightScale: 1.75,
      thicknessScale: 1.4,
    };
    const placements = wallPiecesToPlacements(shaped, generateWallPieces(shaped, seg, post));
    const segment = placements.find((placement) => placement.assetId === 'dungeon/wall');
    expect(segment?.scaleY).toBeCloseTo(1.75);
    // The test segment runs on local X, so its fitted run stretch stays on X
    // while the independent thickness multiplier lands on local Z.
    expect(segment?.scaleZ).toBeCloseTo(1.4);
    const corner = placements.find((placement) => placement.assetId === 'dungeon/pillar');
    expect(corner?.scaleX).toBeCloseTo(1.4);
    expect(corner?.scaleZ).toBeCloseTo(1.4);
    expect(corner?.scaleY).toBeCloseTo(1.75);
  });
});

describe('wall drawing helpers', () => {
  const points = [
    { x: 0, z: 0 },
    { x: 4, z: 2 },
    { x: 8, z: 2 },
  ];

  it('detects clicks on existing nodes without requiring exact floating-point equality', () => {
    expect(pathHasNode(points, { x: 4.04, z: 2.03 }, 0.1)).toBe(true);
    expect(pathHasNode(points, { x: 4.2, z: 2.2 }, 0.1)).toBe(false);
  });

  it('removes one node without mutating the source path', () => {
    expect(withoutLastPathPoint(points)).toEqual(points.slice(0, 2));
    expect(points).toHaveLength(3);
    expect(withoutLastPathPoint([])).toEqual([]);
  });

  it('builds a bounded, grid-aligned overlay around the cursor', () => {
    const fine = cityGridLayout({ x: 3.17, z: -8.42 }, 0.25);
    expect(fine).not.toBeNull();
    if (!fine) return;
    expect(fine.xLines.length).toBeLessThanOrEqual(81);
    expect(fine.zLines.length).toBeLessThanOrEqual(81);
    for (const x of fine.xLines) expect(x / 0.25).toBeCloseTo(Math.round(x / 0.25));
    for (const z of fine.zLines) expect(z / 0.25).toBeCloseTo(Math.round(z / 0.25));
    expect(cityGridLayout({ x: 0, z: 0 }, 0)).toBeNull();
  });
});

describe('roads helpers', () => {
  it('combines legacy roads with road defs', () => {
    const legacy = [
      [
        { x: 0, z: 0 },
        { x: 5, z: 5 },
      ],
    ];
    const defs = [
      {
        id: 'road_1',
        kind: 'road' as const,
        points: [
          { x: 1, z: 1 },
          { x: 2, z: 2 },
        ],
      },
    ];
    const all = combinedRoads(legacy, defs);
    expect(all).toHaveLength(2);
    expect(all[1][0]).toEqual({ x: 1, z: 1 });
    expect(combinedRoads(undefined, undefined)).toEqual([]);
  });

  it('computes polyline bounds with margin', () => {
    const b = polylineBounds(
      [
        { x: -2, z: 3 },
        { x: 4, z: -1 },
      ],
      10,
    );
    expect(b).toEqual({ minX: -12, minZ: -11, maxX: 14, maxZ: 13 });
    expect(polylineBounds([], 5)).toBeNull();
  });
});

describe('prefabs', () => {
  const items: MapPlacement[] = [
    { assetId: 'props/well', x: 10, z: 10, rotY: 0, scale: 1, collide: true },
    { assetId: 'props/crate', x: 14, z: 10, rotY: 1, scale: 2, collide: false },
  ];

  it('rebases around the centroid and stamps at an origin', () => {
    const prefab = rebaseAsPrefab('market', items);
    expect(prefab).not.toBeNull();
    if (!prefab) return;
    expect(prefab.items[0].x).toBeCloseTo(-2);
    expect(prefab.items[1].x).toBeCloseTo(2);
    const stamped = stampPrefab(prefab, { x: 100, z: 50 });
    expect(stamped[0].x).toBeCloseTo(98);
    expect(stamped[1].x).toBeCloseTo(102);
    expect(stamped[0].z).toBeCloseTo(50);
    // Stamps never carry city ownership or uids.
    expect(stamped[0].cityId).toBeUndefined();
    // The source items are untouched.
    expect(items[0].x).toBe(10);
  });

  it('sanitizes a stored prefab library', () => {
    expect(sanitizeCityPrefabs(null)).toEqual([]);
    expect(sanitizeCityPrefabs([{ name: 'ok', items }])).toHaveLength(1);
    expect(sanitizeCityPrefabs([{ name: '', items }])).toEqual([]);
    expect(sanitizeCityPrefabs([{ name: 'bad', items: [{ assetId: 5 }] }])).toEqual([]);
  });
});

describe('ghost blocking', () => {
  it('flags overlap with colliding placements only', () => {
    const placements: MapPlacement[] = [
      { assetId: 'a', x: 0, z: 0, rotY: 0, scale: 1, collide: true },
      { assetId: 'b', x: 20, z: 0, rotY: 0, scale: 1, collide: false },
    ];
    expect(ghostBlocked(placements, 0.2, 0, 1)).toBe(true);
    expect(ghostBlocked(placements, 8, 0, 1)).toBe(false);
    // Non-colliding neighbors never block.
    expect(ghostBlocked(placements, 20, 0.2, 1)).toBe(false);
  });
});

describe('kit scale + tile snapping', () => {
  it('sanitizes kitScale and tileSnap with life-size defaults', () => {
    const d = sanitizeCitySettings(null);
    expect(d.kitScale).toBe(3);
    expect(d.tileSnap).toBe(true);
    expect(sanitizeCitySettings({ kitScale: 100 }).kitScale).toBe(20);
    expect(sanitizeCitySettings({ kitScale: -1 }).kitScale).toBe(3);
    expect(sanitizeCitySettings({ tileSnap: false }).tileSnap).toBe(false);
  });

  it('rotatedPitch swaps axes at 90 degrees', () => {
    const fp = { sizeX: 2, sizeZ: 1 };
    const at0 = rotatedPitch(fp, 3, 0);
    expect(at0.px).toBeCloseTo(6);
    expect(at0.pz).toBeCloseTo(3);
    const at90 = rotatedPitch(fp, 3, Math.PI / 2);
    expect(at90.px).toBeCloseTo(3);
    expect(at90.pz).toBeCloseTo(6);
  });

  it('tile-snapped neighbors sit exactly one pitch apart (edges touch)', () => {
    const fp = { sizeX: 2.2, sizeZ: 2.2 };
    const scale = 3;
    const a = tileSnapPoint({ x: 0.9, z: 0.4 }, fp, scale, 0);
    const b = tileSnapPoint({ x: 7.4, z: 0.4 }, fp, scale, 0);
    expect(a).toEqual({ x: 0, z: 0 });
    expect(b.x).toBeCloseTo(6.6);
    // Center distance equals the piece's world width: shared edge, no gap.
    expect(b.x - a.x).toBeCloseTo(fp.sizeX * scale);
    expect(b.z - a.z).toBeCloseTo(0);
  });
});

describe('walkable wall tops + stairs', () => {
  const def: WallRunDef = {
    id: 'wall_9',
    points: [
      { x: 0, z: 0 },
      { x: 20, z: 0 },
    ],
    segmentAssetId: 'medieval_village_v2/buildings/CastleWall_01',
    stairAssetId: 'dungeon/stairs_long',
    scale: 3,
    postEvery: 0,
    walkTop: true,
    stairs: true,
  };
  const stairFp = { sizeX: 1.5, sizeZ: 2.25, sizeY: 1.1 };

  it('wallTopModelY prefers hitbox tops and falls back to model height', () => {
    expect(wallTopModelY([{ x: 0, y: 1.1, z: 0, hx: 1, hy: 1.1, hz: 0.2 }], 2.2)).toBeCloseTo(2.2);
    expect(wallTopModelY([], 1.8)).toBeCloseTo(1.8);
    expect(wallTopModelY(undefined, 1.8)).toBeCloseTo(1.8);
  });

  it('wallTopRamps builds one flat deck per hitbox, else a footprint deck', () => {
    const boxes = [
      { x: -0.5, y: 1, z: 0, hx: 0.5, hy: 1, hz: 0.2 },
      { x: 0.5, y: 1.2, z: 0, hx: 0.5, hy: 1.05, hz: 0.2 },
    ];
    const decks = wallTopRamps(boxes, { sizeX: 2, sizeZ: 0.4, sizeY: 2.25 });
    expect(decks).toHaveLength(2);
    for (const d of decks) {
      expect(d.y0).toBe(d.y1);
      expect(d.y0).toBeCloseTo(2.25);
    }
    const fallback = wallTopRamps([], { sizeX: 2, sizeZ: 0.4, sizeY: 2.1 });
    expect(fallback).toHaveLength(1);
    expect(fallback[0].hx).toBeCloseTo(1);
    expect(fallback[0].y1).toBeCloseTo(2.1);
  });

  it('open runs get a stair beyond each end, ascending into the wall', () => {
    const stairs = generateWallStairs(def, stairFp, 2.25);
    expect(stairs).toHaveLength(2);
    const [s0, s1] = stairs;
    // Length in world yards: sizeZ * scale = 6.75; centered half beyond ends.
    expect(s0.x).toBeCloseTo(-3.375);
    expect(s0.z).toBeCloseTo(0);
    expect(s1.x).toBeCloseTo(23.375);
    // Ascent toward the wall: model -Z mapped onto +X for the start stair.
    expect(s0.rotY).toBeCloseTo(Math.atan2(-1, 0));
    expect(s1.rotY).toBeCloseTo(Math.atan2(1, 0));
    // scaleY lands the stair top exactly on the walk height:
    // sy = scale * scaleY, top = sy * sizeY = wallTopModel * scale.
    expect((s0.scaleY ?? 1) * def.scale * stairFp.sizeY).toBeCloseTo(2.25 * def.scale);
    expect(s0.ramps).toHaveLength(1);
    expect(s0.ramps?.[0].y0).toBe(0);
    expect(s0.ramps?.[0].y1).toBeCloseTo(stairFp.sizeY);
    expect(s0.ramps?.[0].ry).toBeCloseTo(Math.PI / 2);
  });

  it('stretches stairs to the configured wall height', () => {
    const stairs = generateWallStairs({ ...def, heightScale: 1.6 }, stairFp, 2.25);
    expect(stairs).toHaveLength(2);
    expect((stairs[0].scaleY ?? 1) * def.scale * stairFp.sizeY).toBeCloseTo(2.25 * def.scale * 1.6);
  });

  it('closed loops get one stair beside the first edge', () => {
    const loop: WallRunDef = {
      ...def,
      closed: true,
      points: [
        { x: 0, z: 0 },
        { x: 10, z: 0 },
        { x: 10, z: 10 },
        { x: 0, z: 10 },
      ],
    };
    const stairs = generateWallStairs(loop, stairFp, 2.25);
    expect(stairs).toHaveLength(1);
    // Beside the first edge's midpoint, offset to the edge's left side.
    expect(stairs[0].x).toBeCloseTo(5);
    expect(stairs[0].z).toBeCloseTo(3.375);
  });

  it('stair placements carry decks and no blocking boxes', () => {
    const stairs = generateWallStairs(def, stairFp, 2.25);
    const placements = wallPiecesToPlacements(def, stairs);
    for (const p of placements) {
      expect(p.ramps?.length).toBe(1);
      expect(p.collisionMode).toBe('baked');
      expect(p.hitboxes).toBeUndefined();
      expect((p as { scaleY?: number }).scaleY).toBeGreaterThan(1);
    }
  });

  it('piece counts minimize stretch distortion (log-closest to 1)', () => {
    const seg = { sizeX: 2, sizeZ: 0.5, sizeY: 2.2 };
    const run = (len: number) =>
      generateWallPieces(
        {
          ...def,
          stairs: false,
          points: [
            { x: 0, z: 0 },
            { x: len, z: 0 },
          ],
          scale: 1,
        },
        seg,
      ).filter((p) => p.kind === 'segment');
    // 2.8yd edge: 1 piece at 1.4x vs 2 at 0.7x; 1.4 is closer to 1 in log space.
    expect(run(2.8)).toHaveLength(1);
    // 3.2yd edge: 2 pieces at 0.8x beats 1 piece at 1.6x.
    expect(run(3.2)).toHaveLength(2);
  });
});
