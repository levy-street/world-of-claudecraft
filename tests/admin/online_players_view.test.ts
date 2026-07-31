import { describe, expect, it } from 'vitest';
import {
  buildOnlinePlayersView,
  matchesOnlineQuery,
  ONLINE_PLAYERS_PAGE_SIZE,
  type OnlineSortColumn,
} from '../../src/admin/online_players_view';
import type { LivePlayer } from '../../src/admin/types';

function player(overrides: Partial<LivePlayer> & { pid: number }): LivePlayer {
  return {
    accountId: overrides.pid + 100,
    characterId: overrides.pid + 200,
    name: `Player${overrides.pid}`,
    class: 'warrior',
    level: 10,
    hp: 100,
    maxHp: 100,
    x: 0,
    z: 0,
    zone: 'greenhollow',
    sessionSeconds: 60,
    lastSaveSecondsAgo: 5,
    moveSpeedMultiplier: 1,
    runSpeed: 7,
    swimming: false,
    auras: [],
    ...overrides,
  };
}

const LABELS = {
  class: (id: string) => (id === 'warrior' ? 'Guerrier' : 'Zelateur'),
  zone: (id: string) => (id === 'greenhollow' ? 'Combe verte' : 'Aurebourg'),
};

describe('online players view: search', () => {
  const roster = [
    player({ pid: 1, name: 'Aragorn', class: 'warrior', zone: 'greenhollow', level: 60 }),
    player({ pid: 2, name: 'Belegorn', class: 'priest', zone: 'eastbrook', level: 12 }),
  ];

  it('matches on the rendered class and zone labels, not only the raw ids', () => {
    expect(
      buildOnlinePlayersView(roster, { query: 'Combe', labels: LABELS }).rows.map((p) => p.name),
    ).toEqual(['Aragorn']);
    expect(
      buildOnlinePlayersView(roster, { query: 'Zelateur', labels: LABELS }).rows.map((p) => p.name),
    ).toEqual(['Belegorn']);
    // Without labels the raw ids are all there is to match, so the label query misses.
    expect(buildOnlinePlayersView(roster, { query: 'Combe' }).total).toBe(0);
    expect(buildOnlinePlayersView(roster, { query: 'greenhollow' }).total).toBe(1);
  });

  it('matches name, account id, character id and level, case and accent insensitively', () => {
    expect(matchesOnlineQuery(roster[0], 'aragorn')).toBe(true);
    expect(matchesOnlineQuery(roster[0], 'ARAGÖRN')).toBe(true);
    expect(matchesOnlineQuery(roster[0], '101')).toBe(true); // accountId
    expect(matchesOnlineQuery(roster[0], '201')).toBe(true); // characterId
    expect(matchesOnlineQuery(roster[0], '60')).toBe(true); // level
    expect(matchesOnlineQuery(roster[0], 'belegorn')).toBe(false);
  });

  it('matches the instance name of a player inside a dungeon', () => {
    const inDungeon = player({
      pid: 3,
      name: 'Delver',
      location: {
        kind: 'dungeon',
        zoneId: 'shadowfen',
        zone: 'Shadowfen',
        instanceId: 'sf-1',
        instance: 'Sunken Crypt',
        instanceSlot: null,
        poiIndex: null,
        poi: null,
        poiDistance: null,
      },
    });
    expect(matchesOnlineQuery(inDungeon, 'sunken')).toBe(true);
    expect(matchesOnlineQuery(roster[0], 'sunken')).toBe(false);
  });

  it('treats a blank query as no filter', () => {
    expect(buildOnlinePlayersView(roster, { query: '   ' }).total).toBe(2);
  });
});

describe('online players view: sort', () => {
  const roster = [
    player({
      pid: 1,
      name: 'Cedric',
      level: 20,
      hp: 50,
      maxHp: 100,
      sessionSeconds: 30,
      lastSaveSecondsAgo: 9,
      accountId: 30,
      class: 'priest',
      zone: 'eastbrook',
    }),
    player({
      pid: 2,
      name: 'Aria',
      level: 60,
      hp: 10,
      maxHp: 100,
      sessionSeconds: 900,
      lastSaveSecondsAgo: 1,
      accountId: 10,
      class: 'warrior',
      zone: 'greenhollow',
    }),
    player({
      pid: 3,
      name: 'bramble',
      level: 40,
      hp: 100,
      maxHp: 100,
      sessionSeconds: 120,
      lastSaveSecondsAgo: 5,
      accountId: 20,
      class: 'mage',
      zone: 'ashvale',
    }),
  ];
  const order = (sort: OnlineSortColumn, dir: 'asc' | 'desc') =>
    buildOnlinePlayersView(roster, { sort, dir, locale: 'en' }).rows.map((p) => p.name);

  it('sorts by name case insensitively in both directions', () => {
    expect(order('name', 'asc')).toEqual(['Aria', 'bramble', 'Cedric']);
    expect(order('name', 'desc')).toEqual(['Cedric', 'bramble', 'Aria']);
  });

  it('sorts every numeric column', () => {
    expect(order('level', 'asc')).toEqual(['Cedric', 'bramble', 'Aria']);
    expect(order('session', 'desc')).toEqual(['Aria', 'bramble', 'Cedric']);
    expect(order('lastSave', 'asc')).toEqual(['Aria', 'bramble', 'Cedric']);
    expect(order('account', 'asc')).toEqual(['Aria', 'bramble', 'Cedric']);
  });

  it('sorts HP by the missing-health fraction, not the raw value', () => {
    const scaled = [
      player({ pid: 1, name: 'Full', hp: 200, maxHp: 200 }),
      player({ pid: 2, name: 'Hurt', hp: 300, maxHp: 1000 }),
    ];
    // Raw HP would put Full (200) first; the fraction puts Hurt (30%) first.
    expect(
      buildOnlinePlayersView(scaled, { sort: 'hp', dir: 'asc' }).rows.map((p) => p.name),
    ).toEqual(['Hurt', 'Full']);
  });

  it('sorts class and zone by their rendered labels', () => {
    // Raw ids ascending would be mage, priest, warrior; the labels reorder them.
    expect(
      buildOnlinePlayersView(roster, {
        sort: 'class',
        dir: 'asc',
        labels: {
          class: (id) => ({ warrior: 'Alpha', mage: 'Beta', priest: 'Gamma' })[id] ?? id,
        },
        locale: 'en',
      }).rows.map((p) => p.class),
    ).toEqual(['warrior', 'mage', 'priest']);
    expect(
      buildOnlinePlayersView(roster, {
        sort: 'zone',
        dir: 'asc',
        labels: {
          zone: (id) => ({ greenhollow: 'Alpha', ashvale: 'Beta', eastbrook: 'Gamma' })[id] ?? id,
        },
        locale: 'en',
      }).rows.map((p) => p.zone),
    ).toEqual(['greenhollow', 'ashvale', 'eastbrook']);
  });

  it('breaks ties on pid so equal rows keep a stable order across refreshes', () => {
    const tied = [
      player({ pid: 9, level: 5 }),
      player({ pid: 4, level: 5 }),
      player({ pid: 7, level: 5 }),
    ];
    expect(
      buildOnlinePlayersView(tied, { sort: 'level', dir: 'asc' }).rows.map((p) => p.pid),
    ).toEqual([4, 7, 9]);
    expect(
      buildOnlinePlayersView(tied, { sort: 'level', dir: 'desc' }).rows.map((p) => p.pid),
    ).toEqual([4, 7, 9]);
  });

  it('defaults to ascending by name', () => {
    expect(buildOnlinePlayersView(roster, { locale: 'en' }).rows.map((p) => p.name)).toEqual([
      'Aria',
      'bramble',
      'Cedric',
    ]);
  });
});

describe('online players view: paging', () => {
  const roster = Array.from({ length: 7 }, (_, index) => player({ pid: index + 1 }));

  it('slices the requested page and reports the filtered total', () => {
    const view = buildOnlinePlayersView(roster, { sort: 'account', page: 2, limit: 3 });
    expect(view.rows.map((p) => p.pid)).toEqual([4, 5, 6]);
    expect(view).toMatchObject({ total: 7, page: 2, limit: 3 });
  });

  it('clamps a page past the end so a shrinking roster never blanks the table', () => {
    const view = buildOnlinePlayersView(roster, { sort: 'account', page: 9, limit: 3 });
    expect(view.page).toBe(3);
    expect(view.rows.map((p) => p.pid)).toEqual([7]);
  });

  it('clamps a page below one and keeps an empty roster on page one', () => {
    expect(buildOnlinePlayersView(roster, { page: 0 }).page).toBe(1);
    expect(buildOnlinePlayersView([], { page: 4 })).toMatchObject({ total: 0, page: 1 });
  });

  it('pages by the shared page size by default', () => {
    expect(ONLINE_PLAYERS_PAGE_SIZE).toBe(25);
    const big = Array.from({ length: 30 }, (_, index) => player({ pid: index + 1 }));
    const view = buildOnlinePlayersView(big, { sort: 'account' });
    expect(view.limit).toBe(25);
    expect(view.rows).toHaveLength(25);
    expect(view.total).toBe(30);
  });

  it('pages the FILTERED roster, not the raw one', () => {
    const mixed = [
      player({ pid: 1, name: 'Keep1', zone: 'ashvale' }),
      player({ pid: 2, name: 'Drop', zone: 'greenhollow' }),
      player({ pid: 3, name: 'Keep2', zone: 'ashvale' }),
    ];
    const view = buildOnlinePlayersView(mixed, {
      query: 'ashvale',
      sort: 'account',
      limit: 1,
      page: 2,
    });
    expect(view.total).toBe(2);
    expect(view.rows.map((p) => p.name)).toEqual(['Keep2']);
  });

  it('leaves the input array untouched', () => {
    const input = [player({ pid: 2, name: 'B' }), player({ pid: 1, name: 'A' })];
    buildOnlinePlayersView(input, { sort: 'name' });
    expect(input.map((p) => p.name)).toEqual(['B', 'A']);
  });
});
