import { describe, expect, it } from 'vitest';
import type { ArticleTools } from '../scripts/mediawiki/entity_format';
import { itemAcquisitionIndex } from '../scripts/mediawiki/item_acquisition';
import { CLASSES, ITEMS, MOBS } from '../src/sim/data';

const w: ArticleTools = {
  titleBy: {
    item: new Map(Object.entries(ITEMS).map(([id, x]) => [id, x.name])),
    class: new Map(Object.keys(CLASSES).map((id) => [id, id])),
    npc: new Map(),
    quest: new Map(),
    mob: new Map(Object.keys(MOBS).map((id) => [id, id])),
    ability: new Map(),
    zone: new Map(),
    dungeon: new Map(),
  },
  add() {},
  section: (name, body) => '== ' + name + ' ==\n' + body,
  table: (rows) => rows.map((r) => r.join(' ')).join('\n'),
  bullets: (rows) => rows.join('\n'),
  link: (title, label) => '[[' + title + (label ? '|' + label : '') + ']]',
  money: (c) => c + ' copper',
};

describe('complete item acquisition routes', () => {
  const entries = itemAcquisitionIndex(w);
  it('accounts for every item with a route or explicit availability information', () => {
    const missing = Object.keys(ITEMS).filter((id) => !entries.get(id)?.length);
    expect(missing).toEqual([]);
    for (const [id, ways] of entries)
      for (const way of ways) {
        expect(way.steps.length, id).toBeGreaterThan(0);
        for (const p of way.points ?? [])
          expect(Number.isFinite(p.x) && Number.isFinite(p.z), id).toBe(true);
      }
  });
  it('keeps quest rewards, world interactions and unavailable authored loot distinct', () => {
    expect(entries.get('wardens_oathband')?.some((s) => s.title.includes('Quest reward'))).toBe(
      true,
    );
    expect(
      entries
        .get('hollow_sealstone')
        ?.some((s) => s.details?.some((x) => x.includes('rather than placing the object'))),
    ).toBe(true);
    expect(entries.get('wardens_seal')?.some((s) => s.title.startsWith('Defeat'))).toBe(false);
    expect(
      entries
        .get('wardens_seal')
        ?.some((s) => s.details?.some((x) => x.includes('no collect objective'))),
    ).toBe(true);
  });
  it('explains the denominator of a shared loot roll', () => {
    const grouped = Object.values(MOBS).flatMap((m) =>
      m.loot.filter((e) => e.rollGroup && e.itemId).map((e) => e.itemId!),
    );
    const item = grouped.find((id) =>
      entries.get(id)?.some((s) => s.details?.some((x) => x.includes('sum of retained chances'))),
    );
    expect(item).toBeDefined();
  });
  it('locates relic guardians and includes fixed world-quest item rewards', () => {
    for (const id of ['captains_crest', 'priests_sigil', 'royal_seal']) {
      const paths = entries.get(id)!;
      expect(
        paths.some((p) =>
          p.points?.some((point) => point.frame !== 'Overworld' && point.label.includes('summon')),
        ),
        id,
      ).toBe(true);
    }
    expect(
      entries.get('rift_essence')?.filter((p) => p.title.startsWith('Complete the world quest')),
    ).toHaveLength(2);
  });
});
