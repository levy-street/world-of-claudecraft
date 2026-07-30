// Crafting materials must never be vendor junk. The junk sweep (sellAllJunk in
// src/sim/items.ts) vendors every quality:'poor' item, so any material used as a
// recipe reagent must not be 'poor'. This guard enforces it across the crafting
// recipes (ALL_RECIPES) and the enchanting recipes (ENCHANTS), so a future
// material added as grey junk fails here instead of getting auto-vendored in game.
// Non-poor rarity colors stay allowed: the enchanting ladder deliberately tiers
// its materials (dust common, essence uncommon, shard rare).
import { describe, expect, it } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';

function reagentIds(): string[] {
  const ids = new Set<string>();
  for (const r of ALL_RECIPES) for (const rg of r.reagents ?? []) ids.add(rg.itemId);
  for (const e of Object.values(ENCHANTS)) for (const rg of e.reagents ?? []) ids.add(rg.itemId);
  return [...ids];
}

describe('crafting materials are not vendor junk', () => {
  it('every recipe / enchant reagent resolves to a real item', () => {
    const missing = reagentIds().filter((id) => !ITEMS[id]);
    expect(missing, `reagents with no ITEMS def: ${missing.join(', ')}`).toEqual([]);
  });

  it('no crafting-material reagent is quality "poor" (would be auto-vendored as junk)', () => {
    const poor = reagentIds().filter((id) => ITEMS[id]?.quality === 'poor');
    expect(poor, `these reagents would be swept by "sell junk": ${poor.join(', ')}`).toEqual([]);
  });
});
