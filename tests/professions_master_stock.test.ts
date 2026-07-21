// Phase 9 station stocking: the six premium (tier 4/5) station-recipe
// reagents move within reach of their stations. tinker_gizzel (toolworks)
// stocks all six; the forge/loom/tannery masters each gained exactly
// thorium_ore (their own station recipe's premium reagent); the kitchens and
// apothecary masters gained nothing; quartermaster_bree (the pre-existing
// Highwatch trade-goods source) keeps all six.
import { describe, expect, it } from 'vitest';
import { ZONE1_NPCS } from '../src/sim/content/zone1';
import { ZONE2_NPCS } from '../src/sim/content/zone2';
import { ZONE3_NPCS } from '../src/sim/content/zone3';
import { ITEMS } from '../src/sim/data';

const PREMIUM_REAGENTS = [
  'thorium_ore',
  'arcanite_bar',
  'ashwood_log',
  'elderwood_log',
  'goldleaf_herb',
  'sunpetal_herb',
];

function stockOf(npcs: Record<string, { vendorItems?: readonly string[] }>, id: string): string[] {
  const npc = npcs[id];
  if (!npc?.vendorItems) throw new Error(`${id} has no vendor stock`);
  return [...npc.vendorItems];
}

describe('Phase 9 master vendor stocking', () => {
  it('tinker_gizzel stocks exactly the six premium reagents appended after its prior stock', () => {
    const stock = stockOf(ZONE1_NPCS, 'tinker_gizzel');
    expect(stock.slice(-6)).toEqual(PREMIUM_REAGENTS);
    // Prior toolworks stock survives ahead of the reagents.
    expect(stock).toContain('handaxe');
    expect(stock).toContain('simple_fishing_pole');
  });

  it('forge, loom, and tannery masters each gained exactly thorium_ore', () => {
    for (const [npcs, id] of [
      [ZONE1_NPCS, 'forgemistress_darva'],
      [ZONE1_NPCS, 'weaver_ottilie'],
      [ZONE2_NPCS, 'tanner_hesk'],
    ] as const) {
      const stock = stockOf(npcs, id);
      expect(stock[stock.length - 1], id).toBe('thorium_ore');
      expect(
        stock.filter((itemId) => itemId === 'thorium_ore'),
        id,
      ).toHaveLength(1);
      // thorium_ore is the ONLY premium reagent these masters carry.
      for (const reagent of PREMIUM_REAGENTS.slice(1)) {
        expect(stock, `${id} must not stock ${reagent}`).not.toContain(reagent);
      }
    }
  });

  it('the kitchens and apothecary masters carry no premium reagents', () => {
    for (const [npcs, id] of [
      [ZONE1_NPCS, 'cook_marlow'],
      [ZONE3_NPCS, 'alchemist_verane'],
    ] as const) {
      const stock = stockOf(npcs, id);
      for (const reagent of PREMIUM_REAGENTS) {
        expect(stock, `${id} must not stock ${reagent}`).not.toContain(reagent);
      }
    }
  });

  it('quartermaster_bree keeps all six premium reagents (the pre-Phase-9 source)', () => {
    const stock = stockOf(ZONE3_NPCS, 'quartermaster_bree');
    for (const reagent of PREMIUM_REAGENTS) {
      expect(stock, reagent).toContain(reagent);
    }
  });

  it('every stocked id resolves to a real item', () => {
    for (const id of [
      'tinker_gizzel',
      'forgemistress_darva',
      'weaver_ottilie',
      'cook_marlow',
    ] as const) {
      for (const itemId of stockOf(ZONE1_NPCS, id)) {
        expect(ITEMS[itemId], `${id} stocks unknown item ${itemId}`).toBeDefined();
      }
    }
    for (const itemId of stockOf(ZONE2_NPCS, 'tanner_hesk')) {
      expect(ITEMS[itemId], `tanner_hesk stocks unknown item ${itemId}`).toBeDefined();
    }
    for (const itemId of stockOf(ZONE3_NPCS, 'alchemist_verane')) {
      expect(ITEMS[itemId], `alchemist_verane stocks unknown item ${itemId}`).toBeDefined();
    }
  });
});
