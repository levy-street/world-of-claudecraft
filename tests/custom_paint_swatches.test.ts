import { describe, expect, it } from 'vitest';
import {
  CUSTOM_PAINT_ID_EXT_MAX,
  CUSTOM_PAINT_ID_EXT_MIN,
  CUSTOM_PAINT_ID_MAX,
  CUSTOM_PAINT_ID_MIN,
  isCustomPaintId,
  MAX_CUSTOM_PAINT_SWATCHES,
  nextCustomPaintId,
  sanitizeMapDoc,
} from '../src/sim/map_doc';

// Custom biome-paint swatches (maker palette additions): the sanitizer keeps
// swatches in the reserved id range and preserves cells painted with them;
// unknown ids still degrade to 255 (unpainted).

function docWith(biomePaint: unknown): unknown {
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
    biomePaint,
  };
}

describe('custom paint swatches', () => {
  it('round-trips swatches and keeps cells painted with them', () => {
    const id = CUSTOM_PAINT_ID_MIN;
    const doc = sanitizeMapDoc(
      docWith({
        cell: 8,
        cols: 2,
        rows: 1,
        originX: 0,
        originZ: 0,
        ids: [id, 1],
        custom: [{ id, color: 0xd024b0, label: 'Magenta' }],
      }),
    );
    expect(doc?.biomePaint?.custom).toEqual([{ id, color: 0xd024b0, label: 'Magenta' }]);
    expect(doc?.biomePaint?.ids).toEqual([id, 1]);
  });

  it('drops out-of-range swatches and degrades their cells to unpainted', () => {
    const doc = sanitizeMapDoc(
      docWith({
        cell: 8,
        cols: 2,
        rows: 1,
        originX: 0,
        originZ: 0,
        ids: [7, 1], // 7 sits below the overflow window and is not built-in
        custom: [{ id: 7, color: 0x123456 }],
      }),
    );
    expect(doc?.biomePaint?.custom).toBeUndefined();
    expect(doc?.biomePaint?.ids).toEqual([255, 1]);
  });

  it('keeps swatches minted in the overflow window', () => {
    const id = CUSTOM_PAINT_ID_EXT_MIN;
    const doc = sanitizeMapDoc(
      docWith({
        cell: 8,
        cols: 2,
        rows: 1,
        originX: 0,
        originZ: 0,
        ids: [id, CUSTOM_PAINT_ID_EXT_MAX],
        custom: [
          { id, color: 0x123456 },
          { id: CUSTOM_PAINT_ID_EXT_MAX, color: 0x654321 },
        ],
      }),
    );
    expect(doc?.biomePaint?.custom?.map((s) => s.id)).toEqual([id, CUSTOM_PAINT_ID_EXT_MAX]);
    expect(doc?.biomePaint?.ids).toEqual([id, CUSTOM_PAINT_ID_EXT_MAX]);
  });
});

describe('custom paint id allocation', () => {
  it('mints from the primary window first, then overflows below it', () => {
    const used = new Set<number>();
    // The whole primary window, in order, before any overflow id appears.
    for (let i = CUSTOM_PAINT_ID_MIN; i <= CUSTOM_PAINT_ID_MAX; i++) {
      const id = nextCustomPaintId(used);
      expect(id).toBe(i);
      used.add(id);
    }
    expect(nextCustomPaintId(used)).toBe(CUSTOM_PAINT_ID_EXT_MIN);
  });

  it('skips ids already taken and reports exhaustion', () => {
    const used = new Set<number>([CUSTOM_PAINT_ID_MIN, CUSTOM_PAINT_ID_MIN + 1]);
    expect(nextCustomPaintId(used)).toBe(CUSTOM_PAINT_ID_MIN + 2);
    const all = new Set<number>();
    for (let i = CUSTOM_PAINT_ID_EXT_MIN; i <= CUSTOM_PAINT_ID_MAX; i++) all.add(i);
    expect(nextCustomPaintId(all)).toBe(-1);
  });

  it('accepts every mintable id as a custom paint id', () => {
    const used = new Set<number>();
    for (let i = 0; i < MAX_CUSTOM_PAINT_SWATCHES; i++) {
      const id = nextCustomPaintId(used);
      expect(isCustomPaintId(id)).toBe(true);
      used.add(id);
    }
    // Built-in biome ids and "unpainted" are never mintable.
    expect(isCustomPaintId(0)).toBe(false);
    expect(isCustomPaintId(6)).toBe(false);
    expect(isCustomPaintId(255)).toBe(false);
  });
});

describe('swatch hue/light adjust', () => {
  it('round-trips hueShift/light/baseBiome and clamps out-of-range values', () => {
    const id = CUSTOM_PAINT_ID_MIN;
    const doc = sanitizeMapDoc(
      docWith({
        cell: 8,
        cols: 1,
        rows: 1,
        originX: 0,
        originZ: 0,
        ids: [id],
        custom: [{ id, color: 0x336699, hueShift: 400, light: -3, baseBiome: 2 }],
      }),
    );
    expect(doc?.biomePaint?.custom).toEqual([
      { id, color: 0x336699, hueShift: 180, light: -1, baseBiome: 2 },
    ]);
  });

  it('drops zero adjust values and invalid baseBiome ids', () => {
    const id = CUSTOM_PAINT_ID_MIN;
    const doc = sanitizeMapDoc(
      docWith({
        cell: 8,
        cols: 1,
        rows: 1,
        originX: 0,
        originZ: 0,
        ids: [id],
        custom: [{ id, color: 0x336699, hueShift: 0, light: 0, baseBiome: 99 }],
      }),
    );
    expect(doc?.biomePaint?.custom).toEqual([{ id, color: 0x336699 }]);
  });

  it('round-trips the saved flag and drops non-true values', () => {
    const id = CUSTOM_PAINT_ID_MIN;
    const doc = sanitizeMapDoc(
      docWith({
        cell: 8,
        cols: 2,
        rows: 1,
        originX: 0,
        originZ: 0,
        ids: [id, id + 1],
        custom: [
          { id, color: 0x336699, hueShift: 90, baseBiome: 2, saved: true },
          { id: id + 1, color: 0x336699, saved: 'yes' },
        ],
      }),
    );
    expect(doc?.biomePaint?.custom).toEqual([
      { id, color: 0x336699, hueShift: 90, baseBiome: 2, saved: true },
      { id: id + 1, color: 0x336699 },
    ]);
  });
});
