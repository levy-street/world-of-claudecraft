import { FACTION_VENDOR_GATES, vendorFactionForNpc } from '../../src/sim/content/faction_vendors';
import { HEROIC_VENDOR_STOCK } from '../../src/sim/content/heroic_vendor';
import { CRUCIBLE_VENDOR_STOCK } from '../../src/sim/content/ignivar_loot';
import { BUILTIN_WORLD, DUNGEON_LIST, ITEMS, MOBS, NPCS } from '../../src/sim/data';
import { factionCurrencyName } from '../../src/sim/factions';
import type { NpcDef } from '../../src/sim/types';
import { buyPurchaseTotals } from '../../src/sim/vendor_buy_stack';
import { vendorTokenPrice } from '../../src/sim/vendor_token_price';
import type { ArticleTools } from './entity_format';
import { homeZones } from './npc_article';
import { zonesByLevel } from './zone_article';
import { levelText, mobRank, RANK_ORDER, zoneCreatures } from './zone_creatures';

/** A page the seed has already written (build_seed's `pages` array). */
export interface SeedPage {
  title: string;
  text: string;
}

type Writer = Pick<ArticleTools, 'add' | 'section' | 'bullets' | 'link' | 'titleBy'> & {
  reserve(title: string): string;
};

const collate = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

/** The currencies one vendor takes, in a fixed order: coin first, then the rest by name. */
export function vendorCurrencies(n: NpcDef, item: (id: string) => string): string[] {
  const named = new Set<string>();
  let coin = false;
  let honor = false;
  for (const id of n.vendorItems ?? []) {
    const def = ITEMS[id];
    if (!def) continue;
    if (def.teachesRiding) {
      coin = true;
      continue;
    }
    const totals = buyPurchaseTotals(def, def.buyValue ?? 0, def.priceHonor ?? 0, 1);
    if (totals?.copper) coin = true;
    if (totals?.honor) honor = true;
    const token = vendorTokenPrice(def);
    if (token) named.add(item(token.itemId));
    const gate = FACTION_VENDOR_GATES[id];
    if (gate?.currencyCost) {
      const faction = gate.factionId ?? vendorFactionForNpc(n.id) ?? 'church_order';
      named.add(factionCurrencyName(faction));
    }
  }
  if (n.warfareVendor) honor = true;
  if (n.heroicVendor) named.add('Heroic Marks');
  if (n.crucibleVendor) named.add('Raid sigils');
  return [
    ...(coin ? ['Coin'] : []),
    ...(honor ? ['Honor'] : []),
    ...[...named].sort((a, b) => collate(a.replace(/\W/g, ''), b.replace(/\W/g, ''))),
  ];
}

/** How many offers one vendor's shop shows. */
export function vendorStockSize(n: NpcDef): number {
  return (
    (n.vendorItems?.length ?? 0) +
    (n.heroicVendor ? HEROIC_VENDOR_STOCK.length : 0) +
    (n.crucibleVendor ? CRUCIBLE_VENDOR_STOCK.length : 0)
  );
}

/** Every NPC that runs a shop: a vendor stock, or a Heroic Marks or sigil shop. */
export function vendorNpcs(): NpcDef[] {
  return Object.values(NPCS)
    .map((n) => BUILTIN_WORLD.npcs[n.id] ?? n)
    .filter((n) => !n.devVendor && vendorStockSize(n) > 0);
}

/** The zones a vendor's page names (the NPCs hub uses the same), else its room, else its activity. */
export function vendorPlaces(n: NpcDef): string[] {
  const zones = homeZones(n.id).map((z) => z.name);
  if (zones.length) return zones;
  const room = DUNGEON_LIST.find((d) => d.npcs?.some((s) => s.npcId === n.id));
  return [room?.name ?? 'Events and activities'];
}

/** The Vendors directory: every shop, grouped by where its keeper stands. */
export function addVendorDirectory(w: Writer): { title: string; count: number } {
  const item = (id: string) => {
    const title = w.titleBy.item.get(id);
    const name = ITEMS[id]?.name ?? id;
    return title ? w.link(title, name) : name;
  };
  const groups = new Map<string, string[]>();
  const vendors = vendorNpcs();
  for (const n of vendors) {
    const title = w.titleBy.npc.get(n.id);
    if (!title) continue;
    const size = vendorStockSize(n);
    const row = [
      w.link(title, n.name),
      'Stock: ' + size + (size === 1 ? ' item' : ' items'),
      'Pays with: ' + vendorCurrencies(n, item).join(', '),
    ].join(' · ');
    // A keeper who stands in more than one zone is listed in each of them.
    for (const place of vendorPlaces(n)) groups.set(place, [...(groups.get(place) ?? []), row]);
  }
  const order = zonesByLevel().map((z) => z.name);
  const rank = (place: string) => {
    const i = order.indexOf(place);
    return i < 0 ? order.length : i;
  };
  const title = w.reserve('Vendors');
  w.add(
    title,
    w.link('NPCs', 'Browse NPCs') +
      '\n\n' +
      'Every NPC who sells things, grouped by the zone they stand in. Most take coin. Some take Honor, Heroic Marks, faction marks or other tokens instead. Open a vendor to see each item and its price. ' +
      w.link('Vendors and currencies') +
      ' explains how buying and selling works.\n\n' +
      [...groups]
        .sort(([a], [b]) => rank(a) - rank(b) || collate(a, b))
        .map(([place, rows]) => w.section(place, w.bullets(rows.sort(collate))))
        .join(''),
    ['Portals'],
  );
  return { title, count: vendors.length };
}

/** One "Enemies index" page per zone, listing its camp enemies by rank. Zone id to title. */
export function addEnemyZoneIndexes(w: Writer): Map<string, { title: string; count: number }> {
  const out = new Map<string, { title: string; count: number }>();
  for (const zone of zonesByLevel()) {
    const enemies = zoneCreatures(zone.id).filter((c) => c.role === 'enemy');
    if (!enemies.length) continue;
    const byRank = new Map<string, string[]>();
    for (const c of enemies) {
      const m = MOBS[c.mobId];
      const mobTitle = w.titleBy.mob.get(c.mobId);
      const rank = mobRank(m);
      const lines = byRank.get(rank) ?? [];
      lines.push(
        (mobTitle ? w.link(mobTitle, c.name) : c.name) +
          ' · ' +
          levelText(c.min, c.max) +
          (m.rare && m.elite && !m.boss ? ' · Rare elite' : ''),
      );
      byRank.set(rank, lines);
    }
    const title = w.reserve(zone.name + ' (Enemies index)');
    const zoneTitle = w.titleBy.zone.get(zone.id);
    w.add(
      title,
      w.link('Mobs', 'Browse enemies') +
        '\n\n' +
        'Enemies that live out in ' +
        (zoneTitle ? w.link(zoneTitle, zone.name) : zone.name) +
        ', by rank. The levels are the ones they have in this zone. Enemies inside dungeons and raids are listed with each dungeon instead.\n\n' +
        RANK_ORDER.filter((r) => byRank.has(r))
          .map((r) => w.section(r, w.bullets(byRank.get(r)!)))
          .join(''),
      ['Portals'],
    );
    out.set(zone.id, { title, count: enemies.length });
  }
  return out;
}

/**
 * Adds a section to a hub page the catalog already wrote, before its category lines.
 * The new links are plain directory bullets, so the reader's breadcrumbs follow them.
 */
export function appendHubSection(pages: SeedPage[], hub: string, section: string): boolean {
  const page = pages.find((p) => p.title === hub);
  if (!page) return false;
  const tail = /\n(?:\[\[Category:[^\]]+\]\]\n?)+$/.exec(page.text);
  const cut = tail ? tail.index : page.text.length;
  page.text =
    page.text.slice(0, cut).trimEnd() + '\n\n' + section.trim() + '\n' + page.text.slice(cut);
  return true;
}

/** Writes the Vendors directory and the enemies-by-zone pages, and links them from their hubs. */
export function addHubDirectories(w: Writer, pages: SeedPage[]): Map<string, string> {
  const vendors = addVendorDirectory(w);
  appendHubSection(
    pages,
    'NPCs',
    w.section(
      'Shops',
      w.bullets([w.link(vendors.title, 'All vendors') + ' (' + vendors.count + ')']),
    ),
  );
  const zones = addEnemyZoneIndexes(w);
  appendHubSection(
    pages,
    'Mobs',
    w.section(
      'By zone',
      w.bullets(
        zonesByLevel()
          .filter((z) => zones.has(z.id))
          .map((z) => w.link(zones.get(z.id)!.title, z.name) + ' (' + zones.get(z.id)!.count + ')'),
      ),
    ),
  );
  return new Map([...zones].map(([id, z]) => [id, z.title]));
}
