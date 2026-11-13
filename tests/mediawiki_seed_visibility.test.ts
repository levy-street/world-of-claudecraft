// The MediaWiki seed publishes one page per player-visible ability, so a renamed
// or retired ability must not leave a stale or orphaned wiki page behind.
//
// This checks the GENERATOR against the current content, not the committed
// mediawiki/seed/pages.xml. That file is a first-boot deploy artifact the release
// regenerates when it ships, and its committed copy trails the content by tens of
// thousands of lines at any given moment, so demanding a fresh copy in every
// content PR would drag that whole unrelated diff along. Rebuilding into a temp
// dir keeps the real invariant: what the generator emits for TODAY's abilities is
// exactly the visible set, with no duplicates and no dangling links.
//
// That trailing is now a two-tier posture rather than an unchecked one, and this
// file is only its always-on half. tests/mediawiki_seed_freshness.test.ts owns
// the other half: at PR tier it holds the committed copy to this generator's own
// envelope and to the repo dash rule, and under MEDIAWIKI_SEED_RELEASE_TIER=1 it
// demands the committed bytes equal a fresh build, so a release that forgets
// `npm run wiki:seed` fails instead of shipping a stale wiki. Nothing here
// changes: freshness of the committed bytes is still deliberately not this
// file's business.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WEEKLY_QUESTS } from '../src/sim/content/weekly_quests';
import { WORLD_QUESTS } from '../src/sim/content/world_quests';
import { ABILITIES, ITEMS, MOBS, QUESTS } from '../src/sim/data';

let xml = '';
let cards: Record<string, string>;
let workDir = '';

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'woc-seed-'));
  const out = path.join(workDir, 'pages.xml');
  execFileSync(process.execPath, [resolve('scripts/mediawiki/build_seed.mjs')], {
    env: { ...process.env, MEDIAWIKI_SEED_OUT: out },
    stdio: 'pipe',
  });
  xml = readFileSync(out, 'utf8');
  cards = JSON.parse(readFileSync(path.join(workDir, 'pages.tooltips.json'), 'utf8'));
}, 120_000);

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe('MediaWiki ability visibility', () => {
  it('publishes exactly the player-visible abilities', () => {
    // Abilities that share a name are told apart by a qualifier, "(Ability, arcane)",
    // never by a bare number.
    const published = [...xml.matchAll(/<title>([^<]+ \(Ability(?:, [^<)]+)?\))<\/title>/g)].map(
      (match) => match[1],
    );
    expect(new Set(published).size).toBe(published.length);
    const actualTitles = published
      .map((t) => t.replace(/ \(Ability, [^)]+\)$/, ' (Ability)'))
      .sort();
    const expectedTitles = Object.values(ABILITIES)
      .filter((ability) => ability.hiddenFromPlayer !== true)
      .map((ability) =>
        `${ability.name} (Ability)`.replace(
          /[&<>"']/g,
          (char) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char] ??
            char,
        ),
      )
      .sort();

    expect(actualTitles).toEqual(expectedTitles);
    expect(xml).not.toMatch(/<title>[^<]+ \(Ability\) \(\d+\)<\/title>/);
    expect(xml).not.toMatch(/<title>Sacred Goad \(Ability, /);
    expect(xml).not.toContain('[[undefined]]');
  });

  it('publishes a usable static Bear Trap reference without a live tooltip token', () => {
    const article = xml.split('<title>Bear Trap (Ability)</title>')[1]?.split('</page>')[0];
    expect(article).toBeDefined();
    expect(article).toContain('85 Physical damage at zero Ranged Attack Power over 15 sec');
    expect(article).toContain('5 times, once every 3 sec');
    expect(article).toContain('Each tick is rounded to a whole number');
    expect(article).not.toMatch(/\$d|\{damage\}/);
  });

  it('publishes the reworked Retribution defensive under its current name only', () => {
    expect(xml).toContain('<title>Debt of Light (Ability)</title>');
    expect(xml).not.toContain('Faithforged Guard (Ability)');
  });
});

describe('the searchable player encyclopedia', () => {
  it('has unique article destinations and resolves every internal article link', () => {
    const titles = [...xml.matchAll(/<title>([^<]+)<\/title>/g)].map((m) => m[1]);
    const published = new Set(titles);
    expect(published.size).toBe(titles.length);
    const missing = new Set<string>();
    for (const [, title] of xml.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
      if (!title.startsWith('Category:') && !published.has(title)) missing.add(title);
    }
    expect([...missing]).toEqual([]);
  });

  it('publishes every item and creature and maps every standard, world, and weekly quest', () => {
    const pages = xml.split('<page>').slice(1);
    const count = (category: string) =>
      pages.filter((p) => p.includes('[[Category:' + category + ']]'));
    expect(count('Items').length).toBe(Object.keys(ITEMS).length);
    // Every creature is published: enemies under Mobs, the rest as friendly creatures.
    expect(count('Mobs').length + count('Friendly creatures').length).toBe(
      Object.keys(MOBS).length,
    );
    expect(count('Friendly creatures').length).toBeGreaterThan(20);
    const systemMaps = count('Gameplay Systems').filter((p) => p.includes('== Route map =='));
    expect(systemMaps).toHaveLength(count('Gameplay Systems').length - 6);
    for (const page of systemMaps)
      expect(page).toMatch(/class=&quot;woc-map&quot;|=== Action route ===/);
    // Dungeon and raid entrance pages carry route maps too; count quest pages only.
    const questCategories = ['Quests', 'World quests', 'Weekly quests'];
    const routes = pages.filter(
      (p) =>
        p.includes('== Route map ==') &&
        questCategories.some((c) => p.includes('[[Category:' + c + ']]')),
    );
    expect(routes.length).toBe(
      Object.keys(QUESTS).length + WORLD_QUESTS.length + WEEKLY_QUESTS.length,
    );
    for (const page of routes) {
      expect(page).toContain('class=&quot;woc-map&quot;');
      expect(page).toContain('class=&quot;woc-pin&quot;');
    }
    const standard = routes.filter((p) => p.includes('[[Category:Quests]]'));
    expect(standard.length).toBe(Object.keys(QUESTS).length);
    for (const page of standard) {
      expect(page).toContain('== Walkthrough ==');
      expect(page).toMatch(/title=&quot;[^&]*?\([-\d.]+, [-\d.]+\)/);
      expect(page).toMatch(/class=&quot;woc-pin&quot; title=&quot;[S0-9/]*H(?:[/0-9]* )/);
    }
  });
});

describe('encyclopedia organization', () => {
  const page = (title: string) => {
    const m = xml.match(
      new RegExp(
        '<title>' +
          title.replace(/[()]/g, '\\$&') +
          '</title>[\\s\\S]*?<text[^>]*>([\\s\\S]*?)</text>',
      ),
    );
    return m ? m[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&') : '';
  };
  const titles = () => [...xml.matchAll(/<title>([^<]+)<\/title>/g)].map((m) => m[1]);
  it('lists delves and rifts on the Dungeons hub and quest interiors on Zones', () => {
    const dungeons = page('Dungeons');
    expect(dungeons).toContain('== Delves ==');
    expect(dungeons).toContain('== Rifts ==');
    expect(dungeons).toContain('[[The Collapsed Reliquary (Delve)|The Collapsed Reliquary]]');
    expect(dungeons).toContain('[[Rank S (Rift)|Rank S]]');
    expect(dungeons).not.toContain('[[The Last Keep]]');
    const zones = page('Zones');
    expect(zones).toContain('== Interiors ==');
    expect(zones).toMatch(/\[\[The Last Keep\]\] · Zone: /);
  });
  it('titles contracts and ferries as players read them', () => {
    const all = titles();
    expect(all.filter((t) => /\((?:boss|heroic|task)\) \(Contract\)$/.test(t))).toEqual([]);
    expect(all).toContain('Morthen the Gravecaller, Heroic (Contract)');
    expect(all).toContain('Eastbrook to Nightbloom (Ferry)');
    expect(all.filter((t) => t.endsWith('(Ferry)') && /^[a-z]/.test(t))).toEqual([]);
  });
  it('names the forge trainer for the trades it teaches and groups pets and companions', () => {
    // The NPC keeps its in-game title, but the wiki's service label and NPC group name the
    // professions the forge actually teaches.
    expect(titles()).not.toContain('Blacksmithing Trainer (NPCs index)');
    expect(titles()).toContain('Armorcrafting and Weaponcrafting Trainer (NPCs index)');
    expect(xml).not.toMatch(/! Service\n\| Blacksmithing Trainer/);
    expect(xml).toMatch(/! Service\n\| Armorcrafting and Weaponcrafting Trainer/);
    const systems = page('Gameplay Systems');
    const pets = systems.split('== Pets and companions ==')[1].split('\n== ')[0];
    for (const topic of ['Combat pets', 'Hunter pets', 'Delve companions', 'Cosmetic companions'])
      expect(pets, topic).toContain(topic);
  });
});

describe('headline numbers', () => {
  it('gives every ability, talent, specialization and enemy page a stat strip', () => {
    const pages = xml.split('<page>').slice(1);
    const has = (p: string) => p.includes('== At a glance ==') || p.includes('== Ability stats ==');
    for (const category of ['Talent choices', 'Specializations', 'Mobs']) {
      const group = pages.filter((p) => p.includes('[[Category:' + category + ']]'));
      expect(group.length, category).toBeGreaterThan(20);
      expect(group.filter((p) => !has(p)).length, category).toBe(0);
    }
    const abilities = pages.filter((p) => p.includes('[[Category:Abilities]]'));
    // The one exception is the item-used bomb, which has its own layout.
    expect(abilities.filter((p) => !has(p)).length).toBe(1);
    // No ability page is left with a bare formula where a percent label belongs.
    expect(abilities.filter((p) => p.includes('&lt;woc-math&gt;')).length).toBe(0);
  });
  it('lists a creature with several levels in level order', () => {
    const boar = xml.split('<page>').find((p) => p.includes('<title>Wild Boar (Mob)</title>'))!;
    const glance = boar.split('== At a glance ==')[1].split('== Facts ==')[0];
    expect(glance).toMatch(/! Level\n\| \d+ \/ \d+/);
    expect(glance).toMatch(/! Health\n\| \d+ \/ \d+/);
  });
});

describe('the encyclopedia hover catalog', () => {
  it('maps every item and visible ability to its reserved article title', () => {
    const expected = xml
      .split('<page>')
      .slice(1)
      .filter(
        (page) => page.includes('[[Category:Items]]') || page.includes('[[Category:Abilities]]'),
      )
      .map((page) => page.match(/<title>([^<]+)<\/title>/)![1])
      .sort();
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    expect(
      Object.keys(cards)
        .map((title) => title.replace(/[&<>"']/g, (c) => entities[c]))
        .sort(),
    ).toEqual(expected);
    for (const [title, html] of Object.entries(cards)) {
      expect(html, title).toContain('class="tt-title"');
    }
    expect(cards['Clockwork Shock Bomb (Ability)']).toBe(cards['Clockwork Shock Bomb']);
  });
  it.runIf(process.env.MEDIAWIKI_SEED_RELEASE_TIER === '1')(
    'ships the regenerated tooltips',
    () => {
      expect(
        readFileSync('mediawiki/seed/pages.tooltips.json', 'utf8') ===
          readFileSync(path.join(workDir, 'pages.tooltips.json'), 'utf8'),
      ).toBe(true);
    },
  );
});
