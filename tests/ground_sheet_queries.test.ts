import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import * as sheets from '../src/sim/ground_sheet_queries';
import type { CaveDef, TerrainCut, WorldContent } from '../src/sim/types';
import * as world from '../src/sim/world';
import { groundHeight, groundHeightAtBody, terrainHeight } from '../src/sim/world';

// The second-ground-sheet bindings (src/sim/ground_sheet_queries.ts), moved out
// of world.ts. Imported DIRECTLY here: the empty-map identities every shipped
// world relies on (no caves, no cuts: each query collapses to the plain
// heightfield answer) and the under-sheet arms the movement and mob code read.
// tests/cavity_sheets.test.ts and tests/caves.test.ts cover the same functions
// through the world.ts re-exports.

const SEED = 20061;

function content(extra: Partial<WorldContent>): WorldContent {
  return { ...BUILTIN_WORLD, ...extra };
}

afterEach(() => {
  setActiveWorldContent(null);
});

// A carve sphere buried 8yd under the shipped ground near (0, 40).
function buriedCarve(): { cut: TerrainCut; surface: number } {
  const surface = terrainHeight(0, 40, SEED);
  return { cut: { x: 0, y: surface - 8, z: 40, radius: 6, carve: true }, surface };
}

describe('world.ts re-exports the moved bindings', () => {
  it('every public name is the same function object', () => {
    const names = [
      'cameraSheetMaxDist',
      'groundHeightNear',
      'mobGroundHeight',
      'onCaveSheet',
      'onUnderSheet',
      'sheetCeilingAt',
      'sheetGroundHeight',
      'sheetMouthStepOk',
      'sheetStepMismatch',
      'sheetWallBlocksStep',
      'terrainCutAt',
      'terrainCutAtHeight',
    ] as const;
    // groundSheetsActive is the hot-path gate move_toward.ts imports directly;
    // world.ts (at its monolith ceiling) does not re-export it.
    expect(Object.keys(sheets).sort()).toEqual([...names, 'groundSheetsActive'].sort());
    for (const name of names) {
      expect(typeof sheets[name], name).toBe('function');
      expect(world[name], name).toBe(sheets[name]);
    }
  });
});

describe('a map with no caves and no cuts', () => {
  const points: [number, number][] = [
    [0, 40],
    [12.5, -30.25],
    [-140, 220],
  ];

  it('the sheet gate is off, which is what lets the mob fan skip every query', () => {
    expect(sheets.groundSheetsActive()).toBe(false);
    setActiveWorldContent(content({ caves: [], holes: [] }));
    expect(sheets.groundSheetsActive()).toBe(false);
  });

  it('every query collapses to the plain heightfield answer', () => {
    for (const [x, z] of points) {
      const g = groundHeight(x, z, SEED);
      expect(sheets.terrainCutAt(x, z, SEED)).toBe(false);
      expect(sheets.terrainCutAtHeight(x, z, g)).toBe(false);
      expect(sheets.onCaveSheet(x, z, SEED, g)).toBe(false);
      expect(sheets.onUnderSheet(x, z, SEED, g - 10)).toBe(false);
      expect(sheets.mobGroundHeight(x, z, SEED, g - 10)).toBe(g);
      expect(sheets.sheetGroundHeight(x, z, SEED, g)).toBe(groundHeightAtBody(x, z, SEED, g));
      expect(sheets.sheetCeilingAt(x, z, SEED, g)).toBe(Infinity);
      expect(sheets.sheetWallBlocksStep(SEED, x, z, g - 10, x + 1, z)).toBe(false);
      expect(sheets.sheetStepMismatch(SEED, x, z, g, x + 1, z)).toBe(false);
      expect(sheets.sheetMouthStepOk(SEED, x, z, g, x + 1, z, g, g + 0.5)).toBe(false);
      expect(sheets.cameraSheetMaxDist(SEED, x, g + 1.6, z, x + 6, g + 4, z, 0.3)).toBe(Infinity);
    }
  });

  it('groundHeightNear never sits below the body-aware ground', () => {
    for (const [x, z] of points) {
      const g = groundHeight(x, z, SEED);
      expect(sheets.groundHeightNear(x, z, SEED, g)).toBeGreaterThanOrEqual(
        groundHeightAtBody(x, z, SEED, g),
      );
    }
  });
});

describe('a buried carve cavity', () => {
  it('turns the sheet gate on, so the mob fan runs the sheet queries', () => {
    setActiveWorldContent(content({ holes: [buriedCarve().cut] }));
    expect(sheets.groundSheetsActive()).toBe(true);
    const cave: CaveDef = {
      id: 'gate_cave',
      nodes: [
        { x: -20, y: -30, z: 40, radius: 4 },
        { x: 20, y: -30, z: 40, radius: 4 },
      ],
    };
    setActiveWorldContent(content({ caves: [cave] }));
    expect(sheets.groundSheetsActive()).toBe(true);
  });

  it('a mob on the cavity floor keeps that floor; a surface mob keeps the surface', () => {
    const { cut, surface } = buriedCarve();
    setActiveWorldContent(content({ holes: [cut] }));
    const deep = surface - 14;
    const floor = sheets.mobGroundHeight(0, 40, SEED, deep);
    expect(floor).toBe(sheets.groundHeightNear(0, 40, SEED, deep));
    expect(floor).toBeLessThan(surface - 10);
    expect(sheets.mobGroundHeight(0, 40, SEED, surface)).toBe(groundHeight(0, 40, SEED));
  });

  it('sheetGroundHeight resolves the cavity floor without the standable-top fold', () => {
    const { cut, surface } = buriedCarve();
    setActiveWorldContent(content({ holes: [cut] }));
    const deep = surface - 14;
    const floor = sheets.sheetGroundHeight(0, 40, SEED, deep);
    expect(floor).toBeLessThan(surface - 10);
    expect(floor).toBeGreaterThan(surface - 15);
  });

  it('sheetStepMismatch flags a layer switch inside the footprint only', () => {
    const { cut, surface } = buriedCarve();
    setActiveWorldContent(content({ holes: [cut] }));
    const feet = sheets.groundHeightNear(0, 40, SEED, surface - 14);
    // Across the cavity floor: same sheet, no mismatch.
    expect(sheets.sheetStepMismatch(SEED, -0.5, 40, feet, 0.5, 40)).toBe(false);
    // A surface mover stepping over the buried room resolves to the surface
    // sheet it already stands on: no mismatch either.
    expect(sheets.sheetStepMismatch(SEED, -0.5, 40, surface, 0.5, 40)).toBe(false);
    // A cavity-floor mover stepping far outside every footprint: not in a
    // footprint, so the fan never pays for the height probe.
    expect(sheets.sheetStepMismatch(SEED, 60, 40, feet, 61, 40)).toBe(false);
  });

  it('cameraSheetMaxDist confines an eye inside the cavity and frees one on the surface', () => {
    const { cut, surface } = buriedCarve();
    setActiveWorldContent(content({ holes: [cut] }));
    const eyeY = surface - 10;
    // A boom pulled sideways 20yd runs into the cavity wall within its radius.
    const max = sheets.cameraSheetMaxDist(SEED, 0, eyeY, 40, 20, eyeY, 40, 0.3);
    expect(max).toBeLessThan(6);
    expect(max).toBeGreaterThanOrEqual(0);
    // The same boom from an eye above the surface is unconfined.
    const up = surface + 1.6;
    expect(sheets.cameraSheetMaxDist(SEED, 0, up, 40, 20, up, 40, 0.3)).toBe(Infinity);
  });

  it('a buried carve does not cut the surface sheet', () => {
    const { cut } = buriedCarve();
    setActiveWorldContent(content({ holes: [cut] }));
    expect(sheets.terrainCutAt(0, 40, SEED)).toBe(false);
    expect(sheets.terrainCutAtHeight(0, 40, terrainHeight(0, 40, SEED))).toBe(false);
  });
});
