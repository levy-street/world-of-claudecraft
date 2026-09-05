import { describe, expect, it } from 'vitest';
import { CRUCIBLE_COLLECTIONS, CRUCIBLE_COLLECTION_ITEMS } from '../src/sim/content/crucible_collections';
import { RELIQUARY_PAGES, RELIQUARY_PAGES_BY_ID, reliquaryRelicSource } from '../src/sim/content/reliquary';

describe('Crucible crafted Reliquary page', () => {
  it('appends only the thirty-three crafted relics with their actual profession sources', () => {
    const page = RELIQUARY_PAGES_BY_ID.professions_crucible;
    expect(page).toBeDefined();
    expect(RELIQUARY_PAGES.at(-1)?.id).toBe('professions_crucible');
    expect(page.shelf).toBe('professions');
    expect(page.clearSource).toEqual({ kind: 'none' });
    expect(page.relics).toHaveLength(33);
    expect(page.relics.map((row) => row.kind === 'item' ? row.itemId : '').sort()).toEqual(Object.keys(CRUCIBLE_COLLECTION_ITEMS).sort());
    for (const collection of CRUCIBLE_COLLECTIONS) {
      for (const id of collection.itemIds) {
        const relic = page.relics.find((row) => row.kind === 'item' && row.itemId === id)!;
        expect(relic.kind).toBe('item');
        expect(reliquaryRelicSource(page, relic)).toEqual([{ sourceKind: 'profession', sourceId: collection.craftId }]);
      }
    }
  });
});
