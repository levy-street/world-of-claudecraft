import { describe, expect, it } from 'vitest';
import {
  dropSourceTable,
  HEROIC_TAB,
  type LootRow,
  lootTables,
  NORMAL_TAB,
} from '../scripts/mediawiki/loot_table';

const row = (drop: string, chance: number, extra: Partial<LootRow> = {}): LootRow => ({
  drop,
  quality: 'Rare',
  chance,
  notes: [],
  difficulty: 'Any',
  ...extra,
});
const cells = (text: string) => text.split('\n').filter((l) => l.startsWith('| '));

describe('creature loot tables', () => {
  it('lists an open-world creature in one view, highest chance on top', () => {
    const text = lootTables([
      row('[[Hide]]', 0.3, { notes: ['Only while you need it for [[Quest]]'] }),
      row('Coins', 1, { quality: 'Coins' }),
    ]);
    expect(text).not.toContain(NORMAL_TAB);
    expect(text).toContain("'''Separate rolls'''");
    expect(text).toContain('! Drop !! Quality !! Chance !! Notes');
    expect(cells(text)).toEqual([
      '| Coins || Coins || 100% || ',
      '| [[Hide]] || Rare || 30% || Only while you need it for [[Quest]].',
    ]);
  });
  it('splits a dungeon creature into a Normal view and a Heroic view', () => {
    const text = lootTables(
      [
        row('8 copper', 1, { quality: 'Coins', heroicDrop: '20 copper' }),
        row('[[A]]', 0.0875, { pool: 'blue', heroicDrop: '[[A (2)|A]]' }),
        row('[[B]]', 0.0875, { pool: 'blue', difficulty: 'Normal' }),
        row('[[C]]', 0.19636364, { pool: 'gold', difficulty: 'Heroic' }),
      ],
      ['Some items share one roll.'],
      ['[[Pet]] companion.'],
    );
    expect(text.startsWith('Some items share one roll.')).toBe(true);
    expect(text).toContain('=== ' + NORMAL_TAB + ' ===');
    expect(text).toContain('=== ' + HEROIC_TAB + ' ===');
    const [, normal, heroic] = text.split(/=== (?:Normal|Heroic) loot ===\n/);
    // Normal: its own coins, both blue items, no Heroic-only item.
    expect(cells(normal)).toEqual([
      '| 8 copper || Coins || 100% || ',
      '| [[A]] || Rare || 8.75% || ',
      '| [[B]] || Rare || 8.75% || ',
    ]);
    expect(normal).toContain("come to '''17.5%'''");
    // Heroic: upgraded coins and item, the Heroic-only pool, no Normal-only item.
    expect(cells(heroic)).toEqual([
      '| 20 copper || Coins || 100% || ',
      '| [[A (2)|A]] || Rare || 8.75% || ',
      '| [[C]] || Rare || 19.64% || ',
    ]);
    expect(heroic).toContain("'''Shared roll 2'''");
    expect(text.endsWith('* [[Pet]] companion.')).toBe(true);
  });
  it('lists the creatures that drop an item, most likely first', () => {
    const text = dropSourceTable([
      { creature: '[[Wolf]]', where: 'Open world', chance: 0.02, notes: [] },
      {
        creature: '[[Boss]]',
        where: 'Heroic only',
        chance: 0.1,
        notes: ['Shares one roll with 3 other items'],
      },
    ]);
    expect(text).toContain('! Dropped by !! Where !! Chance !! Notes');
    expect(cells(text)).toEqual([
      '| [[Boss]] || Heroic only || 10% || Shares one roll with 3 other items.',
      '| [[Wolf]] || Open world || 2% || ',
    ]);
  });
});
