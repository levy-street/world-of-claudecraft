import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ambientDecorationKey,
  ambientDecorationsToPlacements,
  closestAmbientDecorations,
} from '../src/editor/foliage_edit_core';
import { STUDIO_DOCUMENT_TITLE, STUDIO_NAME } from '../src/editor/studio_brand';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import {
  type GroundDressingSpot,
  generateGroundDressing,
  groundDressingKey,
  mushroomsAllowedAt,
} from '../src/sim/ground_dressing';
import type { Decoration } from '../src/sim/world';
import { decorationKey, generateDecorationsInBounds } from '../src/sim/world';

afterEach(() => setActiveWorldContent(null));

const decorations: Decoration[] = [
  { kind: 'tree', x: 10, z: 20, scale: 1, variant: 2, biome: 'vale' },
  { kind: 'tree2', x: 30, z: 40, scale: 2, variant: 1, biome: 'vale' },
  { kind: 'tree2', x: 50, z: 60, scale: 1, variant: 0, biome: 'dusk' },
  { kind: 'rock', x: 70, z: 80, scale: 1.5, variant: 2, biome: 'peaks' },
];

const dressing: GroundDressingSpot[] = [
  { kind: 'bush', x: 32, z: 42, scale: 1.2 },
  { kind: 'bushFlowers', x: 55, z: 65, scale: 0.9 },
];

describe('ambientDecorationsToPlacements', () => {
  it('preserves every anchor as an editable colliding placement', () => {
    const placements = ambientDecorationsToPlacements(decorations);
    expect(placements).toHaveLength(decorations.length);
    expect(placements.map(({ x, z, collide }) => ({ x, z, collide }))).toEqual([
      { x: 10, z: 20, collide: true },
      { x: 30, z: 40, collide: true },
      { x: 50, z: 60, collide: true },
      { x: 70, z: 80, collide: true },
    ]);
  });

  it('maps procedural species to matching foliage catalog assets and sizes', () => {
    const placements = ambientDecorationsToPlacements(decorations);
    expect(placements.map((placement) => placement.assetId)).toEqual([
      'foliage/pine_4',
      'foliage/oak_2',
      'foliage/twisted_1',
      'foliage/rock_3',
    ]);
    expect(placements[0].scale).toBeCloseTo(1.1);
    expect(placements[1].scale).toBeCloseTo(2.3);
    expect(placements[2].scale).toBeCloseTo(0.5);
    expect(placements[3].scale).toBeCloseTo(0.93);
  });

  it('is deterministic and retains the procedural rock shape variation', () => {
    const first = ambientDecorationsToPlacements(decorations);
    const second = ambientDecorationsToPlacements(decorations);
    expect(second).toEqual(first);
    expect(first[3].scaleX).toBeTypeOf('number');
    expect(first[3].scaleY).toBeTypeOf('number');
    expect(first[3].scaleZ).toBeTypeOf('number');
  });

  it('turns procedural bushes into editable walk-through placements', () => {
    const placements = ambientDecorationsToPlacements(dressing);
    expect(placements.map((placement) => placement.assetId)).toEqual([
      'foliage/bush',
      'foliage/bush_flowers',
    ]);
    expect(placements.every((placement) => placement.collide === false)).toBe(true);
    expect(placements.every((placement) => placement.collisionMode === 'none')).toBe(true);
    expect(placements.map((placement) => placement.scale)).toEqual([1.2, 0.9]);
  });

  it('uses stable exclusion keys for editable ground dressing', () => {
    expect(dressing.map(ambientDecorationKey)).toEqual(dressing.map(groundDressingKey));
    expect(closestAmbientDecorations([...decorations, ...dressing], { x: 32, z: 42 }, 1)).toEqual([
      dressing[0],
    ]);
  });

  it('selects a deterministic nearest batch around the camera focus', () => {
    const nearest = closestAmbientDecorations(decorations, { x: 31, z: 39 }, 2);
    expect(nearest).toEqual([decorations[1], decorations[0]]);
    expect(nearest.map(ambientDecorationKey)).toEqual([
      'tree2:30.000:40.000',
      'tree:10.000:20.000',
    ]);
  });

  it('includes rocks so every scenery kind becomes editable', () => {
    // The rock sits at the exact focus, so it must be the nearest hit (the old
    // batch filtered rocks out and returned the far tree instead).
    expect(closestAmbientDecorations(decorations, { x: 70, z: 80 }, 1)).toEqual([decorations[3]]);
    // A whole-field convert (large limit) keeps all four kinds.
    const everything = closestAmbientDecorations(decorations, { x: 0, z: 0 }, 99);
    expect(everything).toHaveLength(4);
    expect(everything.some((d) => d.kind === 'rock')).toBe(true);
  });

  it('suppresses converted ambient anchors while leaving nearby foliage procedural', () => {
    const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
    const before = generateDecorationsInBounds(20061, bounds);
    expect(before.length).toBeGreaterThan(1);
    const excluded = decorationKey(before[0]);
    setActiveWorldContent({ ...BUILTIN_WORLD, decorationExclusions: [excluded] });
    const after = generateDecorationsInBounds(20061, bounds);
    expect(after).toHaveLength(before.length - 1);
    expect(after.some((decoration) => decorationKey(decoration) === excluded)).toBe(false);
  });

  it('suppresses converted bushes without adding collision or touching grass', () => {
    const bounds = { minX: -500, maxX: 500, minZ: -300, maxZ: 500 };
    const before = generateGroundDressing(20061, { bounds });
    expect(before.length).toBeGreaterThan(0);
    const excluded = groundDressingKey(before[0]);
    setActiveWorldContent({ ...BUILTIN_WORLD, decorationExclusions: [excluded] });
    const after = generateGroundDressing(20061, { bounds });
    expect(after).toHaveLength(before.length - 1);
    expect(after.some((spot) => groundDressingKey(spot) === excluded)).toBe(false);
  });

  it('limits mushroom dressing to Nightbloom, the Veiled Hollow, and Wraithwood', () => {
    expect(mushroomsAllowedAt(0, 0)).toBe(false);
    expect(mushroomsAllowedAt(-40, 1030)).toBe(true);
    expect(mushroomsAllowedAt(-370, 1420)).toBe(true);
    expect(mushroomsAllowedAt(360, 1430)).toBe(true);

    const vale = generateGroundDressing(20061, {
      bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
    });
    expect(vale.some((spot) => spot.kind === 'mushroom')).toBe(false);
  });
});

describe('editor foliage streaming integration', () => {
  const appSource = readFileSync(new URL('../src/editor/app.ts', import.meta.url), 'utf8');

  it('never converts procedural foliage just because the camera entered a zone', () => {
    expect(appSource).not.toContain('startAutoZoneLoop');
    expect(appSource).not.toContain("makeAmbientFoliageEditable('zone', { auto: true })");
  });

  it('always releases the loading overlay after an explicit foliage refresh', () => {
    const refreshStart = appSource.indexOf('private refreshAmbientFoliage');
    const refreshEnd = appSource.indexOf('private zoneAtEditorPoint', refreshStart);
    const refreshSource = appSource.slice(refreshStart, refreshEnd);

    expect(refreshStart).toBeGreaterThanOrEqual(0);
    expect(refreshEnd).toBeGreaterThan(refreshStart);
    expect(refreshSource).toContain('.finally(() => this.hide3dLoading())');
  });
});

describe('ClaudeCraft Studio brand', () => {
  it('uses the product name consistently in the editor chrome and document title', () => {
    expect(STUDIO_NAME).toBe('ClaudeCraft Studio');
    expect(STUDIO_DOCUMENT_TITLE).toBe('ClaudeCraft Studio - World of ClaudeCraft');
  });
});
