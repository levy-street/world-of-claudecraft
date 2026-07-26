import { describe, expect, it } from 'vitest';
import {
  type AffixDefinition,
  PROCEDURAL_AFFIXES,
  PROCEDURAL_ITEM_BASES,
  PROCEDURAL_STAT_BUDGET_COST,
} from '../src/sim/content/procedural_loot';
import { generateProceduralItem } from '../src/sim/loot/procedural';
import type { ProceduralRarity } from '../src/sim/procedural_item';
import { sanitizeItemInstancePayload } from '../src/sim/procedural_item_validation';
import type { ItemInstancePayload } from '../src/sim/types';

const RARITIES = [
  'common',
  'magic',
  'rare',
  'epic',
  'legendary',
] as const satisfies readonly Exclude<ProceduralRarity, 'mythic'>[];

function generatedPayload(
  seed: number,
  rarity: (typeof RARITIES)[number] = 'rare',
  forcedItemLevel = 20,
): ItemInstancePayload {
  return generateProceduralItem({
    seed,
    uid: `pi1:affix-validation:${seed}`,
    context: {
      source: 'dev',
      sourceEntityId: 900,
      sourceSpawnSequence: seed,
      lootSlotIndex: 0,
    },
    basePoolId: 'initial_all',
    rarityTableId: 'initial_dungeon_boss',
    sourceItemLevel: forcedItemLevel,
    forcedRarity: rarity,
    forcedItemLevel,
  }).instance;
}

function procedural(payload: ItemInstancePayload) {
  const item = payload.procedural;
  if (!item) throw new Error('expected generated procedural payload');
  return item;
}

function firstAffix(payload: ItemInstancePayload) {
  const affix = procedural(payload).affixes[0];
  if (!affix) throw new Error('expected generated affix');
  return affix;
}

function definitionFor(payload: ItemInstancePayload): AffixDefinition {
  const affix = firstAffix(payload);
  const definition = PROCEDURAL_AFFIXES[affix.affixId];
  if (!definition) throw new Error(`missing affix definition ${affix.affixId}`);
  return definition;
}

function magicPrecisionAtLevelTen(): ItemInstancePayload {
  for (let seed = 1; seed <= 10_000; seed++) {
    const payload = generateProceduralItem({
      seed,
      uid: `pi1:affix-level:${seed}`,
      context: {
        source: 'dev',
        sourceEntityId: 901,
        sourceSpawnSequence: seed,
        lootSlotIndex: 0,
      },
      basePoolId: 'initial_all',
      rarityTableId: 'initial_world',
      sourceItemLevel: 10,
      forcedBaseId: 'gravecaller_ring',
      forcedRarity: 'magic',
      forcedItemLevel: 10,
    }).instance;
    const affixes = procedural(payload).affixes;
    if (affixes.length === 1 && affixes[0].affixId === 'precision') {
      return payload;
    }
  }
  throw new Error('failed to find deterministic precision fixture');
}

describe('persisted procedural affix validation', () => {
  it('accepts shipped revision 1 generator output plus legacy and static payloads', () => {
    for (let seed = 1; seed <= 160; seed++) {
      const rarity = RARITIES[(seed - 1) % RARITIES.length];
      const payload = generatedPayload(seed, rarity);
      const item = procedural(payload);
      expect(sanitizeItemInstancePayload(payload, item.baseId), `${rarity}:${seed}`).toEqual({
        ok: true,
        value: payload,
      });
    }

    expect(sanitizeItemInstancePayload({ rolled: { stats: { int: 4 } } })).toEqual({
      ok: true,
      value: { rolled: { stats: { int: 4 } } },
    });
    expect(sanitizeItemInstancePayload({ signer: 'Legacy Crafter' })).toEqual({
      ok: true,
      value: { signer: 'Legacy Crafter' },
    });
  });

  it('rejects stored ranges that do not exactly match the authored revision 1 tier', () => {
    const payload = generatedPayload(501);
    const affix = firstAffix(payload);
    const [stat] = Object.keys(affix.values);
    const range = affix.ranges[stat];
    affix.ranges[stat] = { min: range.min - 100, max: range.max + 100 };

    expect(sanitizeItemInstancePayload(payload, procedural(payload).baseId)).toEqual({
      ok: false,
      error: `affix ${affix.affixId} range does not match tier for ${stat}`,
    });
  });

  it('rejects ordinary affix values that do not honor the authored quantization step', () => {
    const payload = generatedPayload(502);
    const affix = firstAffix(payload);
    const definition = definitionFor(payload);
    const tier = definition.tiers.find((entry) => entry.tier === affix.tier);
    if (!tier) throw new Error('missing generated affix tier');
    const [stat] = Object.keys(affix.values);
    const range = tier.rolls[stat];
    const step = range.step ?? 1;
    affix.values[stat] = range.min + step / 2;

    expect(sanitizeItemInstancePayload(payload, procedural(payload).baseId)).toEqual({
      ok: false,
      error: `affix ${affix.affixId} value for ${stat} is not quantized`,
    });
  });

  it('rejects a stored affix budget that does not match its rolled values', () => {
    const payload = generatedPayload(503);
    const affix = firstAffix(payload);
    affix.budget = Number((affix.budget + 0.001).toFixed(3));

    expect(sanitizeItemInstancePayload(payload, procedural(payload).baseId)).toEqual({
      ok: false,
      error: `affix ${affix.affixId} budget does not match values`,
    });
  });

  it('rejects a quantized affix value below its rarity roll floor', () => {
    const payload = generatedPayload(507, 'legendary');
    const item = procedural(payload);
    const affix = firstAffix(payload);
    const [stat] = Object.keys(affix.values);
    const range = affix.ranges[stat];
    affix.values[stat] = range.min;
    affix.budget = Number((range.min * PROCEDURAL_STAT_BUDGET_COST[stat]).toFixed(3));

    expect(sanitizeItemInstancePayload(payload, item.baseId)).toEqual({
      ok: false,
      error: `affix ${affix.affixId} value for ${stat} is below the legendary roll floor`,
    });
  });

  it('rejects floor-valid affixes whose recomputed total exceeds canonical tolerance', () => {
    let payload: ItemInstancePayload | undefined;
    for (let seed = 600; seed <= 2000; seed++) {
      const candidate = generatedPayload(seed, 'rare');
      const item = procedural(candidate);
      for (const affix of item.affixes) {
        for (const [stat, range] of Object.entries(affix.ranges)) {
          affix.values[stat] = range.max;
          affix.budget = Number((range.max * PROCEDURAL_STAT_BUDGET_COST[stat]).toFixed(3));
        }
      }
      const result = sanitizeItemInstancePayload(candidate, item.baseId);
      if (
        !result.ok &&
        result.error === 'procedural affix total exceeds canonical budget tolerance'
      ) {
        payload = candidate;
        break;
      }
    }
    expect(payload).toBeDefined();
  });
  it('enforces both authored minimum and maximum item levels', () => {
    const belowMinimum = magicPrecisionAtLevelTen();
    procedural(belowMinimum).itemLevel = 9;
    expect(sanitizeItemInstancePayload(belowMinimum, 'gravecaller_ring')).toEqual({
      ok: false,
      error: 'affix precision is outside its item level range',
    });

    const aboveMaximum = generatedPayload(504);
    const affix = firstAffix(aboveMaximum);
    const definition = definitionFor(aboveMaximum);
    const originalMaximum = definition.maxItemLevel;
    definition.maxItemLevel = procedural(aboveMaximum).itemLevel - 1;
    try {
      expect(sanitizeItemInstancePayload(aboveMaximum, procedural(aboveMaximum).baseId)).toEqual({
        ok: false,
        error: `affix ${affix.affixId} is outside its item level range`,
      });
    } finally {
      if (originalMaximum === undefined) delete definition.maxItemLevel;
      else definition.maxItemLevel = originalMaximum;
    }
  });

  it('requires the exact authored stat-key schema for the stored tier', () => {
    const payload = generatedPayload(505);
    const affix = firstAffix(payload);
    const definition = definitionFor(payload);
    const tier = definition.tiers.find((entry) => entry.tier === affix.tier);
    if (!tier) throw new Error('missing generated affix tier');
    const originalRolls = tier.rolls;
    const extraStat = Object.hasOwn(originalRolls, 'sta') ? 'int' : 'sta';
    tier.rolls = { ...originalRolls, [extraStat]: { min: 1, max: 2 } };
    try {
      expect(sanitizeItemInstancePayload(payload, procedural(payload).baseId)).toEqual({
        ok: false,
        error: `affix ${affix.affixId} stat keys do not match tier`,
      });
    } finally {
      tier.rolls = originalRolls;
    }
  });

  it('rejects two otherwise valid affixes that share an exclusive group', () => {
    const payload = generatedPayload(506);
    const [first, second] = procedural(payload).affixes;
    if (!first || !second) throw new Error('expected at least two generated affixes');
    const firstDefinition = PROCEDURAL_AFFIXES[first.affixId];
    const secondDefinition = PROCEDURAL_AFFIXES[second.affixId];
    const firstGroups = firstDefinition.exclusiveGroups;
    const secondGroups = secondDefinition.exclusiveGroups;
    firstDefinition.exclusiveGroups = [...(firstGroups ?? []), 'test.persisted_exclusion'];
    secondDefinition.exclusiveGroups = [...(secondGroups ?? []), 'test.persisted_exclusion'];
    try {
      expect(sanitizeItemInstancePayload(payload, procedural(payload).baseId)).toEqual({
        ok: false,
        error: 'duplicate procedural affix exclusive group test.persisted_exclusion',
      });
    } finally {
      if (firstGroups === undefined) delete firstDefinition.exclusiveGroups;
      else firstDefinition.exclusiveGroups = firstGroups;
      if (secondGroups === undefined) delete secondDefinition.exclusiveGroups;
      else secondDefinition.exclusiveGroups = secondGroups;
    }
  });

  it('keeps every currently authored base represented by accepted generated payloads', () => {
    const accepted = new Set<string>();
    for (
      let seed = 1;
      seed <= 10_000 && accepted.size < Object.keys(PROCEDURAL_ITEM_BASES).length;
      seed++
    ) {
      const payload = generatedPayload(20_000 + seed, 'rare');
      const item = procedural(payload);
      const result = sanitizeItemInstancePayload(payload, item.baseId);
      expect(result.ok, `${item.baseId}:${seed}`).toBe(true);
      accepted.add(item.baseId);
    }
    expect(accepted).toEqual(new Set(Object.keys(PROCEDURAL_ITEM_BASES)));
  });
});
