// Tests for the home-page high-score board (src/ui/highscore_board.ts), extracted
// out of src/main.ts so its markup has a tested home (the news_feed.ts precedent).
//
// Covers what the board actually promises: the guild tag beside each ranked name
// (present, absent, and escaped), the column set it did NOT change, and the
// loading / empty / error / re-entrancy behavior of the thin loader.

import { describe, expect, it } from 'vitest';
import { classDisplayName } from '../src/ui/entity_i18n';
import {
  highscoreBoardHtml,
  highscoreEmptyHtml,
  highscoreErrorHtml,
  highscoreRowHtml,
  loadHighscoresInto,
} from '../src/ui/highscore_board';
import { setLanguage, t } from '../src/ui/i18n';
import type { LeaderboardEntry } from '../src/world_api';

setLanguage('en');

function entry(over: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    rank: 1,
    name: 'Zyzz',
    cls: 'warrior',
    level: 60,
    virtualLevel: 12,
    lifetimeXp: 5_000_000,
    prestigeRank: 0,
    title: null,
    realm: 'Claudemoon',
    ...over,
  };
}

/** A minimal innerHTML sink, so the loader needs no DOM implementation. */
function host(): HTMLElement & { innerHTML: string } {
  return { innerHTML: '' } as HTMLElement & { innerHTML: string };
}

describe('highscore_board: the guild tag beside each ranked name', () => {
  it('renders the guild next to the name, before the realm cell', () => {
    const html = highscoreRowHtml(entry({ guild: 'Monarchs' }));
    // The row reads name, guild, realm: the guild rides INSIDE the name cell, so
    // the grid keeps its six columns (see the .hs-row rules in shell.css).
    expect(html).toContain('<span class="hs-guild"');
    expect(html).toContain('&lt;Monarchs&gt;');
    expect(html.indexOf('Zyzz')).toBeLessThan(html.indexOf('Monarchs'));
    expect(html.indexOf('Monarchs')).toBeLessThan(html.indexOf('Claudemoon'));
    expect(html.indexOf('hs-guild')).toBeLessThan(html.indexOf('hs-realm'));
  });

  it('labels the tag from the catalog, never a hardcoded English word', () => {
    expect(highscoreRowHtml(entry({ guild: 'Monarchs' }))).toContain(
      `title="${t('hudChrome.leaderboard.guildName')}"`,
    );
  });

  it('renders no tag for an unguilded row (absent key or empty string)', () => {
    // Unguilded is the server OMITTING the key; the offline Sim's passive display
    // field can also arrive as ''. Neither may render an empty pair of brackets.
    for (const row of [entry(), entry({ guild: '' })]) {
      const html = highscoreRowHtml(row);
      expect(html).not.toContain('hs-guild');
      expect(html).not.toContain('&lt;&gt;');
    }
  });

  it('escapes a guild name carrying HTML so it cannot inject markup', () => {
    const html = highscoreRowHtml(entry({ guild: '<img src=x onerror=1>' }));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('keeps the guild tag independent of the prestige star', () => {
    const html = highscoreRowHtml(entry({ prestigeRank: 3, guild: 'Monarchs' }));
    expect(html).toContain('hs-prestige');
    expect(html).toContain('&lt;Monarchs&gt;');
  });
});

describe('highscore_board: the row/head shape the stylesheet depends on', () => {
  it('keeps every existing column cell, with the mobile data-label captions', () => {
    const html = highscoreRowHtml(entry({ guild: 'Monarchs' }));
    for (const cls of ['hs-rank', 'hs-name', 'hs-realm', 'hs-lvl', 'hs-vlvl', 'hs-xp']) {
      expect(html).toContain(`class="${cls}"`);
    }
    // The mobile stacked layout renders these as ::before captions.
    expect(html).toContain(`data-label="${t('game.leaderboard.realmCol')}"`);
    expect(html).toContain(`data-label="${t('game.leaderboard.lifetimeXp')}"`);
  });

  it('adds no guild COLUMN to the header (the tag lives in the name cell)', () => {
    const head = highscoreBoardHtml([]);
    expect(head).toContain('hs-head');
    expect(head).not.toContain('hs-guild');
  });

  it('flags the top three rows and titles the name with the localized class', () => {
    expect(highscoreRowHtml(entry({ rank: 3 }))).toContain('hs-row hs-top');
    expect(highscoreRowHtml(entry({ rank: 4 }))).not.toContain('hs-top');
    expect(highscoreRowHtml(entry())).toContain(`title="${classDisplayName('warrior')}"`);
  });

  it('omits the class title for an unknown class id rather than inventing one', () => {
    const html = highscoreRowHtml(entry({ cls: 'not_a_class' as never }));
    expect(html).toContain('<span class="hs-name">');
  });

  it('renders the header plus one row per leader', () => {
    const html = highscoreBoardHtml([entry({ rank: 1 }), entry({ rank: 2, name: 'Solo' })]);
    expect(html.match(/class="hs-row/g)?.length).toBe(3); // head + 2 rows
  });
});

describe('highscore_board: rank/level/virtual level/prestige render through formatNumber', () => {
  // A four-digit value is the decisive probe: formatNumber's default grouping
  // inserts a thousands separator a raw template interpolation never would,
  // matching how the lifetimeXp column already renders (formatXp).
  it('formats the rank with digit grouping, not a raw number', () => {
    const html = highscoreRowHtml(entry({ rank: 1234 }));
    expect(html).toContain('<span class="hs-rank">1,234</span>');
    expect(html).not.toContain('<span class="hs-rank">1234</span>');
  });

  it('formats the level and virtual level with digit grouping', () => {
    const html = highscoreRowHtml(entry({ level: 1234, virtualLevel: 5678 }));
    expect(html).toContain('>1,234</span>');
    expect(html).toContain('>5,678</span>');
    expect(html).not.toContain('>1234<');
    expect(html).not.toContain('>5678<');
  });

  it('formats the prestige rank badge and its tooltip with digit grouping', () => {
    const html = highscoreRowHtml(entry({ prestigeRank: 1234 }));
    expect(html).toContain('&starf;1,234</span>');
    expect(html).toContain(`${t('game.prestige.rank')} 1,234`);
    expect(html).not.toContain('&starf;1234<');
  });
});

describe('highscore_board: loadHighscoresInto (the thin consumer)', () => {
  it('paints the ranked board from the injected fetch', async () => {
    const el = host();
    await loadHighscoresInto(el, async () => [entry({ guild: 'Monarchs' })]);
    expect(el.innerHTML).toContain('&lt;Monarchs&gt;');
    expect(el.innerHTML).toContain('hs-head');
  });

  it('paints the localized empty state for a resolved empty board', async () => {
    const el = host();
    await loadHighscoresInto(el, async () => []);
    expect(el.innerHTML).toBe(highscoreEmptyHtml());
  });

  it('paints the localized retry line when the fetch rejects', async () => {
    const el = host();
    await loadHighscoresInto(el, async () => {
      throw new Error('offline');
    });
    expect(el.innerHTML).toBe(highscoreErrorHtml());
  });

  it('is a no-op without a host element (the /play entry has no marketing shell)', async () => {
    let called = false;
    await loadHighscoresInto(null, async () => {
      called = true;
      return [];
    });
    expect(called).toBe(false);
  });

  it('drops a second load while the first is still in flight', async () => {
    const el = host();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher = async (): Promise<LeaderboardEntry[]> => {
      calls += 1;
      await gate;
      return [entry()];
    };
    const first = loadHighscoresInto(el, fetcher);
    await loadHighscoresInto(el, fetcher); // re-entrant, must be dropped
    expect(calls).toBe(1);
    release();
    await first;
    expect(calls).toBe(1);
    expect(el.innerHTML).toContain('hs-head');
  });
});
