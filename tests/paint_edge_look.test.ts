import { describe, expect, it } from 'vitest';
import { paintEdgeParams } from '../src/render/terrain_paint_layers';
import {
  DEFAULT_PAINT_EDGE_DETAIL,
  DEFAULT_PAINT_EDGE_SOFTNESS,
  sanitizeMapDoc,
} from '../src/sim/map_doc';

function grid(cell: number, extra: Record<string, unknown> = {}): never {
  // `never` so the same literal serves both paintEdgeParams (typed BiomePaint)
  // and sanitizeMapDoc (raw unknown), including the deliberately-junk cases.
  return {
    cell,
    cols: 4,
    rows: 4,
    originX: 0,
    originZ: 0,
    ids: [255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255],
    ...extra,
  } as never;
}

describe('paint edge look', () => {
  it('reads the same in yards whatever the grid cell is', () => {
    // The whole point of storing 0..1 and resolving against `cell`: a map at
    // 0.25yd cells and one at 2yd cells must get the same boundary on screen.
    const fine = paintEdgeParams(grid(0.25, { edgeSoftness: 0.5, edgeDetail: 0.5 }));
    const coarse = paintEdgeParams(grid(2, { edgeSoftness: 0.5, edgeDetail: 0.5 }));
    expect(fine.warpYd).toBeCloseTo(coarse.warpYd, 6);
    expect(fine.spreadCells * 0.25).toBeCloseTo(coarse.spreadCells * 2, 6);
  });

  it('absent values read as the defaults, not as zero', () => {
    const bare = paintEdgeParams(grid(1));
    const explicit = paintEdgeParams(
      grid(1, { edgeSoftness: DEFAULT_PAINT_EDGE_SOFTNESS, edgeDetail: DEFAULT_PAINT_EDGE_DETAIL }),
    );
    expect(bare).toEqual(explicit);
    expect(bare.warpYd).toBeGreaterThan(0);
  });

  it('zero is the pre-feature look: no warp, a one-cell kernel', () => {
    const off = paintEdgeParams(grid(1, { edgeSoftness: 0, edgeDetail: 0 }));
    expect(off.warpYd).toBe(0);
    expect(off.spreadCells).toBe(1);
    expect(off.radiusCells).toBe(1);
  });

  it('never blends narrower than one cell', () => {
    // 4yd of softness on a 16yd grid is still less than a cell.
    expect(paintEdgeParams(grid(16, { edgeSoftness: 1 })).spreadCells).toBe(1);
  });

  it('the interior radius covers the kernel AND the warp', () => {
    const p = paintEdgeParams(grid(1, { edgeSoftness: 1, edgeDetail: 1 }));
    expect(p.radiusCells).toBeGreaterThanOrEqual(Math.ceil(p.spreadCells + p.warpYd));
  });

  it('survives a document round-trip, and an untouched document stays bare', () => {
    const doc = (paint: Record<string, unknown>): Record<string, unknown> => ({
      version: 2,
      meta: { id: 'm1', name: 'edges', seed: 1 },
      content: {
        zones: [
          { id: 'z', name: 'Z', zMin: -10, zMax: 100, hub: { x: 0, z: 0, radius: 5, name: 'H' } },
        ],
        camps: [],
        npcs: {},
        objects: [],
      },
      biomePaint: paint,
    });
    const round = (paint: Record<string, unknown>) => {
      const out = sanitizeMapDoc(doc(paint));
      expect(out).not.toBeNull();
      return out?.biomePaint;
    };
    const withEdge = round(grid(1, { edgeSoftness: 0.75, edgeDetail: 0.2 }));
    expect(withEdge?.edgeSoftness).toBe(0.75);
    expect(withEdge?.edgeDetail).toBe(0.2);
    // A value equal to the default is dropped, so a document that never
    // touched the sliders round-trips byte-identically to a pre-feature save.
    const atDefault = round(
      grid(1, {
        edgeSoftness: DEFAULT_PAINT_EDGE_SOFTNESS,
        edgeDetail: DEFAULT_PAINT_EDGE_DETAIL,
      }),
    );
    expect(atDefault?.edgeSoftness).toBeUndefined();
    expect(atDefault?.edgeDetail).toBeUndefined();
    // Garbage is dropped rather than thrown on, and out-of-range is clamped.
    const junk = round(grid(1, { edgeSoftness: 'wide', edgeDetail: 9 }));
    expect(junk?.edgeSoftness).toBeUndefined();
    expect(junk?.edgeDetail).toBe(1);
  });
});
