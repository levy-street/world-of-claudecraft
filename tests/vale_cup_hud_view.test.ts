// Tests for the two per-frame Vale Cup pure cores:
//  - vale_cup_indicator_view.ts (the persistent button: hidden / queued / live,
//    with the clock deliberately OUTSIDE the structural sig),
//  - vale_cup_hud_view.ts (the in-match strip: score, count-down clock, phase).
// Both are fed a Sim-shaped stub (extra junk fields the cores must ignore) AND
// a ClientWorld-mirror-shaped stub (tests/arena_window_view.test.ts pattern).

import { describe, expect, it } from 'vitest';
import { buildVcupHudView } from '../src/ui/vale_cup_hud_view';
import { buildVcupIndicatorView } from '../src/ui/vale_cup_indicator_view';
import type { CupInfo } from '../src/world_api';

function makeCupInfo(shape: 'sim' | 'client', over: Partial<CupInfo> = {}): CupInfo {
  const junk = shape === 'sim' ? { _seq: 3, _pending: [1, 2] } : {};
  return {
    standing: { wins: 0, losses: 0, draws: 0 },
    queued: false,
    bracket: null,
    nation: null,
    role: null,
    position: 0,
    queueSizes: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    deserterFor: 0,
    match: null,
    live: null,
    board: [],
    ...junk,
    ...over,
  } as unknown as CupInfo;
}

function makeMatch(
  over: Partial<NonNullable<CupInfo['match']>> = {},
): NonNullable<CupInfo['match']> {
  return {
    id: 5,
    phase: 'active',
    countdown: 0,
    timeLeft: 359,
    golden: false,
    scoreA: 0,
    scoreB: 3,
    nationA: 'thornpeak',
    nationB: 'mirefen',
    awayPalette: false,
    team: 'B',
    teamA: [
      {
        pid: 2,
        name: 'A',
        role: 'allrounder',
        me: false,
        bot: false,
        ready: false,
        wins: 0,
        losses: 0,
        guild: '',
      },
    ],
    teamB: [
      {
        pid: 1,
        name: 'Me',
        role: 'allrounder',
        me: true,
        bot: false,
        ready: false,
        wins: 0,
        losses: 0,
        guild: '',
      },
    ],
    ballId: 42,
    kickoffTeam: 'A',
    briefingLeft: 0,
    iAmReady: false,
    holderPid: null,
    bets: { open: false, poolA: 0, poolB: 0, count: 0, myStake: 0, mySide: null },
    origin: { x: 0, z: 0 },
    ...over,
  };
}

describe('vale_cup_indicator_view', () => {
  it('hides with no snapshot and when nothing is happening', () => {
    expect(buildVcupIndicatorView(null).kind).toBe('hidden');
    expect(buildVcupIndicatorView(makeCupInfo('sim')).kind).toBe('hidden');
  });

  it('hides inside my own match (the match strip owns the screen)', () => {
    const v = buildVcupIndicatorView(makeCupInfo('sim', { match: makeMatch() }));
    expect(v.kind).toBe('hidden');
  });

  it('shows the queued state with bracket, position, and queue size', () => {
    const v = buildVcupIndicatorView(
      makeCupInfo('sim', {
        queued: true,
        bracket: 3,
        role: 'striker',
        position: 2,
        queueSizes: { 1: 0, 2: 0, 3: 4, 4: 0, 5: 0 },
      }),
    );
    expect(v).toEqual({
      kind: 'queued',
      bracket: 3,
      position: 2,
      waiting: 4,
      role: 'striker',
      sig: 'q|3|2|4',
    });
  });

  it('shows the live state with a split clock OUTSIDE the structural sig', () => {
    const at = (clock: number) =>
      buildVcupIndicatorView(
        makeCupInfo('sim', {
          live: {
            id: 8,
            bracket: 2,
            clock,
            scoreA: 1,
            scoreB: 1,
            nationA: 'vale',
            nationB: 'vale',
          },
        }),
      );
    const a = at(65);
    expect(a).toMatchObject({
      kind: 'live',
      nationA: 'vale',
      nationB: 'vale',
      awayPalette: true,
      scoreA: 1,
      scoreB: 1,
      minutes: 1,
      seconds: 5,
    });
    // the per-second tick must NOT move the sig (elided setText carries it)
    expect(at(66).sig).toBe(a.sig);
    expect(at(66)).toMatchObject({ minutes: 1, seconds: 6 });
  });

  it('renders identically from Sim-shaped and mirror-shaped stubs', () => {
    const over: Partial<CupInfo> = {
      live: {
        id: 1,
        bracket: 5,
        clock: 30,
        scoreA: 0,
        scoreB: 2,
        nationA: 'ogre',
        nationB: 'moon',
      },
    };
    expect(buildVcupIndicatorView(makeCupInfo('sim', over))).toEqual(
      buildVcupIndicatorView(makeCupInfo('client', over)),
    );
  });
});

describe('vale_cup_hud_view', () => {
  it('is inactive without a match', () => {
    expect(buildVcupHudView(null).active).toBe(false);
    expect(buildVcupHudView(makeCupInfo('sim')).active).toBe(false);
  });

  it('stays inactive during the briefing phase (the overlay owns the screen then)', () => {
    const v = buildVcupHudView(makeCupInfo('sim', { match: makeMatch({ phase: 'briefing' }) }));
    expect(v.active).toBe(false);
  });

  it('derives the strip from the match snapshot', () => {
    const v = buildVcupHudView(makeCupInfo('sim', { match: makeMatch() }));
    expect(v).toMatchObject({
      active: true,
      nationA: 'thornpeak',
      nationB: 'mirefen',
      scoreA: 0,
      scoreB: 3,
      phase: 'active',
      minutes: 5,
      seconds: 59,
      myTeam: 'B',
    });
  });

  it('rounds the kickoff countdown up (a 2.2s countdown reads 3)', () => {
    const v = buildVcupHudView(
      makeCupInfo('sim', { match: makeMatch({ phase: 'countdown', countdown: 2.2 }) }),
    );
    expect(v.phase).toBe('countdown');
    expect(v.countdown).toBe(3);
  });

  it('keeps the structural sig stable across score/clock/phase movement', () => {
    const base = buildVcupHudView(makeCupInfo('sim', { match: makeMatch() }));
    const moved = buildVcupHudView(
      makeCupInfo('sim', { match: makeMatch({ scoreA: 2, timeLeft: 100, phase: 'goal' }) }),
    );
    expect(moved.sig).toBe(base.sig);
    // but a new match (or new nations) rebuilds the skeleton
    const other = buildVcupHudView(makeCupInfo('sim', { match: makeMatch({ id: 6 }) }));
    expect(other.sig).not.toBe(base.sig);
  });

  it('keeps the strip up through the aftermath (phase over + returnIn)', () => {
    const v = buildVcupHudView(
      makeCupInfo('sim', { match: makeMatch({ phase: 'over', returnIn: 3.4 }) }),
    );
    expect(v.active).toBe(true);
    expect(v.phase).toBe('over');
    expect(v.returnIn).toBe(4);
  });

  it('renders identically from Sim-shaped and mirror-shaped stubs', () => {
    const over: Partial<CupInfo> = { match: makeMatch({ golden: true, phase: 'golden' }) };
    expect(buildVcupHudView(makeCupInfo('sim', over))).toEqual(
      buildVcupHudView(makeCupInfo('client', over)),
    );
  });
});
