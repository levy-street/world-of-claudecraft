// The one item-cell authority (src/ui/worn_item_cell_view.ts): the triple every
// cell that holds a COPY reads (the chosen legendary name over the def name,
// the instance-effective quality, the color that quality maps to). Pinned
// per dimension with a disagreeing def so each field is decisive on its own.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { itemDisplayName } from '../src/ui/entity_i18n';
import { QUALITY_COLOR } from '../src/ui/icons';
import { QUALITY_DEFAULT_COLOR, wornItemCellParts } from '../src/ui/worn_item_cell_view';

const APEX_NECK = 'wyrmfall_pendant'; // an epic apex def

describe('wornItemCellParts', () => {
  it('a bare copy reads the def: its name, its quality, its color', () => {
    const def = ITEMS[APEX_NECK];
    expect(def.quality).toBe('epic');
    for (const instance of [undefined, null, {}]) {
      expect(wornItemCellParts(def, instance)).toEqual({
        name: itemDisplayName(def),
        quality: 'epic',
        color: QUALITY_COLOR.epic,
      });
    }
  });

  it('a promoted copy reads the chosen name in legendary orange, never the def tier', () => {
    const def = ITEMS[APEX_NECK];
    const parts = wornItemCellParts(def, {
      perfected: true,
      rolled: { quality: 'legendary', stats: { int: 2 } },
      name: "Vel'tara's Oath",
    });
    expect(parts).toEqual({
      name: "Vel'tara's Oath",
      quality: 'legendary',
      color: QUALITY_COLOR.legendary,
    });
    // The name leaves RAW (player-authored text): the painter esc()s at the sink.
    expect(parts.name).toContain("'");
  });

  it('a legacy legendary-rolled copy keeps the def name but reads legendary (the display rule)', () => {
    const def = ITEMS[APEX_NECK];
    expect(wornItemCellParts(def, { rolled: { quality: 'legendary' } })).toEqual({
      name: itemDisplayName(def),
      quality: 'legendary',
      color: QUALITY_COLOR.legendary,
    });
  });

  it('an unknown rolled tier narrows back to the def quality (total against a hostile wire)', () => {
    const def = ITEMS[APEX_NECK];
    const parts = wornItemCellParts(def, {
      rolled: { quality: 'constructor' as never },
      name: 'Odd',
    });
    expect(parts.quality).toBe('epic');
    expect(parts.color).toBe(QUALITY_COLOR.epic);
    expect(parts.name).toBe('Odd');
  });

  it('a def with no quality falls to the default token, never undefined', () => {
    const def = { ...ITEMS[APEX_NECK], quality: undefined } as never;
    const parts = wornItemCellParts(def, undefined);
    expect(parts.quality).toBeUndefined();
    expect(parts.color).toBe(QUALITY_COLOR.common ?? QUALITY_DEFAULT_COLOR);
    expect(QUALITY_DEFAULT_COLOR).toBe('var(--color-quality-default)');
  });
});
