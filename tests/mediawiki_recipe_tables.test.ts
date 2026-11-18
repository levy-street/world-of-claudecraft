import { describe, expect, it } from 'vitest';
import { materialUses } from '../scripts/mediawiki/material_uses';
import {
  feeWords,
  RECIPE_PATTERN_ITEMS,
  RECIPE_REWARD_QUESTS,
  recipeTrainerStation,
} from '../scripts/mediawiki/recipe_sources';
import {
  professionRecipes,
  RECIPE_TABLE_HEADINGS,
  recipeTable,
} from '../scripts/mediawiki/recipe_table';
import { addSystemArticles } from '../scripts/mediawiki/system_articles';
import { GUIDE_PROF_CRAFTS } from '../src/guide/content.generated';
import { ENCHANTS } from '../src/sim/content/enchants';
import { ALL_RECIPES, ITEMS, NPCS } from '../src/sim/data';
import { MATERIAL_GRADES } from '../src/sim/professions/material_grades';
import { trainingFeeFor } from '../src/sim/professions/training';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';

// Links that carry the id, so a row can be checked against the game data.
const links = {
  item: (id: string) => `[[item:${id}]]`,
  npc: (id: string) => `[[npc:${id}]]`,
  quest: (id: string) => `[[quest:${id}]]`,
  recipe: (r: ProfessionRecipeRecord) => `[[recipe:${r.id}]]`,
};
const recipeName = (r: ProfessionRecipeRecord) => ITEMS[r.resultItemId]?.name ?? r.id;
const DASH_OR_EMOJI = /[‒-―−]|\p{Extended_Pictographic}/u;

function tableRows(table: string): string[][] {
  return table
    .split('\n')
    .filter((line) => line.startsWith('| '))
    .map((line) => line.slice(2).split(' || '));
}

const tables = new Map(
  GUIDE_PROF_CRAFTS.map((c) => [c.id, recipeTable(professionRecipes(c.id, recipeName), links)]),
);

describe('crafting recipe tables', () => {
  it('lists every recipe exactly once, under its own profession', () => {
    const seen = new Map<string, string>();
    for (const [profession, table] of tables)
      for (const row of tableRows(table)) {
        const id = /\[\[recipe:([^\]]+)\]\]/.exec(row[1])?.[1];
        expect(id, row.join(' || ')).toBeTruthy();
        expect(seen.has(id!), id).toBe(false);
        seen.set(id!, profession);
      }
    expect([...seen.keys()].sort()).toEqual(ALL_RECIPES.map((r) => r.id).sort());
    for (const r of ALL_RECIPES) expect(seen.get(r.id), r.id).toBe(r.professionId);
  });

  it('matches each recipe: skill, output, materials and how to learn it', () => {
    const byId = new Map(ALL_RECIPES.map((r) => [r.id, r]));
    for (const table of tables.values()) {
      expect(table).toContain('! ' + RECIPE_TABLE_HEADINGS.join(' !! '));
      for (const row of tableRows(table)) {
        expect(row).toHaveLength(RECIPE_TABLE_HEADINGS.length);
        const r = byId.get(/\[\[recipe:([^\]]+)\]\]/.exec(row[1])![1])!;
        expect(row[0]).toBe(String(r.skillReq));
        expect(row[2]).toMatch(
          new RegExp(`^${r.resultCount} x \\[\\[item:${r.resultItemId}\\]\\] \\([A-Z][a-z]+\\)$`),
        );
        const materials = [...row[3].matchAll(/(\d+) x \[\[item:([^\]]+)\]\]/g)].map((m) => ({
          itemId: m[2],
          count: Number(m[1]),
        }));
        expect(materials, r.id).toEqual(
          r.reagents.map((m) => ({ itemId: m.itemId, count: m.count })),
        );
        const learned = row[4];
        if (!r.acquisition?.length) expect(learned).toBe('Known from the start');
        if (r.acquisition?.includes('trainer')) {
          const station = recipeTrainerStation(r);
          expect(station, r.id).toBeDefined();
          expect(learned).toContain(`Trainer: [[npc:${station!.masterNpcId}]]`);
          expect(learned).toContain(feeWords(trainingFeeFor(r)));
        }
        if (r.acquisition?.includes('drop'))
          for (const pattern of RECIPE_PATTERN_ITEMS.get(r.id) ?? [])
            expect(learned).toContain(`[[item:${pattern}]]`);
        if (r.acquisition?.includes('quest'))
          for (const quest of RECIPE_REWARD_QUESTS.get(r.id) ?? [])
            expect(learned).toContain(`[[quest:${quest}]]`);
      }
    }
  });

  it('sorts each table by listed skill', () => {
    for (const table of tables.values()) {
      const skills = tableRows(table).map((row) => Number(row[0]));
      expect(skills).toEqual([...skills].sort((a, b) => a - b));
    }
  });

  it('writes fees in coin words', () => {
    expect(feeWords(0)).toBe('no fee');
    expect(feeWords(50)).toBe('50 copper');
    expect(feeWords(2500)).toBe('25 silver');
    expect(feeWords(12050)).toBe('1 gold 20 silver 50 copper');
  });

  it('uses no dashes or emojis', () => {
    for (const table of tables.values()) expect(table).not.toMatch(DASH_OR_EMOJI);
  });
});

describe('crafting recipe tables in the wiki', () => {
  const pages = new Map<string, string>();
  const titles = new Set<string>();
  addSystemArticles({
    unique(base) {
      let title = base;
      for (let i = 2; titles.has(title); i++) title = `${base} (${i})`;
      titles.add(title);
      return title;
    },
    add(title, text) {
      pages.set(title, text);
    },
    titleBy: {
      item: new Map(Object.entries(ITEMS).map(([id, i]) => [id, i.name])),
      npc: new Map(Object.entries(NPCS).map(([id, n]) => [id, n.name + ' (NPC)'])),
      mob: new Map(),
      zone: new Map(),
      dungeon: new Map(),
    },
  });

  it('puts one table on each craft page, linking every recipe page once', () => {
    const linked: string[] = [];
    for (const craft of GUIDE_PROF_CRAFTS) {
      const page = pages.get(craft.name)!;
      expect(page, craft.name).toContain('== Recipes by skill ==');
      expect(page.match(/\{\| class="wikitable recipe-table"/g)).toHaveLength(1);
      for (const line of page.split('\n').filter((l) => l.startsWith('| ')))
        linked.push(/(?:\/> )?\[\[([^\]|]+)\|/.exec(line.split(' || ')[1])![1]);
      expect(page).not.toMatch(DASH_OR_EMOJI);
    }
    expect(new Set(linked).size).toBe(ALL_RECIPES.length);
    expect(linked).toHaveLength(ALL_RECIPES.length);
    for (const title of linked) expect(pages.has(title), title).toBe(true);
  });

  it('labels trainer links with the NPC name, not the page title', () => {
    expect(pages.get('Alchemy')).toMatch(/Trainer: \[\[[^\]|]+ \(NPC\)\|[^\]]+\]\]/);
  });

  it('keeps the hub a directory and points it at every craft table', () => {
    const hub = pages.get('Crafting recipes')!;
    expect(hub).toContain('== Recipe tables by craft ==');
    for (const craft of GUIDE_PROF_CRAFTS) expect(hub).toContain(`[[${craft.name}]]`);
    expect(hub).not.toContain('recipe-table');
    expect(hub).not.toMatch(DASH_OR_EMOJI);
  });
});

describe('material uses beyond recipes', () => {
  const uses = materialUses({
    item: (id) => `[[item:${id}]]`,
    enchant: (id) => `[[enchant:${id}]]`,
    page: (title) => `[[${title}]]`,
  });

  it('names every enchant that spends a material', () => {
    for (const e of Object.values(ENCHANTS))
      for (const r of e.reagents)
        expect(uses.get(r.itemId)?.join('\n'), r.itemId).toContain(
          `${r.count} each time you apply [[enchant:${e.id}]]`,
        );
  });

  it('says a fine node grade stands in for its normal grade', () => {
    for (const [base, row] of Object.entries(MATERIAL_GRADES))
      expect(uses.get(row.fineItemId)?.join('\n')).toContain(`asks for [[item:${base}]]`);
  });

  it('covers the farming supplies', () => {
    for (const id of ['withered_husks', 'compost', 'growth_tonic'])
      expect(uses.get(id)?.length, id).toBeGreaterThan(0);
  });

  it('uses no dashes or emojis', () => {
    for (const entries of uses.values())
      for (const line of entries) expect(line).not.toMatch(DASH_OR_EMOJI);
  });
});
