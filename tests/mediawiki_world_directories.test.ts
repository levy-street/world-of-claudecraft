import { describe, expect, it } from 'vitest';
import type { ArticleKind, ArticleTools } from '../scripts/mediawiki/entity_format';
import {
  addHubDirectories,
  appendHubSection,
  type SeedPage,
  vendorCurrencies,
  vendorNpcs,
} from '../scripts/mediawiki/hub_directories';
import { addMountRoutes, mountReins } from '../scripts/mediawiki/mount_routes';
import { zoneArticle, zoneGathering } from '../scripts/mediawiki/zone_article';
import { creaturesByZone } from '../scripts/mediawiki/zone_creatures';
import { MOUNTS } from '../src/sim/content/mounts';
import {
  DUNGEONS,
  gatherNodesInActiveWorld,
  getActiveWorldContent,
  ITEMS,
  MOBS,
  NPCS,
  QUESTS,
  ZONES,
  zoneContaining,
} from '../src/sim/data';

function tools() {
  const registries: Record<string, Record<string, unknown>> = {
    item: ITEMS,
    mob: MOBS,
    npc: NPCS,
    quest: QUESTS,
    dungeon: DUNGEONS,
    zone: Object.fromEntries(ZONES.map((z) => [z.id, z])),
  };
  const titleBy = Object.fromEntries(
    ['class', 'ability', 'zone', 'dungeon', 'npc', 'quest', 'mob', 'item'].map((kind) => [
      kind,
      new Map(Object.keys(registries[kind] ?? {}).map((id) => [id, kind + '/' + id])),
    ]),
  ) as Record<ArticleKind, Map<string, string>>;
  const added = new Map<string, string>();
  const used = new Set<string>();
  const w: ArticleTools & { reserve(t: string): string } = {
    titleBy,
    add: (title, body) => added.set(title, body),
    section: (name, body) => '== ' + name + ' ==\n' + body.trim() + '\n\n',
    table: (rows) => rows.map((r) => r.join(': ')).join('\n'),
    bullets: (rows) => rows.map((r) => '* ' + r).join('\n'),
    link: (title, label = title) => '[[' + title + '|' + label + ']]',
    money: (n) => (n ?? 0) + ' copper',
    reserve: (t) => {
      used.add(t);
      return t;
    },
  };
  return { w, added, used };
}

const zone = (id: string) => ZONES.find((z) => z.id === id)!;

describe('zone articles', () => {
  const { w, used } = tools();
  const raidParents = new Map([
    ['nythraxis_crypt', 'Nythraxis (Raid)'],
    ['nythraxis_boss_arena', 'Nythraxis (Raid)'],
  ]);
  used.add('The Collapsed Reliquary (Delve)');
  const zw = { ...w, usedTitles: used, raidParents, zoneDirectories: new Map<string, string>() };

  it('lists entrances, enemies with their zone levels, portals and the world PvP rule', () => {
    const thornpeak = zoneArticle(zone('thornpeak_heights'), zw);
    expect(thornpeak).toContain('World PvP: Contested.');
    expect(thornpeak).toMatch(
      /\[\[dungeon\/gravewyrm_sanctum\|Gravewyrm Sanctum\]\] · Dungeon · Level \d+ to \d+ · Heroic at level 20 · Entrance at \(/,
    );
    expect(thornpeak).toContain('[[Nythraxis (Raid)|Nythraxis]] · Raid for');
    expect(thornpeak).toContain('== Portals ==\n* A portal at (');
    expect(thornpeak).toContain('[[zone/veiled_hollow|The Veiled Hollow]]');
    expect(zoneArticle(zone('veiled_hollow'), zw)).toContain(
      'takes you to [[zone/thornpeak_heights|Thornpeak Heights]]',
    );
    expect(zoneArticle(zone('proving_shore'), zw)).toContain('World PvP: Sanctuary.');
    const eastbrook = zoneArticle(zone('eastbrook_vale'), zw);
    expect(eastbrook).toContain(
      '[[The Collapsed Reliquary (Delve)|The Collapsed Reliquary]] · Delve from level 7',
    );
    expect(eastbrook).toContain('[[mob/forest_wolf|Forest Wolf]] · Level ');
    // The sections the article always had are still there, in their old order.
    const order = [
      '== Overview ==',
      '== Facts ==',
      '== Points of interest ==',
      '== NPCs ==',
      '== Quests starting here ==',
    ];
    const at = order.map((h) => eastbrook.indexOf(h));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('takes creature levels from the camps in each zone', () => {
    const zones = creaturesByZone();
    for (const camp of getActiveWorldContent().camps) {
      const z = zoneContaining(camp.center.x, camp.center.z);
      if (!z || !MOBS[camp.mobId]) continue;
      const row = zones.get(z.id)!.find((c) => c.mobId === camp.mobId)!;
      expect(row.min).toBeLessThanOrEqual(camp.levelMin ?? MOBS[camp.mobId].minLevel);
      expect(row.max).toBeGreaterThanOrEqual(camp.levelMax ?? MOBS[camp.mobId].maxLevel);
    }
  });

  it('counts every gathering node in the zone', () => {
    for (const z of ZONES) {
      const lines = zoneGathering(z, w);
      const total = lines.reduce((sum, line) => sum + Number(/: (\d+) /.exec(line)![1]), 0);
      expect(total, z.id).toBe(gatherNodesInActiveWorld().filter((n) => n.zoneId === z.id).length);
    }
  });
});

describe('vendors and enemies-by-zone directories', () => {
  const hubs = (): SeedPage[] => [
    { title: 'NPCs', text: 'intro\n\n== Services ==\n* x\n\n[[Category:Portals]]\n' },
    { title: 'Mobs', text: 'intro\n\n== Creature families ==\n* y\n\n[[Category:Portals]]\n' },
  ];

  it('lists every NPC with a shop, with its stock size and currency, and links it from the NPCs hub', () => {
    const { w, added } = tools();
    const pages = hubs();
    addHubDirectories(w, pages);
    const vendors = added.get('Vendors')!;
    expect(vendors.startsWith('[[NPCs|Browse NPCs]]')).toBe(true);
    for (const n of Object.values(NPCS).filter((n) => n.vendorItems?.length))
      expect(vendors, n.id).toContain('[[npc/' + n.id + '|' + n.name + ']] · Stock: ');
    expect(vendors).toContain(
      '[[npc/trader_wilkes|Trader Wilkes]] · Stock: ' +
        NPCS.trader_wilkes.vendorItems!.length +
        ' items · Pays with: Coin',
    );
    expect(vendors).toMatch(
      /\[\[npc\/heroic_quartermaster\|[^\]]+\]\] · Stock: \d+ items · Pays with: Heroic Marks/,
    );
    const npcs = pages[0].text;
    expect(npcs).toContain('== Shops ==\n* [[Vendors|All vendors]] (' + vendorNpcs().length + ')');
    expect(npcs.trimEnd().endsWith('[[Category:Portals]]')).toBe(true);
    expect(npcs.indexOf('== Shops ==')).toBeGreaterThan(npcs.indexOf('== Services =='));
  });

  it('names Honor for a Warfare quartermaster', () => {
    const warfare = Object.values(NPCS).find((n) => n.warfareVendor)!;
    expect(vendorCurrencies(warfare, (id) => id)).toContain('Honor');
  });

  it('writes one enemies page per zone, by rank, and links each from the Enemies hub', () => {
    const { w, added } = tools();
    const pages = hubs();
    const index = addHubDirectories(w, pages);
    const eastbrook = added.get(index.get('eastbrook_vale')!)!;
    expect(index.get('eastbrook_vale')).toBe('Eastbrook Vale (Enemies index)');
    expect(eastbrook.startsWith('[[Mobs|Browse enemies]]')).toBe(true);
    expect(eastbrook).toContain('== Normal enemies ==');
    expect(eastbrook).toMatch(/\* \[\[mob\/forest_wolf\|Forest Wolf\]\] · Level \d/);
    const mobs = pages[1].text;
    expect(mobs).toContain('== By zone ==\n* [[');
    expect(mobs).toContain('[[Eastbrook Vale (Enemies index)|Eastbrook Vale]] (');
    expect(mobs.trimEnd().endsWith('[[Category:Portals]]')).toBe(true);
  });

  it('adds a section before a hub page category lines and reports a missing hub', () => {
    const pages: SeedPage[] = [{ title: 'Hub', text: 'body\n\n[[Category:A]]\n[[Category:B]]\n' }];
    expect(appendHubSection(pages, 'Hub', '== New ==\n* z')).toBe(true);
    expect(pages[0].text).toBe('body\n\n== New ==\n* z\n\n[[Category:A]]\n[[Category:B]]\n');
    expect(appendHubSection(pages, 'Nope', '== New ==')).toBe(false);
  });
});

describe('mount routes', () => {
  it('adds How to get from the reins sources to every player mount page', () => {
    const { w } = tools();
    const pages: SeedPage[] = [...mountReins().keys()].map((key) => ({
      title: MOUNTS[key as keyof typeof MOUNTS].name + ' (Mount)',
      text: 'A mount.\n\nRelated guide: [[Mounts and riding]].\n\n[[Category:Mounts and riding]]\n',
    }));
    expect(addMountRoutes(w, pages)).toBe(pages.length);
    for (const page of pages) {
      expect(page.text, page.title).toContain(
        '== How to get ==\nYou get this mount by getting [[item/reins_',
      );
      expect(page.text.indexOf('== How to get ==')).toBeLessThan(
        page.text.indexOf('Related guide:'),
      );
    }
    const valorsteed = pages.find((p) => p.title === 'Valorsteed (Mount)')!;
    expect(valorsteed.text).toContain('Buy from [[npc/stablemaster_marla|');
  });
});
