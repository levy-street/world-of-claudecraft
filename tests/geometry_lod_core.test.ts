// The pure half of a geometry's levels of detail (src/render/assets/geometry_lod_core.ts): the
// fallback rule, how a file's WOC_lod list is named, the triangle-list check, and the index
// arithmetic a merge runs to carry its parts' levels.
import { describe, expect, it } from 'vitest';
import {
  type CoarseLodLevel,
  type GeometryLodLevel,
  geometryLodDrawn,
  type LodMergePart,
  lodIndicesValid,
  mergeLodIndices,
  wocLodLevelNames,
} from '../src/render/assets/geometry_lod_core';

const LEVELS: readonly GeometryLodLevel[] = ['lod0', 'mid', 'far'];

describe('geometryLodDrawn: the next finer level that exists', () => {
  const cases: [GeometryLodLevel, readonly CoarseLodLevel[], GeometryLodLevel][] = [
    ['lod0', [], 'lod0'],
    ['lod0', ['mid'], 'lod0'],
    ['lod0', ['far'], 'lod0'],
    ['lod0', ['mid', 'far'], 'lod0'],
    ['mid', [], 'lod0'],
    ['mid', ['mid'], 'mid'],
    // mid never falls DOWN to far: a coarser level than asked is never drawn
    ['mid', ['far'], 'lod0'],
    ['mid', ['mid', 'far'], 'mid'],
    ['far', [], 'lod0'],
    ['far', ['mid'], 'mid'],
    ['far', ['far'], 'far'],
    ['far', ['mid', 'far'], 'far'],
  ];
  it.each(cases)('asked %s of a geometry carrying %j draws %s', (wanted, carries, drawn) => {
    expect(geometryLodDrawn(wanted, (level) => carries.includes(level))).toBe(drawn);
  });

  it('covers every (wanted, carried) pair', () => {
    const subsets: CoarseLodLevel[][] = [[], ['mid'], ['far'], ['mid', 'far']];
    expect(cases.length).toBe(LEVELS.length * subsets.length);
  });
});

describe('wocLodLevelNames: the contract names the list by position', () => {
  it('names a list of two mid then far, and a list of one far (mid saved too little)', () => {
    expect(wocLodLevelNames(0)).toEqual([]);
    expect(wocLodLevelNames(1)).toEqual(['far']);
    expect(wocLodLevelNames(2)).toEqual(['mid', 'far']);
    // entries past the second name nothing
    expect(wocLodLevelNames(3)).toEqual(['mid', 'far']);
  });
});

describe('lodIndicesValid', () => {
  it('takes whole triangles over the geometry own vertices only', () => {
    expect(lodIndicesValid(new Uint16Array([0, 1, 2]), 3)).toBe(true);
    expect(lodIndicesValid(new Uint32Array([0, 1, 2, 2, 1, 3]), 4)).toBe(true);
    expect(lodIndicesValid(new Uint16Array([]), 3)).toBe(false);
    expect(lodIndicesValid(new Uint16Array([0, 1]), 3)).toBe(false);
    expect(lodIndicesValid(new Uint16Array([0, 1, 3]), 3)).toBe(false);
    expect(lodIndicesValid([0, 1, 1.5], 3)).toBe(false);
    expect(lodIndicesValid([0, -1, 2], 3)).toBe(false);
  });
});

/** A part with `vertices` vertices whose level 0 is `tris` triangles over them. */
function part(over: Partial<LodMergePart> & { vertices: number }): LodMergePart {
  return { flip: false, lod0: null, mid: null, far: null, ...over };
}

describe('mergeLodIndices: each part offset like the merged level 0', () => {
  it('offsets every part by the vertices before it, mid and far alike', () => {
    const a = part({ vertices: 4, lod0: [0, 1, 2, 2, 1, 3], mid: [0, 1, 3], far: [0, 1, 3] });
    const b = part({ vertices: 3, lod0: [0, 1, 2], mid: [0, 2, 1], far: [2, 1, 0] });
    const merged = mergeLodIndices([a, b]);
    expect([...(merged.mid ?? [])]).toEqual([0, 1, 3, 4, 6, 5]);
    expect([...(merged.far ?? [])]).toEqual([0, 1, 3, 6, 5, 4]);
  });

  it('falls back per part: mid to level 0, far to mid then level 0', () => {
    const onlyFar = part({ vertices: 3, lod0: [0, 1, 2, 2, 1, 0], far: [0, 1, 2] });
    const onlyMid = part({ vertices: 3, lod0: [0, 1, 2, 0, 2, 1], mid: [0, 2, 1] });
    const none = part({ vertices: 3, lod0: [2, 1, 0] });
    const merged = mergeLodIndices([onlyFar, onlyMid, none]);
    // mid: onlyFar draws its level 0 (it has no mid), onlyMid its mid, none its level 0
    expect([...(merged.mid ?? [])]).toEqual([0, 1, 2, 2, 1, 0, 3, 5, 4, 8, 7, 6]);
    // far: onlyFar its far, onlyMid its mid, none its level 0
    expect([...(merged.far ?? [])]).toEqual([0, 1, 2, 3, 5, 4, 8, 7, 6]);
  });

  it('leaves a level out when no part carries it', () => {
    const merged = mergeLodIndices([
      part({ vertices: 3, lod0: [0, 1, 2] }),
      part({ vertices: 3, lod0: [0, 1, 2], far: [0, 1, 2] }),
    ]);
    expect(merged.mid).toBeNull();
    expect(merged.far).not.toBeNull();
    expect(mergeLodIndices([part({ vertices: 3, lod0: [0, 1, 2] })])).toEqual({
      mid: null,
      far: null,
    });
  });

  it('flips a mirrored part as its level 0 is flipped, and draws an unindexed part in order', () => {
    const mirrored = part({ vertices: 3, flip: true, lod0: [0, 1, 2], mid: [0, 1, 2] });
    const unindexed = part({ vertices: 6 });
    const withMid = part({ vertices: 3, lod0: [0, 1, 2], mid: [1, 2, 0] });
    const merged = mergeLodIndices([mirrored, unindexed, withMid]);
    expect([...(merged.mid ?? [])]).toEqual([0, 2, 1, 3, 4, 5, 6, 7, 8, 10, 11, 9]);
  });

  it('drops a trailing partial triangle so later parts never shift', () => {
    const broken = part({ vertices: 3, lod0: [0, 1, 2, 0], mid: [0, 1, 2, 1] });
    const next = part({ vertices: 3, lod0: [0, 1, 2], mid: [0, 1, 2] });
    expect([...(mergeLodIndices([broken, next]).mid ?? [])]).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('is 16-bit up to 0xffff vertices and 32-bit past them', () => {
    const small = mergeLodIndices([part({ vertices: 0xffff, lod0: [0, 1, 2], mid: [0, 1, 2] })]);
    expect(small.mid).toBeInstanceOf(Uint16Array);
    const big = mergeLodIndices([
      part({ vertices: 0xffff, lod0: [0, 1, 2], mid: [0, 1, 2] }),
      part({ vertices: 3, lod0: [0, 1, 2], mid: [0, 1, 2] }),
    ]);
    expect(big.mid).toBeInstanceOf(Uint32Array);
    expect([...(big.mid ?? [])].slice(3)).toEqual([0xffff, 0x10000, 0x10001]);
  });
});
