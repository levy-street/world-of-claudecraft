// Pins the extracted border-edge geometry leaf (src/sim/border_edges.ts):
// the pure BorderEdge derivation, the sealed-border movement wall it feeds,
// and that both are deterministic pure functions of their inputs.

import { describe, expect, it } from 'vitest';
import { computeBorderEdges, crossesSealedBorder, SEALED_BORDERS } from '../src/sim/border_edges';
import type { ZoneDef } from '../src/sim/types';

function zone(partial: Partial<ZoneDef> & { id: string; zMin: number; zMax: number }): ZoneDef {
  return {
    name: partial.id,
    levelRange: [1, 10],
    biome: 'vale',
    hub: { x: 0, z: (partial.zMin + partial.zMax) / 2, radius: 10, name: partial.id },
    graveyard: { x: 0, z: (partial.zMin + partial.zMax) / 2 },
    lakes: [],
    pois: [],
    welcome: '',
    ...partial,
  } as ZoneDef;
}

describe('computeBorderEdges', () => {
  it('derives one horizontal BorderEdge for two adjacent zone rects', () => {
    const south = zone({ id: 'south', zMin: 0, zMax: 100 });
    const north = zone({ id: 'north', zMin: 100, zMax: 200, southPassX: 42 });
    const edges = computeBorderEdges([south, north]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      kind: 'h',
      at: 100,
      lo: -180, // STRIP_MIN_X (neither zone declares xMin/xMax)
      hi: 180, // STRIP_MAX_X
      passAt: 42,
      sealed: false,
    });
  });

  it('is a pure function: identical zone input yields identical output', () => {
    const south = zone({ id: 'south', zMin: 0, zMax: 100 });
    const north = zone({ id: 'north', zMin: 100, zMax: 200, southPassX: 42 });
    const first = computeBorderEdges([south, north]);
    const second = computeBorderEdges([south, north]);
    expect(second).toEqual(first);
  });

  it('yields a SEALED_BORDERS entry when the derived edges include a sealed border', () => {
    const south = zone({ id: 'south', zMin: 0, zMax: 100 });
    const north = zone({ id: 'north', zMin: 100, zMax: 200, sealedSouthBorder: true });
    const edges = computeBorderEdges([south, north]);
    const sealedEdge = edges.find((e) => e.kind === 'h' && e.sealed);
    expect(sealedEdge).toBeDefined();
    expect(sealedEdge?.at).toBe(115); // border z (100) plus the sealed crest's +15 shift

    // SEALED_BORDERS itself is derived from the module's own ZONES-backed
    // BORDER_EDGES (not the synthetic pair above), so just assert it holds
    // at least one real sealed crest with the same lo/hi feather math.
    expect(SEALED_BORDERS.length).toBeGreaterThan(0);
    for (const b of SEALED_BORDERS) {
      expect(b.hi - b.lo).toBeGreaterThan(48); // at least the 24yd feather on each side
    }
  });

  it('is order-independent (a not being adjacent to itself, no duplicate edges)', () => {
    const west = zone({ id: 'west', zMin: 0, zMax: 100, xMax: 50 });
    const east = zone({ id: 'east', zMin: 0, zMax: 100, xMin: 50 });
    const edges = computeBorderEdges([west, east]);
    expect(edges).toHaveLength(1);
    expect(edges[0].kind).toBe('v');
    expect(edges[0].at).toBe(50);
  });
});

describe('crossesSealedBorder', () => {
  it('returns true for a movement segment straddling a sealed crest z line', () => {
    const crest = SEALED_BORDERS[0];
    expect(crest).toBeDefined();
    const x = (crest.lo + crest.hi) / 2;
    expect(crossesSealedBorder(x, crest.at - 5, crest.at + 5)).toBe(true);
  });

  it('returns false for a segment that never crosses the crest z line', () => {
    const crest = SEALED_BORDERS[0];
    const x = (crest.lo + crest.hi) / 2;
    expect(crossesSealedBorder(x, crest.at + 5, crest.at + 10)).toBe(false);
  });

  it('returns false outside the crest x span even when z straddles it', () => {
    const crest = SEALED_BORDERS[0];
    expect(crossesSealedBorder(crest.lo - 1000, crest.at - 5, crest.at + 5)).toBe(false);
  });

  it('is a pure function: identical input yields identical output', () => {
    const crest = SEALED_BORDERS[0];
    const x = (crest.lo + crest.hi) / 2;
    const first = crossesSealedBorder(x, crest.at - 5, crest.at + 5);
    const second = crossesSealedBorder(x, crest.at - 5, crest.at + 5);
    expect(second).toBe(first);
  });
});
