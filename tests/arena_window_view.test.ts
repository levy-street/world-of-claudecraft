// Tests for the arena window pure core (arena_window_view.ts):
//  - the offline-vs-live discriminator (the online-only-shape trap),
//  - bracket resolution + commit, canSwitchBracket, queueDisabled, party section,
//  - ladder/all-time row derivation (rank, me-flag, knownClass),
//  - the render-skip signature stability,
//  - same-shape parity: two structurally-distinct ArenaInfo snapshots that carry
//    the same logical data render an identical view (the core reads only declared
//    fields), plus same-input determinism.
//
// DOM-free / i18n-free, so this Node suite drives the core directly; the DOM
// painter (arena_window.ts) is covered by its WCAG-markup source guard.

import { describe, expect, it } from 'vitest';
import {
  type ArenaAllTimeEntry,
  type ArenaView,
  type ArenaViewInput,
  buildArenaView,
} from '../src/ui/arena_window_view';
import type { ArenaFormat, ArenaInfo, PartyInfo } from '../src/world_api';

const STANDINGS = {
  '1v1': { rating: 1500, wins: 10, losses: 5 },
  '2v2': { rating: 1400, wins: 6, losses: 6 },
  fiesta: { rating: 1300, wins: 3, losses: 2 },
} as const;

const LADDERS = {
  '1v1': [
    { pid: 1, name: 'Me', cls: 'warrior', rating: 1500, wins: 10, losses: 5 },
    { pid: 2, name: 'Rival', cls: 'mage', rating: 1400, wins: 8, losses: 7 },
  ],
  '2v2': [],
  fiesta: [],
} as const;

/** A live ArenaInfo. `shape: 'sim'` carries extra fields the core must ignore. */
function makeArenaInfo(shape: 'sim' | 'client', over: Partial<ArenaInfo> = {}): ArenaInfo {
  const junk = shape === 'sim' ? { _internalSeq: 7, _dirty: true } : {};
  return {
    rating: 1500,
    wins: 10,
    losses: 5,
    standings: structuredClone(STANDINGS),
    format: null,
    queued: false,
    queueSize: 0,
    match: null,
    ladder: structuredClone(LADDERS['1v1']),
    ladders: structuredClone(LADDERS),
    ...junk,
    ...over,
  } as unknown as ArenaInfo;
}

function input(over: Partial<ArenaViewInput> = {}): ArenaViewInput {
  return {
    info: makeArenaInfo('sim'),
    selectedBracket: '1v1',
    playerId: 1,
    playerName: 'Me',
    party: null,
    allTime: {},
    practiceAvailable: false,
    ...over,
  };
}

function live(view: ArenaView): Extract<ArenaView, { kind: 'live' }> {
  if (view.kind !== 'live') throw new Error('expected a live view');
  return view;
}

const party = (members: { pid: number; level?: number; cls?: string }[], leader = 1): PartyInfo =>
  ({
    leader,
    raid: false,
    members: members.map((m) => ({
      pid: m.pid,
      name: `P${m.pid}`,
      cls: m.cls ?? 'warrior',
      level: m.level ?? 60,
    })),
  }) as unknown as PartyInfo;

describe('buildArenaView: offline vs live (online-only-shape trap)', () => {
  it('returns the offline notice when no arena snapshot has synced', () => {
    expect(buildArenaView(input({ info: null })).kind).toBe('offline');
  });

  it('returns the live panel once a snapshot is present', () => {
    expect(buildArenaView(input()).kind).toBe('live');
  });

  it('renders identically from two structurally-distinct snapshots (same data)', () => {
    const fromSim = buildArenaView(input({ info: makeArenaInfo('sim') }));
    const fromClient = buildArenaView(input({ info: makeArenaInfo('client') }));
    expect(fromSim).toEqual(fromClient);
  });

  it('is deterministic: identical inputs produce a deep-equal view', () => {
    expect(buildArenaView(input())).toEqual(buildArenaView(input()));
  });
});

describe('buildArenaView: bracket resolution + commit', () => {
  it('uses the selected bracket when idle and does not commit it', () => {
    const v = live(buildArenaView(input({ selectedBracket: '2v2' })));
    expect(v.bracket).toBe('2v2');
    expect(v.commitBracket).toBe(false);
    expect(v.canSwitchBracket).toBe(true);
  });

  it('forces + commits the match bracket regardless of selection', () => {
    const info = makeArenaInfo('sim', {
      match: { format: 'fiesta', state: 'active', oppName: 'Foe' },
    } as Partial<ArenaInfo>);
    const v = live(buildArenaView(input({ info, selectedBracket: '1v1' })));
    expect(v.bracket).toBe('fiesta');
    expect(v.commitBracket).toBe(true);
    expect(v.canSwitchBracket).toBe(false);
    expect(v.action).toEqual({ kind: 'in-match', oppName: 'Foe' });
  });

  it('forces + commits the queued bracket and locks switching', () => {
    const info = makeArenaInfo('sim', { queued: true, queueSize: 3, format: '2v2' });
    const v = live(buildArenaView(input({ info, selectedBracket: '1v1' })));
    expect(v.bracket).toBe('2v2');
    expect(v.commitBracket).toBe(true);
    expect(v.canSwitchBracket).toBe(false);
    expect(v.action).toEqual({ kind: 'queued', queueSize: 3 });
    // Locked brackets are the inactive ones while queued.
    expect(v.brackets.filter((b) => b.locked).map((b) => b.fmt)).toEqual([
      '1v1',
      'fiesta',
      'yumi3',
      'yumi5',
    ]);
  });
});

describe('buildArenaView: queue gating', () => {
  it('disables 1v1 queue while in a party', () => {
    const v = live(buildArenaView(input({ party: party([{ pid: 1 }, { pid: 2 }]) })));
    expect(v.action).toEqual({ kind: 'idle', queueDisabled: true });
  });

  it('disables a 2v2 queue for a non-leader of a full party', () => {
    const v = live(
      buildArenaView(
        input({ selectedBracket: '2v2', playerId: 2, party: party([{ pid: 1 }, { pid: 2 }], 1) }),
      ),
    );
    expect(v.action).toEqual({ kind: 'idle', queueDisabled: true });
    expect(v.party.kind).toBe('members');
  });

  it('disables a team queue for an over-size party and shows the warn note', () => {
    const v = live(
      buildArenaView(
        input({ selectedBracket: '2v2', party: party([{ pid: 1 }, { pid: 2 }, { pid: 3 }]) }),
      ),
    );
    expect(v.action).toEqual({ kind: 'idle', queueDisabled: true });
    expect(v.party.kind).toBe('warn');
  });

  it('enables a solo 1v1 queue', () => {
    expect(live(buildArenaView(input())).action).toEqual({ kind: 'idle', queueDisabled: false });
  });
});

describe('buildArenaView: ladder + all-time rows', () => {
  it('ranks and me-flags the live ladder, marking known classes', () => {
    const v = live(buildArenaView(input()));
    expect(v.ladder.map((r) => r.rank)).toEqual([1, 2]);
    expect(v.ladder.map((r) => r.me)).toEqual([true, false]);
    expect(v.ladder.every((r) => r.knownClass)).toBe(true);
  });

  it('flags an unknown class id as knownClass=false and carries the raw id through', () => {
    const info = makeArenaInfo('sim', {
      ladders: {
        ...structuredClone(LADDERS),
        '1v1': [{ pid: 9, name: 'Mystery', cls: 'not_a_class', rating: 1200, wins: 1, losses: 1 }],
      },
    } as unknown as Partial<ArenaInfo>);
    const v = live(buildArenaView(input({ info })));
    expect(v.ladder).toHaveLength(1);
    expect(v.ladder[0].knownClass).toBe(false);
    // The core leaves the raw id intact; the painter falls back to it unlocalized.
    expect(v.ladder[0].cls).toBe('not_a_class');
  });

  it('derives all-time rows from the painter-owned cache, me-flagged by name', () => {
    const allTime: Partial<Record<ArenaFormat, ArenaAllTimeEntry[]>> = {
      '1v1': [
        { name: 'Me', class: 'warrior', level: 60, rating: 1600, wins: 20, losses: 4 },
        { name: 'Legend', class: 'rogue', level: 60, rating: 1700, wins: 30, losses: 2 },
      ],
    };
    const v = live(buildArenaView(input({ allTime })));
    expect(v.allTime?.map((r) => r.me)).toEqual([true, false]);
    expect(v.allTime?.map((r) => r.level)).toEqual([60, 60]);
  });

  it('omits the all-time section when the cache has no rows for the bracket', () => {
    expect(live(buildArenaView(input())).allTime).toBeNull();
  });

  it('shows the practice affordance only on Fiesta when the hook is wired', () => {
    expect(
      live(buildArenaView(input({ selectedBracket: 'fiesta', practiceAvailable: true }))).practice,
    ).toBe(true);
    expect(
      live(buildArenaView(input({ selectedBracket: 'fiesta', practiceAvailable: false }))).practice,
    ).toBe(false);
    expect(
      live(buildArenaView(input({ selectedBracket: '1v1', practiceAvailable: true }))).practice,
    ).toBe(false);
  });
});

describe('buildArenaView: render-skip signature', () => {
  it('is stable across identical snapshots and changes when the data changes', () => {
    const a = live(buildArenaView(input())).sig;
    const b = live(buildArenaView(input())).sig;
    expect(a).toBe(b);
    const changed = live(
      buildArenaView(input({ info: makeArenaInfo('sim', { queued: true, queueSize: 1 }) })),
    ).sig;
    expect(changed).not.toBe(a);
  });
});
