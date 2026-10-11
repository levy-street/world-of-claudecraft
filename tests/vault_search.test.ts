// The Materials Vault name search core (src/ui/vault_search.ts): the pure
// filter the vault pane narrows its rows with. Pinned against the displayed
// name via the injected resolver, not the item id, so it agrees with the
// label the player reads (the bank_filter.ts precedent).
import { describe, expect, it } from 'vitest';
import { filterVaultRows, vaultSearchTerm } from '../src/ui/vault_search';

interface Row {
  itemId: string;
  kind: 'pooled' | 'special';
}

const rows: readonly Row[] = [
  { itemId: 'copper_ore', kind: 'pooled' },
  { itemId: 'osmium_ore', kind: 'pooled' },
  { itemId: 'osmium_ore', kind: 'special' },
  { itemId: 'frost_lotus', kind: 'pooled' },
  { itemId: 'not_a_real_id', kind: 'pooled' },
];

const NAMES: Record<string, string> = {
  copper_ore: 'Copper Ore',
  osmium_ore: 'Osmium Ore',
  frost_lotus: 'Frost Lotus',
};
const nameOf = (row: Row): string => NAMES[row.itemId] ?? row.itemId;

describe('vaultSearchTerm', () => {
  it('trims and lowercases; whitespace-only is no search at all', () => {
    expect(vaultSearchTerm('  OsMiUm ')).toBe('osmium');
    expect(vaultSearchTerm('   ')).toBe('');
    expect(vaultSearchTerm('')).toBe('');
  });
});

describe('filterVaultRows', () => {
  it('an empty or blank query returns EVERY row, in order, as a new array', () => {
    for (const query of ['', '   ']) {
      const out = filterVaultRows(rows, query, nameOf);
      expect(out).toEqual(rows);
      expect(out).not.toBe(rows);
    }
  });

  it('matches the DISPLAYED name, case-insensitively, as a substring', () => {
    expect(filterVaultRows(rows, 'osm', nameOf).map((r) => r.itemId)).toEqual([
      'osmium_ore',
      'osmium_ore',
    ]);
    expect(filterVaultRows(rows, 'ORE', nameOf).map((r) => `${r.itemId}:${r.kind}`)).toEqual([
      'copper_ore:pooled',
      'osmium_ore:pooled',
      'osmium_ore:special',
    ]);
  });

  it('keeps both a pooled and a special row of one material (the rows are distinct actions)', () => {
    const out = filterVaultRows(rows, 'osmium ore', nameOf);
    expect(out.map((r) => r.kind)).toEqual(['pooled', 'special']);
  });

  it('a dormant unknown id is searched under the raw id its label paints', () => {
    expect(filterVaultRows(rows, 'real_id', nameOf).map((r) => r.itemId)).toEqual([
      'not_a_real_id',
    ]);
  });

  it('never matches on the item id when the displayed name differs', () => {
    // 'frost_lotus' contains "lotus" in both, so use a fragment only the id has.
    expect(filterVaultRows(rows, 'frost_', nameOf)).toEqual([]);
  });

  it('no match yields an empty array and leaves the input untouched', () => {
    const before = rows.map((r) => ({ ...r }));
    expect(filterVaultRows(rows, 'zzz', nameOf)).toEqual([]);
    expect(rows).toEqual(before);
  });
});
