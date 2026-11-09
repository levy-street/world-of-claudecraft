import { describe, expect, it } from 'vitest';
import { addSystemArticles } from '../scripts/mediawiki/system_articles';
import { DEEDS } from '../src/sim/content/deeds';
import { BUILTIN_WORLD, ITEMS, QUESTS } from '../src/sim/data';
import { POI_VISIT_RADIUS, ZONE_FISH } from '../src/sim/deeds';

const pages = new Map<string, string>();
const occupied = new Set(['Wayfarer of the Vale (Deed)']);
const questTitles = new Map(Object.entries(QUESTS).map(([id, q]) => [id, q.name]));
questTitles.set('q_wolves', 'Wolves at the Door (2)');
addSystemArticles({
  add: (title, text) => {
    pages.set(title, text);
  },
  unique(base) {
    let title = base;
    for (let i = 2; occupied.has(title); i++) title = base + ' (' + i + ')';
    occupied.add(title);
    return title;
  },
  titleBy: {
    quest: questTitles,
    item: new Map(Object.entries(ITEMS).map(([id, d]) => [id, d.name])),
    mob: new Map(),
    npc: new Map(),
    zone: new Map(),
    dungeon: new Map(),
  },
});
describe('deed requirements in the player encyclopedia', () => {
  it('explains the full Chapter I checklist on its page, including the unmapped landmark and forward references', () => {
    const article = pages.get('Vale Chronicle, Chapter I (Deed)')!;
    expect(
      article.startsWith('Earn 3 other deeds and turn in 4 quests on the same character.'),
    ).toBe(true);
    expect(article).toContain('== How to earn ==');
    expect(article).toContain('=== [[Wayfarer of the Vale (Deed) (2)|Wayfarer of the Vale]] ===');
    expect(article).toContain('=== Quests to turn in ===');
    expect(article).toContain('[[Living off the Land (Deed)|Living off the Land]]');
    expect(article).toContain('[[Something in Mirror Lake (Deed)|Something in Mirror Lake]]');
    const zone = BUILTIN_WORLD.zones.find((z) => z.id === 'eastbrook_vale')!;
    const visited = DEEDS.exp_vale_wayfarer.trigger;
    if (visited.kind !== 'visits') throw Error('Wayfarer trigger changed');
    for (const mark of visited.markIds) {
      const poi = zone.pois.find((p) => p.id === mark.split(':')[2])!;
      expect(article).toContain(
        'within ' + POI_VISIT_RADIUS + ' yd of ' + poi.label + ' at (' + poi.x + ', ' + poi.z + ')',
      );
    }
    expect(article).toContain('This landmark has no map label.');
    for (const node of ['ore vein', 'wood stand', 'herb patch'])
      expect(article).toContain('Harvest one ' + node + ' in Eastbrook Vale');
    for (const id of ZONE_FISH.eastbrook_vale)
      expect(article).toContain('[[' + ITEMS[id].name + ']]');
    expect(article).toContain('[[Wolves at the Door (2)|Wolves at the Door]]');
    for (const id of ['q_boars', 'q_spiders', 'q_greyjaw'])
      expect(article).toContain('[[' + QUESTS[id].name + ']]');
    expect(article).toContain('Gives 5 Renown.');
  });
  it('publishes the earned condition on every public deed while retaining hidden deed visibility', () => {
    const deeds = [...pages].filter(([title]) => title.includes('(Deed)'));
    expect(deeds).toHaveLength(Object.values(DEEDS).filter((deed) => !deed.hidden).length);
    const archived = deeds.filter(([, body]) => body.startsWith("'''Retired deed.'''"));
    expect(archived).toHaveLength(18);
    for (const [, body] of deeds) {
      if (body.startsWith("'''Retired deed.'''")) {
        expect(body).toContain('Nobody can earn it now.');
        expect(body).toContain('== Original requirement ==');
      } else {
        expect(body).toContain('== How to earn ==');
      }
    }
  });
});
