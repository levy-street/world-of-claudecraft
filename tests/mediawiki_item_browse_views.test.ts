import { describe, expect, it } from 'vitest';
import { addCatalogPortals } from '../scripts/mediawiki/catalog_portals';
import { dungeonDetails } from '../scripts/mediawiki/dungeon_article';
import { addDungeonCatalog } from '../scripts/mediawiki/dungeon_catalog';
import type { ArticleKind, ArticleTools } from '../scripts/mediawiki/entity_format';
import { equipmentSetGroups } from '../scripts/mediawiki/equipment_set_groups';
import { instanceLoot, instanceLootPage } from '../scripts/mediawiki/instance_loot';
import { gearFamily, weaponTypePage } from '../scripts/mediawiki/item_browse_table';
import { TABLE_LIMIT } from '../scripts/mediawiki/item_index_pages';
import {
  acquisitionRows,
  itemSourceGroups,
  sourceGroupFor,
} from '../scripts/mediawiki/item_source_groups';
import { FINDER_ACTIVITIES } from '../src/sim/content/dungeon_finder';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { weaponTypeForItem } from '../src/sim/content/weapon_skin_rules';
import { DUNGEONS, ITEM_SETS, ITEMS, MOBS, NPCS, QUESTS, ZONES } from '../src/sim/data';
import { heroicLootItemId } from '../src/sim/loot/heroic_item';

const titleBy = Object.fromEntries(
  ['class', 'ability', 'item', 'npc', 'mob', 'quest', 'dungeon', 'zone'].map((kind) => [
    kind,
    new Map<string, string>(),
  ]),
) as Record<ArticleKind, Map<string, string>>;
for (const [kind, records] of Object.entries({
  item: ITEMS,
  mob: MOBS,
  npc: NPCS,
  quest: QUESTS,
  dungeon: DUNGEONS,
  zone: Object.fromEntries(ZONES.map((z) => [z.id, z])),
}))
  for (const id of Object.keys(records)) titleBy[kind as ArticleKind].set(id, kind + '/' + id);

const pages = new Map<string, string>();
const w: ArticleTools & { reserve(title: string): string } = {
  titleBy,
  reserve: (title) => title,
  link: (title, label = title) => '[[' + title + '|' + label + ']]',
  section: (title, body) => '\n== ' + title + ' ==\n' + body + '\n',
  bullets: (lines) => lines.map((s) => '* ' + s).join('\n'),
  table: (rows) => rows.map(([name, value]) => name + ': ' + value).join('\n'),
  add: (title, body) => {
    expect(pages.has(title), title).toBe(false);
    pages.set(title, body);
  },
  money: (value) => String(value),
};
addCatalogPortals(w);
addDungeonCatalog(w);

// Links down from a page; the "Back to" link up to its parent is left out.
const links = (title: string) =>
  [...(pages.get(title) ?? '').matchAll(/\[\[([^|\]]+)\|(?!Back to )/g)].map((m) => m[1]);
/** Every item page listed on a page or any index page under it. */
function itemsUnder(title: string, seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  if (seen.has(title)) return out;
  seen.add(title);
  for (const target of links(title)) {
    if (target.startsWith('item/')) out.add(target.slice('item/'.length));
    else if (target.endsWith('(Items index)') && target !== title)
      for (const id of itemsUnder(target, seen)) out.add(id);
  }
  return out;
}
const tableRows = (title: string) => (pages.get(title)!.match(/^\|-\n\| /gm) ?? []).length;
const titled = Object.keys(ITEMS);

describe('cross-slot item browse views', () => {
  it('lists every item under exactly its own quality, legendary first', () => {
    const hub = pages.get('Items')!;
    const quality = hub.slice(hub.indexOf('== By quality =='));
    const order = ['Legendary', 'Epic', 'Rare', 'Uncommon', 'Common', 'Poor'];
    expect(quality.match(/\[\[(\w+) items \(Items index\)/g)!.map((s) => s.slice(2))).toEqual(
      order.map((q) => q + ' items (Items index)'),
    );
    for (const q of order) {
      const expected = titled.filter((id) => (ITEMS[id].quality ?? 'common') === q.toLowerCase());
      expect([...itemsUnder(q + ' items (Items index)')].sort(), q).toEqual(expected.sort());
    }
  });

  it('gives each quality its weapons, armor, jewelry and other items pages', () => {
    const legendaryWeapons = titled.filter(
      (id) => ITEMS[id].quality === 'legendary' && ITEMS[id].kind === 'weapon',
    );
    expect(legendaryWeapons.length).toBeGreaterThan(0);
    expect([...itemsUnder('Legendary weapons (Items index)')].sort()).toEqual(
      legendaryWeapons.sort(),
    );
    const epicJewelry = titled.filter(
      (id) => ITEMS[id].quality === 'epic' && gearFamily(ITEMS[id]) === 'jewelry',
    );
    expect([...itemsUnder('Epic jewelry (Items index)')].sort()).toEqual(epicJewelry.sort());
    // The whole legendary list fits in one table; the epic list is split instead.
    expect(tableRows('Legendary items (Items index)')).toBe(
      titled.filter((id) => ITEMS[id].quality === 'legendary').length,
    );
    const epic = titled.filter((id) => ITEMS[id].quality === 'epic').length;
    expect(epic).toBeGreaterThan(TABLE_LIMIT);
    expect(tableRows('Epic items (Items index)')).toBe(0);
    // No quality or source page shows a table longer than the limit.
    const views = new Set<string>();
    const walk = (title: string) => {
      if (views.has(title) || !pages.has(title)) return;
      views.add(title);
      for (const target of links(title)) if (target.endsWith('(Items index)')) walk(target);
    };
    for (const q of ['Legendary', 'Epic', 'Rare', 'Uncommon', 'Common', 'Poor'])
      walk(q + ' items (Items index)');
    walk('Items by source (Items index)');
    expect(views.size).toBeGreaterThan(40);
    for (const title of views) expect(tableRows(title), title).toBeLessThanOrEqual(TABLE_LIMIT);
  });

  it('lists every weapon under its weapon type', () => {
    const weapons = titled.filter((id) => ITEMS[id].kind === 'weapon');
    for (const id of weapons) {
      expect(weaponTypeForItem(id), id).not.toBeNull();
      const page = weaponTypePage(ITEMS[id])!;
      expect(itemsUnder(page + ' (Items index)').has(id), id).toBe(true);
    }
    const hub = pages.get('Items')!;
    const types = hub.slice(hub.indexOf('== Weapons by type =='), hub.indexOf('== Consumables =='));
    const all = [...types.matchAll(/\[\[([^|\]]+)\|/g)].flatMap((m) => [...itemsUnder(m[1])]);
    expect(all.sort()).toEqual(weapons.sort());
  });

  it('sorts every acquisition row into a named source group', () => {
    const unknown = new Set<string>();
    for (const rows of acquisitionRows(w).values())
      for (const row of rows) if (sourceGroupFor(row.title) === undefined) unknown.add(row.title);
    expect([...unknown]).toEqual([]);
  });

  it('files items under the sources their item pages give', () => {
    const groups = itemSourceGroups(w);
    const sold = Object.values(NPCS).find((n) => !n.devVendor && n.vendorItems?.length)!
      .vendorItems![0];
    expect(groups.get(sold)?.has('Vendors')).toBe(true);
    expect(itemsUnder('Vendors (Items index)').has(sold)).toBe(true);
    const dropped = Object.values(MOBS)
      .flatMap((m) => m.loot)
      .find((e) => e.itemId && !e.questId)!.itemId!;
    expect(itemsUnder('Creature drops (Items index)').has(dropped)).toBe(true);
    const hub = links('Items by source (Items index)');
    for (const [id, set] of groups)
      for (const group of set) {
        expect(hub, group).toContain(group + ' (Items index)');
        expect(itemsUnder(group + ' (Items index)').has(id), id + ' in ' + group).toBe(true);
      }
  });

  it('lists each five-player dungeon loot from its creatures, with Heroic copies on Heroic', () => {
    const loot = instanceLoot(w);
    for (const a of FINDER_ACTIVITIES.filter(
      (f) => f.kind === 'dungeon' && f.difficulty === 'normal',
    )) {
      const page = loot.find((l) => l.id === a.dungeonId)!;
      expect(page, a.dungeonId).toBeDefined();
      const mobs = new Set(DUNGEONS[a.dungeonId].spawns.map((s) => s.mobId));
      const entries = [...mobs].flatMap((m) => MOBS[m].loot.filter((e) => e.itemId && !e.questId));
      const dropped = new Set([...mobs].flatMap((m) => MOBS[m].loot.map((e) => e.itemId)));
      for (const e of entries) {
        expect(page.normal.has(e.itemId!), e.itemId).toBe(true);
        if (!e.normalOnly)
          expect(page.heroic.has(heroicLootItemId(e.itemId!, true)), e.itemId).toBe(true);
      }
      for (const m of mobs)
        for (const e of HEROIC_BOSS_LOOT[m] ?? [])
          if (e.itemId && ITEMS[e.itemId]) expect(page.heroic.has(e.itemId), e.itemId).toBe(true);
      // Nothing from outside the dungeon.
      for (const id of page.normal.keys()) expect(dropped.has(id), id).toBe(true);
      expect(instanceLootPage(a.dungeonId)?.title).toBe(
        DUNGEONS[a.dungeonId].name + ' loot (Items index)',
      );
    }
    // A raid's attunement room keeps its own list.
    const nythraxis = loot.find((l) => l.name === 'Nythraxis')!;
    expect(nythraxis.rooms.map((r) => r.id)).not.toContain('abandoned_crypt');
    expect(nythraxis.normal.size).toBeGreaterThan(0);
  });

  it('links each loot page from the Dungeons hub and the dungeon page', () => {
    const hub = links('Dungeons');
    for (const loot of instanceLoot(w)) {
      const title = loot.name + ' loot (Items index)';
      expect(hub, title).toContain(title);
      expect(pages.get(title)).toContain('class="wikitable item-table"');
    }
    const crypt = DUNGEONS.hollow_crypt;
    const details = dungeonDetails(crypt, {
      section: w.section,
      bullets: w.bullets,
      table: (rows) => rows.join('\n'),
      mob: (id) => id,
    });
    expect(details).toContain('[[' + crypt.name + ' loot (Items index)|');
  });

  it('groups every equipment set once, under the dungeon or raid that drops it', () => {
    const groups = equipmentSetGroups(w);
    const listed = [...groups.values()].flatMap((sets) => sets.map((e) => e.set.id));
    expect(listed.sort()).toEqual(Object.keys(ITEM_SETS).sort());
    const page = pages.get('Equipment sets by group (Items index)')!;
    for (const set of Object.values(ITEM_SETS))
      expect(page.split(set.name + ' (Equipment set)|').length - 1, set.name).toBe(1);
    // Instance groups come first and every set in one has a piece dropping there.
    const loot = instanceLoot(w);
    for (const [group, sets] of groups) {
      const instance = loot.find((l) => l.name === group);
      if (!instance) continue;
      for (const e of sets)
        expect(
          Object.values(ITEMS).some(
            (i) => i.set === e.set.id && (instance.normal.has(i.id) || instance.heroic.has(i.id)),
          ),
          e.set.name,
        ).toBe(true);
    }
  });

  it('reaches every new page from the Items or Dungeons hub', () => {
    const seen = new Set<string>();
    const queue = ['Items', 'Dungeons'];
    while (queue.length) {
      const title = queue.shift()!;
      if (seen.has(title)) continue;
      seen.add(title);
      for (const target of links(title)) if (pages.has(target)) queue.push(target);
    }
    for (const title of pages.keys())
      if (title.endsWith('(Items index)')) expect(seen.has(title), title).toBe(true);
    for (const text of pages.values()) expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});
