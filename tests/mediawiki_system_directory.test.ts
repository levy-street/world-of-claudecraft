import { describe, expect, it } from 'vitest';
import { addSystemArticles } from '../scripts/mediawiki/system_articles';
import { systemDirectory } from '../scripts/mediawiki/system_directory';
import { DEEDS } from '../src/sim/content/deeds';
import { RELIQUARY_PAGES } from '../src/sim/content/reliquary';
import { ALL_RECIPES } from '../src/sim/data';
import { deedDisplayCategory } from '../src/ui/deeds_view';
import { guideStrings } from '../src/ui/i18n.catalog/guide';

describe('gameplay systems directory', () => {
  it('links every generated topic exactly once and keeps the public article title', () => {
    const pages = new Map<string, string>();
    const reserved = new Set(['Allied Hearthstone']);
    const topics = addSystemArticles({
      add: (title, body) => pages.set(title, body),
      unique(name) {
        let title = name;
        for (let i = 2; reserved.has(title); i++) title = `${name} (${i})`;
        reserved.add(title);
        return title;
      },
      titleBy: {
        item: new Map(),
        npc: new Map(),
        mob: new Map(),
        zone: new Map(),
        dungeon: new Map(),
      },
    });
    const hub = pages.get('Gameplay Systems')!;
    const destinations = [...hub.matchAll(/^\* \[\[([^|\]]+)(?:\|[^\]]+)?\]\]$/gm)].map(
      (m) => m[1],
    );
    expect(destinations.sort()).toEqual([...topics].sort());
    expect(hub).toContain('[[Allied Hearthstone (2)|Allied Hearthstone]]');
    expect(hub).toMatch(/== Character progression and combat ==[^=]*\[\[Level experience\]\]/);
    expect(hub).toMatch(/== Crafting professions ==[^=]*\[\[Crafting recipes\]\]/);
    expect(hub).toMatch(/== Trade, currency and storage ==[^=]*\[\[Materials Vault\]\]/);
  });

  it('omits empty themes and calls out new topics that need a place', () => {
    const topics = new Map([['Combat', { title: 'Combat' }]]);
    expect(systemDirectory(topics)).not.toContain('Crafting professions');
    topics.set('Future system', { title: 'Future system' });
    expect(() => systemDirectory(topics)).toThrow('Future system');
  });

  it('groups every recipe, visible deed and Reliquary page under its game category', () => {
    const pages = new Map<string, { body: string; categories: string[] }>();
    const titles = new Set<string>();
    addSystemArticles({
      add: (title, body, categories) => pages.set(title, { body, categories }),
      unique(name) {
        let title = name;
        for (let i = 2; titles.has(title); i++) title = `${name} (${i})`;
        titles.add(title);
        return title;
      },
      titleBy: {
        item: new Map(),
        npc: new Map(),
        mob: new Map(),
        zone: new Map(),
        dungeon: new Map(),
      },
    });
    for (const [owner, sectionNames] of [
      [
        'Crafting recipes',
        ALL_RECIPES.map((r) => r.professionId.charAt(0).toUpperCase() + r.professionId.slice(1)),
      ],
      [
        'Book of Deeds',
        Object.values(DEEDS)
          .filter((d) => !d.hidden)
          .map((d) => guideStrings.deedsPage.cat[deedDisplayCategory(d.category)]),
      ],
      ['The Reliquary', RELIQUARY_PAGES.map((p) => guideStrings.reliquaryPage.shelf[p.shelf])],
    ] as const) {
      const page = pages.get(owner)!;
      expect(page.categories).toContain('Collection directories');
      const expectedCounts = new Map<string, number>();
      for (const section of sectionNames)
        expectedCounts.set(section, (expectedCounts.get(section) ?? 0) + 1);
      const actualCounts = new Map<string, number>();
      const linked = new Set<string>();
      let currentSection = '';
      for (const line of page.body.split('\n')) {
        const section = line.match(/^== (.+) ==$/);
        if (section) currentSection = section[1];
        const title = line.match(/^\* \[\[([^|\]]+)/)?.[1];
        if (title && pages.get(title)?.categories[0] === owner) {
          expect(linked.has(title)).toBe(false);
          linked.add(title);
          actualCounts.set(currentSection, (actualCounts.get(currentSection) ?? 0) + 1);
        }
      }
      expect(actualCounts).toEqual(expectedCounts);
    }
  });
});
