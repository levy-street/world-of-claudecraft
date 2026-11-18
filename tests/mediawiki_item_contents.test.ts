import { describe, expect, it } from 'vitest';
import type { ArticleTools } from '../scripts/mediawiki/entity_format';
import {
  articleLinks,
  casketContents,
  casketGearOdds,
  delveChestOdds,
  delveChestTables,
  emissaryCacheContents,
  hoardContents,
  hoardMaterialsText,
  hoardPayoutTables,
  itemContentsSection,
  lootPercent,
} from '../scripts/mediawiki/item_contents';
import { currencySpendIndex, whatItBuysSection } from '../scripts/mediawiki/item_spends';
import { itemChances, rollOutcomes } from '../scripts/mediawiki/roll_outcomes';
import { weeklyVaultChoices } from '../scripts/mediawiki/weekly_vault_choices';
import { CASKET_GEAR_CHANCE, CASKET_MATERIAL_POOL } from '../src/sim/clue_casket';
import { drownedLitanyChestItemsForTier } from '../src/sim/content/delves/drowned_litany_loot';
import { delveChestItemsForTier } from '../src/sim/content/delves/lockpick_tiers';
import { HEROIC_MARK_CURRENCY_ID } from '../src/sim/content/dungeon_difficulty';
import { GOURDLIGHT_SWEET_ID } from '../src/sim/content/gourdlight_eve';
import {
  GUILD_QUARTERMASTER_STOCK,
  LANTERN_SEAL_ITEM_ID,
} from '../src/sim/content/guild_contracts';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { RIFT_ESSENCE_ITEM_ID } from '../src/sim/content/rift/items';
import {
  TREASURE_MAP_ITEM_IDS,
  VAULT_MATERIAL_POOL,
  VAULT_PAYOUTS,
} from '../src/sim/content/treasure_maps';
import { CLASSES, ITEMS, MOBS, NPCS } from '../src/sim/data';
import {
  EMISSARY_CACHE_ITEM_ID,
  EMISSARY_CACHE_MARKS,
  emissaryCachePoolForClass,
} from '../src/sim/emissary_cache';
import { PERFECTING_ATTEMPT_COST } from '../src/sim/professions/perfecting';
import { RIFT_BAND_MAX_UPGRADE } from '../src/sim/rift/band_ladder';
import { riftUpgradeCost } from '../src/sim/rift/progression';
import { Rng } from '../src/sim/rng';
import type { PlayerClass } from '../src/sim/types';
import { WEEKLY_BOSS_TABLES } from '../src/sim/weekly_reward_tables';
import { weeklyLootPool } from '../src/sim/weekly_rewards';

function writer(): ArticleTools {
  return {
    titleBy: {
      item: new Map(Object.values(ITEMS).map((i) => [i.id, i.name])),
      npc: new Map(Object.values(NPCS).map((n) => [n.id, n.name + ' (NPC)'])),
      quest: new Map(),
      class: new Map(Object.values(CLASSES).map((c) => [c.id, c.name])),
      ability: new Map(),
      zone: new Map(),
      dungeon: new Map(),
      mob: new Map(),
    },
    add() {},
    link: (title, label) => '[[' + title + (label && label !== title ? '|' + label : '') + ']]',
    money: (amount = 0) => amount + ' copper',
    section: (title, body) => '== ' + title + ' ==\n' + body,
    table: (rows) => rows.map((row) => row.join(' ')).join('\n'),
    bullets: (lines) => lines.join('\n'),
  };
}

const CLASS_IDS = Object.keys(CLASSES) as PlayerClass[];
const w = writer();
const links = articleLinks(w);

/** Sample the real seeded Rng many times: the enumerated chances must match. */
function sampled(roll: (rng: Rng) => { itemId: string }[], runs = 20000) {
  const counts = new Map<string, number>();
  for (let seed = 1; seed <= runs; seed++)
    for (const row of roll(new Rng(seed * 7919)))
      counts.set(row.itemId, (counts.get(row.itemId) ?? 0) + 1);
  return new Map([...counts].map(([id, n]) => [id, n / runs]));
}

describe('rollOutcomes', () => {
  it('walks chance, int and pick branches and their chances add up to 1', () => {
    const outcomes = rollOutcomes((rng) => [
      rng.chance(0.25) ? 'a' : 'b',
      String(rng.int(1, 4)),
      rng.pick(['x', 'y']),
    ]);
    expect(outcomes).toHaveLength(2 * 4 * 2);
    expect(outcomes.reduce((s, o) => s + o.chance, 0)).toBeCloseTo(1, 12);
    const a = outcomes.filter((o) => o.result[0] === 'a').reduce((s, o) => s + o.chance, 0);
    expect(a).toBeCloseTo(0.25, 12);
  });

  it('matches the real delve chest resolvers drawn with a seeded Rng', () => {
    for (const resolver of [delveChestItemsForTier, drownedLitanyChestItemsForTier])
      for (const cls of ['warrior', 'rogue', 'mage'] as PlayerClass[]) {
        const exact = itemChances(rollOutcomes((rng) => resolver('premium', cls, rng)));
        const seen = sampled((rng) => resolver('premium', cls, rng));
        expect([...exact.keys()].sort()).toEqual([...seen.keys()].sort());
        for (const [id, { chance }] of exact) expect(seen.get(id)!).toBeCloseTo(chance, 1);
      }
  });
});

describe("Emissary's Cache contents", () => {
  const body = emissaryCacheContents(links);
  it('lists the marks, then every class pool with 1 / pool size per piece', () => {
    expect(body).toContain(EMISSARY_CACHE_MARKS + ' × [[Heroic Mark]]');
    for (const cls of CLASS_IDS) {
      const pool = emissaryCachePoolForClass(cls);
      const part = body.split('=== ' + CLASSES[cls].name + ' ===')[1].split('===')[0];
      expect(part).toContain(pool.length + ' pieces, so each one is a 1 in ' + pool.length);
      for (const id of pool) {
        expect(part).toContain(links.item(id));
        expect(part).toContain(lootPercent(1 / pool.length));
      }
      expect(part.match(/^\|-\n\| /gm)!.length).toBe(pool.length);
    }
    expect(body).toContain('class="wikitable loot-table"');
  });

  it('is the "What is inside" section on the cache item page only', () => {
    expect(itemContentsSection(w, ITEMS[EMISSARY_CACHE_ITEM_ID])).toContain('== What is inside ==');
    expect(itemContentsSection(w, ITEMS.heroic_mark)).toBe('');
  });
});

describe('Treasure Casket and hoards', () => {
  it('names the casket gear pieces with the gear chance split over them', () => {
    const odds = casketGearOdds('warrior');
    const total = [...odds.values()].reduce((s, o) => s + o.chance, 0);
    expect(total).toBeCloseTo(CASKET_GEAR_CHANCE, 12);
    const body = casketContents(w);
    for (const id of odds.keys()) expect(body).toContain(links.item(id));
    for (const id of CASKET_MATERIAL_POOL) expect(body).toContain(links.item(id));
  });

  it('names the hoard material pool with the count for each map rarity', () => {
    for (const [rarity, mapId] of Object.entries(TREASURE_MAP_ITEM_IDS) as [
      keyof typeof VAULT_PAYOUTS,
      string,
    ][]) {
      const body = hoardContents(w, rarity);
      for (const id of VAULT_MATERIAL_POOL)
        expect(body).toContain(VAULT_PAYOUTS[rarity].materials + ' × ' + links.item(id));
      expect(itemContentsSection(w, ITEMS[mapId])).toContain('== What the hoard gives ==');
      expect(hoardMaterialsText(links, rarity)).toContain(
        'Gives ' + VAULT_PAYOUTS[rarity].materials + ' of one material',
      );
    }
    const table = hoardPayoutTables(links);
    for (const id of VAULT_MATERIAL_POOL) expect(table).toContain(links.item(id));
  });
});

describe('delve chest tables', () => {
  it('shows every piece each class can get at every tier, with its chance', () => {
    for (const [litany, resolver] of [
      [false, delveChestItemsForTier],
      [true, drownedLitanyChestItemsForTier],
    ] as const) {
      const body = delveChestTables(links, litany);
      for (const tier of ['low', 'medium', 'premium', 'bountiful'] as const)
        for (const cls of CLASS_IDS) {
          const { items, nothing } = delveChestOdds(resolver, tier, cls);
          for (const [id, { chance }] of items) {
            expect(body).toContain(links.item(id));
            expect(body).toContain(lootPercent(chance));
          }
          if (nothing > 0) expect(body).toContain('No gear');
        }
    }
    // The low Litany chest really can be empty (its 50% consolation roll).
    expect(delveChestOdds(drownedLitanyChestItemsForTier, 'low', 'warrior').nothing).toBeCloseTo(
      0.5,
      12,
    );
  });
});

describe('What it buys', () => {
  const spends = currencySpendIndex(w);
  it('lists the Heroic Quartermaster stock on the Heroic Mark page', () => {
    const rows = spends.get(HEROIC_MARK_CURRENCY_ID)!;
    for (const offer of HEROIC_VENDOR_STOCK)
      expect(rows.some((r) => r.buys === links.item(offer.itemId) && r.cost === offer.marks)).toBe(
        true,
      );
    expect(whatItBuysSection(w, HEROIC_MARK_CURRENCY_ID, spends)).toContain('== What it buys ==');
  });

  it('lists vendor token prices, the Lantern Hall stock, the Rift Forge and Perfecting', () => {
    const sweets = spends.get(GOURDLIGHT_SWEET_ID)!;
    for (const npc of Object.values(NPCS))
      for (const id of npc.vendorItems ?? []) {
        const price = ITEMS[id]?.priceItem;
        if (price?.itemId === GOURDLIGHT_SWEET_ID && !npc.devVendor)
          expect(
            sweets.some((r) => r.buys.includes(links.item(id)) && r.cost === price.count),
          ).toBe(true);
      }
    expect(spends.get(LANTERN_SEAL_ITEM_ID)!.map((r) => r.cost)).toEqual(
      GUILD_QUARTERMASTER_STOCK.map((o) => o.seals),
    );
    expect(spends.get(RIFT_ESSENCE_ITEM_ID)!.map((r) => r.cost)).toEqual(
      Array.from({ length: RIFT_BAND_MAX_UPGRADE }, (_, rank) => riftUpgradeCost(rank)),
    );
    for (const c of PERFECTING_ATTEMPT_COST)
      expect(spends.get(c.itemId)?.length).toBeGreaterThan(0);
    expect(spends.get('deed_of_making')?.length).toBeGreaterThan(0);
  });

  it('adds nothing to an item no one takes as payment', () => {
    expect(ITEMS.raw_mirror_trout).toBeDefined();
    expect(whatItBuysSection(w, 'raw_mirror_trout', spends)).toBe('');
  });
});

describe('Weekly Vault choices', () => {
  it('names every boss table and every fixed-row piece', () => {
    const body = weeklyVaultChoices({
      ...links,
      mob: (id) => '[[' + (MOBS[id]?.name ?? id) + ']]',
      dungeon: (id) => '[[' + id + ']]',
    });
    for (const table of WEEKLY_BOSS_TABLES)
      expect(body).toContain('[[' + (MOBS[table.bossId]?.name ?? table.bossId) + ']]');
    for (const cls of CLASS_IDS)
      for (const pool of ['world', 'pvp'] as const)
        for (const id of weeklyLootPool(pool, cls)) expect(body).toContain(links.item(id));
  });
});
