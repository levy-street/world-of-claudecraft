// The UI-boundary translation of a Browse search
// (src/ui/market_search_localized_core.ts). The market filters server-side
// against ENGLISH names and ids, so a player searching in their own language
// found nothing; this decides what string to ask with instead.
//
// The contract these pin is soundness, not cleverness: the resolver may only
// substitute a search it has VERIFIED selects exactly the set the localized
// query names, and must otherwise hand back the typed text untouched. A wrong
// result set would be worse than the empty one it replaces.

import { describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { defaultMarketQuery, marketItemMatches } from '../src/sim/market_query';
import { localizedMarketSearch } from '../src/ui/market_search_localized_core';

/** A tiny fake catalog: English haystack plus a "localized" name per id. */
const CATALOG: Record<string, { english: string; localized: string }> = {
  iron_sword: { english: 'iron_sword Iron Sword', localized: 'Eisenschwert' },
  steel_sword: { english: 'steel_sword Steel Sword', localized: 'Stahlschwert' },
  oak_shield: { english: 'oak_shield Oak Shield', localized: 'Eichenschild' },
  healing_draught: { english: 'healing_draught Healing Draught', localized: 'Heiltrank' },
  marrowpoint: { english: 'marrowpoint Marrowpoint', localized: 'İlik Ucu' },
};
const IDS = Object.keys(CATALOG);

/** The English matcher's own rule, mirrored: name OR id contains the search. */
const englishMatches = (id: string, search: string): boolean =>
  CATALOG[id].english.toLowerCase().includes(search.toLowerCase());

function resolve(query: string, over: readonly string[] = IDS, localeTag = 'de-DE'): string {
  return localizedMarketSearch({
    query,
    localeTag,
    itemIds: over,
    localizedNameOf: (id) => CATALOG[id].localized,
    englishMatches,
    englishHaystackOf: (id) => CATALOG[id].english,
  });
}

/** The ids a given emitted search selects through the English matcher. */
function selects(search: string, over: readonly string[] = IDS): string[] {
  return over.filter((id) => englishMatches(id, search));
}

describe('localizedMarketSearch: an English search is never disturbed', () => {
  it('passes an English name substring through byte-identically', () => {
    expect(resolve('Sword')).toBe('Sword');
    expect(resolve('  Iron  ')).toBe('  Iron  ');
  });

  it('passes an item id through byte-identically', () => {
    expect(resolve('oak_shield')).toBe('oak_shield');
  });

  it('passes an empty or whitespace query through', () => {
    expect(resolve('')).toBe('');
    expect(resolve('   ')).toBe('   ');
  });

  it('does not even consult the localized catalog when English already matches', () => {
    const localizedNameOf = vi.fn((id: string) => CATALOG[id].localized);
    localizedMarketSearch({
      query: 'IRON',
      localeTag: 'tr-TR',
      itemIds: IDS,
      localizedNameOf,
      englishMatches,
      englishHaystackOf: (id) => CATALOG[id].english,
    });
    expect(localizedNameOf).not.toHaveBeenCalled();
  });
});

describe('localizedMarketSearch: a localized query resolves to a verified English one', () => {
  it('names a single localized match by its id', () => {
    const sent = resolve('Eichenschild');
    expect(sent).toBe('oak_shield');
    expect(selects(sent)).toEqual(['oak_shield']);
  });

  it('is case-insensitive and trims, like the box the player types into', () => {
    expect(resolve('  EICHENSCHILD ')).toBe('oak_shield');
  });

  it('folds Turkish dotted I with the active locale', () => {
    expect('İlik Ucu'.toLowerCase()).not.toContain('ilik');
    expect(resolve('ilik', ['marrowpoint'], 'tr-TR')).toBe('marrowpoint');
  });

  it('names a localized FAMILY by the English word its members share', () => {
    // "schwert" names both swords; their English haystacks share "sword", and
    // that word selects exactly those two, so it verifies and is sent.
    const sent = resolve('schwert');
    expect(sent).toBe('sword');
    expect(selects(sent).sort()).toEqual(['iron_sword', 'steel_sword']);
  });

  it('matches a localized SUBSTRING, not only a whole name', () => {
    expect(resolve('Eisen')).toBe('iron_sword');
  });
});

describe('localizedMarketSearch: it refuses rather than sending a wrong set', () => {
  it('hands back the typed text when nothing matches in either language', () => {
    expect(resolve('Zauberstab')).toBe('Zauberstab');
  });

  it('refuses a shared word that would select MORE than the localized set', () => {
    // A third item whose English name also carries "sword" but whose localized
    // name does not carry "schwert": the candidate word now over-selects, so it
    // must be rejected and the typed text sent instead.
    const ids = [...IDS, 'ritual_sword'];
    const withExtra: typeof CATALOG = {
      ...CATALOG,
      ritual_sword: { english: 'ritual_sword Ritual Sword', localized: 'Ritualklinge' },
    };
    const sent = localizedMarketSearch({
      query: 'schwert',
      localeTag: 'de-DE',
      itemIds: ids,
      localizedNameOf: (id) => withExtra[id].localized,
      englishMatches: (id, search) =>
        withExtra[id].english.toLowerCase().includes(search.toLowerCase()),
      englishHaystackOf: (id) => withExtra[id].english,
    });
    // "sword" would have selected three items for a query naming two.
    expect(sent).toBe('schwert');
  });

  it('refuses a family whose members share no English word at all', () => {
    // Two localized names sharing a fragment whose items share nothing in
    // English: not expressible in one search string, so the old empty result
    // stands rather than a guess.
    const withPair: typeof CATALOG = {
      ...CATALOG,
      moon_ring: { english: 'moon_ring Moon Ring', localized: 'Mondreif' },
      sun_cloak: { english: 'sun_cloak Sun Cloak', localized: 'Mondmantel' },
    };
    const ids = [...IDS, 'moon_ring', 'sun_cloak'];
    const sent = localizedMarketSearch({
      query: 'mond',
      localeTag: 'de-DE',
      itemIds: ids,
      localizedNameOf: (id) => withPair[id].localized,
      englishMatches: (id, search) =>
        withPair[id].english.toLowerCase().includes(search.toLowerCase()),
      englishHaystackOf: (id) => withPair[id].english,
    });
    expect(sent).toBe('mond');
  });
});

describe('localizedMarketSearch against the REAL matcher and catalog', () => {
  // The verification arm runs the authority's own predicate, so this drives the
  // real one over the real merged table rather than the mirror above.
  const realIds = Object.keys(ITEMS);
  const realMatches = (id: string, search: string): boolean =>
    marketItemMatches(id, { ...defaultMarketQuery(), search });

  function resolveReal(query: string, localizedNameOf: (id: string) => string): string {
    return localizedMarketSearch({
      query,
      localeTag: 'en-US',
      itemIds: realIds,
      localizedNameOf,
      englishMatches: realMatches,
      englishHaystackOf: (id) => `${id} ${ITEMS[id]?.name ?? ''}`,
    });
  }

  it('an English query over the live catalog is passed through untouched', () => {
    // English (the default locale) means localizedNameOf IS the def name, so
    // rule 1 fires and nothing is translated. This is the arm that guarantees
    // an English-speaking player sees zero change.
    const nameOf = (id: string) => ITEMS[id]?.name ?? id;
    for (const query of ['sword', 'potion', 'Iron']) {
      expect(resolveReal(query, nameOf)).toBe(query);
    }
  });

  it('a pseudo-localized single item resolves to an id the REAL matcher accepts', () => {
    // Rename exactly one live item and search the new name: the emitted search
    // must be accepted by the authority for that item and no other.
    const target = realIds[0];
    const nameOf = (id: string) => (id === target ? 'Zzzunique Marker' : `xx-${id}`);
    const sent = resolveReal('zzzunique', nameOf);
    expect(sent).toBe(target.toLowerCase());
    expect(realIds.filter((id) => realMatches(id, sent))).toEqual([target]);
  });
});
