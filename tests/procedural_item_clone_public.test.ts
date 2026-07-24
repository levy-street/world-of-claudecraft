import { describe, expect, it } from 'vitest';
import {
  cloneProceduralPayload,
  type ProceduralItemInstance,
  proceduralQuality,
} from '../src/sim/procedural_item';
import { publicItemInstanceView } from '../src/sim/procedural_item_public';
import type { ItemInstancePayload } from '../src/sim/types';

function fixture(): ItemInstancePayload {
  const procedural: ProceduralItemInstance = {
    version: 1,
    uid: 'pi1:test:42',
    baseId: 'gravecaller_ring',
    itemLevel: 20,
    rarity: 'rare',
    affixes: [
      {
        affixId: 'sages',
        family: 'primary.intellect',
        position: 'prefix',
        tier: 4,
        revision: 1,
        budget: 8,
        values: { int: 8 },
        ranges: { int: { min: 6, max: 9 } },
      },
    ],
    implicits: [
      {
        affixId: 'ring_implicit',
        family: 'implicit.ring',
        position: 'prefix',
        tier: 1,
        revision: 1,
        budget: 1,
        values: { sta: 1 },
        ranges: { sta: { min: 1, max: 1 } },
      },
    ],
    legendaryPowerId: 'test_power',
    powerRevision: 2,
    legendaryRolls: { magnitude: 0.25 },
    generatedName: {
      baseId: 'gravecaller_ring',
      rareWordIds: ['procedural.rare.grave', 'procedural.rare.promise'],
    },
    seed: 123,
    dropContext: {
      source: 'dungeon',
      sourceEntityId: 7,
      sourceSpawnSequence: 3,
      lootSlotIndex: 1,
      sourceTags: ['boss', 'gravecaller'],
    },
  };
  return {
    signer: 'Ayla',
    charges: { test_power: 2 },
    rolled: { quality: 'rare', stats: { int: 1 } },
    enchant: 'greater_intellect',
    boundTo: 9,
    procedural,
  };
}

describe('procedural item clone and public projection', () => {
  it('deep-clones every nested mutable branch', () => {
    const original = fixture();
    const clone = cloneProceduralPayload(original);
    expect(clone).toEqual(original);
    expect(clone).not.toBe(original);
    expect(clone.charges).not.toBe(original.charges);
    expect(clone.rolled).not.toBe(original.rolled);
    expect(clone.rolled?.stats).not.toBe(original.rolled?.stats);
    expect(clone.procedural).not.toBe(original.procedural);
    expect(clone.procedural?.affixes).not.toBe(original.procedural?.affixes);
    expect(clone.procedural?.affixes[0].values).not.toBe(original.procedural?.affixes[0].values);
    expect(clone.procedural?.affixes[0].ranges.int).not.toBe(
      original.procedural?.affixes[0].ranges.int,
    );
    expect(clone.procedural?.implicits).not.toBe(original.procedural?.implicits);
    expect(clone.procedural?.legendaryRolls).not.toBe(original.procedural?.legendaryRolls);
    expect(clone.procedural?.generatedName.rareWordIds).not.toBe(
      original.procedural?.generatedName.rareWordIds,
    );
    expect(clone.procedural?.dropContext?.sourceTags).not.toBe(
      original.procedural?.dropContext?.sourceTags,
    );
  });

  it('does not let clone mutation alias the source payload', () => {
    const original = fixture();
    const clone = cloneProceduralPayload(original);
    clone.procedural!.affixes[0].values.int = 999;
    clone.procedural!.affixes[0].ranges.int.min = 999;
    clone.procedural!.generatedName.rareWordIds![0] = 'changed';
    clone.procedural!.dropContext!.sourceTags![0] = 'changed';
    clone.procedural!.legendaryRolls!.magnitude = 999;
    expect(original.procedural!.affixes[0].values.int).toBe(8);
    expect(original.procedural!.affixes[0].ranges.int.min).toBe(6);
    expect(original.procedural!.generatedName.rareWordIds![0]).toBe('procedural.rare.grave');
    expect(original.procedural!.dropContext!.sourceTags![0]).toBe('boss');
    expect(original.procedural!.legendaryRolls!.magnitude).toBe(0.25);
  });

  it('omits identity, seed, provenance, binding, and charges from public views', () => {
    const view = publicItemInstanceView(fixture());
    const json = JSON.stringify(view);
    expect(json).not.toContain('pi1:test:42');
    expect(json).not.toContain('"seed"');
    expect(json).not.toContain('"dropContext"');
    expect(json).not.toContain('"boundTo"');
    expect(json).not.toContain('"charges"');
    expect(json).not.toContain('sourceEntityId');
    expect(view.procedural?.baseId).toBe('gravecaller_ring');
    expect(view.procedural?.affixes[0].values.int).toBe(8);
    expect(view.procedural?.legendaryRolls?.magnitude).toBe(0.25);
  });

  it('maps procedural rarities onto the established v0.30 quality language', () => {
    expect(proceduralQuality('common')).toBe('common');
    expect(proceduralQuality('magic')).toBe('uncommon');
    expect(proceduralQuality('rare')).toBe('rare');
    expect(proceduralQuality('epic')).toBe('epic');
    expect(proceduralQuality('legendary')).toBe('legendary');
    expect(proceduralQuality('mythic')).toBeNull();
  });
});
