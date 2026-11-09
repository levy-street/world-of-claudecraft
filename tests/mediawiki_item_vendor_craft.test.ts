import { describe, expect, it } from 'vitest';
import type { ArticleTools } from '../scripts/mediawiki/entity_format';
import { itemNpcPoints } from '../scripts/mediawiki/item_npc_route';
import { vendorCraftAcquisitions } from '../scripts/mediawiki/item_vendor_craft';
import { CRUCIBLE_VENDOR_STOCK } from '../src/sim/content/ignivar_loot';
import { ALL_RECIPES, ITEMS, NPCS, QUESTS } from '../src/sim/data';
import { MARKET_HOUSE_STOCK } from '../src/sim/market';

function writer(): ArticleTools {
  return {
    titleBy: {
      item: new Map(Object.values(ITEMS).map((i) => [i.id, i.name])),
      npc: new Map(Object.values(NPCS).map((n) => [n.id, n.name + ' (NPC)'])),
      quest: new Map(Object.values(QUESTS).map((q) => [q.id, q.name])),
      class: new Map(),
      ability: new Map(),
      zone: new Map(),
      dungeon: new Map(),
      mob: new Map(),
    },
    add() {},
    link: (title, label) => '[[' + title + (label ? '|' + label : '') + ']]',
    money: (amount = 0) => amount + ' copper',
    section: (title, body) => title + '\n' + body,
    table: (rows) => rows.map((row) => row.join(' ')).join('\n'),
    bullets: (lines) => lines.join('\n'),
  };
}

describe('item vendor and crafting acquisition routes', () => {
  const methods = vendorCraftAcquisitions(writer());
  it('covers standing market stock with stack prices and disenchant materials with actual yields', () => {
    for (const stock of MARKET_HOUSE_STOCK) {
      const buy = methods
        .get(stock.itemId)!
        .find((m) => m.title === 'Buy standing stock on the World Market')!;
      expect(buy.steps[2]).toContain(stock.price + ' copper');
      expect(buy.steps[2]).toContain('full stack of ' + stock.count);
      expect(buy.points?.filter((p) => p.step === 'Reward')).toHaveLength(2);
    }
    for (const id of [
      'arcane_dust',
      'arcane_essence',
      'arcane_shard',
      'resonant_thread',
      'resonant_hide',
      'resonant_links',
      'resonant_steel',
      'resonant_timber',
    ]) {
      const method = methods.get(id)!.find((m) => m.title === 'Disenchant equipment')!;
      expect(method.steps.join(' ')).toContain('Disenchant');
      expect(method.details!.join(' ')).toContain('regardless of Enchanting skill');
    }
    expect(
      methods
        .get('arcane_dust')!
        .find((m) => m.title === 'Disenchant equipment')!
        .details!.join(' '),
    ).toContain('50%');
    expect(
      methods
        .get('arcane_shard')!
        .find((m) => m.title === 'Disenchant equipment')!
        .details!.join(' '),
    ).toContain('always gives exactly 1');
  });
  it('preserves the different gold, marks and sigil currencies', () => {
    const gold = methods.get('furyforged_warhelm')!.find((m) => m.title.startsWith('Buy from'))!;
    expect(gold.steps.join(' ')).toContain('170000 copper');
    const marks = methods
      .get('seal_of_the_nine_oaths')!
      .find((m) => m.title === 'Spend Heroic Marks')!;
    expect(marks.steps.join(' ')).toContain('12 Heroic Marks');
    const sigil = CRUCIBLE_VENDOR_STOCK[0];
    const exchange = methods
      .get(sigil.itemId)!
      .find((m) => m.title === 'Exchange a Crucible sigil')!;
    expect(exchange.steps.join(' ')).toContain(ITEMS[sigil.sigilId].name);
    expect(exchange.points).toContainEqual(
      expect.objectContaining({ step: 'Reward', x: 505.5, z: 2237.6 }),
    );
  });
  it('gives each craft output the real recipe inputs, source and station rule', () => {
    for (const recipe of ALL_RECIPES) {
      const craft = methods
        .get(recipe.resultItemId)!
        .filter((m) => m.title.startsWith('Craft with'));
      expect(craft.length, recipe.id).toBeGreaterThan(0);
      expect(
        craft.some((m) =>
          recipe.reagents.every((r) =>
            m.steps[1].includes(r.count + ' × [[' + ITEMS[r.itemId].name),
          ),
        ),
        recipe.id,
      ).toBe(true);
    }
    const field = methods
      .get('eastbrook_arming_sword')!
      .find((m) => m.title.startsWith('Craft with'))!;
    expect(field.steps[0]).toContain('known automatically');
    expect(field.steps[2]).toContain('You do not need a station for this recipe');
  });
  it('locates every live vendor and gives finite pins in the correct world or room frame', () => {
    for (const n of Object.values(NPCS).filter((n) => n.vendorItems?.length && !n.devVendor))
      expect(itemNpcPoints('Start', n.id).length, n.id).toBeGreaterThan(0);
    for (const entries of methods.values())
      for (const method of entries)
        for (const p of method.points ?? []) {
          expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
          expect(p.frame).not.toBe('');
        }
  });
});
