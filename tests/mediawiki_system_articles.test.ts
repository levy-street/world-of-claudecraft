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
  it('resolves numeric tokens and display labels before publishing', () => {
    const unresolved = [...pages].flatMap(([title, body]) => {
      const tokens = body.match(/\{[a-zA-Z]\w*\}|\bundefined\b|\bNaN\b/g);
      return tokens ? [[title, tokens]] : [];
    });
    expect(unresolved).toEqual([]);
  });
  it('publishes verifiable progression, crafting and collection details', () => {
    expect(pages.get('Dungeon Finder')).toContain('moderated note of up to 120 characters');
    expect(pages.get('Dungeon Finder')).not.toContain('no free-form advertisement text');
    expect(pages.get('Death and recovery')).toContain('plus 24 seconds per further level');
    expect(pages.get('Lockpicking')).toContain(
      '3 page(s) in a row, 1 attempt(s), 3 seconds per move',
    );
    expect(pages.get('Hunter pets')).toContain('22% of your ranged attack power');
    expect(pages.get('Water Elemental (Combat pet)')).toContain('10 Frost damage');
    const cave = pages.get('Mother of Mushrooms (Hoard encounter)');
    expect(cave).toContain(
      'Initial nature damage before target modifiers: 51 on common, 42 on rare.',
    );
    expect(cave).not.toMatch(/common: \./);
    expect(pages.get('Leveling and prestige')).toContain('Level 1 to 2:');
    expect(pages.get('Ashes at the Gate (Clue hunt)')).toContain('x 350, z 2085');
    expect(pages.get('Mounts and riding')).toContain('increases movement speed by 70%');
    for (const t of byCategory.get('Crafting recipes') ?? []) {
      expect(pages.get(t)).toMatch(/Base material cost/);
      expect(pages.get(t)).toMatch(/Makes \d+ x \[\[/);
    }
  });
});
