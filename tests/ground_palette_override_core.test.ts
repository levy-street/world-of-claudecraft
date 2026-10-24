import { afterEach, describe, expect, it } from 'vitest';
import {
  groundPaletteFor,
  groundPaletteOverrideTable,
  groundPaletteVersion,
  setGroundPaletteOverrides,
} from '../src/render/ground_palette_override_core';
import { BIOME_PALETTE } from '../src/render/terrain_palette';

const LUSH = {
  grass: 0x6aab3c,
  grassDark: 0x3c7a3e,
  grassYellow: 0xa8c652,
  dirt: 0x9d7a50,
  sand: 0xdcc795,
};

afterEach(() => {
  setGroundPaletteOverrides(null);
});

describe('ground palette overrides (palette lab)', () => {
  it('falls back to the shipped biome row for a zone without an override', () => {
    expect(groundPaletteFor('eastbrook_vale', 'vale')).toBe(BIOME_PALETTE.vale);
    expect(groundPaletteOverrideTable()).toBeNull();
  });

  it('returns the override for its zone only', () => {
    setGroundPaletteOverrides({ eastbrook_vale: LUSH });
    expect(groundPaletteFor('eastbrook_vale', 'vale')).toEqual(LUSH);
    // Another zone of the SAME biome keeps the shipped row: overrides are per zone.
    expect(groundPaletteFor('goldcrest_harbor', 'vale')).toBe(BIOME_PALETTE.vale);
  });

  it('moves the version only on an effective change', () => {
    const v0 = groundPaletteVersion();
    expect(setGroundPaletteOverrides({ eastbrook_vale: LUSH })).toBe(true);
    const v1 = groundPaletteVersion();
    expect(v1).toBe(v0 + 1);
    // Every worker job re-sends the table: an identical table is free.
    expect(setGroundPaletteOverrides({ eastbrook_vale: { ...LUSH } })).toBe(false);
    expect(groundPaletteVersion()).toBe(v1);
    expect(setGroundPaletteOverrides(null)).toBe(true);
    expect(groundPaletteVersion()).toBe(v1 + 1);
    expect(setGroundPaletteOverrides({})).toBe(false);
  });

  it('copies the table, so a caller mutating its object later changes nothing', () => {
    const table: Record<string, typeof LUSH> = { eastbrook_vale: LUSH };
    setGroundPaletteOverrides(table);
    delete table.eastbrook_vale;
    expect(groundPaletteFor('eastbrook_vale', 'vale')).toEqual(LUSH);
  });
});
