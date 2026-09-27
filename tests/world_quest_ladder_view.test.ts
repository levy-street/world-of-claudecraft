// The World Quest rankings window's pure core
// (buildWorldQuestLadderView in src/ui/world_quest_leaderboard_view.ts): the
// board cards, the podium order and placeholders, the ladder split around the
// podium, the pinned "your best" bar, the fetch states, and the pager.
import { describe, expect, it } from 'vitest';
import type { WorldQuestMedal } from '../src/sim/world_quest_scoreboards';
import { WORLD_QUEST_SCOREBOARDS } from '../src/sim/world_quest_scoreboards';
import {
  buildWorldQuestLadderView,
  resolveWorldQuestBoard,
  WORLD_QUEST_LADDER_ART_DIR,
  worldQuestBoardArt,
  worldQuestBoardRule,
  worldQuestMedalArt,
} from '../src/ui/world_quest_leaderboard_view';
import type { WorldQuestLeaderboardEntry, WorldQuestLeaderboardPage } from '../src/world_api';

const MEDALS: (WorldQuestMedal | null)[] = ['gold', 'silver', 'bronze', null];

function entries(from: number, count: number): WorldQuestLeaderboardEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    rank: from + i,
    name: `Hero${from + i}`,
    medal: MEDALS[(from + i - 1) % MEDALS.length],
    metric: 100 - (from + i),
  }));
}

function page(over: Partial<WorldQuestLeaderboardPage> = {}): WorldQuestLeaderboardPage {
  return {
    board: 'north_watch_cannon',
    leaders: entries(1, 12),
    page: 0,
    pageSize: 50,
    pageCount: 1,
    total: 12,
    self: null,
    ...over,
  };
}

describe('art paths', () => {
  it('points every board and medal under the rankings art dir', () => {
    expect(WORLD_QUEST_LADDER_ART_DIR).toBe('ui/world-quests/leaderboard');
    expect(worldQuestBoardArt('forge')).toBe('ui/world-quests/leaderboard/forge.webp');
    expect(worldQuestMedalArt('silver')).toBe('ui/world-quests/leaderboard/medal_silver.webp');
  });
});

describe('cards and board header', () => {
  it('builds one card per scoreboard with art, metric header, and one active card', () => {
    const view = buildWorldQuestLadderView('forge', { kind: 'loading' }, 'Hero1');
    expect(view.cards.map((c) => c.id)).toEqual([
      'north_watch_cannon',
      'last_keep_cannon',
      'calligraphy',
      'slalom',
      'forge',
    ]);
    expect(view.cards.filter((c) => c.active).map((c) => c.id)).toEqual(['forge']);
    const forge = view.cards.find((c) => c.id === 'forge');
    expect(forge).toMatchObject({
      label: 'A Helping Hammer',
      metricHeader: 'Time',
      art: 'ui/world-quests/leaderboard/forge.webp',
    });
    expect(view.boardTitle).toBe('A Helping Hammer');
    expect(view.title).toBe('World Quest Rankings');
  });

  it('falls back to the default board for an unknown id', () => {
    const view = buildWorldQuestLadderView('nope', { kind: 'loading' }, '');
    expect(view.boardId).toBe(WORLD_QUEST_SCOREBOARDS[0].id);
    expect(view.cards.filter((c) => c.active)).toHaveLength(1);
  });

  it('words the ordering rule by metric-first versus medal-first boards', () => {
    expect(worldQuestBoardRule(resolveWorldQuestBoard('north_watch_cannon'))).toBe(
      'Ranked by waves held',
    );
    expect(worldQuestBoardRule(resolveWorldQuestBoard('forge'))).toBe(
      'Ranked by medal, then fastest time',
    );
    expect(worldQuestBoardRule(resolveWorldQuestBoard('slalom'))).toBe(
      'Ranked by medal, then highest score',
    );
  });
});

describe('fetch states', () => {
  it('loading shows the loading line, no podium, no rows, no self bar', () => {
    const view = buildWorldQuestLadderView('forge', { kind: 'loading' }, 'Hero1');
    expect(view).toMatchObject({ state: 'loading', message: 'Loading rankings…', self: null });
    expect(view.podium).toEqual([]);
    expect(view.rows).toEqual([]);
    expect(view.pager).toBeNull();
  });

  it('error shows the retry line and no self bar', () => {
    const view = buildWorldQuestLadderView('forge', { kind: 'error' }, 'Hero1');
    expect(view.state).toBe('error');
    expect(view.message).toBe('Could not load the leaderboard. Try again.');
    expect(view.self).toBeNull();
  });

  it('an empty board shows the empty line and still tells the viewer they have no score', () => {
    const view = buildWorldQuestLadderView(
      'forge',
      { kind: 'page', page: page({ leaders: [], total: 0 }) },
      'Hero1',
    );
    expect(view.state).toBe('empty');
    expect(view.message).toMatch(/No scores on this board yet/);
    expect(view.podium).toEqual([]);
    expect(view.self).toMatchObject({ kind: 'none', label: 'Your best' });
  });
});

describe('ranked board', () => {
  it('lists the podium first place first and only rank 4 onward on page 0', () => {
    const view = buildWorldQuestLadderView(
      'north_watch_cannon',
      { kind: 'page', page: page() },
      'x',
    );
    expect(view.state).toBe('ranked');
    // First place first; the stylesheet stands it silver, gold, bronze.
    expect(view.podium.map((s) => s.place)).toEqual([1, 2, 3]);
    expect(view.podium.map((s) => s.name)).toEqual(['Hero1', 'Hero2', 'Hero3']);
    expect(view.podium[0]).toMatchObject({
      filled: true,
      rank: '1',
      medal: 'gold',
      medalText: 'Gold',
      medalArt: 'ui/world-quests/leaderboard/medal_gold.webp',
      metricText: '99',
      me: false,
    });
    expect(view.rows.map((r) => r.rank)).toEqual(['4', '5', '6', '7', '8', '9', '10', '11', '12']);
    // Rank 4 carries no medal: no medal art, the no-medal text.
    expect(view.rows[0]).toMatchObject({ medal: null, medalArt: null, medalText: 'None' });
    expect(view.rows[1].medalArt).toBe('ui/world-quests/leaderboard/medal_gold.webp');
    expect(view.totalText).toBe('12 heroes ranked');
  });

  it('colors the podium discs by place, not by the medal each hero earned', () => {
    // Ranks 1 and 2 both earned gold and rank 3 earned silver: the discs still
    // read gold, silver, bronze, and each slot keeps its earned medal separately.
    const leaders: WorldQuestLeaderboardEntry[] = [
      { rank: 1, name: 'Seraphine', medal: 'gold', metric: 48 },
      { rank: 2, name: 'Brannoc', medal: 'gold', metric: 45 },
      { rank: 3, name: 'Ysolde', medal: 'silver', metric: 42 },
    ];
    const view = buildWorldQuestLadderView(
      'north_watch_cannon',
      { kind: 'page', page: page({ leaders, total: 3 }) },
      'x',
    );
    // The disc art itself is a stylesheet concern now (.lbp-slot-1/2/3 in
    // src/styles/components.css); the slots list first place first.
    expect(view.podium.map((s) => [s.place, s.medalArt])).toEqual([
      [1, worldQuestMedalArt('gold')],
      [2, worldQuestMedalArt('gold')],
      [3, worldQuestMedalArt('silver')],
    ]);
  });

  it('leaves unheld podium places standing as unclaimed placeholders', () => {
    const view = buildWorldQuestLadderView(
      'forge',
      { kind: 'page', page: page({ leaders: entries(1, 1), total: 1 }) },
      'Hero1',
    );
    expect(view.podium.map((s) => [s.place, s.filled, s.name])).toEqual([
      [1, true, 'Hero1'],
      [2, false, 'Unclaimed'],
      [3, false, 'Unclaimed'],
    ]);
    expect(view.podium[1]).toMatchObject({
      medalArt: null,
      metricText: '',
      rank: '2',
    });
    expect(view.rows).toEqual([]);
    expect(view.totalText).toBe('One hero ranked');
  });

  it('on a later page drops the podium and lists every row, with a pager', () => {
    const view = buildWorldQuestLadderView(
      'forge',
      {
        kind: 'page',
        page: page({ leaders: entries(51, 3), page: 1, pageCount: 3, total: 120 }),
      },
      'Hero52',
    );
    expect(view.podium).toEqual([]);
    expect(view.rows.map((r) => r.rank)).toEqual(['51', '52', '53']);
    expect(view.rows.map((r) => r.me)).toEqual([false, true, false]);
    expect(view.pager).toMatchObject({
      page: 1,
      pageCount: 3,
      prevDisabled: false,
      nextDisabled: false,
      status: 'Page 2 of 3',
    });
  });

  it('marks the viewer on the podium case-insensitively', () => {
    const view = buildWorldQuestLadderView('forge', { kind: 'page', page: page() }, 'hero3');
    expect(view.podium.find((s) => s.place === 3)?.me).toBe(true);
    expect(view.podium.filter((s) => s.me)).toHaveLength(1);
  });
});

describe('your best', () => {
  it('pins the server-resolved standing even when the row is off this page', () => {
    const view = buildWorldQuestLadderView(
      'forge',
      {
        kind: 'page',
        page: page({ self: { rank: 97, name: 'Ari', medal: 'bronze', metric: 61.25 } }),
      },
      'Ari',
    );
    expect(view.self).toEqual({
      kind: 'ranked',
      label: 'Your best',
      rankText: 'Rank 97',
      name: 'Ari',
      medal: 'bronze',
      medalText: 'Bronze',
      medalArt: 'ui/world-quests/leaderboard/medal_bronze.webp',
      metricText: '61.3s',
    });
  });

  it('reads an explicit null self as no score, even if a same-named row is listed', () => {
    const view = buildWorldQuestLadderView('forge', { kind: 'page', page: page() }, 'Hero5');
    expect(view.self).toMatchObject({ kind: 'none' });
  });

  it('falls back to the listed row when an older server omits self entirely', () => {
    const legacy = page();
    delete legacy.self;
    const view = buildWorldQuestLadderView('forge', { kind: 'page', page: legacy }, 'Hero5');
    expect(view.self).toMatchObject({ kind: 'ranked', rankText: 'Rank 5', name: 'Hero5' });
  });
});
