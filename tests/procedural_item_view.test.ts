import { describe, expect, it } from 'vitest';
import type { GeneratedItemName, ProceduralItemInstance } from '../src/sim/procedural_item';
import type { ItemDef, ItemInstancePayload } from '../src/sim/types';
import {
  activeLegendaryPower,
  proceduralNameView,
  proceduralTooltipView,
  resolvedItemDeltas,
} from '../src/ui/procedural_item_view';

function ringDefinition(): ItemDef {
  return {
    id: 'gravecaller_ring',
    name: 'Gravecaller Ring',
    kind: 'armor',
    slot: 'ring',
    quality: 'common',
    sellValue: 1,
  };
}

function item(
  uid: string,
  values: Record<string, number>,
  name: GeneratedItemName = {
    baseId: 'gravecaller_ring',
    rareWordIds: ['procedural.rare.storm', 'procedural.rare.bite'],
  },
): ItemInstancePayload {
  const procedural: ProceduralItemInstance = {
    version: 1,
    uid,
    baseId: 'gravecaller_ring',
    itemLevel: 20,
    rarity: 'rare',
    affixes: Object.entries(values).map(([stat, value], index) => ({
      affixId: `fixture_${stat}`,
      family: `fixture.${stat}`,
      position: index % 2 === 0 ? 'prefix' : 'suffix',
      tier: 4,
      revision: 1,
      budget: value,
      values: { [stat]: value },
      ranges: { [stat]: { min: value - 1, max: value + 1 } },
    })),
    generatedName: name,
    seed: 1,
  };
  return { procedural };
}

describe('procedural item view cores', () => {
  it('returns token-only deterministic name models', () => {
    expect(
      proceduralNameView({
        baseId: 'ashwood_staff',
        prefixId: 'procedural.name.sages',
      }),
    ).toEqual({
      kind: 'affixed',
      baseId: 'ashwood_staff',
      prefixId: 'procedural.name.sages',
    });
    expect(
      proceduralNameView({
        baseId: 'gravecaller_ring',
        rareWordIds: ['procedural.rare.grave', 'procedural.rare.promise'],
      }),
    ).toEqual({
      kind: 'rare',
      baseId: 'gravecaller_ring',
      rareWordIds: ['procedural.rare.grave', 'procedural.rare.promise'],
    });
    expect(
      proceduralNameView({
        baseId: 'gravecaller_cloth_hood',
        legendaryNameId: 'legendary.crown_last_pyre.name',
      }),
    ).toEqual({
      kind: 'legendary',
      baseId: 'gravecaller_cloth_hood',
      legendaryNameId: 'legendary.crown_last_pyre.name',
    });
  });

  it('sorts affix lines into a stable tooltip order', () => {
    const payload = item('pi1:view:1', {
      manaOnKill: 4,
      hasteRating: 12,
      int: 7,
      armor: 18,
      spellPower: 9,
    });
    const view = proceduralTooltipView(payload.procedural as ProceduralItemInstance);
    expect(view.affixes.map((line) => line.stat)).toEqual([
      'armor',
      'int',
      'spellPower',
      'hasteRating',
      'manaOnKill',
    ]);
    expect(view.rarity).toBe('rare');
    expect(view.quality).toBe('rare');
    expect(view.itemLevel).toBe(20);
    expect(view.uid).toBe('pi1:view:1');
  });

  it('compares two exact copies of the same base by final values', () => {
    const definition = ringDefinition();
    const candidate = item('pi1:view:2', {
      int: 9,
      sta: 3,
      critRating: 12,
    });
    const equipped = item('pi1:view:3', {
      int: 6,
      sta: 5,
      critRating: 4,
    });
    expect(resolvedItemDeltas(definition, candidate, definition, equipped)).toEqual([
      { stat: 'sta', delta: -2 },
      { stat: 'int', delta: 3 },
      { stat: 'critRating', delta: 8 },
    ]);
  });

  it('does not invent a score for incomparable legendary powers', () => {
    const definition = ringDefinition();
    const candidate = item('pi1:view:4', { int: 8 });
    const equipped = item('pi1:view:5', { int: 8 });
    candidate.procedural!.legendaryPowerId = 'power_a';
    equipped.procedural!.legendaryPowerId = 'power_b';
    expect(resolvedItemDeltas(definition, candidate, definition, equipped)).toEqual([]);
  });

  it('selects at most the first active legendary power for presentation', () => {
    expect(
      activeLegendaryPower([
        {
          stats: { str: 0, agi: 0, sta: 0, int: 0, spi: 0, armor: 0 },
          spellPower: 0,
          critRating: 0,
          hasteRating: 0,
          hitRating: 0,
          pvpOffenseRating: 0,
          pvpDefenseRating: 0,
          healthOnKill: 0,
          manaOnKill: 0,
          blockValue: 0,
          legendaryPowerId: 'first_power',
        },
        {
          stats: { str: 0, agi: 0, sta: 0, int: 0, spi: 0, armor: 0 },
          spellPower: 0,
          critRating: 0,
          hasteRating: 0,
          hitRating: 0,
          pvpOffenseRating: 0,
          pvpDefenseRating: 0,
          healthOnKill: 0,
          manaOnKill: 0,
          blockValue: 0,
          legendaryPowerId: 'suppressed_power',
        },
      ]),
    ).toBe('first_power');
  });
});
