import { describe, expect, it } from 'vitest';
import { revealOrder, topRarity, aggregateCollection, Rarity } from '../src/ui/pack_reveal_core';

describe('revealOrder', () => {
  it('orders lowest rarity first, stable for ties, without mutating the input', () => {
    const items = [
      { rarity: 'rare' as Rarity, id: 'a' },
      { rarity: 'common' as Rarity, id: 'b' },
      { rarity: 'epic' as Rarity, id: 'c' },
      { rarity: 'common' as Rarity, id: 'd' },
    ];
    const ordered = revealOrder(items);
    expect(ordered.map((x) => x.id)).toEqual(['b', 'd', 'a', 'c']); // common(b,d stable) -> rare -> epic
    expect(items.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']); // input untouched
  });

  it('handles an empty rip', () => {
    expect(revealOrder([])).toEqual([]);
  });
});

describe('topRarity', () => {
  it('returns the best rarity in the rip, or null when empty', () => {
    expect(topRarity([{ rarity: 'common' }, { rarity: 'rare' }, { rarity: 'uncommon' }])).toBe('rare');
    expect(topRarity([{ rarity: 'legendary' }, { rarity: 'epic' }])).toBe('legendary');
    expect(topRarity([])).toBeNull();
  });
});

describe('aggregateCollection', () => {
  it('counts duplicates and sorts best-rarity first then by ref', () => {
    const entries = aggregateCollection([
      { ref: 'worn_sword', rarity: 'common' },
      { ref: 'worn_sword', rarity: 'common' },
      { ref: 'boundstone_helm', rarity: 'rare' },
      { ref: 'aug_brutality', rarity: 'uncommon' },
      { ref: 'worn_sword', rarity: 'common' },
    ]);
    expect(entries).toEqual([
      { ref: 'boundstone_helm', rarity: 'rare', count: 1 },
      { ref: 'aug_brutality', rarity: 'uncommon', count: 1 },
      { ref: 'worn_sword', rarity: 'common', count: 3 },
    ]);
  });

  it('is empty for no pulls', () => {
    expect(aggregateCollection([])).toEqual([]);
  });
});
