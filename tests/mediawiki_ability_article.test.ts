import { describe, expect, it } from 'vitest';
import { abilityArticle } from '../scripts/mediawiki/ability_article';
import { addTalentPages } from '../scripts/mediawiki/talent_articles';
import { ROW_TREES, TALENTS } from '../src/sim/content/talents';
import { ABILITIES, CLASSES, QUESTS } from '../src/sim/data';
import { directHealBonus, directHitBonus, dotTickBonus } from '../src/sim/spell_scaling';

const titles = (records: Record<string, { name: string }>) =>
  new Map(Object.entries(records).map(([id, r]) => [id, r.name]));
const tools = {
  link: (t: string, l?: string) => l ?? t,
  section: (h: string, b: string) => h + '\n' + b + '\n',
  table: (rows: string[][]) => rows.map((r) => r.join(' | ')).join('\n'),
  bullets: (rows: string[]) => rows.join('\n'),
  titleBy: { class: titles(CLASSES), ability: titles(ABILITIES), quest: titles(QUESTS) },
};
describe('Player encyclopedia ability mechanics', () => {
  it('describes the ground-aim bomb through its inventory item rather than a class spell grant', () => {
    const article = abilityArticle(ABILITIES.clockwork_shock_bomb, {
      ...tools,
      link: (title, label = title) => '[[' + title + '|' + label + ']]',
      titleBy: {
        ...tools.titleBy,
        item: new Map([['clockwork_shock_bomb', 'reserved bomb item']]),
      },
    });
    expect(article).toContain('reserved bomb item');
    expect(article).toContain('Any class carrying');
    expect(article).toContain('120 to 160');
    expect(article).toContain('One bomb per successful use');
    expect(article).not.toMatch(/Warrior|First rank|Global cooldown|Level 1/);
  });
  it('renders every visible ability without leaking a spellbook token', () => {
    for (const def of Object.values(ABILITIES).filter((d) => !d.hiddenFromPlayer)) {
      const text = abilityArticle(def, tools);
      expect(text, def.id).not.toMatch(
        /\$[dbto]\b|\{\w+\}|entities\.abilities\.|\b(?:undefined|NaN)\b/,
      );
    }
  });
  it('resolves a specialization that replaces a resource cost with a gain', () => {
    const article = abilityArticle(ABILITIES.execute, tools);
    expect(article).toContain('Grants 20 rage');
    expect(article).toContain('6 sec cooldown');
  });
  it('describes rank-specific direct hits, hybrid burns and the exact power fraction', () => {
    const fireball = ABILITIES.fireball,
      article = abilityArticle(fireball, tools);
    expect(article).toContain('Higher ranks');
    expect(article).toContain('periodic effect gains no separate power bonus');
    const match = article.match(/Spell Power × ([\d.]+) \/ ([\d.]+)/);
    expect(match).not.toBeNull();
    for (const power of [40, 137])
      expect(Math.round((power * Number(match![1])) / Number(match![2]))).toBe(
        directHitBonus(power, fireball, fireball.castTime),
      );
  });
  it('separates the ranged power coefficient per tick from a direct healing roll', () => {
    const sting = ABILITIES.serpent_sting,
      dot = sting.effects.find((e) => e.type === 'dot')!;
    const shot = abilityArticle(sting, tools).match(
      /Ranged Attack Power × ([\d.]+) × ([\d.]+) \/ ([\d.]+)/,
    );
    const heal = ABILITIES.lesser_heal;
    const healing = abilityArticle(heal, tools).match(
      /Healing Power × ([\d.]+) × ([\d.]+) \/ ([\d.]+)/,
    );
    expect(shot).not.toBeNull();
    expect(healing).not.toBeNull();
    for (const power of [40, 137]) {
      expect(Math.round((power * Number(shot![1]) * Number(shot![2])) / Number(shot![3]))).toBe(
        dotTickBonus(power, sting, dot.duration, dot.interval),
      );
      expect(
        Math.round((power * Number(healing![1]) * Number(healing![2])) / Number(healing![3])),
      ).toBe(directHealBonus(power, heal.castTime));
    }
  });
  it('indexes each talent choice and specialization, including granted abilities and alternatives', () => {
    const pages = new Map<string, string>();
    addTalentPages({
      ...tools,
      add: (t, b) => {
        expect(pages.has(t)).toBe(false);
        pages.set(t, b);
      },
      usedTitles: new Set(),
      unique: (t, used) => {
        let result = t;
        let i = 1;
        while (used.has(result)) result = t + ' (' + ++i + ')';
        used.add(result);
        return result;
      },
    });
    expect([...pages.keys()].filter((t) => t.includes('(Specialization)'))).toHaveLength(
      Object.values(TALENTS).reduce((n, c) => n + c.specs.length, 0),
    );
    expect([...pages.keys()].filter((t) => t.includes('(Talent)'))).toHaveLength(
      Object.values(ROW_TREES).flatMap((rows) => rows.flatMap((row) => row.options)).length,
    );
    expect(pages.get('Double Blink (Talent)')).toContain('30% more slowly');
    expect(pages.get('Double Blink (Talent)')).toContain('Ice Floes');
  });
});
