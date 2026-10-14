import { describe, expect, it } from 'vitest';
import { DECAL_LIBRARY } from '../src/render/decal_library.generated';
import {
  DECAL_DROP_MARGIN,
  DECAL_RANGE_BASE,
  DECAL_RANGE_MAX,
  decalEdgeDistance,
  decalViewRange,
  keepDroppedDecal,
  pickResidentDecals,
} from '../src/render/decal_stream_core';
import { MAX_DECAL_SIZE, MAX_DECALS, MIN_DECAL_SIZE, sanitizeMapDoc } from '../src/sim/map_doc';
import type { MapDecal } from '../src/sim/types';

// Authored ground decals: the document contract (what survives a save) and the
// streaming rules that keep a decal-heavy map cheap.

function docWith(decals: unknown): unknown {
  return {
    version: 2,
    meta: { id: 'm', name: 'M', createdAt: 0, updatedAt: 0, seed: 1, parentId: '' },
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
    placements: [],
    decals,
  };
}

const decal = (over: Partial<MapDecal> = {}): Record<string, unknown> => ({
  x: 10,
  z: 20,
  tex: 'builtin:pentagram',
  size: 8,
  rot: 0,
  ...over,
});

describe('decal document', () => {
  it('round-trips a stamp and drops fields left at their defaults', () => {
    const doc = sanitizeMapDoc(
      docWith([decal({ opacity: 1, aspect: 1, color: 0xffffff, glow: 0, sort: 0 })]),
    );
    expect(doc?.decals).toEqual([{ x: 10, z: 20, tex: 'builtin:pentagram', size: 8, rot: 0 }]);
  });

  it('keeps the non-default look fields', () => {
    const doc = sanitizeMapDoc(
      docWith([decal({ opacity: 0.4, aspect: 2, color: 0x8844ff, glow: 0.5, sort: 3 })]),
    );
    expect(doc?.decals?.[0]).toMatchObject({
      opacity: 0.4,
      aspect: 2,
      color: 0x8844ff,
      glow: 0.5,
      sort: 3,
    });
  });

  it('accepts an imported sha and rejects art ids of any other shape', () => {
    const sha = 'a'.repeat(64);
    const doc = sanitizeMapDoc(
      docWith([
        decal({ tex: sha }),
        decal({ tex: 'builtin:blast_scorch' }),
        decal({ tex: 'builtin:has spaces' }),
        decal({ tex: 'javascript:alert(1)' }),
        decal({ tex: 'a'.repeat(63) }),
        decal({ tex: '' }),
      ]),
    );
    expect(doc?.decals?.map((d) => d.tex)).toEqual([sha, 'builtin:blast_scorch']);
  });

  it('clamps the size and wraps rotation instead of clamping it', () => {
    const doc = sanitizeMapDoc(
      docWith([
        decal({ size: 9999 }),
        decal({ size: 0.0001 }),
        decal({ rot: Math.PI * 2 + 0.5 }),
        decal({ rot: -0.5 }),
      ]),
    );
    const out = doc?.decals ?? [];
    expect(out[0].size).toBe(MAX_DECAL_SIZE);
    expect(out[1].size).toBe(MIN_DECAL_SIZE);
    expect(out[2].rot).toBeCloseTo(0.5, 6);
    expect(out[3].rot).toBeCloseTo(Math.PI * 2 - 0.5, 6);
  });

  it('drops malformed entries and caps the list', () => {
    const doc = sanitizeMapDoc(
      docWith([
        decal({ x: Number.NaN }),
        null,
        'nope',
        { tex: 'builtin:pentagram' }, // no position
        ...Array.from({ length: MAX_DECALS + 20 }, () => decal()),
      ]),
    );
    // The cap applies to the RAW list, so the leading junk eats slots rather
    // than letting a hostile document push extra valid entries past the cap.
    expect(doc?.decals?.length).toBeLessThanOrEqual(MAX_DECALS);
    expect(doc?.decals?.every((d) => Number.isFinite(d.x) && Number.isFinite(d.z))).toBe(true);
  });

  it('leaves no decals field on a map with none', () => {
    expect(sanitizeMapDoc(docWith([]))?.decals).toBeUndefined();
    expect(sanitizeMapDoc(docWith(undefined))?.decals).toBeUndefined();
  });
});

describe('decal streaming', () => {
  it('scales view range with footprint, capped by the fog', () => {
    expect(decalViewRange(0, 10_000)).toBe(DECAL_RANGE_BASE);
    expect(decalViewRange(4, 10_000)).toBeGreaterThan(decalViewRange(1, 10_000));
    expect(decalViewRange(100_000, 10_000)).toBe(DECAL_RANGE_MAX);
    // Fog always wins: drawing what fog hides is wasted work.
    expect(decalViewRange(60, 40)).toBe(40);
  });

  it('measures distance to the footprint EDGE, so you can stand inside one', () => {
    const big = { x: 0, z: 0, size: 60 };
    expect(decalEdgeDistance(big, 0, 0)).toBe(0);
    expect(decalEdgeDistance(big, 0, 20)).toBe(0); // still inside the circle
    expect(decalEdgeDistance(big, 0, 40)).toBe(10);
  });

  it('only picks decals in range', () => {
    const decals = [
      { x: 0, z: 0, size: 4 }, // under the camera
      { x: 0, z: 5_000, size: 4 }, // far away
    ];
    expect(pickResidentDecals(decals, 0, 0, 1000).map((p) => p.index)).toEqual([0]);
  });

  it('fades in across the outer band rather than popping', () => {
    const d = { x: 0, z: 0, size: 4 };
    const range = decalViewRange(d.size, 1000);
    // Ranges are measured to the footprint edge, so park the EDGE at the range.
    const justInRange = pickResidentDecals([{ x: 0, z: range + 2, size: 4 }], 0, 0, 1000)[0];
    const halfBand = pickResidentDecals(
      [{ x: 0, z: range + 2 - range * 0.08, size: 4 }],
      0,
      0,
      1000,
    )[0];
    const wellInside = pickResidentDecals([d], 0, 0, 1000)[0];
    expect(justInRange.fade).toBeCloseTo(0, 5);
    expect(halfBand.fade).toBeCloseTo(0.5, 2);
    expect(wellInside.fade).toBe(1);
  });

  it('keeps the NEAREST when a map stamps more than the budget into one spot', () => {
    // 40 decals in a line, all in range; a budget of 10 must keep the closest.
    const decals = Array.from({ length: 40 }, (_, i) => ({ x: i, z: 0, size: 1 }));
    const picks = pickResidentDecals(decals, 0, 0, 1000, 10);
    expect(picks).toHaveLength(10);
    expect(picks.map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // ...and a camera at the far end keeps the other end instead.
    const farPicks = pickResidentDecals(decals, 39, 0, 1000, 10);
    expect(farPicks.map((p) => p.index)).toEqual([39, 38, 37, 36, 35, 34, 33, 32, 31, 30]);
  });

  it('a big decal outranks a small one that is nearer its centre', () => {
    const decals = [
      { x: 0, z: 0, size: 80 }, // camera stands inside this circle
      { x: 0, z: 12, size: 1 },
    ];
    expect(pickResidentDecals(decals, 0, 0, 1000, 1).map((p) => p.index)).toEqual([0]);
  });

  it('holds a mesh through the hysteresis margin, then lets it go', () => {
    const d = { x: 0, z: 0, size: 4 };
    // Edge distance again: the camera's own offset is the range plus the radius.
    const out = decalViewRange(d.size, 1000) + d.size / 2;
    expect(keepDroppedDecal(d, 0, out + DECAL_DROP_MARGIN - 1, 1000, 1)).toBe(true);
    expect(keepDroppedDecal(d, 0, out + DECAL_DROP_MARGIN + 1, 1000, 1)).toBe(false);
    // Over budget the margin does not apply, the budget is the harder rule.
    expect(keepDroppedDecal(d, 0, 0, 1000, 1_000, 10)).toBe(false);
  });
});

describe('built-in decal library', () => {
  it('has unique file-safe keys with sane authored defaults', () => {
    expect(DECAL_LIBRARY.length).toBeGreaterThan(0);
    const keys = new Set<string>();
    for (const d of DECAL_LIBRARY) {
      expect(d.key).toMatch(/^[a-z0-9_]+$/);
      expect(keys.has(d.key)).toBe(false);
      keys.add(d.key);
      expect(d.size).toBeGreaterThanOrEqual(MIN_DECAL_SIZE);
      expect(d.size).toBeLessThanOrEqual(MAX_DECAL_SIZE);
      expect(d.glow ?? 0).toBeGreaterThanOrEqual(0);
      expect(d.glow ?? 0).toBeLessThanOrEqual(1);
      expect(d.name.length).toBeGreaterThan(0);
    }
  });

  it('every entry passes the document sanitizer as a builtin art id', () => {
    const doc = sanitizeMapDoc(
      docWith(DECAL_LIBRARY.map((d) => decal({ tex: `builtin:${d.key}` }))),
    );
    expect(doc?.decals?.length).toBe(DECAL_LIBRARY.length);
  });
});
