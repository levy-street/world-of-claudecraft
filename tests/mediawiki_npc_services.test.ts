import { describe, expect, it } from 'vitest';
import type { ArticleKind, ArticleTools } from '../scripts/mediawiki/entity_format';
import { npcArticle } from '../scripts/mediawiki/npc_article';
import { npcServices, npcTrainingSection, SERVICE_PAGES } from '../scripts/mediawiki/npc_service';
import { addSystemArticles } from '../scripts/mediawiki/system_articles';
import { STATIONS } from '../src/sim/content/professions';
import { WEEKLY_QUEST_REWARD, WEEKLY_QUESTS } from '../src/sim/content/weekly_quests';
import { ITEMS, MOBS, NPCS, QUESTS, ZONES } from '../src/sim/data';
import { buildTrainView } from '../src/ui/hud/vendor/train_view';

function tools(): ArticleTools {
  const registries: Record<string, Record<string, unknown>> = {
    item: ITEMS,
    mob: MOBS,
    npc: NPCS,
    quest: QUESTS,
    zone: Object.fromEntries(ZONES.map((z) => [z.id, z])),
  };
  const titleBy = Object.fromEntries(
    ['class', 'ability', 'zone', 'dungeon', 'npc', 'quest', 'mob', 'item'].map((kind) => [
      kind,
      new Map(Object.keys(registries[kind] ?? {}).map((id) => [id, kind + '/' + id])),
    ]),
  ) as Record<ArticleKind, Map<string, string>>;
  return {
    titleBy,
    add: () => {},
    section: (name, body) => '== ' + name + ' ==\n' + body + '\n',
    table: (rows) => rows.map((r) => r.join(': ')).join('\n'),
    bullets: (rows) => rows.map((r) => '* ' + r).join('\n'),
    link: (title, label = title) => '[[' + title + '|' + label + ']]',
    money: (n) => (n ?? 0) + ' copper',
  };
}

const flagged = (flag: keyof (typeof NPCS)[string]) => Object.values(NPCS).filter((n) => n[flag]);

describe('NPC service rows', () => {
  const w = tools();

  it('gives the weekly emissary a Service row that names every weekly charge and its reward', () => {
    const [emissary] = flagged('weeklyEmissary');
    expect(emissary?.name).toBe('Cham Pete');
    const services = npcServices(emissary, w);
    expect(services.map((s) => s.label)).toEqual(['Weekly quests']);
    const text = services[0].text;
    for (const q of WEEKLY_QUESTS) expect(text).toContain(String(q.count));
    expect(text).toContain('clear 3 dungeons');
    expect(text).toContain(WEEKLY_QUEST_REWARD.copper.base + ' copper');
    expect(text).toContain('[[item/' + WEEKLY_QUEST_REWARD.cacheItemId + '|');
    expect(text).toContain('[[Weekly quests|');
  });

  it('gives the world quest taskmaster a Service row linked to World quests', () => {
    const [taskmaster] = flagged('worldQuestBoard');
    expect(taskmaster?.name).toBe('Taskmaster Kaelen');
    const services = npcServices(taskmaster, w);
    expect(services.map((s) => s.label)).toEqual(['World quests']);
    expect(services[0].text).toContain('[[World quests|');
  });

  it('describes every flagged service NPC and links its system page', () => {
    const cases: [keyof (typeof NPCS)[string], string][] = [
      ['banker', SERVICE_PAGES.banker],
      ['market', SERVICE_PAGES.market],
      ['riftForge', SERVICE_PAGES.riftForge],
      ['cardMaster', SERVICE_PAGES.cardMaster],
      ['heroicVendor', SERVICE_PAGES.heroic],
      ['farmer', SERVICE_PAGES.farming],
    ];
    for (const [flag, page] of cases) {
      const npcs = flagged(flag);
      expect(npcs.length, flag).toBeGreaterThan(0);
      for (const n of npcs) {
        const text = npcServices(n, w)
          .map((s) => s.text)
          .join(' ');
        expect(text, n.id).toContain('[[' + page + '|');
      }
    }
    const [maudie] = flagged('innkeeper');
    expect(npcServices(maudie, w)[0]).toMatchObject({ label: 'Innkeeper' });
    expect(npcServices(maudie, w)[0].text).toContain('Sells food and drink');
  });

  it('links only system pages the systems pass really writes', () => {
    const titles = new Set<string>();
    addSystemArticles({
      unique(base) {
        let title = base;
        for (let i = 2; titles.has(title); i++) title = `${base} (${i})`;
        titles.add(title);
        return title;
      },
      add: (title) => titles.add(title),
      titleBy: {
        item: new Map(),
        npc: new Map(),
        mob: new Map(),
        zone: new Map(),
        dungeon: new Map(),
      },
    });
    // Vendors is the directory this change adds; the two quest boards come from the quest pass.
    const elsewhere = new Set<string>([
      SERVICE_PAGES.vendors,
      SERVICE_PAGES.weekly,
      SERVICE_PAGES.worldQuests,
    ]);
    for (const page of Object.values(SERVICE_PAGES))
      if (!elsewhere.has(page)) expect(titles.has(page), page).toBe(true);
  });

  it('labels the onboarding trainers that run no station', () => {
    expect(npcServices(NPCS.foreman_odell, w).map((s) => s.label)).toEqual(['Mining Trainer']);
    const jessica = npcServices(NPCS.farmer_jessica, w).map((s) => s.label);
    expect(jessica).toContain('Farmer');
    expect(jessica).toContain('Farming Trainer');
    expect(npcServices(NPCS.smith_haldren, w).map((s) => s.label)).toContain('Hobby Trainer');
  });
});

describe('profession trainer pages', () => {
  const w = tools();

  it('lists every recipe the Training window shows for Tinker Gizzel, with its skill step and fee', () => {
    const section = npcTrainingSection('tinker_gizzel', w);
    const rows = buildTrainView('tinker_gizzel', {
      stations: STATIONS,
      knownRecipes: [],
      craftSkills: {},
      copper: 0,
      items: ITEMS,
    }).rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(section).toContain('== Training ==');
    expect(section).toContain('[[Engineering|Engineering]]');
    expect(section.match(/^\* /gm)).toHaveLength(rows.length);
    expect(section).toMatch(/· Learn at skill 0 · Free$/m);
    expect(section).toMatch(/· Learn at skill 25 · Fee 2500 copper$/m);
  });

  it('gives every station master a Training section and nobody else one', () => {
    for (const station of STATIONS)
      expect(npcTrainingSection(station.masterNpcId, w), station.masterNpcId).toContain(
        '== Training ==',
      );
    expect(npcTrainingSection('farmer_jessica', w)).toBe('');
    expect(npcTrainingSection('bursar_fernando', w)).toBe('');
  });

  it('puts the Service row, what they do and the training list on the NPC article', () => {
    const page = npcArticle(NPCS.tinker_gizzel, w);
    expect(page).toContain('Service: Engineering Trainer');
    expect(page).toContain('== What they do ==');
    expect(page).toContain('== Training ==');
    const emissary = npcArticle(flagged('weeklyEmissary')[0], w);
    expect(emissary).toContain('Service: Weekly quests');
    expect(emissary).toContain('== What they do ==');
  });
});
