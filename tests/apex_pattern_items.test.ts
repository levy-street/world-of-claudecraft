// Masterwrought apex recipe patterns (Phase 11): the 28 kind:'recipe' drops in
// src/sim/content/apex_patterns.ts that teach the 28 acquisition:['drop'] apex
// recipes, plus the R8 channel wiring: the ten APEX_GEAR patterns on the
// Nythraxis base loot table ('nythraxis_patterns', tail-pinned in
// tests/nythraxis_raid_unit.test.ts), the ten APEX_ARMOR patterns on the rift
// clear draw (RIFT_PATTERN_ITEM_IDS), and the eight APEX_CONSUMABLE patterns in
// NEITHER drop channel (they are Heroic Quartermaster stock,
// tests/heroic_vendor.test.ts). The generic kind:'recipe' behavior sweeps
// (learn flow, tradability, market, stacking) live in
// tests/recipe_pattern_items.test.ts; this file pins the SHIPPED phase 11
// content against the recorded contract.
import { describe, expect, it } from 'vitest';
import {
  APEX_ARMOR_RECIPES,
  APEX_CONSUMABLE_RECIPES,
  APEX_GEAR_RECIPES,
  recipeById,
} from '../src/sim/content/recipes';
import { ITEMS, MOBS } from '../src/sim/data';
import { addRiftClearGearLoot, RIFT_PATTERN_ITEM_IDS } from '../src/sim/rift/progression';
import { Rng } from '../src/sim/rng';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';

// The classic per-craft display prefix table (the recorded phase decision):
// spelled as literals so a drifted def name reds here, never re-derived.
const PREFIX_BY_PROFESSION: Record<string, string> = {
  armorcrafting: 'Plans',
  weaponcrafting: 'Plans',
  leatherworking: 'Pattern',
  tailoring: 'Pattern',
  jewelcrafting: 'Design',
  engineering: 'Schematic',
  inscription: 'Technique',
  alchemy: 'Recipe',
  cooking: 'Recipe',
};

const ARMOR_PATTERN_IDS = APEX_ARMOR_RECIPES.map((r) => `pattern_${r.resultItemId}`);
const GEAR_PATTERN_IDS = APEX_GEAR_RECIPES.map((r) => `pattern_${r.resultItemId}`);
const CONSUMABLE_PATTERN_IDS = APEX_CONSUMABLE_RECIPES.map((r) => `pattern_${r.resultItemId}`);
const ALL_PATTERN_IDS = [...ARMOR_PATTERN_IDS, ...GEAR_PATTERN_IDS, ...CONSUMABLE_PATTERN_IDS];

describe('apex pattern defs (the 28-id universe)', () => {
  it('covers all 28 apex recipes, one pattern_<output> def per recipe, and no strays', () => {
    expect(ARMOR_PATTERN_IDS).toHaveLength(10);
    expect(GEAR_PATTERN_IDS).toHaveLength(10);
    expect(CONSUMABLE_PATTERN_IDS).toHaveLength(8);
    // Exactness both ways: every shipped kind:'recipe' def is one of the 28,
    // so a stray pattern cannot ship outside the recorded universe.
    const shippedRecipeKind = Object.values(ITEMS)
      .filter((def) => def.kind === 'recipe')
      .map((def) => def.id)
      .sort();
    expect(shippedRecipeKind).toEqual([...ALL_PATTERN_IDS].sort());
  });

  it('every pattern is an epic, tradable, sellValue-100 recipe item teaching its exact recipe', () => {
    for (const id of ALL_PATTERN_IDS) {
      const def = ITEMS[id];
      expect(def, id).toBeDefined();
      if (def.kind !== 'recipe') throw new Error(`${id} must be kind recipe, got ${def.kind}`);
      expect(def.quality, id).toBe('epic');
      expect(def.sellValue, id).toBe(100);
      // Tradable, bind by consumption at learn: never soulbound, never barred
      // from the World Market.
      expect(def.soulbound ?? false, id).toBe(false);
      expect(def.noMarketList ?? false, id).toBe(false);
      // pattern_<x> teaches the recipe whose resultItemId is <x>.
      const recipe = recipeById(def.teachesRecipeId);
      expect(recipe, `${id} teaches ${def.teachesRecipeId}`).toBeDefined();
      expect(`pattern_${recipe!.resultItemId}`, id).toBe(id);
      expect(recipe!.acquisition, id).toContain('drop');
    }
  });

  it('names every pattern with its craft family prefix on the output English name', () => {
    for (const id of ALL_PATTERN_IDS) {
      const def = ITEMS[id];
      if (def.kind !== 'recipe') throw new Error(`${id} must be kind recipe`);
      const recipe = recipeById(def.teachesRecipeId)!;
      const prefix = PREFIX_BY_PROFESSION[recipe.professionId];
      expect(prefix, `${id}: no prefix recorded for ${recipe.professionId}`).toBeDefined();
      const output = ITEMS[recipe.resultItemId];
      expect(output, `${id}: output ${recipe.resultItemId}`).toBeDefined();
      expect(def.name, id).toBe(`${prefix}: ${output.name}`);
    }
  });
});

describe('apex pattern channel wiring (R8: raid gear, rift armor, vendor consumables)', () => {
  const raidPatternEntries = () =>
    MOBS.nythraxis_scourge_of_thornpeak.loot.filter(
      (entry) => entry.rollGroup === 'nythraxis_patterns',
    );

  it('the raid group carries exactly the ten gear patterns at 0.04 each', () => {
    const entries = raidPatternEntries();
    expect(entries.map((entry) => entry.itemId).sort()).toEqual([...GEAR_PATTERN_IDS].sort());
    for (const entry of entries) expect(entry.chance, entry.itemId).toBe(0.04);
  });

  it('the rift list is sorted and carries exactly the ten armor patterns', () => {
    expect([...RIFT_PATTERN_ITEM_IDS]).toEqual([...RIFT_PATTERN_ITEM_IDS].sort());
    expect([...RIFT_PATTERN_ITEM_IDS].sort()).toEqual([...ARMOR_PATTERN_IDS].sort());
  });

  it('the eight consumable patterns ride NEITHER drop channel', () => {
    const raidIds = new Set(raidPatternEntries().map((entry) => entry.itemId));
    // Sweep the WHOLE raid table, not just the pattern group, so a consumable
    // pattern smuggled into a gear group would still red.
    const allRaidIds = new Set(
      MOBS.nythraxis_scourge_of_thornpeak.loot.flatMap((entry) =>
        entry.itemId ? [entry.itemId] : [],
      ),
    );
    for (const id of CONSUMABLE_PATTERN_IDS) {
      expect(raidIds.has(id), id).toBe(false);
      expect(allRaidIds.has(id), id).toBe(false);
      expect((RIFT_PATTERN_ITEM_IDS as readonly string[]).includes(id), id).toBe(false);
    }
    // And the two drop channels never overlap.
    for (const id of RIFT_PATTERN_ITEM_IDS) expect(allRaidIds.has(id), id).toBe(false);
  });

  it('winning B/A/S rift clears shed armor patterns near 8%, C clears never do', () => {
    const patternIds = new Set<string>(RIFT_PATTERN_ITEM_IDS);
    const patternsOf = (baseLevel: number, rngSeed: number): string[] => {
      const boss = { loot: { copper: 0, items: [] }, lootable: false } as unknown as Entity;
      const ctx = { rng: new Rng(rngSeed) } as unknown as SimContext;
      addRiftClearGearLoot(ctx, boss, baseLevel);
      return (boss.loot?.items ?? [])
        .map((slot) => slot.itemId ?? '')
        .filter((id) => patternIds.has(id));
    };
    const SAMPLE = 5000;
    // C (baseLevel 20) returns before the pattern draw BY DESIGN.
    for (let s = 1; s <= SAMPLE; s++) expect(patternsOf(20, s)).toEqual([]);
    // B/A/S each draw once per clear at 0.08; the pick is uniform over the
    // sorted list, so every armor pattern must actually be reachable.
    for (const baseLevel of [22, 25, 28]) {
      let hits = 0;
      const seen = new Set<string>();
      for (let s = 1; s <= SAMPLE; s++) {
        const dropped = patternsOf(baseLevel, s);
        expect(dropped.length, `baseLevel ${baseLevel} seed ${s}`).toBeLessThanOrEqual(1);
        for (const id of dropped) {
          hits++;
          seen.add(id);
        }
      }
      const expected = SAMPLE * 0.08; // 400
      expect(hits, `baseLevel ${baseLevel}: ${hits}/${SAMPLE}`).toBeGreaterThan(expected * 0.7);
      expect(hits, `baseLevel ${baseLevel}: ${hits}/${SAMPLE}`).toBeLessThan(expected * 1.3);
      for (const id of RIFT_PATTERN_ITEM_IDS) {
        expect(seen.has(id), `${id} never dropped at baseLevel ${baseLevel}`).toBe(true);
      }
    }
  });
});
