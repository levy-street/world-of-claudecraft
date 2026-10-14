// The asset browser's pure decisions: multi-term search with synonyms,
// subcategory grouping, favourites/recents list transforms.

import { describe, expect, it } from 'vitest';
import { ASSET_CATALOG } from '../src/editor/asset_catalog.generated';
import {
  filterAssets,
  matchesAssetQuery,
  parseStoredIds,
  pushRecent,
  RECENTS_CAP,
  subcategoriesOf,
  toggleFavourite,
} from '../src/editor/asset_search_core';

const asset = (id: string, label: string, subcategory?: string) => ({
  id,
  label,
  category: id.split('/')[0],
  path: `/models/${id}.glb`,
  subcategory,
});

describe('matchesAssetQuery', () => {
  const barrel = asset('medieval_village_v2/props/Barrel_01', 'Barrel 01', 'props');

  it('empty query matches everything', () => {
    expect(matchesAssetQuery(barrel, '')).toBe(true);
    expect(matchesAssetQuery(barrel, '   ')).toBe(true);
  });

  it('is case-insensitive across id, label, category, subcategory and path', () => {
    expect(matchesAssetQuery(barrel, 'BARREL')).toBe(true);
    expect(matchesAssetQuery(barrel, 'medieval')).toBe(true); // id/path
    expect(matchesAssetQuery(barrel, 'props')).toBe(true); // subcategory
    expect(matchesAssetQuery(barrel, 'glb')).toBe(true); // path
  });

  it('ANDs every term', () => {
    expect(matchesAssetQuery(barrel, 'village barrel')).toBe(true);
    expect(matchesAssetQuery(barrel, 'village anvil')).toBe(false);
  });

  it('reaches through the synonym map', () => {
    // "crate" -> box/container; a barrel is neither.
    expect(matchesAssetQuery(asset('dungeon/box_1', 'Box 1'), 'crate')).toBe(true);
    expect(matchesAssetQuery(barrel, 'crate')).toBe(false);
    // "house" finds buildings.
    expect(
      matchesAssetQuery(
        asset('medieval_village_v2/buildings/TownHall', 'Town Hall', 'buildings'),
        'house',
      ),
    ).toBe(true);
  });

  it('filters the real catalogue without throwing and finds the village pack', () => {
    const hits = filterAssets(ASSET_CATALOG, 'village building');
    expect(hits.length).toBeGreaterThan(50);
    expect(hits.every((h) => h.id.startsWith('medieval_village_v2/'))).toBe(true);
  });
});

describe('subcategoriesOf', () => {
  it('groups the village pack into its real subfolders', () => {
    const subs = subcategoriesOf(ASSET_CATALOG, 'medieval_village_v2');
    const byId = new Map(subs.map((s) => [s.id, s.count]));
    expect(byId.get('buildings')).toBe(98);
    expect(byId.get('props')).toBe(199);
    expect(byId.get('nature')).toBe(33);
    expect(byId.get('environment')).toBe(19);
  });

  it('gives the flat dungeon pack naming families', () => {
    const subs = subcategoriesOf(ASSET_CATALOG, 'dungeon');
    expect(subs.length).toBeGreaterThan(3);
    const total = subs.reduce((s, x) => s + x.count, 0);
    expect(total).toBe(ASSET_CATALOG.filter((a) => a.category === 'dungeon').length);
  });

  it('leaves small undivided categories chipless', () => {
    expect(subcategoriesOf(ASSET_CATALOG, 'weapons')).toEqual([]);
  });
});

describe('favourites and recents', () => {
  it('toggleFavourite adds then removes', () => {
    const one = toggleFavourite([], 'a');
    expect(one).toEqual(['a']);
    expect(toggleFavourite(one, 'b')).toEqual(['a', 'b']);
    expect(toggleFavourite(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('pushRecent dedupes to the front and caps', () => {
    expect(pushRecent(['b', 'a'], 'a')).toEqual(['a', 'b']);
    let list: string[] = [];
    for (let i = 0; i < RECENTS_CAP + 10; i++) list = pushRecent(list, `id${i}`);
    expect(list).toHaveLength(RECENTS_CAP);
    expect(list[0]).toBe(`id${RECENTS_CAP + 9}`);
  });

  it('parseStoredIds tolerates junk', () => {
    expect(parseStoredIds(null)).toEqual([]);
    expect(parseStoredIds('not json')).toEqual([]);
    expect(parseStoredIds('{"a":1}')).toEqual([]);
    expect(parseStoredIds('["a", 3, "b"]')).toEqual(['a', 'b']);
  });
});
