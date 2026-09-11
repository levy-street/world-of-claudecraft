import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { itemDisplayName } from '../src/ui/entity_i18n';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { marketItemMatches, defaultMarketQuery } from '../src/ui/market_filters';
import { resolveMarketSearchTerm } from '../src/ui/market_search_core';

const allItemIds = Object.keys(ITEMS);
const en = (id: string) => ITEMS[id]?.name ?? '';
const localizedNameOf = (id: string) => itemDisplayName(ITEMS[id]);
const englishMatches = (id: string, search: string) =>
  marketItemMatches(id, { ...defaultMarketQuery(), search });
const englishHaystackOf = (id: string) => `${id} ${en(id)}`;

describe('market_search_core: pure resolver contract', () => {
  it('empty query returns empty string', () => {
    const input = {
      query: '',
      localeTag: 'en',
      itemIds: allItemIds,
      localizedNameOf,
      englishMatches,
      englishHaystackOf,
    };
    expect(resolveMarketSearchTerm(input)).toBe('');
  });

  it('exact English/id match passes through unchanged (Rule 1)', () => {
    const input = {
      query: 'worn_sword',
      localeTag: 'en',
      itemIds: allItemIds,
      localizedNameOf,
      englishMatches,
      englishHaystackOf,
    };
    expect(resolveMarketSearchTerm(input)).toBe('worn_sword');
  });

  it('localized exact match resolves to the English id (Rule 2)', async () => {
    await ensureLocaleLoaded('tr_TR');
    setLanguage('tr_TR');
    try {
      const trName = localizedNameOf('marrowpoint'); // 'İlik Ucu'
      const input = {
        query: trName,
        localeTag: 'tr_TR',
        itemIds: allItemIds,
        localizedNameOf,
        englishMatches,
        englishHaystackOf,
      };
      expect(resolveMarketSearchTerm(input)).toBe('marrowpoint');
    } finally {
      setLanguage('en');
    }
  });

  it('unmatched localized query falls through to original text (Rule 4)', async () => {
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    try {
      const jaName = localizedNameOf('worn_sword'); // Japanese name
      setLanguage('en');
      const input = {
        query: jaName,
        localeTag: 'en',
        itemIds: allItemIds,
        localizedNameOf,
        englishMatches,
        englishHaystackOf,
      };
      expect(resolveMarketSearchTerm(input)).toBe(jaName);
    } finally {
      setLanguage('en');
    }
  });

  it('same query under different locales can resolve differently (locale-aware case folding)', async () => {
    await ensureLocaleLoaded('tr_TR');
    setLanguage('tr_TR');
    try {
      const trInput = {
        query: 'ilik ucu', // typed lowercase
        localeTag: 'tr_TR',
        itemIds: allItemIds,
        localizedNameOf,
        englishMatches,
        englishHaystackOf,
      };
      const trResult = resolveMarketSearchTerm(trInput);
      expect(trResult).toBe('marrowpoint');
    } finally {
      setLanguage('en');
    }
  });
});