import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { cavitySheetAt, MIN_CAVITY_HEADROOM, resolveGroundSheet } from '../src/sim/ground_sheets';
import { DETAIL_CELL_MAX, sanitizeMapDoc, serializeMapDoc } from '../src/sim/map_doc';
import { carveFieldAt, HOLE_WALL_RISE, sanitizeTerrainCut } from '../src/sim/terrain_cuts';
import type { TerrainCut, WorldContent } from '../src/sim/types';
import {
  groundHeight,
  groundHeightNear,
  onUnderSheet,
  sheetCeilingAt,
  sheetMouthStepOk,
  sheetWallBlocksStep,
  terrainHeight,
} from '../src/sim/world';

// The Carve tool's cavities: boolean solids whose underground interior is a
// real room, walkable floor, rock walls, a ceiling the jump arc respects.
// Legacy (non-carve) holes stay pure sheet cutouts, pinned here too.

const SEED = 20061;

function world(extra: Partial<WorldContent>): WorldContent {
  return { ...BUILTIN_WORLD, ...extra };
}

afterEach(() => {
  setActiveWorldContent(null);
});

describe('carveFieldAt (sim/terrain_cuts.ts)', () => {
  const sphere: TerrainCut = { x: 0, y: 0, z: 0, radius: 5, carve: true };

  it('is negative inside the solid, positive outside', () => {
    expect(carveFieldAt([sphere], undefined, 0, 0, 0)).toBeLessThan(0);
    expect(carveFieldAt([sphere], undefined, 0, 8, 0)).toBeGreaterThan(0);
  });

  it('a patch fills the cavity back in', () => {
    const patch: TerrainCut = { x: 0, y: 0, z: 0, radius: 8 };
    expect(carveFieldAt([sphere], [patch], 0, 0, 0)).toBeGreaterThanOrEqual(0);
  });

  it('sanitize carries the carve flag and drops non-true values', () => {
    expect(sanitizeTerrainCut({ x: 0, y: 0, z: 0, radius: 5, carve: true })?.carve).toBe(true);
    expect(sanitizeTerrainCut({ x: 0, y: 0, z: 0, radius: 5, carve: 1 })?.carve).toBeUndefined();
    expect(sanitizeTerrainCut({ x: 0, y: 0, z: 0, radius: 5 })?.carve).toBeUndefined();
  });
});

describe('cavitySheetAt (sim/ground_sheets.ts)', () => {
  it('a buried carve sphere has a floor and a rock ceiling', () => {
    // Sphere centre 8yd under the surface, radius 5: fully buried.
    const surface = 10;
    const cut: TerrainCut = { x: 0, y: surface - 8, z: 0, radius: 5, carve: true };
    const sheet = cavitySheetAt([cut], undefined, 0, 0, surface, surface - 12);
    expect(sheet).not.toBeNull();
    expect(sheet!.floor).toBeCloseTo(surface - 13, 1);
    expect(sheet!.ceiling).toBeCloseTo(surface - 3, 1);
  });

  it('a legacy (non-carve) hole has NO cavity floor', () => {
    const cut: TerrainCut = { x: 0, y: 2, z: 0, radius: 5 };
    expect(cavitySheetAt([cut], undefined, 0, 0, 10, -3)).toBeNull();
  });

  it('a shallow open pit is walkable (sky above needs no headroom)', () => {
    // Sphere centred at the surface: the pit under it is only radius deep,
    // less than MIN_CAVITY_HEADROOM in its shallow margin, but it is open to
    // the sky so the bowl is standable.
    const surface = 10;
    const cut: TerrainCut = { x: 0, y: surface, z: 0, radius: 1.4, carve: true };
    expect(1.4).toBeLessThan(MIN_CAVITY_HEADROOM);
    const sheet = cavitySheetAt([cut], undefined, 0, 0, surface, surface);
    expect(sheet).not.toBeNull();
    expect(sheet!.floor).toBeCloseTo(surface - 1.4, 1);
  });

  it('the thin margin of a buried carve reads as rock (headroom gate)', () => {
    const surface = 10;
    const cut: TerrainCut = { x: 0, y: surface - 8, z: 0, radius: 5, carve: true };
    // 4.97yd off-centre the sphere's vertical chord is ~1.1yd, under the
    // headroom minimum: no sheet, the wall band stays solid.
    expect(cavitySheetAt([cut], undefined, 4.97, 0, surface, surface - 8)).toBeNull();
  });

  it('a patch removes the floor it covers', () => {
    const surface = 10;
    const cut: TerrainCut = { x: 0, y: surface - 8, z: 0, radius: 5, carve: true };
    const patch: TerrainCut = { x: 0, y: surface - 8, z: 0, radius: 7 };
    expect(cavitySheetAt([cut], [patch], 0, 0, surface, surface - 8)).toBeNull();
  });

  it('a tube void merges: no phantom floor across a cave mouth it breaks into', () => {
    const surface = 10;
    // Carve bottom at surface-6; a tube's air spans surface-12..surface-5,
    // overlapping the carve's bottom, so the combined void runs to the tube
    // floor and the carve's own lower boundary is NOT a floor.
    const cut: TerrainCut = { x: 0, y: surface - 3, z: 0, radius: 3, carve: true };
    const tube = { floor: surface - 12, ceiling: surface - 5 };
    const sheet = cavitySheetAt([cut], undefined, 0, 0, surface, surface, tube);
    expect(sheet?.floor ?? surface - 12).toBeCloseTo(surface - 12, 1);
  });
});

describe('resolveGroundSheet with carves', () => {
  it('nearest sheet wins: surface mover stays up, cavity mover stays down', () => {
    const surface = 10;
    const cut: TerrainCut = { x: 0, y: surface - 8, z: 0, radius: 5, carve: true };
    const up = resolveGroundSheet(undefined, [cut], undefined, 0, 0, surface, surface);
    expect(up.height).toBe(surface);
    expect(up.cavity).toBe(false);
    const down = resolveGroundSheet(undefined, [cut], undefined, 0, 0, surface, surface - 12);
    expect(down.cavity).toBe(true);
    expect(down.height).toBeCloseTo(surface - 13, 1);
  });

  it('a cut with nothing underneath still walls the step off', () => {
    const cut: TerrainCut = { x: 0, y: 10, z: 0, radius: 5 };
    const sheet = resolveGroundSheet(undefined, [cut], undefined, 0, 0, 10, 10);
    expect(sheet.height).toBeGreaterThan(HOLE_WALL_RISE - 10);
  });
});

describe('carve document round-trip (sim/map_doc.ts)', () => {
  const baseDoc = {
    version: 2,
    meta: { id: 'm1', name: 'carves', seed: SEED },
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

  it('carve flag and detail regions survive serialize -> parse; junk is dropped', () => {
    const doc = sanitizeMapDoc(
      JSON.parse(
        serializeMapDoc(
          sanitizeMapDoc({
            ...baseDoc,
            holes: [
              { x: 0, y: 2, z: 40, radius: 6, carve: true, blend: 2 },
              { x: 5, y: 2, z: 44, radius: 4 },
            ],
            detailRegions: [
              { x: 0, z: 40, radius: 12, cell: 0.3 },
              { x: 1, z: 1, radius: 999, cell: 9 }, // clamped
              { x: Number.NaN, z: 0, radius: 5, cell: 0.5 }, // dropped
            ],
          })!,
        ),
      ),
    );
    expect(doc).not.toBeNull();
    expect(doc!.holes?.[0]?.carve).toBe(true);
    expect(doc!.holes?.[1]?.carve).toBeUndefined();
    expect(doc!.detailRegions?.length).toBe(2);
    expect(doc!.detailRegions?.[0]).toEqual({ x: 0, z: 40, radius: 12, cell: 0.3 });
    expect(doc!.detailRegions?.[1].radius).toBeLessThanOrEqual(60);
    expect(doc!.detailRegions?.[1].cell).toBeLessThanOrEqual(DETAIL_CELL_MAX);
  });
});

describe('world bindings (sim/world.ts)', () => {
  // A big carve sphere buried under the shipped world's ground near (0, 40).
  function buriedCarve(): { cut: TerrainCut; surface: number } {
    const surface = terrainHeight(0, 40, SEED);
    return { cut: { x: 0, y: surface - 8, z: 40, radius: 6, carve: true }, surface };
  }

  it('groundHeightNear stands a deep mover on the cavity floor', () => {
    const { cut, surface } = buriedCarve();
    setActiveWorldContent(world({ holes: [cut] }));
    const floor = groundHeightNear(0, 40, SEED, surface - 14);
    expect(floor).toBeLessThan(surface - 10);
    expect(floor).toBeGreaterThan(surface - 15);
    // The surface mover is unaffected: the ground sheet above is intact.
    expect(groundHeightNear(0, 40, SEED, surface)).toBeCloseTo(groundHeight(0, 40, SEED), 5);
  });

  it('onUnderSheet is true only for the mover on the cavity floor', () => {
    const { cut, surface } = buriedCarve();
    setActiveWorldContent(world({ holes: [cut] }));
    expect(onUnderSheet(0, 40, SEED, surface - 14)).toBe(true);
    expect(onUnderSheet(0, 40, SEED, surface)).toBe(false);
  });

  it('sheetCeilingAt reports the rock roof for the cavity mover', () => {
    const { cut, surface } = buriedCarve();
    setActiveWorldContent(world({ holes: [cut] }));
    const ceiling = sheetCeilingAt(0, 40, SEED, surface - 14);
    expect(ceiling).toBeLessThan(surface);
    expect(ceiling).toBeGreaterThan(surface - 8);
    expect(sheetCeilingAt(0, 40, SEED, surface)).toBe(Infinity);
  });

  it('sheetWallBlocksStep: rock beside the cavity blocks, the interior does not', () => {
    const { cut, surface } = buriedCarve();
    setActiveWorldContent(world({ holes: [cut] }));
    const feet = surface - 13.5; // on the cavity floor
    // Step across the middle of the room: air all the way.
    expect(sheetWallBlocksStep(SEED, -1, 40, feet, 1, 40)).toBe(false);
    // Step from the interior into the rock beyond the wall.
    expect(sheetWallBlocksStep(SEED, 4, 40, feet, 8, 40)).toBe(true);
    // Surface movers never consult the rock test.
    expect(sheetWallBlocksStep(SEED, 4, 40, surface, 8, 40)).toBe(false);
  });

  it('sheetMouthStepOk allows a small rise only across a sheet transfer', () => {
    const { cut, surface } = buriedCarve();
    setActiveWorldContent(world({ holes: [cut] }));
    const feet = surface - 13.5;
    // Transfer between cavity and surface with a small rise: allowed.
    expect(sheetMouthStepOk(SEED, 0, 40, feet, 30, 40, feet, feet + 1)).toBe(true);
    // Same rise with no transfer (both on the surface): refused.
    expect(sheetMouthStepOk(SEED, 30, 40, surface, 31, 40, surface, surface + 1)).toBe(false);
  });
});
