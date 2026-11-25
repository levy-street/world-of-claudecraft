import { describe, expect, it } from 'vitest';
import { addSystemArticles } from '../scripts/mediawiki/system_articles';
import { CLUE_HUNTS } from '../src/sim/content/clue_hunts';
import { DEEDS } from '../src/sim/content/deeds';
import { ENCHANTS } from '../src/sim/content/enchants';
import { isDeveloperMount, MOUNTS } from '../src/sim/content/mounts';
import { CAVE_THEMES } from '../src/sim/content/rift/cave_themes';
import { RIFT_THEMES } from '../src/sim/content/rift/themes';
import { ALL_RECIPES, DELVE_LIST, ITEMS } from '../src/sim/data';

function render() {
  const pages = new Map<string, string>();
  const byCategory = new Map<string, string[]>();
  const titles = new Set<string>();
  addSystemArticles({
    unique(base) {
      let title = base;
      for (let i = 2; titles.has(title); i++) title = `${base} (${i})`;
      titles.add(title);
      return title;
    },
    add(title, text, categories) {
      expect(pages.has(title), title).toBe(false);
      pages.set(title, text);
      for (const c of categories) byCategory.set(c, [...(byCategory.get(c) ?? []), title]);
    },
    titleBy: {
      item: new Map(Object.entries(ITEMS).map(([id, i]) => [id, i.name])),
      npc: new Map(),
      mob: new Map(),
      zone: new Map(),
      dungeon: new Map(),
    },
  });
  return { pages, byCategory };
}
describe('system encyclopedia', () => {
  const { pages, byCategory } = render();
  it('marks retired modes, their mechanics and their deeds on direct visits', () => {
    const directory = pages.get('Gameplay Systems')!;
    const retired = directory.split('== Retired and unavailable activities ==')[1].split('==')[0];
    for (const title of ['Protect Yumi', 'Fiesta arena', 'Vale Cup', 'Mount racing']) {
      expect(retired).toContain('[[' + title + ']]');
      expect(directory.split('== Retired and unavailable activities ==')[0]).not.toContain(
        '[[' + title + ']]',
      );
    }
    for (const group of ['Fiesta augments', 'Fiesta power-ups']) {
      for (const title of byCategory.get(group)!) expect(pages.get(title)).toMatch(/^'''Retired/);
    }
    for (const name of ['Boots on the Pitch', 'Party Crasher']) {
      const title = name + ' (Deed)';
      expect(pages.get(title)).toMatch(/^'''Retired deed/);
      expect(pages.get(title)).toContain('== Original requirement ==');
      expect(pages.get('Book of Deeds')).toContain(`[[${title}|${name}]] (retired)`);
    }
    expect(pages.get('Mount racing')).toContain('7 bars in any order');
    expect(pages.get('Gourdlight Eve')).toContain('Seasonal event');
  });
  it('gives every public entry in its registries a reachable article', () => {
    for (const [name, count] of [
      ['Hoard encounters', RIFT_THEMES.length + CAVE_THEMES.length],
      ['Rift floors', 1 + RIFT_THEMES.length],
      ['Crafting recipes', ALL_RECIPES.length],
      ['Equipment enchants', Object.keys(ENCHANTS).length],
      ['Book of Deeds', Object.values(DEEDS).filter((d) => !d.hidden).length],
      ['Delves', DELVE_LIST.length],
      ['Clue hunts', CLUE_HUNTS.length],
      ['Mounts and riding', Object.keys(MOUNTS).filter((k) => !isDeveloperMount(k)).length],
    ] as const) {
      const entries = byCategory.get(name) ?? [];
      expect(entries, name).toHaveLength(count);
      for (const title of entries) expect(pages.get(name)).toContain(`[[${title}|`);
    }
  });
  it('gives every available system its entry point, prerequisites, ordered actions and outcome', () => {
    const systems = byCategory.get('Gameplay Systems')!;
    const retired = new Set([
      'Protect Yumi',
      'Fiesta arena',
      'Fiesta augments',
      'Fiesta power-ups',
      'Vale Cup',
      'Mount racing',
    ]);
    for (const title of systems) {
      const body = pages.get(title)!;
      if (retired.has(title)) {
        expect(body, title).toMatch(/^'''Retired/);
        expect(body, title).not.toContain('== Getting started ==');
      } else if (title === 'Referral cards') {
        expect(body).toContain('== How to start a card ==');
      } else {
        expect(body, title).toMatch(
          /== Getting started ==[\s\S]+'''Where to go\.'''.+[\s\S]+'''What you need\.'''.+[\s\S]+=== Step by step ===\n# .+[\s\S]+\n# .+[\s\S]+'''What you get\.'''.+/,
        );
      }
    }
  });
  it('resolves numeric tokens and display labels before publishing', () => {
    const unresolved = [...pages].flatMap(([title, body]) => {
      const tokens = body.match(/\{[a-zA-Z]\w*\}|\bundefined\b|\bNaN\b/g);
      return tokens ? [[title, tokens]] : [];
    });
    expect(unresolved).toEqual([]);
  });
  it('links each profession to its recipes and separates listed skill from the ability to craft', () => {
    const pick = 'Osmium Mining Pick (Recipe)';
    expect(pages.get('Engineering')).toMatch(
      new RegExp(
        `^\\| 75 \\|\\| (?:<woc-art [^>]*/> )?\\[\\[${pick.replace(/[()]/g, '\\$&')}\\|`,
        'm',
      ),
    );
    expect(pages.get(pick)).toContain('attempt it below its listed skill of 75');
    expect(pages.get(pick)).toContain('From skill 100 until 125: 0.5 skill per craft');
    expect(pages.get('Crafting stations')).toContain('x 7, z 660');
    for (const title of byCategory.get('Crafting recipes') ?? []) {
      expect(pages.get(title)).toContain('== Skill gain ==');
    }
  });
  it('publishes verifiable progression, crafting and collection details', () => {
    expect(pages.get('Dungeon Finder')).toContain(
      'note of up to 120 characters, which moderators can check',
    );
    expect(pages.get('Dungeon Finder')).not.toContain('no free-form advertisement text');
    expect(pages.get('Death and recovery')).toContain('plus 24 seconds for each level above that');
    expect(pages.get('Lockpicking')).toContain(
      '3 page(s) in a row, 1 attempt(s), 3 seconds per move',
    );
    expect(pages.get('Hunter pets')).toContain('22% of your ranged attack power');
    expect(pages.get('Water Elemental (Combat pet)')).toContain('10 Frost damage');
    const cave = pages.get('Mother of Mushrooms (Hoard encounter)');
    expect(cave).toContain(
      'First hit of nature damage, before anything on you lowers it: 51 on common, 42 on rare.',
    );
    expect(cave).not.toMatch(/common: \./);
    expect(pages.get('Leveling and prestige')).toContain('Level 1 to 2:');
    expect(pages.get('Ashes at the Gate (Clue hunt)')).toContain('x 350, z 2085');
    expect(pages.get('Mounts and riding')).toContain('makes you move 70% faster');
    for (const t of byCategory.get('Crafting recipes') ?? []) {
      expect(pages.get(t)).toMatch(/Base material cost/);
      expect(pages.get(t)).toMatch(/Makes \d+ x \[\[/);
    }
  });
});
