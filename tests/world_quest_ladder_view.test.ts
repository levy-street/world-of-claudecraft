// The World Quest rankings window's pure core
// (buildWorldQuestLadderView in src/ui/world_quest_leaderboard_view.ts): the
// board cards, the podium order and placeholders, the ladder split around the
// podium, the pinned "your best" bar, the fetch states, and the pager.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TURRET_MISSIONS } from '../src/sim/content/fire_and_fly_missions';
import { FIRE_AND_FLY_QUEST_ID } from '../src/sim/content/world_quest_fire_and_fly';
import { FIRE_AND_FLY_MASTERY_BOARD_ID } from '../src/sim/fire_and_fly_scoreboards';
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
    expect(WORLD_QUEST_LADDER_ART_DIR).toBe('/ui/world-quests/leaderboard');
    expect(worldQuestBoardArt('forge')).toBe('/ui/world-quests/leaderboard/forge.webp');
    expect(worldQuestBoardArt('glider_downs_v2_daily')).toBe(
      '/ui/world-quests/leaderboard/slalom.webp',
    );
    expect(worldQuestBoardArt('fire_and_fly_hard_v2_lifetime')).toBe(
      '/ui/world-quests/leaderboard/barricade.webp',
    );
    expect(worldQuestBoardArt('fire_and_fly_pack_v1_lifetime')).toBe(
      '/ui/world-quests/leaderboard/barricade.webp',
    );
    expect(worldQuestBoardArt(FIRE_AND_FLY_MASTERY_BOARD_ID)).toBe(
      '/ui/world-quests/leaderboard/barricade.webp',
    );
    expect(worldQuestMedalArt('silver')).toBe('/ui/world-quests/leaderboard/medal_silver.webp');
  });

  // The paths reach the stylesheet through a custom property, where a relative
  // url() resolves against the built stylesheet (/assets/...) instead of the page.
  // Root-absolute paths are the only form that survives that, so pin the form
  // AND that every path names a file that actually ships under public/.
  it('keeps every art path root-absolute and backed by a shipped file', () => {
    const paths = [
      ...WORLD_QUEST_SCOREBOARDS.map((b) => worldQuestBoardArt(b.id)),
      ...(['gold', 'silver', 'bronze'] as const).map(worldQuestMedalArt),
    ];
    for (const p of paths) {
      expect(p.startsWith('/'), p).toBe(true);
      expect(existsSync(join(process.cwd(), 'public', p)), p).toBe(true);
    }
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
      art: '/ui/world-quests/leaderboard/forge.webp',
    });
    expect(view.boardTitle).toBe('A Helping Hammer');
    expect(view.title).toBe('World Quest Rankings');
  });

  it("titles the trial boards as the gunner's records, with the offline rules on a personal page", () => {
    const online = buildWorldQuestLadderView(
      'fire_and_fly_introduction_v2_daily',
      { kind: 'page', page: page({ board: 'fire_and_fly_introduction_v2_daily' }) },
      'Hero1',
    );
    expect(online.title).toBe("Gunner's records");
    expect(online.subtitle).toMatch(/^The best medal ranks first.*practice included/);
    expect(online.boardTitle).toBe("Recruit's Trial: Today");
    expect(online.cards).toHaveLength(6);
    expect(online.columns.metric).toBe('Score');
    const offline = buildWorldQuestLadderView(
      'fire_and_fly_introduction_v2_daily',
      { kind: 'page', page: page({ board: 'fire_and_fly_introduction_v2_daily', personal: true }) },
      'Hero1',
    );
    expect(offline.subtitle).toMatch(/^Your offline records/);
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
      medalArt: '/ui/world-quests/leaderboard/medal_gold.webp',
      metricText: '99',
      me: false,
    });
    expect(view.rows.map((r) => r.rank)).toEqual(['4', '5', '6', '7', '8', '9', '10', '11', '12']);
    // Rank 4 carries no medal: no medal art, the no-medal text.
    expect(view.rows[0]).toMatchObject({ medal: null, medalArt: null, medalText: 'None' });
    expect(view.rows[1].medalArt).toBe('/ui/world-quests/leaderboard/medal_gold.webp');
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
      medalArt: '/ui/world-quests/leaderboard/medal_bronze.webp',
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

describe("Fire and Fly's groups: trials, missions, Mastery", () => {
  const MISSION = 'fire_and_fly_giants_v1_lifetime';
  const MASTERY = FIRE_AND_FLY_MASTERY_BOARD_ID;
  const RECRUITED = { trialsWon: 3, recruited: true };

  it('switches between the three groups, each opening its first board or keeping the active one', () => {
    const view = buildWorldQuestLadderView(
      'fire_and_fly_standard_v2_lifetime',
      { kind: 'loading' },
      '',
      RECRUITED,
    );
    expect(view.groupsLabel).toBe("Gunner's record groups");
    expect(view.groups).toEqual([
      {
        group: 'trials',
        label: 'Trials',
        board: 'fire_and_fly_standard_v2_lifetime',
        active: true,
      },
      {
        group: 'missions',
        label: 'Missions',
        board: 'fire_and_fly_pack_v1_lifetime',
        active: false,
      },
      { group: 'mastery', label: 'Mastery', board: MASTERY, active: false },
    ]);
    expect(view.cards).toHaveLength(6);
    expect(view.start).toEqual({
      questId: FIRE_AND_FLY_QUEST_ID,
      courseId: 'fire_and_fly_standard',
      label: 'Take this trial',
    });
    expect(buildWorldQuestLadderView('forge', { kind: 'loading' }, '').groups).toEqual([]);
    expect(
      buildWorldQuestLadderView('glider_downs_v2_daily', { kind: 'loading' }, '').groups,
    ).toEqual([]);
  });

  it("lists one all-time card per mission in the instructor's order, and takes the mission", () => {
    const view = buildWorldQuestLadderView(
      MISSION,
      { kind: 'page', page: page({ board: MISSION }) },
      'Hero1',
      RECRUITED,
    );
    expect(view.title).toBe("Gunner's records");
    expect(view.cards.map((c) => c.id)).toEqual(
      TURRET_MISSIONS.map((m) => `fire_and_fly_${m.boardKey}_v1_lifetime`),
    );
    expect(view.cards.map((c) => c.label)).toEqual([
      'The Pack: All time',
      'Heavy Tread: All time',
      'The Deluge: All time',
      'The Cracked Tower: All time',
      'The Powder Store: All time',
    ]);
    expect(view.cards.filter((c) => c.active).map((c) => c.id)).toEqual([MISSION]);
    expect(view.groups.filter((g) => g.active).map((g) => g.group)).toEqual(['missions']);
    expect(view.subtitle).toMatch(/^The best medal ranks first.*Every won mission counts/);
    expect(view.boardRule).toBe('Ranked by medal, then highest score');
    expect(view.columns.medal).toBe('Medal');
    expect(view.start).toEqual({
      questId: FIRE_AND_FLY_QUEST_ID,
      courseId: 'fire_and_fly_giants',
      label: 'Take this mission',
    });
    const offline = buildWorldQuestLadderView(
      MISSION,
      { kind: 'page', page: page({ board: MISSION, personal: true }) },
      'Hero1',
    );
    expect(offline.subtitle).toMatch(/^Your offline records/);
  });

  it('shows the Mastery as one board of stars and points, with no start button', () => {
    const leaders: WorldQuestLeaderboardEntry[] = [
      { rank: 1, name: 'Ace', medal: null, metric: 120_000, stars: 13 },
      { rank: 2, name: 'Bea', medal: null, metric: 150_000, stars: 12 },
      { rank: 3, name: 'Cy', medal: null, metric: 9_000, stars: 1 },
      { rank: 4, name: 'Hero1', medal: null, metric: 8_000, stars: 1 },
    ];
    const view = buildWorldQuestLadderView(
      MASTERY,
      {
        kind: 'page',
        page: page({ board: MASTERY, leaders, total: 4, self: leaders[3] }),
      },
      'Hero1',
      RECRUITED,
    );
    expect(view.boardTitle).toBe("Gunner's Mastery");
    expect(view.cards.map((c) => c.id)).toEqual([MASTERY]);
    expect(view.groups.filter((g) => g.active).map((g) => g.group)).toEqual(['mastery']);
    expect(view.boardRule).toBe('Ranked by stars, then highest score');
    expect(view.subtitle).toMatch(/^Your best medal on each mission, summed as stars/);
    expect(view.columns).toMatchObject({ medal: 'Stars', metric: 'Score' });
    expect(view.start).toBeNull();
    const byPlace = [...view.podium].sort((a, b) => a.place - b.place);
    expect(byPlace.map((slot) => [slot.name, slot.medalText, slot.metricText])).toEqual([
      ['Ace', '13 stars', '120,000'],
      ['Bea', '12 stars', '150,000'],
      ['Cy', '1 star', '9,000'],
    ]);
    expect(view.podium.every((slot) => slot.medalArt === null)).toBe(true);
    expect(view.rows.map((row) => [row.name, row.medalText, row.metricText, row.me])).toEqual([
      ['Hero1', '1 star', '8,000', true],
    ]);
    expect(view.self).toMatchObject({ kind: 'ranked', medalText: '1 star', metricText: '8,000' });
    const offline = buildWorldQuestLadderView(
      MASTERY,
      { kind: 'page', page: page({ board: MASTERY, leaders: [], total: 0, personal: true }) },
      'Hero1',
    );
    expect(offline.state).toBe('empty');
    expect(offline.subtitle).toMatch(/^Your offline Mastery/);
  });

  it('offers no start for a trial or mission the character has not unlocked', () => {
    const start = (board: string, recruitment = { trialsWon: 0, recruited: false }) =>
      buildWorldQuestLadderView(board, { kind: 'loading' }, '', recruitment).start;
    expect(start('fire_and_fly_introduction_v2_daily')?.courseId).toBe('fire_and_fly_introduction');
    expect(start('fire_and_fly_standard_v2_daily')).toBeNull();
    expect(start('fire_and_fly_standard_v2_daily', { trialsWon: 1, recruited: false })).toEqual(
      expect.objectContaining({ courseId: 'fire_and_fly_standard' }),
    );
    expect(start(MISSION, { trialsWon: 2, recruited: false })).toBeNull();
    expect(start(MISSION, RECRUITED)?.courseId).toBe('fire_and_fly_giants');
    expect(buildWorldQuestLadderView(MISSION, { kind: 'loading' }, '').start).toBeNull();
    expect(start('glider_valleys_v2_lifetime')).toEqual(
      expect.objectContaining({
        questId: 'wq_galecrest_slalom',
        courseId: 'galecrest_practice_valleys',
      }),
    );
  });

  it('shows no star count, never a false zero, on a Mastery row the server sent without one', () => {
    const leaders: WorldQuestLeaderboardEntry[] = [
      { rank: 1, name: 'Ace', medal: null, metric: 120_000 },
      { rank: 2, name: 'Bea', medal: null, metric: 90_000, stars: 0 },
    ];
    const view = buildWorldQuestLadderView(
      MASTERY,
      { kind: 'page', page: page({ board: MASTERY, leaders, total: 2, self: leaders[0] }) },
      'Ace',
    );
    const byPlace = [...view.podium].sort((a, b) => a.place - b.place);
    expect(byPlace.slice(0, 2).map((slot) => slot.medalText)).toEqual(['None', '0 stars']);
    expect(view.self).toMatchObject({ kind: 'ranked', medalText: 'None' });
  });
});
