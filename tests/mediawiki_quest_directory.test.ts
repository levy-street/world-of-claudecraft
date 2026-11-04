import { describe, expect, it } from 'vitest';
import type { ArticleKind, ArticleTools } from '../scripts/mediawiki/entity_format';
import { addQuestArticles } from '../scripts/mediawiki/quest_articles';
import { addQuestDirectory } from '../scripts/mediawiki/quest_directory';
import { getActiveWorldContent, QUESTS } from '../src/sim/data';

function harness() {
  const pages = new Map<string, string>();
  const titleBy = {} as Record<ArticleKind, Map<string, string>>;
  for (const domain of [
    'ability',
    'class',
    'zone',
    'dungeon',
    'npc',
    'quest',
    'mob',
    'item',
  ] as const)
    titleBy[domain] = new Map();
  const used = new Set<string>();
  for (const q of Object.values(QUESTS)) {
    titleBy.quest.set(q.id, used.has(q.name) ? q.name + ' (' + q.id + ')' : q.name);
    used.add(q.name);
  }
  const w: ArticleTools & { reserve(s: string): string } = {
    titleBy,
    reserve: (s) => s,
    link: (s, label = s) => '[[' + s + '|' + label + ']]',
    add: (s, body) => {
      expect(pages.has(s)).toBe(false);
      pages.set(s, body);
    },
    section: (title, body) => '== ' + title + ' ==\n' + body + '\n',
    table: (rows) => rows.map((pair) => pair.join(' | ')).join('\n'),
    bullets: (rows) => rows.map((line) => '* ' + line).join('\n'),
    money: (n) => (n ?? 0) + ' copper',
    kindWording: (s) => s,
  };
  return { w, pages };
}

describe('quest browsing', () => {
  it('reaches every standard quest once through its starting area and orders prerequisites first', () => {
    const { w, pages } = harness();
    const zoneTitles = addQuestDirectory(w);
    const grouped = [...zoneTitles.values()].map((t) => pages.get(t)!).join('\n');
    for (const quest of Object.values(QUESTS))
      expect(
        grouped.split(w.link(w.titleBy.quest.get(quest.id)!, quest.name)).length - 1,
        quest.id,
      ).toBe(1);
    const eastbrook = pages.get(zoneTitles.get('Eastbrook Vale')!)!;
    expect(eastbrook.indexOf(w.link('Wolves at the Door'))).toBeLessThan(
      eastbrook.indexOf(w.link('The Old Wolf')),
    );
    expect(pages.get('Quests')).toContain(w.link('World quests'));
    expect(pages.get('Quests')).toContain(w.link('Weekly quests'));
    expect(pages.get('Profession quests')).toContain(w.link(QUESTS.q_prof_intro.name));
    expect(pages.get('Profession quests')).toContain(w.link(QUESTS.q_prof_workorder_forge.name));
    expect(pages.get('Repeatable quests')).toContain(w.link(QUESTS.q_prof_workorder_forge.name));
    expect(pages.get('Repeatable quests')).not.toContain(w.link(QUESTS.q_prof_intro.name));
  });
  it('puts live start and hand-in coordinates, harvesting and rewards before quest dialogue', () => {
    const { w, pages } = harness();
    addQuestArticles(w, new Map());
    const quest = QUESTS.q_prof_intro;
    const article = pages.get(quest.name)!;
    const { x, z } = getActiveWorldContent().npcs[quest.giverNpcId].pos;
    const pos = '(' + Number(x.toFixed(2)) + ', ' + Number(z.toFixed(2)) + ')';
    const brief = article.slice(0, article.indexOf('== Objectives =='));
    expect(brief).toContain('Start | Foreman Odell · Eastbrook Vale ' + pos);
    expect(brief).toContain('Hand in | Foreman Odell · Eastbrook Vale ' + pos);
    expect(article).toContain('Mine ore veins 5 times.');
    expect(article).toContain('Copper Mining Pick');
    expect(article).toContain('150 XP');
    expect(article).toContain('50 copper');
    expect(article.indexOf('== Walkthrough ==')).toBeLessThan(article.indexOf('== Rewards =='));
    expect(article.indexOf('== Rewards ==')).toBeLessThan(article.indexOf('== Quest dialogue =='));
    expect(article).toContain(w.link(QUESTS.q_prof_hobby_switch.name));
  });
});
