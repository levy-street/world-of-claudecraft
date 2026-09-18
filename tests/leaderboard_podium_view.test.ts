// The leaderboard podium core (src/ui/leaderboard_podium_view.ts): the page
// split every leaderboard tab uses, the place order and the disc medal per
// place, and the viewer standing decisions the tabs make without a server read.
// The disc art itself lives in the stylesheet, so this file also pins that the
// three medal files ship and that each place maps to its own medal url.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  guildStandingRow,
  isViewerGuild,
  PODIUM_PLACE_MEDAL,
  PODIUM_PLACE_ORDER,
  playersStandingBar,
  podiumSplit,
  viewerRowOnPage,
} from '../src/ui/leaderboard_podium_view';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

interface Row {
  rank: number;
  name: string;
  me: boolean;
}

function rows(count: number, meRank = 0): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    rank: i + 1,
    name: `Hero${i + 1}`,
    me: i + 1 === meRank,
  }));
}

describe('podiumSplit', () => {
  it('stands ranks 1 to 3 in place order and lists rank 4 onward on the first page', () => {
    const split = podiumSplit(0, rows(6), (r) => r.rank);
    expect(split.podium.map((s) => [s.place, s.rankText, s.entry?.name])).toEqual([
      [1, '1', 'Hero1'],
      [2, '2', 'Hero2'],
      [3, '3', 'Hero3'],
    ]);
    expect(split.listed.map((r) => r.rank)).toEqual([4, 5, 6]);
    expect(PODIUM_PLACE_ORDER).toEqual([1, 2, 3]);
  });

  it('leaves an unheld place standing empty', () => {
    const split = podiumSplit(0, rows(1), (r) => r.rank);
    expect(split.podium.map((s) => [s.place, s.entry])).toEqual([
      [1, rows(1)[0]],
      [2, null],
      [3, null],
    ]);
    expect(split.listed).toEqual([]);
  });

  it('drops the podium on a later page and lists every row', () => {
    const later = rows(3).map((r) => ({ ...r, rank: r.rank + 50 }));
    const split = podiumSplit(1, later, (r) => r.rank);
    expect(split.podium).toEqual([]);
    expect(split.listed.map((r) => r.rank)).toEqual([51, 52, 53]);
  });

  it('has no podium for an empty page', () => {
    expect(podiumSplit(0, [] as Row[], (r) => r.rank)).toEqual({ podium: [], listed: [] });
  });
});

describe('podium disc art', () => {
  it('maps each place to its own medal, gold first', () => {
    expect(PODIUM_PLACE_MEDAL).toEqual({ 1: 'gold', 2: 'silver', 3: 'bronze' });
  });

  it('ships the three medal files the stylesheet reads', () => {
    for (const medal of ['gold', 'silver', 'bronze']) {
      const file = join(repoRoot, 'public', 'ui', 'leaderboard', `medal_${medal}.webp`);
      expect(existsSync(file), `missing ${file}`).toBe(true);
      // A WebP container: RIFF....WEBP.
      const head = readFileSync(file).subarray(0, 12).toString('latin1');
      expect(head.startsWith('RIFF') && head.endsWith('WEBP'), `${medal} is not a WebP`).toBe(true);
    }
  });

  it('declares each place medal as an absolute /ui/ url on its slot class', () => {
    const css = readFileSync(join(repoRoot, 'src', 'styles', 'components.css'), 'utf8');
    for (const place of PODIUM_PLACE_ORDER) {
      const medal = PODIUM_PLACE_MEDAL[place];
      const rule = new RegExp(
        `#leaderboard-window \\.lbp-slot-${place} \\{[^}]*--lbp-medal: url\\("/ui/leaderboard/medal_${medal}\\.webp"\\)`,
      );
      expect(css, `.lbp-slot-${place} must carry medal_${medal}`).toMatch(rule);
    }
  });
});

describe('standing decisions', () => {
  it('finds the viewer row on the page, or nothing', () => {
    expect(viewerRowOnPage(rows(5, 4))?.rank).toBe(4);
    expect(viewerRowOnPage(rows(5))).toBeNull();
  });

  it('players: the ranked row on the page wins over the off-page standing', () => {
    const offPage = { name: 'Hero4', level: 20 };
    const onPage = rows(5, 4).map((r) => ({ ...r, level: 20 }));
    expect(playersStandingBar(onPage, offPage)).toMatchObject({ rank: 4, name: 'Hero4' });
  });

  it('players: off the page the standing carries no rank', () => {
    const offPage = { name: 'Ari', level: 12 };
    const bar = playersStandingBar(
      rows(5).map((r) => ({ ...r, level: 20 })),
      offPage,
    );
    expect(bar).toEqual({ name: 'Ari', level: 12, rank: null });
  });

  it('players: no viewer at all shows no bar', () => {
    expect(
      playersStandingBar(
        rows(3).map((r) => ({ ...r, level: 1 })),
        null,
      ),
    ).toBeNull();
  });

  it("guilds: the viewer's own guild when it is on the page, exact name only", () => {
    const guilds = [
      { rank: 1, name: 'Ironvow' },
      { rank: 2, name: 'Moonwardens' },
    ];
    expect(guildStandingRow(guilds, 'Moonwardens')?.rank).toBe(2);
    expect(guildStandingRow(guilds, 'moonwardens')).toBeNull();
    expect(guildStandingRow(guilds, 'Thornveil')).toBeNull();
    expect(guildStandingRow(guilds, null)).toBeNull();
    expect(guildStandingRow(guilds, '')).toBeNull();
  });

  it('guilds: the viewer guild match is exact and needs a guild', () => {
    expect(isViewerGuild('Moonwardens', 'Moonwardens')).toBe(true);
    expect(isViewerGuild('Moonwardens', 'moonwardens')).toBe(false);
    expect(isViewerGuild('Moonwardens', '')).toBe(false);
    expect(isViewerGuild('Moonwardens', null)).toBe(false);
    expect(isViewerGuild('Moonwardens', undefined)).toBe(false);
  });
});
