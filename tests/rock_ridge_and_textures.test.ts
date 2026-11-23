import { afterEach, describe, expect, it } from 'vitest';
import { generateCaveRigNodes } from '../src/editor/cave_gen_core';
import { buildCaveGeometry } from '../src/render/cave_mesh';
import { buildRockChainModel, buildRockModel } from '../src/render/rock_gen';
import {
  builtinKeyOf,
  builtinShaFor,
  paintDefaultSets,
  TERRAIN_TEXTURE_SETS,
  terrainTexturePath,
} from '../src/render/terrain_texture_sets';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { sanitizeMapDoc } from '../src/sim/map_doc';
import type { CaveDef } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

// The v3 Rock tool additions (height/depth/jaggedness/texture sets), the
// merged rock-ridge body, per-node cave girth, and the built-in texture
// library plumbing (builtin: pseudo-shas + the registry).

// rockTex 2 = bare material (no canvas/texture loads, so this runs in node).
const P = { rockSeed: 42, rockNoise: 0.6, rockDetail: 0.5, rockSharp: 0.2, rockTex: 2 };

describe('rock v3 shape params', () => {
  it('rockHeight stretches the body vertically', () => {
    const short = buildRockModel({ ...P, rockHeight: 0.5 }).geometry;
    const tall = buildRockModel({ ...P, rockHeight: 2.5 }).geometry;
    const hShort = short.boundingBox!.max.y - short.boundingBox!.min.y;
    const hTall = tall.boundingBox!.max.y - tall.boundingBox!.min.y;
    expect(hTall).toBeGreaterThan(hShort * 3);
  });

  it('rockJag adds displacement detail', () => {
    const calm = buildRockModel({ ...P, rockJag: 0 }).geometry.getAttribute('position');
    const jagged = buildRockModel({ ...P, rockJag: 1 }).geometry.getAttribute('position');
    let diff = 0;
    for (let i = 0; i < calm.count; i += 7) {
      if (Math.abs(calm.getX(i) - jagged.getX(i)) > 1e-6) diff++;
    }
    expect(diff).toBeGreaterThan(0);
  });
});

describe('buildRockChainModel (merged ridge)', () => {
  const NODES = [
    { dx: 0, dz: 0, dy: 0, r: 3, h: 1 },
    { dx: 12, dz: 2, dy: 1.5, r: 4, h: 1.4 },
    { dx: 24, dz: -3, dy: 0.5, r: 2.5, h: 0.8 },
  ];

  it('produces ONE indexed body spanning every node', () => {
    const mesh = buildRockChainModel(NODES, P);
    const geo = mesh.geometry;
    expect(geo.index).not.toBeNull();
    const bb = geo.boundingBox!;
    // Spans the chain: from before the first node to past the last.
    expect(bb.min.x).toBeLessThan(1);
    expect(bb.max.x).toBeGreaterThan(23);
    // One continuous surface, not disjoint sphere shells: every vertex is
    // referenced by the shared index (welded ring strip).
    expect(geo.getAttribute('position').count).toBeGreaterThan(200);
  });

  it('is deterministic for the same nodes + params', () => {
    const a = buildRockChainModel(NODES, P).geometry.getAttribute('position');
    const b = buildRockChainModel(NODES, P).geometry.getAttribute('position');
    expect(a.count).toBe(b.count);
    for (let i = 0; i < a.count; i += 23) {
      expect(a.getX(i)).toBeCloseTo(b.getX(i), 10);
      expect(a.getY(i)).toBeCloseTo(b.getY(i), 10);
    }
  });

  it('per-node girth shapes the body', () => {
    const thin = buildRockChainModel(
      NODES.map((n) => ({ ...n, r: 1 })),
      P,
    ).geometry.boundingBox!;
    const fat = buildRockChainModel(
      NODES.map((n) => ({ ...n, r: 5 })),
      P,
    ).geometry.boundingBox!;
    expect(fat.max.z - fat.min.z).toBeGreaterThan(thin.max.z - thin.min.z);
  });
});

describe('per-node authored elevation (rig point Y gizmo)', () => {
  it('node y IS the cave floor: a mid-span dive is obeyed verbatim', () => {
    const dived = generateCaveRigNodes(
      [
        { x: 0, y: 10, z: 0 },
        { x: 40, y: 0, z: 0 },
        { x: 80, y: 10, z: 0 },
      ],
      4,
    );
    const midFloor = (nodes: { x: number; y: number }[]): number => {
      let best = nodes[0].y;
      let bestD = Number.POSITIVE_INFINITY;
      for (const n of nodes) {
        const d = Math.abs(n.x - 40);
        if (d < bestD) {
          bestD = d;
          best = n.y;
        }
      }
      return best;
    };
    expect(midFloor(dived)).toBeLessThan(2);
    // Mouths land exactly on their authored heights.
    expect(dived[0].y).toBeCloseTo(10, 4);
    expect(dived[dived.length - 1].y).toBeCloseTo(10, 4);
  });
});

describe('per-node cave girth (rig point scale)', () => {
  it('a scaled rig point widens the bore there', () => {
    const uniform = generateCaveRigNodes(
      [
        { x: 0, y: 10, z: 0 },
        { x: 60, y: 10, z: 0 },
      ],
      4,
    );
    const bulged = generateCaveRigNodes(
      [
        { x: 0, y: 10, z: 0, r: 1 },
        { x: 30, y: 10, z: 0, r: 2.5 },
        { x: 60, y: 10, z: 0, r: 1 },
      ],
      4,
    );
    const mid = (nodes: { x: number; radius: number }[]): number => {
      let best = nodes[0].radius;
      let bestD = Number.POSITIVE_INFINITY;
      for (const n of nodes) {
        const d = Math.abs(n.x - 30);
        if (d < bestD) {
          bestD = d;
          best = n.radius;
        }
      }
      return best;
    };
    expect(mid(bulged)).toBeGreaterThan(mid(uniform) * 1.5);
  });
});

describe('map sanitizer round trip (new fields)', () => {
  const base = {
    version: 2,
    meta: { id: 'm', name: 'M', seed: 7 },
    content: {
      zones: [
        { id: 'z', name: 'Z', zMin: -10, zMax: 100, hub: { x: 0, z: 0, radius: 5, name: 'H' } },
      ],
      camps: [],
      npcs: {},
      objects: [],
      roads: [],
    },
    terrainEdits: [],
    placements: [] as unknown[],
  };

  it('keeps rockHeight/rockDepth/rockJag/rockTexId + rockNodes', () => {
    const doc = sanitizeMapDoc({
      ...base,
      placements: [
        {
          assetId: 'rock/ridge',
          x: 1,
          z: 2,
          rotY: 0,
          scale: 1,
          collide: false,
          rockHeight: 2.2,
          rockDepth: 0.4,
          rockJag: 0.7,
          rockTexId: 'Cliff001',
          rockNodes: [
            { dx: 0, dz: 0, dy: 0, r: 3, h: 1 },
            { dx: 10, dz: 1, dy: 2, r: 4, h: 1.2 },
          ],
        },
      ],
    });
    const p = doc!.placements[0];
    expect(p.rockHeight).toBeCloseTo(2.2);
    expect(p.rockDepth).toBeCloseTo(0.4);
    expect(p.rockJag).toBeCloseTo(0.7);
    expect(p.rockTexId).toBe('Cliff001');
    expect(p.rockNodes).toHaveLength(2);
    expect(p.rockNodes![1].r).toBeCloseTo(4);
  });

  it('drops malformed rockTexId and single-node chains', () => {
    const doc = sanitizeMapDoc({
      ...base,
      placements: [
        {
          assetId: 'rock/ridge',
          x: 0,
          z: 0,
          rotY: 0,
          scale: 1,
          collide: false,
          rockTexId: '../evil/path',
          rockNodes: [{ dx: 0, dz: 0, dy: 0, r: 3, h: 1 }],
        },
      ],
    });
    const p = doc!.placements[0];
    expect(p.rockTexId).toBeUndefined();
    expect(p.rockNodes).toBeUndefined();
  });

  it('keeps texture tile sizes (rock + cave), clamped 1..64', () => {
    const doc = sanitizeMapDoc({
      ...base,
      placements: [
        {
          assetId: 'rock/generated',
          x: 0,
          z: 0,
          rotY: 0,
          scale: 1,
          collide: false,
          rockTexId: 'Sand001',
          rockTexTile: 999,
        },
      ],
      caves: [
        {
          id: 'c1',
          nodes: [
            { x: 0, y: 5, z: 0, radius: 4 },
            { x: 20, y: 5, z: 0, radius: 4 },
          ],
          tex: 'Cliff002',
          texTile: 12,
        },
      ],
    });
    expect(doc!.placements[0].rockTexTile).toBe(64);
    expect(doc!.caves![0].texTile).toBe(12);
  });

  it('keeps cave tex keys and builtin: swatch shas', () => {
    const doc = sanitizeMapDoc({
      ...base,
      caves: [
        {
          id: 'c1',
          nodes: [
            { x: 0, y: 5, z: 0, radius: 4 },
            { x: 20, y: 5, z: 0, radius: 4 },
          ],
          tex: 'Sand002',
        },
      ],
      biomePaint: {
        cell: 4,
        cols: 4,
        rows: 4,
        originX: 0,
        originZ: 0,
        ids: new Array(16).fill(255),
        custom: [
          { id: 200, color: 0x997957, label: 'Dune Ripples', textureSha: builtinShaFor('Sand001') },
          { id: 201, color: 0x123456, textureSha: 'not a sha' },
        ],
      },
    });
    expect(doc!.caves![0].tex).toBe('Sand002');
    const custom = doc!.biomePaint!.custom!;
    expect(custom[0].textureSha).toBe('builtin:Sand001');
    expect(custom[1].textureSha).toBeUndefined();
  });
});

describe('terrain texture set registry', () => {
  it('builtin sha helpers round-trip registry keys only', () => {
    expect(builtinKeyOf(builtinShaFor('Grass002'))).toBe('Grass002');
    expect(builtinKeyOf('builtin:NoSuchSet')).toBeNull();
    expect(builtinKeyOf('a'.repeat(64))).toBeNull();
  });

  it('the imported Yoge packs are paint defaults with full PBR paths', () => {
    const defaults = paintDefaultSets().map((s) => s.key);
    expect(defaults).toEqual([
      'Grass002',
      'Grass003',
      'Sand001',
      'Sand002',
      'Sand003',
      'Sand004',
      'Cliff001',
      'Cliff002',
      // Second import: 2 more per source volume (14 total).
      'Grass004',
      'Grass005',
      'Sand005',
      'Sand006',
      'Sand007',
      'Sand008',
      'Cliff003',
      'Cliff004',
      'Ground100',
      'Ground101',
      'Rock052',
      'Rock053',
      'Rock054',
      'Rock055',
      // Third import (9 volumes): 2 per volume + all uniform Ground sets.
      'Roots001',
      'Roots002',
      'Rock056',
      'Rock057',
      'Cliff005',
      'Cliff006',
      'Lava005',
      'Lava006',
      'Wood001',
      'Wood002',
      'Wood003',
      'Wood004',
      'Cobblestone001',
      'Cobblestone002',
      // Dirt run pruned 2026-07-25 to the distinct tones (Ground103/107 kept for
      // the Auto-Retexture tool); near-identical browns 102/104/105/106/108/109/
      // 110/112/117 removed.
      'Ground103',
      'Ground107',
      'Ground111',
      'Ground113',
      'Ground114',
      'Ground115',
      'Ground116',
      'Ground118',
      // Fourth import (2026-07-25): Vol224 Tiles, Vol238/239 Snow, Vol271/278 Ground.
      'Tiles001',
      'Tiles002',
      'Snow001',
      'Snow002',
      'Snow003',
      'Snow004',
      'Ground119',
      'Ground120',
      'Ground121',
      'Ground122',
    ]);
    for (const key of defaults) {
      expect(terrainTexturePath(key, 'color')).toBe(`textures/terrain/${key}_Color.jpg`);
      expect(terrainTexturePath(key, 'normal')).toBe(`textures/terrain/${key}_NormalGL.jpg`);
      expect(terrainTexturePath(key, 'rough')).toBe(`textures/terrain/${key}_Roughness.jpg`);
      expect(terrainTexturePath(key, 'ao')).toBe(`textures/terrain/${key}_AmbientOcclusion.jpg`);
    }
  });

  it('map files a set does not ship resolve to null', () => {
    expect(terrainTexturePath('Lava004', 'rough')).toBeNull();
    expect(terrainTexturePath('NoSuchSet', 'color')).toBeNull();
    // Every registry entry at least has a Color map.
    for (const s of TERRAIN_TEXTURE_SETS) {
      expect(terrainTexturePath(s.key, 'color')).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Cave tube rendering: the mesh derives from the cave's own nodes and NOTHING
// else. Terrain towering over the tube must not squish, taper, or collapse a
// single ring ? the entrance stays the full authored arch everywhere.
// ---------------------------------------------------------------------------

const MOUTH_SEED = 20061;
// Per-ring layout: interior arch (ARC_SEGS+1) + interior floor (FLOOR_SEGS+1)
// + exterior arch + exterior bottom (cave_mesh.ts buildCaveGeometry).
const RING_COLS = (14 + 1 + 6 + 1) * 2;

describe('cave tube mesh (never squished by terrain)', () => {
  afterEach(() => setActiveWorldContent(null));

  it('every ring keeps the FULL authored arch even under raised terrain', () => {
    const z = 40;
    const h0 = terrainHeight(0, z, MOUTH_SEED);
    // A flat tube at the outside ground level running into a plateau raised
    // 40yd above it: the old carve-based mesh collapsed these rings flat.
    const cave: CaveDef = {
      id: 'mouth_test',
      radius: 4,
      nodes: Array.from({ length: 16 }, (_, i) => ({ x: i * 4, y: h0, z, radius: 4 })),
    };
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      terrainEdits: [{ x: 70, z, radius: 40, delta: h0 + 40, falloff: 'smooth', mode: 'level' }],
      caves: [cave],
    });
    const geo = buildCaveGeometry(cave, { swatches: new Map() });
    expect(geo).not.toBeNull();
    const pos = geo!.getAttribute('position');
    // Both ends open (default): no cap-center vertices, clean ring grid.
    const rows = pos.count / RING_COLS;
    expect(Number.isInteger(rows)).toBe(true);
    // Apex (u = 0) of each interior ring: arch vertex 7 (ARC_SEGS / 2). The
    // full clearance stands on EVERY ring ? clearance(4) = 3.4yd.
    for (let r = 0; r < rows; r++) {
      const apexY = pos.getY(r * RING_COLS + 7);
      const floorY = pos.getY(r * RING_COLS + (14 + 1)); // first floor column
      expect(apexY - floorY).toBeGreaterThan(3.3);
    }
    // The entrance ring spans exactly the authored width (radius 4, wall to
    // wall at 0.995 inset): "always as big as you scale it".
    const x0 = pos.getX(0);
    const z0 = pos.getZ(0);
    const x1 = pos.getX(14);
    const z1 = pos.getZ(14);
    expect(Math.hypot(x1 - x0, z1 - z0)).toBeCloseTo(2 * 4 * 0.995, 3);
  });

  it('sealing an end adds its rock-cap vertices; open ends add none', () => {
    const nodes = Array.from({ length: 8 }, (_, i) => ({ x: i * 5, y: 0, z: 0, radius: 4 }));
    const open = buildCaveGeometry({ id: 'o', nodes }, { swatches: new Map() });
    const sealed = buildCaveGeometry(
      { id: 's', nodes, startOpen: false, endOpen: false },
      { swatches: new Map() },
    );
    expect(open).not.toBeNull();
    expect(sealed).not.toBeNull();
    const openCount = open!.getAttribute('position').count;
    const sealedCount = sealed!.getAttribute('position').count;
    expect(openCount % RING_COLS).toBe(0);
    // Two centers (interior + exterior) per sealed end.
    expect(sealedCount - openCount).toBe(4);
  });
});
