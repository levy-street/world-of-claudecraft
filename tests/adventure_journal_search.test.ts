// The Adventure Journal's boss search (src/ui/hud/journal/journal_search_view.ts,
// the pure matcher, and journal_search_html.ts, its page list): accent- and
// case-insensitive matching on the names the player reads, the best match
// first, a council found by either member, an instance name finding every
// page of it, the localized names of the current language, and the arrow keys
// walking the results.
import { afterEach, describe, expect, it } from 'vitest';
import { HEAT_GUARDIAN } from '../src/sim/encounters/smith_heart/heat_ids';
import { tEntity } from '../src/ui/entity_i18n';
import { JOURNAL_INSTANCES, journalInstance } from '../src/ui/hud/journal/journal_catalog';
import { journalSearchPages } from '../src/ui/hud/journal/journal_search_html';
import {
  foldJournalSearch,
  type JournalSearchPage,
  journalSearch,
  journalSearchCursor,
} from '../src/ui/hud/journal/journal_search_view';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';

const page = (
  bossKey: string,
  name: string,
  instanceName: string,
  aliases: string[] = [],
): JournalSearchPage => ({
  instanceId: instanceName.toLowerCase().replace(/\W+/g, '_'),
  bossKey,
  name,
  aliases,
  instanceName,
  portraitUrl: `/p/${bossKey}.webp`,
});

const PAGES: JournalSearchPage[] = [
  page('tusker', 'Sledge Tusker', 'Gravewyrm Sanctum'),
  page('velkhar', 'Grand Necromancer Velkhar', 'Gravewyrm Sanctum'),
  page('korzul', 'Korzul the Gravewyrm', 'Gravewyrm Sanctum'),
  page('council', 'The Hammer Council', "The Smith's Heart", ['Hrothmar', 'Velmira']),
  page('heat', 'Ignazhar, the Unquenchable', "The Smith's Heart"),
  page('aurora', 'Auróra, the Silent Winter', "The Smith's Heart"),
];

const keys = (results: { bossKey: string }[]) => results.map((r) => r.bossKey);

afterEach(() => setLanguage('en'));

describe('journal search matching', () => {
  it('folds case, accents and spacing both ways', () => {
    expect(foldJournalSearch('  AuRÓra,   the  ')).toBe('aurora, the');
    expect(keys(journalSearch(PAGES, 'aurora'))).toEqual(['aurora']);
    expect(keys(journalSearch(PAGES, 'AURÓRA'))).toEqual(['aurora']);
    expect(keys(journalSearch(PAGES, 'ignázhar'))).toEqual(['heat']);
    expect(keys(journalSearch(PAGES, 'IGNAZ'))).toEqual(['heat']);
    // Locale-free folding: a capital I is a plain i on every host.
    expect(foldJournalSearch('IGNAZHAR')).toBe('ignazhar');
  });

  it('finds nothing for an empty or blank query, or an unknown name', () => {
    expect(journalSearch(PAGES, '')).toEqual([]);
    expect(journalSearch(PAGES, '   ')).toEqual([]);
    expect(journalSearch(PAGES, 'zzqx')).toEqual([]);
  });

  it('puts a name that starts with the query first, then a word start, then a substring', () => {
    // "gr": Grand Necromancer starts with it; Korzul the Gravewyrm has a word
    // starting with it; nothing else contains it in its own name, and the
    // Sanctum's other page (Sledge Tusker) matches through its instance only.
    const results = journalSearch(PAGES, 'gr');
    expect(keys(results)).toEqual(['velkhar', 'korzul', 'tusker']);
    expect(results.map((r) => r.rank)).toEqual([0, 1, 3]);
    // A plain substring (inside a word) ranks below a word start.
    expect(journalSearch(PAGES, 'zhar').map((r) => r.rank)).toEqual([2]);
  });

  it('finds a council by its title or by either member', () => {
    expect(keys(journalSearch(PAGES, 'hammer'))).toEqual(['council']);
    expect(keys(journalSearch(PAGES, 'velmira'))).toEqual(['council']);
    expect(keys(journalSearch(PAGES, 'hroth'))).toEqual(['council']);
  });

  it("lists every page of an instance by the instance's name, in list order", () => {
    expect(keys(journalSearch(PAGES, 'smith'))).toEqual(['council', 'heat', 'aurora']);
    expect(journalSearch(PAGES, 'smith').every((r) => r.rank === 3)).toBe(true);
  });

  it('keeps the list order between equal matches and honours a limit', () => {
    expect(keys(journalSearch(PAGES, 'the'))).toEqual(['council', 'korzul', 'heat', 'aurora']);
    expect(journalSearch(PAGES, 'the', 2)).toHaveLength(2);
  });
});

describe('journal search cursor', () => {
  it('walks the results with Up and Down, wrapping at both ends', () => {
    expect(journalSearchCursor(-1, 'ArrowDown', 3)).toBe(0);
    expect(journalSearchCursor(0, 'ArrowDown', 3)).toBe(1);
    expect(journalSearchCursor(2, 'ArrowDown', 3)).toBe(0);
    expect(journalSearchCursor(-1, 'ArrowUp', 3)).toBe(2);
    expect(journalSearchCursor(0, 'ArrowUp', 3)).toBe(2);
    expect(journalSearchCursor(2, 'ArrowUp', 3)).toBe(1);
  });

  it('leaves every other key (Home and End are the caret keys) and an empty list alone', () => {
    expect(journalSearchCursor(1, 'Home', 3)).toBeNull();
    expect(journalSearchCursor(1, 'End', 3)).toBeNull();
    expect(journalSearchCursor(1, 'a', 3)).toBeNull();
    expect(journalSearchCursor(-1, 'ArrowDown', 0)).toBeNull();
  });
});

describe('journal search pages', () => {
  it('lists every page of the instances it is given, with portrait and instance name', () => {
    const pages = journalSearchPages(JOURNAL_INSTANCES);
    const total = JOURNAL_INSTANCES.reduce((n, i) => n + i.source.bossKeys.length, 0);
    expect(pages).toHaveLength(total);
    for (const entry of pages) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.instanceName.length).toBeGreaterThan(0);
      expect(entry.portraitUrl.length).toBeGreaterThan(0);
    }
    const heart = journalInstance('smith_heart');
    expect(heart).not.toBeNull();
    const heat = pages.find(
      (entry) => entry.bossKey === HEAT_GUARDIAN || entry.name.startsWith('Ignazhar'),
    );
    expect(heat?.instanceName).toBe("The Smith's Heart");
    expect(keys(journalSearch(pages, 'ignaz'))).toContain(heat?.bossKey);
  });

  it('matches the localized names of the current language', async () => {
    await ensureLocaleLoaded('ru_RU');
    setLanguage('ru_RU');
    const pages = journalSearchPages(JOURNAL_INSTANCES);
    const localized = tEntity({ kind: 'dungeon', id: 'gravewyrm_sanctum', field: 'name' });
    // The test is only meaningful where the locale really renames it.
    expect(localized).not.toBe('Gravewyrm Sanctum');
    const hits = journalSearch(pages, localized.toLocaleUpperCase());
    expect(hits.length).toBe(journalInstance('gravewyrm_sanctum')?.source.bossKeys.length);
    expect(journalSearch(pages, 'Gravewyrm Sanctum')).toEqual([]);
  });
});
