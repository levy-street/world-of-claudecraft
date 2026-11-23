import { describe, expect, it } from 'vitest';
import {
  buildWaterCharacterField,
  hexToLinear,
  WATER_CHARACTERS,
  WATER_FIELD_LAYERS,
  type WaterCharacter,
  waterCharacterFor,
  waterCharacterTexels,
  waterFieldLayout,
} from '../src/render/ocean/water_character_core';
import { BIOME_BY_ID } from '../src/sim/world';

describe('water character', () => {
  it('gives every biome a character with physical values', () => {
    for (const biome of BIOME_BY_ID) {
      const c = WATER_CHARACTERS[biome];
      expect(c, biome).toBeDefined();
      // Red is absorbed first in every water, murky or clear.
      expect(c.absorb[0], biome).toBeGreaterThan(c.absorb[2] * 0.9);
      for (const a of c.absorb) expect(a, biome).toBeGreaterThan(0);
      expect(c.chop, biome).toBeGreaterThan(0);
      expect(c.foam, biome).toBeGreaterThan(0);
    }
    // The marsh is murkier than the open sea in every channel.
    for (let i = 0; i < 3; i++) {
      expect(WATER_CHARACTERS.marsh.absorb[i]).toBeGreaterThan(WATER_CHARACTERS.vale.absorb[i]);
    }
    // The gale coast is the choppiest, the fen the stillest of the open waters.
    expect(WATER_CHARACTERS.gale.chop).toBeGreaterThan(WATER_CHARACTERS.vale.chop);
    expect(WATER_CHARACTERS.fen.chop).toBeLessThan(WATER_CHARACTERS.vale.chop);
  });

  it('lets a zone override its biome', () => {
    expect(waterCharacterFor('farshore_isle', 'vale')).not.toBe(WATER_CHARACTERS.vale);
    expect(waterCharacterFor('eastbrook_vale', 'vale')).toBe(WATER_CHARACTERS.vale);
  });

  it('packs linear colour, clarity and wave scale into the field layers', () => {
    const texels = waterCharacterTexels(WATER_CHARACTERS.marsh);
    expect(texels.length).toBe(WATER_FIELD_LAYERS * 4);
    const deep = hexToLinear(WATER_CHARACTERS.marsh.deep);
    expect(Array.from(texels.slice(0, 3))).toEqual(deep.map((v) => Math.fround(v)));
    expect(texels[3]).toBeCloseTo(WATER_CHARACTERS.marsh.chop);
    expect(texels[4]).toBeCloseTo(WATER_CHARACTERS.marsh.absorb[0]);
    expect(texels[7]).toBeCloseTo(WATER_CHARACTERS.marsh.foam);
    expect(hexToLinear(0xffffff)).toEqual([1, 1, 1]);
    expect(hexToLinear(0x000000)).toEqual([0, 0, 0]);
  });

  it('sizes the field from the active map, past its edges by a margin', () => {
    const layout = waterFieldLayout(
      [
        { zMin: 0, zMax: 360 },
        { xMin: 180, xMax: 900, zMin: 0, zMax: 720 },
      ],
      -180,
      180,
    );
    expect(layout.minX).toBeLessThan(-180);
    expect(layout.minX + layout.width * layout.cell).toBeGreaterThan(900);
    expect(layout.minZ + layout.height * layout.cell).toBeGreaterThan(720);
  });

  it('bakes a field that keeps each realm and cross-fades a border', () => {
    const layout = waterFieldLayout([{ zMin: 0, zMax: 1200 }], -600, 600);
    const west: WaterCharacter = WATER_CHARACTERS.vale;
    const east: WaterCharacter = WATER_CHARACTERS.marsh;
    const borderX = layout.minX + layout.width * layout.cell * 0.5;
    const field = buildWaterCharacterField(layout, (x) => (x < borderX ? west : east));
    const plane = layout.width * layout.height * 4;
    expect(field.length).toBe(plane * WATER_FIELD_LAYERS);
    const row = Math.floor(layout.height / 2);
    const chopAt = (col: number) => field[(row * layout.width + col) * 4 + 3];
    // Far from the border each side is exactly its own realm.
    expect(chopAt(1)).toBeCloseTo(west.chop, 6);
    expect(chopAt(layout.width - 2)).toBeCloseTo(east.chop, 6);
    // Across it the value moves monotonically, never overshooting either side.
    let prev = chopAt(0);
    for (let col = 1; col < layout.width; col++) {
      const v = chopAt(col);
      expect(v).toBeLessThanOrEqual(prev + 1e-6);
      expect(v).toBeGreaterThanOrEqual(east.chop - 1e-6);
      prev = v;
    }
  });
});
