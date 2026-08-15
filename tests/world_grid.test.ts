// The world grid: zones are rectangles, borders are shared edges. Stage 3
// generalized the border ridges from "walls between stacked bands" to "walls
// along any shared zone edge" and the world rims from constants to per-row
// bounds. These tests pin (a) that the CURRENT one-column world derives the
// exact classic border set, and (b) the new geometry (vertical edges,
// partial spans, pass resolution) against synthetic multi-column worlds.

import { describe, expect, it } from 'vitest';
import {
  BUILTIN_WORLD,
  COLUMN_ZONES,
  columnBlendAt,
  STRIP_MAX_X,
  STRIP_MIN_X,
  setActiveWorldContent,
  worldXBoundsAt,
  ZONES,
} from '../src/sim/data';
import type { ZoneDef } from '../src/sim/types';
import {
  computeBorderEdges,
  inBorderLake,
  inHollowOpenSea,
  terrainHeight,
  terrainRegionCandidateCountsAt,
  WATER_LEVEL,
} from '../src/sim/world';

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

describe('the continent derives the right border set', () => {
  const edges = computeBorderEdges(ZONES);

  it('preserves column blend poison values for non-finite coordinates', () => {
    const column = COLUMN_ZONES[0];
    expect(Number.isNaN(columnBlendAt(column, 0, Number.NaN))).toBe(true);
    expect(Number.isNaN(columnBlendAt(column, Number.NaN, 0))).toBe(true);
  });

  it('keeps the production terrain path sparse at town coordinates', () => {
    expect(terrainRegionCandidateCountsAt(2, -2)).toEqual({
      appliers: 9,
      camps: 17,
      hubs: 1,
    });
  });

  it('has eleven horizontal borders and fifteen column edges', () => {
    // the Farshore adds a v-edge against the vale and an h-line under the
    // Galecrest: both are open-sea borders with no isthmus (ferry only)
    expect(edges.filter((e) => e.kind === 'h').length).toBe(11);
    expect(edges.filter((e) => e.kind === 'v').length).toBe(15);
  });

  it('every crossing sits where the atlas says', () => {
    const v = edges.filter((e) => e.kind === 'v');
    const h = edges.filter((e) => e.kind === 'h');
    const findV = (at: number, lo: number, passAt: number) =>
      v.find((e) => e.at === at && e.lo === lo && e.passAt === passAt);
    const findH = (at: number, lo: number, passAt: number) =>
      h.find((e) => e.at === at && e.lo === lo && e.passAt === passAt);
    expect(findH(1440, -180, 44), 'the Wyrmgate (hollow to frost)').toBeTruthy();
    expect(findV(-180, 180, 440), 'the Mirewalk (marsh to fen)').toBeTruthy();
    expect(findV(180, 180, 440), 'the Windway (marsh to gale)').toBeTruthy();
    expect(findV(-180, 700, 820), 'the Sunway (peaks to jungle)').toBeTruthy();
    expect(findV(180, 700, 800), 'the Gardenwalk (peaks to lawns)').toBeTruthy();
    expect(findV(180, 1820, 1890), 'the Snowline (frost to waste)').toBeTruthy();
    expect(findV(-180, 1820, 1890), 'the Goldmelt (frost to autumn)').toBeTruthy();
    expect(findH(700, 180, 400), 'the Garden Gate (gale to lawns)').toBeTruthy();
    expect(findH(700, -540, -400), 'the Tanglemouth (fen to jungle)').toBeTruthy();
    expect(findH(1260, 180, 390), 'the Crowgate (lawns to wood)').toBeTruthy();
    expect(findH(1260, -540, -330), 'the Nightgate (jungle to dark)').toBeTruthy();
    expect(findH(1820, 180, 404), 'the Wyrmroad (wood to waste)').toBeTruthy();
    expect(findH(1820, -540, -350), 'the gold road (dark to autumn)').toBeTruthy();
  });

  it('the sealed Hollow wall survives, bounded to the strip', () => {
    const sealed = edges.filter((e) => e.sealed);
    expect(sealed.length).toBe(1);
    expect(sealed[0].at).toBe(915);
    expect(sealed[0].lo).toBe(STRIP_MIN_X);
    expect(sealed[0].hi).toBe(STRIP_MAX_X);
    // the columns whose bands span the same z are NOT walled or sealed:
    // the wall is partial, and movement across z 915 is blocked only
    // inside the strip span
    expect(sealed[0].fullRow).toBe(false);
  });

  it('row bounds widen exactly where columns live', () => {
    for (const z of [-100, 100]) {
      // the Farshore widens the starter row east
      expect(worldXBoundsAt(z)).toEqual({ min: STRIP_MIN_X, max: 540 });
    }
    for (const z of [300, 800, 1100, 1700, 1900]) {
      expect(worldXBoundsAt(z)).toEqual({ min: -540, max: 540 });
    }
    for (const z of [2000, 2300]) {
      expect(worldXBoundsAt(z)).toEqual({ min: -540, max: 540 });
    }
    expect(worldXBoundsAt(2400)).toEqual({ min: 180, max: 540 });
  });

  it('reuses frozen row bounds and invalidates them on a content generation change', () => {
    const first = worldXBoundsAt(300);
    expect(worldXBoundsAt(300)).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);

    setActiveWorldContent(BUILTIN_WORLD);
    try {
      const refreshed = worldXBoundsAt(300);
      expect(refreshed).not.toBe(first);
      expect(refreshed).toEqual(first);
    } finally {
      setActiveWorldContent(null);
    }
  });
});

describe('the interior waters are landlocked', () => {
  // The grid's border waters are meres ringed by land: the Hollow's moats,
  // the Reach's flanking lakes, and the six column-row meres. Enclosure
  // itself (no water path to the outer ocean) is proven exhaustively by
  // the flood-fill probe (tmp/border_lakes_probe.mts); these pins keep the
  // caps, basins, and green land seams from silently regressing.
  const SEEDS = [1337, 20061];

  it('the green seams and every cap hold dry land', () => {
    const caps: [string, number, number][] = [
      ['the green seam east, marsh row', 180, 300],
      ['the green seam east, the Windway', 180, 440],
      ['the green seam east, the Gardenwalk', 180, 800],
      ['the green seam west, the Mirewalk', -180, 440],
      ['the green seam west, the Sunway', -180, 820],
      ['the Snowline isthmus', 180, 1890],
      ['the Goldmelt isthmus', -180, 1890],
      ['the Veilmelt north cap', 180, 1932],
      ['the Palewater north cap', -180, 1932],
    ];
    for (const seed of SEEDS) {
      for (const [name, x, z] of caps) {
        expect(terrainHeight(x, z, seed), `${name} (seed ${seed})`).toBeGreaterThan(
          WATER_LEVEL + 0.4,
        );
      }
    }
  });

  it('the blue lakes hold water, classified as lakes, never open sea', () => {
    const hearts: [string, number, number][] = [
      ['the east moat', 180, 1100],
      ['the west moat', -180, 1100],
      ['the Veilmelt', 180, 1600],
      ['the Palewater', -180, 1600],
    ];
    for (const seed of SEEDS) {
      for (const [name, x, z] of hearts) {
        expect(terrainHeight(x, z, seed), `${name} (seed ${seed})`).toBeLessThan(WATER_LEVEL);
        expect(inBorderLake(x, z), `${name} rect`).toBe(true);
        expect(inHollowOpenSea(x, z), `${name} must not be open sea`).toBe(false);
      }
    }
  });

  it('the row-border inlets hold water and open naturally to the sea', () => {
    // the sketch's unmarked borders: sea inlets with organic mouths, not
    // walled meres (the straight cap chains were removed by request)
    const inlets: [string, number, number][] = [
      ['the Lawn inlet', 300, 700],
      ['the Grave inlet', 300, 1260],
      ['the Ash inlet', 300, 1820],
      ['the Palm inlet', -300, 700],
      ['the Dusk inlet', -440, 1260],
      ['the Gold inlet', -450, 1820],
    ];
    for (const seed of SEEDS) {
      for (const [name, x, z] of inlets) {
        expect(terrainHeight(x, z, seed), `${name} (seed ${seed})`).toBeLessThan(WATER_LEVEL);
        expect(inBorderLake(x, z), `${name} keeps ocean rules`).toBe(false);
      }
    }
  });

  it('the outer ocean and the wider Hollow water stay open sea', () => {
    for (const [x, z] of [
      [-560, 1200],
      [560, 1200],
      [0, 2100],
      [-560, 2300],
    ]) {
      expect(terrainHeight(x, z, 20061), `ocean at ${x},${z}`).toBeLessThan(WATER_LEVEL);
      expect(inBorderLake(x, z), `not a mere at ${x},${z}`).toBe(false);
    }
    // past the moat rect the Hollow's water keeps the fatigue turnback
    expect(inBorderLake(160, 1380)).toBe(false);
    expect(inHollowOpenSea(160, 1380)).toBe(true);
  });
});

describe('vertical edges between columns', () => {
  // a strip zone with an east column beside its band
  const A = zone({ id: 'a', zMin: 0, zMax: 360 });
  const EAST = zone({ id: 'east', zMin: 0, zMax: 360, xMin: STRIP_MAX_X, xMax: 540 });

  it('derives a vertical edge along the shared column border', () => {
    const edges = computeBorderEdges([A, EAST]);
    const v = edges.filter((e) => e.kind === 'v');
    expect(v.length).toBe(1);
    expect(v[0].at).toBe(STRIP_MAX_X);
    expect(v[0].lo).toBe(0);
    expect(v[0].hi).toBe(360);
    expect(v[0].fullRow).toBe(false); // column borders always feather at ends
  });

  it('resolves the pass from the east zone west pass, then the west zone east pass', () => {
    const eastWithPass = { ...EAST, westPassZ: 120 };
    expect(computeBorderEdges([A, eastWithPass]).find((e) => e.kind === 'v')?.passAt).toBe(120);
    const aWithPass = { ...A, eastPassZ: 250 };
    expect(computeBorderEdges([aWithPass, EAST]).find((e) => e.kind === 'v')?.passAt).toBe(250);
    // neither declared: the span midpoint
    expect(computeBorderEdges([A, EAST]).find((e) => e.kind === 'v')?.passAt).toBe(180);
  });

  it('a column beside only part of a tall neighbor spans just the overlap', () => {
    const tall = zone({ id: 'tall', zMin: 0, zMax: 1000 });
    const sideCol = zone({ id: 'side', zMin: 200, zMax: 700, xMin: STRIP_MAX_X, xMax: 500 });
    const v = computeBorderEdges([tall, sideCol]).find((e) => e.kind === 'v');
    expect(v).toBeTruthy();
    expect(v?.lo).toBe(200);
    expect(v?.hi).toBe(700);
  });
});

describe('horizontal edges in a multi-column world', () => {
  it('a band boundary shared by offset columns produces the overlap edge, not full row', () => {
    const south = zone({ id: 's', zMin: 0, zMax: 360 });
    const north = zone({ id: 'n', zMin: 360, zMax: 720 });
    // an east column in the NORTH row only: the classic boundary is no
    // longer the whole row, so its ridge must feather at the column seam
    const northEast = zone({ id: 'ne', zMin: 360, zMax: 720, xMin: STRIP_MAX_X, xMax: 540 });
    const edges = computeBorderEdges([south, north, northEast]);
    const h = edges.filter((e) => e.kind === 'h');
    expect(h.length).toBe(1); // south-north only; south and northEast do not overlap in x
    expect(h[0].lo).toBe(STRIP_MIN_X);
    expect(h[0].hi).toBe(STRIP_MAX_X);
    expect(h[0].fullRow).toBe(false); // the north row extends past the span
  });

  it('zones that do not touch produce no edge', () => {
    const a = zone({ id: 'a', zMin: 0, zMax: 360 });
    const island = zone({ id: 'b', zMin: 500, zMax: 800, xMin: 700, xMax: 1000 });
    expect(computeBorderEdges([a, island]).length).toBe(0);
  });
});
