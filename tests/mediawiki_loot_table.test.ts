import { describe, expect, it } from 'vitest';
import { type LootRow, lootTables } from '../scripts/mediawiki/loot_table';

const row = (drop: string, chance: number, extra: Partial<LootRow> = {}): LootRow => ({
  drop,
  quality: 'Rare',
  chance,
  notes: [],
  difficulty: 'Any',
  ...extra,
});

describe('creature loot tables', () => {
  it('lists separate rolls first, highest chance on top, with difficulty in the notes', () => {
    const text = lootTables([
      row('[[Hide]]', 0.3),
      row('Coins', 1, { quality: 'Coins' }),
      row('[[Mask]]', 0.02, {
        difficulty: 'Heroic',
        notes: ['Only if you do not already have it'],
      }),
    ]);
    expect(text).toContain('=== Separate rolls ===');
    expect(text).toContain('! Drop !! Quality !! Chance !! Notes');
    const rows = text.split('\n').filter((l) => l.startsWith('| '));
    expect(rows).toEqual([
      '| Coins || Coins || 100% || ',
      '| [[Hide]] || Rare || 30% || ',
      '| [[Mask]] || Rare || 2% || Heroic only. Only if you do not already have it.',
    ]);
  });
  it('gives each shared roll its own table with the combined chance', () => {
    const text = lootTables(
      [
        row('[[A]]', 0.0875, { pool: 'blue', difficulty: 'Normal' }),
        row('[[B]]', 0.0875, { pool: 'blue', difficulty: 'Normal' }),
        row('[[C]]', 0.19636364, { pool: 'gold', difficulty: 'Heroic' }),
      ],
      ['Some items share one roll.'],
      ['[[Pet]] companion.'],
    );
    expect(text.startsWith('Some items share one roll.')).toBe(true);
    expect(text).toContain('=== Shared roll 1 (Normal) ===');
    expect(text).toContain("At most '''one''' of these 2 items drops");
    expect(text).toContain("come to '''17.5%'''");
    expect(text).toContain('=== Shared roll 1 (Heroic) ===');
    expect(text).toContain('| [[C]] || Rare || 19.64% || ');
    expect(text).not.toContain('=== Separate rolls ===');
    expect(text.endsWith('* [[Pet]] companion.')).toBe(true);
  });
});
