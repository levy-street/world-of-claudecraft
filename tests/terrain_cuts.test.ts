import { describe, expect, it } from 'vitest';
import { caveBoreCut, caveClearance, caveMouthCuts } from '../src/sim/caves';
import { effectiveTerrainCuts } from '../src/sim/ground_sheets';
import { sanitizeMapDoc, serializeMapDoc } from '../src/sim/map_doc';
import {
  CUT_MAX_BLEND,
  CUT_MAX_HALF,
  HOLE_MAX_RADIUS,
  cutBounds,
  cutSdfAt,
  cutsInRect,
  cutsSdfAt,
  cutVerticalBounds,
  inTerrainCut,
  inTerrainHole,
  sanitizeTerrainCut,
  smoothMin,
} from '../src/sim/terrain_cuts';
import type { CaveDef, TerrainCut } from '../src/sim/types';

// The boolean cut stack: the signed distance field itself, the cave bore that
// carves its own mouth out of it, and the document round-trip. The sim's
// ground-sheet consumer is covered by tests/caves.test.ts, which pins that
// movement reads exactly this field.

const sphere = (x: number, y: number, z: number, radius: number): TerrainCut => ({
  x,
  y,
  z,
  radius,
});

describe('shape signed distances (sim/terrain_cuts.ts)', () => {
  it('an absent shape is the v1 sphere, evaluated identically', () => {
    const s = sphere(0, 10, 0, 5);
    expect(cutSdfAt(s, 0, 10, 0)).toBeCloseTo(-5, 9);
    expect(cutSdfAt(s, 5, 10, 0)).toBeCloseTo(0, 9);
    expect(cutSdfAt(s, 8, 10, 0)).toBeCloseTo(3, 9);
    // The legacy predicate, point for point (tests/caves.test.ts pins the
    // same numbers through the old name).
    const holes = [sphere(0, 10, 0, 5)];
    expect(inTerrainHole(holes, 0, 0, 10)).toBe(true);
    expect(inTerrainHole(holes, 4.9, 0, 10)).toBe(true);
    expect(inTerrainHole(holes, 5.1, 0, 10)).toBe(false);
    expect(inTerrainHole(holes, 3, 0, 14)).toBe(false); // 3-4-5: exactly on the rim
    expect(inTerrainHole(holes, 2.9, 0, 13.9)).toBe(true);
  });

  it('a box is an oriented slab, and yaw rotates the footprint', () => {
    const box: TerrainCut = {
      shape: 'box',
      x: 0,
      y: 0,
      z: 0,
      radius: 1,
      halfX: 10,
      halfY: 2,
      halfZ: 2,
    };
    expect(cutSdfAt(box, 0, 0, 0)).toBeLessThan(0); // centre
    expect(cutSdfAt(box, 9, 0, 0)).toBeLessThan(0); // along the long axis
    expect(cutSdfAt(box, 11, 0, 0)).toBeGreaterThan(0);
    expect(cutSdfAt(box, 0, 0, 5)).toBeGreaterThan(0); // across the short axis
    // Yawed a quarter turn, the long axis now runs along z.
    const turned: TerrainCut = { ...box, rotY: Math.PI / 2 };
    expect(cutSdfAt(turned, 0, 0, 9)).toBeLessThan(0);
    expect(cutSdfAt(turned, 9, 0, 0)).toBeGreaterThan(0);
  });

  it('a pitched box follows a cliff face rather than dropping straight down', () => {
    const slot: TerrainCut = {
      shape: 'box',
      x: 0,
      y: 0,
      z: 0,
      radius: 1,
      halfX: 2,
      halfY: 10,
      halfZ: 2,
      rotX: Math.PI / 2,
    };
    // Pitched a quarter turn, the tall axis lies along z.
    expect(cutSdfAt(slot, 0, 0, 9)).toBeLessThan(0);
    expect(cutSdfAt(slot, 0, 9, 0)).toBeGreaterThan(0);
  });

  it('a capsule is a round-ended bar along its local X', () => {
    const bar: TerrainCut = { shape: 'capsule', x: 0, y: 0, z: 0, radius: 3, len: 10 };
    expect(cutSdfAt(bar, 0, 0, 0)).toBeCloseTo(-3, 9);
    expect(cutSdfAt(bar, 10, 0, 0)).toBeCloseTo(-3, 9); // still on the segment
    expect(cutSdfAt(bar, 14, 0, 0)).toBeCloseTo(1, 9); // past the cap
    expect(cutSdfAt(bar, 0, 0, 4)).toBeCloseTo(1, 9);
    // vert squashes the cross-section: an arch wider than it is tall.
    const arch: TerrainCut = { ...bar, vert: 0.5 };
    expect(cutSdfAt(arch, 0, 2, 0)).toBeGreaterThan(0);
    expect(cutSdfAt(arch, 0, 1, 0)).toBeLessThan(0);
  });

  it('a tube is a capsule chain with per-node radius', () => {
    const tube: TerrainCut = {
      shape: 'tube',
      x: 0,
      y: 0,
      z: 0,
      radius: 2,
      nodes: [
        { x: -10, y: 0, z: 0, radius: 2 },
        { x: 10, y: 0, z: 0, radius: 6 },
      ],
    };
    expect(cutSdfAt(tube, -10, 0, 0)).toBeCloseTo(-2, 9);
    expect(cutSdfAt(tube, 10, 0, 0)).toBeCloseTo(-6, 9);
    // Radius interpolates along the chain: halfway the bore is 4 wide.
    expect(cutSdfAt(tube, 0, 0, 3.9)).toBeLessThan(0);
    expect(cutSdfAt(tube, 0, 0, 4.1)).toBeGreaterThan(0);
    expect(cutSdfAt(tube, 0, 0, 20)).toBeGreaterThan(0);
  });

  it('a bore tube never cuts BELOW its chain line', () => {
    const nodes = [
      { x: -10, y: 0, z: 0, radius: 4, vy: 6 },
      { x: 10, y: 0, z: 0, radius: 4, vy: 6 },
    ];
    const open: TerrainCut = { shape: 'tube', x: 0, y: 0, z: 0, radius: 4, nodes };
    const bore: TerrainCut = { ...open, bore: true };
    // Above the line both cut.
    expect(cutSdfAt(open, 0, 3, 0)).toBeLessThan(0);
    expect(cutSdfAt(bore, 0, 3, 0)).toBeLessThan(0);
    // Below it only the unclipped ellipse does: a tube arcing over a valley
    // must not delete the valley floor under it.
    expect(cutSdfAt(open, 0, -3, 0)).toBeLessThan(0);
    expect(cutSdfAt(bore, 0, -3, 0)).toBeGreaterThan(0);
  });
});

describe('the union and its blend', () => {
  it('blend 0 is an exact min, so a v1 document is untouched', () => {
    expect(smoothMin(3, 7, 0)).toBe(3);
    expect(smoothMin(-2, 5, 0)).toBe(-2);
    const cuts = [sphere(-4, 0, 0, 5), sphere(4, 0, 0, 5)];
    expect(cutsSdfAt(cuts, 0, 0, 0)).toBe(
      Math.min(cutSdfAt(cuts[0], 0, 0, 0), cutSdfAt(cuts[1], 0, 0, 0)),
    );
  });

  it('blend melts neighbouring cuts instead of leaving a crease', () => {
    const hard = [sphere(-6, 0, 0, 5), sphere(6, 0, 0, 5)];
    const soft = [sphere(-6, 0, 0, 5), { ...sphere(6, 0, 0, 5), blend: 6 }];
    // Between two spheres that only just touch, the hard union leaves a waist
    // at distance 1 outside; the blended one has already closed it.
    const hardMid = cutsSdfAt(hard, 0, 0, 0);
    const softMid = cutsSdfAt(soft, 0, 0, 0);
    expect(hardMid).toBeCloseTo(1, 6);
    expect(softMid).toBeLessThan(hardMid);
    expect(softMid).toBeLessThan(0);
  });

  it('a patch restores the ground inside a cut', () => {
    const cuts = [sphere(0, 10, 0, 8)];
    const patches = [sphere(4, 10, 0, 3)];
    expect(inTerrainCut(cuts, 0, 0, 10)).toBe(true);
    expect(inTerrainCut(cuts, 4, 0, 10, patches)).toBe(false);
    expect(inTerrainCut(cuts, -4, 0, 10, patches)).toBe(true);
  });

  it('an empty list cuts nothing, at any height', () => {
    expect(cutsSdfAt([], 0, 0, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(cutsSdfAt(undefined, 0, 0, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(inTerrainCut(undefined, 0, 0, 0)).toBe(false);
  });
});

describe('bounds', () => {
  it('a rotated box is covered whatever its yaw', () => {
    const box: TerrainCut = {
      shape: 'box',
      x: 100,
      y: 0,
      z: -50,
      radius: 1,
      halfX: 10,
      halfY: 1,
      halfZ: 2,
      rotY: 0.7,
    };
    const b = cutBounds(box);
    // The diagonal reach bounds every orientation.
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      const probe = { ...box, rotY: a };
      // Sample the solid's own extreme along its long axis.
      const px = 100 + Math.cos(a) * 10;
      const pz = -50 + Math.sin(a) * 10;
      expect(px).toBeGreaterThanOrEqual(b.minX);
      expect(px).toBeLessThanOrEqual(b.maxX);
      expect(pz).toBeGreaterThanOrEqual(b.minZ);
      expect(pz).toBeLessThanOrEqual(b.maxZ);
      expect(cutSdfAt(probe, px, 0, pz)).toBeLessThanOrEqual(0.001);
    }
  });

  it('a tube bounds its whole chain, and a bore never reaches below it', () => {
    const tube: TerrainCut = {
      shape: 'tube',
      x: 0,
      y: 0,
      z: 0,
      radius: 3,
      nodes: [
        { x: 0, y: 0, z: 0, radius: 3, vy: 5 },
        { x: 40, y: 10, z: 20, radius: 3, vy: 5 },
      ],
    };
    const b = cutBounds(tube);
    expect(b.minX).toBeCloseTo(-3, 6);
    expect(b.maxX).toBeCloseTo(43, 6);
    expect(b.maxZ).toBeCloseTo(23, 6);
    expect(cutVerticalBounds(tube).minY).toBeCloseTo(-5, 6);
    expect(cutVerticalBounds({ ...tube, bore: true }).minY).toBeCloseTo(0, 6);
  });

  it('cutsInRect keeps the mesher off cuts it cannot see', () => {
    const near = sphere(0, 0, 0, 5);
    const far = sphere(500, 0, 500, 5);
    expect(cutsInRect([near, far], -10, -10, 10, 10)).toEqual([near]);
    expect(cutsInRect([far], -10, -10, 10, 10)).toBeNull();
    expect(cutsInRect([], -10, -10, 10, 10)).toBeNull();
  });
});

describe('a cave bore carves its own mouth (sim/caves.ts)', () => {
  // A tube climbing out of a hillside: floor rises from -20 to 0.
  const cave: CaveDef = {
    id: 'mouth',
    nodes: [
      { x: 0, y: -20, z: 0, radius: 4 },
      { x: 40, y: 0, z: 0, radius: 4 },
    ],
    autoMouth: true,
  };

  it('the cut is the bore: lateral radius and the clearance above the floor', () => {
    const cut = caveBoreCut(cave);
    expect(cut).not.toBeNull();
    expect(cut?.shape).toBe('tube');
    expect(cut?.bore).toBe(true);
    expect(cut?.nodes?.[0]).toEqual({
      x: 0,
      y: -20,
      z: 0,
      radius: 4,
      vy: caveClearance(4),
    });
    // The width multiplier widens the cut exactly as it widens the bore.
    const wide = caveBoreCut({ ...cave, width: 2 });
    expect(wide?.nodes?.[0].radius).toBe(8);
  });

  it('cuts only where the bore BREACHES the surface', () => {
    const cut = caveBoreCut(cave);
    if (!cut) throw new Error('expected a bore cut');
    const cuts = [cut];
    // Buried: the surface sits above the ceiling, so nothing is removed.
    expect(inTerrainCut(cuts, 20, 0, 60)).toBe(false);
    // Breaching: the surface passes through the bore.
    const floorAtMid = -10;
    expect(inTerrainCut(cuts, 20, 0, floorAtMid + 1)).toBe(true);
    // Standing proud: the surface is below the floor, so the ground under an
    // exposed shell survives.
    expect(inTerrainCut(cuts, 20, 0, floorAtMid - 5)).toBe(false);
    // Outside the footprint entirely.
    expect(inTerrainCut(cuts, 20, 40, floorAtMid + 1)).toBe(false);
  });

  it('only an opted-in cave carves, so v1 documents gain no opening', () => {
    expect(caveMouthCuts([cave]).length).toBe(1);
    expect(caveMouthCuts([{ ...cave, autoMouth: undefined }]).length).toBe(0);
    expect(caveMouthCuts([])).toEqual([]);
    expect(caveBoreCut({ id: 'empty', nodes: [] })).toBeNull();
  });

  it('effectiveTerrainCuts merges authored cuts with self-carved mouths', () => {
    const holes = [sphere(0, 0, 0, 3)];
    expect(effectiveTerrainCuts(undefined, holes)).toBe(holes);
    expect(effectiveTerrainCuts([{ ...cave, autoMouth: undefined }], holes)).toBe(holes);
    const merged = effectiveTerrainCuts([cave], holes);
    expect(merged.length).toBe(2);
    expect(merged[0]).toBe(holes[0]);
    // Memoized on the same arrays: the per-tick path must not rebuild it.
    expect(effectiveTerrainCuts([cave], holes)).not.toBe(merged); // new cave array
    const caves = [cave];
    expect(effectiveTerrainCuts(caves, holes)).toBe(effectiveTerrainCuts(caves, holes));
  });
});

describe('sanitizing (untrusted documents)', () => {
  it('keeps a legacy sphere exactly as it was, shape field absent', () => {
    expect(sanitizeTerrainCut({ x: 1, y: 2, z: 3, radius: 7 })).toEqual({
      x: 1,
      y: 2,
      z: 3,
      radius: 7,
    });
    expect(sanitizeTerrainCut({ x: 1, y: 2, z: 3, radius: 999 })?.radius).toBe(HOLE_MAX_RADIUS);
    expect(sanitizeTerrainCut({ x: 1, y: 2, z: 3, radius: 0.01 })?.radius).toBe(1);
    expect(sanitizeTerrainCut({ x: 'junk', y: 2, z: 3, radius: 4 })).toBeNull();
    expect(sanitizeTerrainCut({ x: 1, y: 2, z: 3, radius: Number.NaN })).toBeNull();
  });

  it('clamps the shape fields and rejects an unknown shape', () => {
    const box = sanitizeTerrainCut({
      shape: 'box',
      x: 0,
      y: 0,
      z: 0,
      radius: 4,
      halfX: 999,
      halfY: 0.01,
      blend: 99,
    });
    expect(box?.shape).toBe('box');
    expect(box?.halfX).toBe(CUT_MAX_HALF);
    expect(box?.halfY).toBe(0.5);
    expect(box?.halfZ).toBeUndefined(); // absent falls back to radius
    expect(box?.blend).toBe(CUT_MAX_BLEND);
    expect(sanitizeTerrainCut({ shape: 'wormhole', x: 0, y: 0, z: 0, radius: 4 })?.shape).toBe(
      undefined,
    );
  });

  it('a tube with no usable chain degrades to its sphere', () => {
    const good = sanitizeTerrainCut({
      shape: 'tube',
      x: 0,
      y: 0,
      z: 0,
      radius: 3,
      bore: true,
      nodes: [
        { x: 0, y: 0, z: 0, radius: 3, vy: 5 },
        { x: 'junk', y: 0, z: 0, radius: 3 },
      ],
    });
    expect(good?.shape).toBe('tube');
    expect(good?.nodes?.length).toBe(1);
    expect(good?.bore).toBe(true);
    const dead = sanitizeTerrainCut({ shape: 'tube', x: 0, y: 0, z: 0, radius: 3, nodes: [] });
    expect(dead?.shape).toBeUndefined();
    expect(dead?.radius).toBe(3);
  });
});

describe('document round-trip (sim/map_doc.ts)', () => {
  const baseDoc = {
    version: 2,
    meta: { id: 'm1', name: 'cuts', seed: 20061 },
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
    placements: [],
  };

  it('shaped cuts and the self-carving flag survive serialize to parse', () => {
    const doc = sanitizeMapDoc(
      JSON.parse(
        JSON.stringify({
          ...baseDoc,
          caves: [
            {
              id: 'c1',
              nodes: [
                { x: 0, y: -5, z: 40, radius: 4 },
                { x: 10, y: -6, z: 40, radius: 5 },
              ],
              autoMouth: true,
              mouthBlend: 2.5,
            },
          ],
          holes: [
            { shape: 'box', x: 5, y: 12, z: -8, radius: 7, halfX: 6, halfZ: 3, rotY: 0.4 },
            { shape: 'capsule', x: 0, y: 0, z: 0, radius: 3, len: 8, vert: 0.7 },
          ],
        }),
      ),
    );
    expect(doc?.caves?.[0].autoMouth).toBe(true);
    expect(doc?.caves?.[0].mouthBlend).toBe(2.5);
    expect(doc?.holes?.[0].shape).toBe('box');
    expect(doc?.holes?.[0].halfX).toBe(6);
    expect(doc?.holes?.[1].shape).toBe('capsule');
    expect(doc?.holes?.[1].vert).toBe(0.7);
    const reparsed = sanitizeMapDoc(JSON.parse(serializeMapDoc(doc as never)));
    expect(reparsed?.holes).toEqual(doc?.holes);
    expect(reparsed?.caves).toEqual(doc?.caves);
  });

  it('a v1 document parses to the same spheres it always did', () => {
    const doc = sanitizeMapDoc({ ...baseDoc, holes: [{ x: 5, y: 12, z: -8, radius: 7 }] });
    expect(doc?.holes).toEqual([{ x: 5, y: 12, z: -8, radius: 7 }]);
    expect(doc?.caves?.[0]?.autoMouth).toBeUndefined();
  });
});
