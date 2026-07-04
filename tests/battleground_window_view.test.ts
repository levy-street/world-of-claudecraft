// Tests for the battleground window pure core (battleground_window_view.ts):
//  - the offline-vs-live discriminator (the online-only-shape trap),
//  - the action section (queued / deserter / idle gating by leadership + size),
//  - the live-match Watch rows (canWatch gating, the watching row),
//  - ladder row derivation (rank, me-flag, knownClass),
//  - the practice affordance, the render-skip signature,
//  - same-shape parity: a Sim-shaped BgInfo (junk extra fields) and a
//    ClientWorld-mirror-shaped BgInfo render identically (arena pattern).

import { describe, expect, it } from 'vitest';
import {
  type BgWindowView,
  type BgWindowViewInput,
  buildBgWindowView,
} from '../src/ui/battleground_window_view';
import type { BgInfo, BgLiveMatch, BgMatchInfo, PartyInfo } from '../src/world_api';

function liveMatch(over: Partial<BgLiveMatch> = {}): BgLiveMatch {
  return {
    id: 1,
    elapsed: 30,
    killsA: 2,
    killsB: 1,
    structuresDownA: 0,
    structuresDownB: 0,
    players: 10,
    ...over,
  };
}

/** A BgInfo snapshot. `shape: 'sim'` carries extra fields the core must ignore. */
function makeBgInfo(shape: 'sim' | 'client', over: Partial<BgInfo> = {}): BgInfo {
  const junk = shape === 'sim' ? { _queueArr: [1, 2], _slotBusy: true } : {};
  return {
    standing: { rating: 1500, wins: 10, losses: 5 },
    queued: false,
    queueSize: 0,
    position: 0,
    waitSec: 0,
    deserterFor: 0,
    match: null,
    liveMatches: [],
    ladder: [
      { pid: 1, name: 'Me', cls: 'warrior', rating: 1500, wins: 10, losses: 5 },
      { pid: 2, name: 'Rival', cls: 'mage', rating: 1400, wins: 8, losses: 7 },
    ],
    spectating: null,
    ...junk,
    ...over,
  } as unknown as BgInfo;
}

function input(over: Partial<BgWindowViewInput> = {}): BgWindowViewInput {
  return {
    info: makeBgInfo('sim'),
    playerId: 1,
    party: null,
    practiceAvailable: false,
    ...over,
  };
}

function live(view: BgWindowView): Extract<BgWindowView, { kind: 'live' }> {
  if (view.kind !== 'live') throw new Error('expected a live view');
  return view;
}

const party = (pids: number[], leader = 1): PartyInfo =>
  ({
    leader,
    raid: false,
    members: pids.map((pid) => ({ pid, name: `P${pid}`, cls: 'warrior', level: 20 })),
  }) as unknown as PartyInfo;

describe('buildBgWindowView: offline vs live (online-only-shape trap)', () => {
  it('returns the offline notice when no snapshot has synced', () => {
    expect(buildBgWindowView(input({ info: null })).kind).toBe('offline');
  });

  it('renders identically from two structurally-distinct snapshots (same data)', () => {
    expect(buildBgWindowView(input({ info: makeBgInfo('sim') }))).toEqual(
      buildBgWindowView(input({ info: makeBgInfo('client') })),
    );
  });

  it('is deterministic: identical inputs produce a deep-equal view', () => {
    expect(buildBgWindowView(input())).toEqual(buildBgWindowView(input()));
  });
});

describe('buildBgWindowView: the action section', () => {
  it('shows the in-match note while fighting', () => {
    const info = makeBgInfo('sim', { match: { id: 4 } as unknown as BgMatchInfo });
    expect(live(buildBgWindowView(input({ info }))).action).toEqual({ kind: 'in-match' });
  });

  it('shows the queued state with position + wait + realm queue size', () => {
    const info = makeBgInfo('sim', { queued: true, position: 3, waitSec: 61, queueSize: 7 });
    expect(live(buildBgWindowView(input({ info }))).action).toEqual({
      kind: 'queued',
      position: 3,
      waitSec: 61,
      queueSize: 7,
    });
  });

  it("shows the Deserter's Knell lockout instead of the join button", () => {
    const info = makeBgInfo('sim', { deserterFor: 154 });
    expect(live(buildBgWindowView(input({ info }))).action).toEqual({
      kind: 'deserter',
      seconds: 154,
    });
  });

  it('lets a solo player queue', () => {
    expect(live(buildBgWindowView(input())).action).toMatchObject({
      kind: 'idle',
      queueDisabled: false,
      partySize: 1,
      isLeader: true,
    });
  });

  it('lets the leader queue a party of five, and blocks a member', () => {
    const five = party([1, 2, 3, 4, 5], 1);
    expect(live(buildBgWindowView(input({ party: five }))).action).toMatchObject({
      kind: 'idle',
      queueDisabled: false,
      partySize: 5,
    });
    expect(live(buildBgWindowView(input({ party: five, playerId: 2 }))).action).toMatchObject({
      kind: 'idle',
      queueDisabled: true,
      isLeader: false,
    });
  });

  it('blocks an over-size party (six)', () => {
    const six = party([1, 2, 3, 4, 5, 6], 1);
    expect(live(buildBgWindowView(input({ party: six }))).action).toMatchObject({
      kind: 'idle',
      queueDisabled: true,
    });
  });

  it('blocks queueing while spectating (stop watching first)', () => {
    const info = makeBgInfo('sim', { spectating: 2, liveMatches: [liveMatch({ id: 2 })] });
    expect(live(buildBgWindowView(input({ info }))).action).toMatchObject({
      kind: 'idle',
      queueDisabled: true,
    });
  });
});

describe('buildBgWindowView: live matches + spectate', () => {
  it('offers Watch on live rows while idle', () => {
    const info = makeBgInfo('sim', { liveMatches: [liveMatch({ id: 9 })] });
    const v = live(buildBgWindowView(input({ info })));
    expect(v.liveMatches).toHaveLength(1);
    expect(v.liveMatches[0]).toMatchObject({ id: 9, canWatch: true, watching: false });
  });

  it('withholds Watch while queued or in a match', () => {
    const queued = makeBgInfo('sim', { queued: true, liveMatches: [liveMatch()] });
    expect(live(buildBgWindowView(input({ info: queued }))).liveMatches[0].canWatch).toBe(false);
    const inMatch = makeBgInfo('sim', {
      match: { id: 4 } as unknown as BgMatchInfo,
      liveMatches: [liveMatch()],
    });
    expect(live(buildBgWindowView(input({ info: inMatch }))).liveMatches[0].canWatch).toBe(false);
  });

  it('marks the watched match and surfaces the spectating id', () => {
    const info = makeBgInfo('sim', {
      spectating: 2,
      liveMatches: [liveMatch({ id: 1 }), liveMatch({ id: 2 })],
    });
    const v = live(buildBgWindowView(input({ info })));
    expect(v.spectating).toBe(2);
    expect(v.liveMatches.map((m) => m.watching)).toEqual([false, true]);
  });
});

describe('buildBgWindowView: ladder + practice', () => {
  it('ranks and me-flags the ladder, marking known classes', () => {
    const v = live(buildBgWindowView(input()));
    expect(v.ladder.map((r) => r.rank)).toEqual([1, 2]);
    expect(v.ladder.map((r) => r.me)).toEqual([true, false]);
    expect(v.ladder.every((r) => r.knownClass)).toBe(true);
  });

  it('flags an unknown class id and carries the raw id through', () => {
    const info = makeBgInfo('sim', {
      ladder: [{ pid: 9, name: 'Mystery', cls: 'not_a_class', rating: 1200, wins: 1, losses: 1 }],
    } as unknown as Partial<BgInfo>);
    const v = live(buildBgWindowView(input({ info })));
    expect(v.ladder[0].knownClass).toBe(false);
    expect(v.ladder[0].cls).toBe('not_a_class');
  });

  it('shows Practice only when the hook is wired and not queued / in a match', () => {
    expect(live(buildBgWindowView(input({ practiceAvailable: true }))).practice).toBe(true);
    expect(live(buildBgWindowView(input({ practiceAvailable: false }))).practice).toBe(false);
    const queued = makeBgInfo('sim', { queued: true });
    expect(live(buildBgWindowView(input({ info: queued, practiceAvailable: true }))).practice).toBe(
      false,
    );
  });
});

describe('buildBgWindowView: render-skip signature', () => {
  it('is stable across identical snapshots and moves when the data changes', () => {
    const a = live(buildBgWindowView(input())).sig;
    const b = live(buildBgWindowView(input())).sig;
    expect(a).toBe(b);
    const changed = live(
      buildBgWindowView(input({ info: makeBgInfo('sim', { queued: true, position: 1 }) })),
    ).sig;
    expect(changed).not.toBe(a);
  });
});
