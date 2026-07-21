// Pure-core tests for the Vale Cup pre-match briefing overlay
// (vale_cup_briefing_view.ts). Fed BOTH a Sim-shaped stub (extra junk fields
// the core must ignore) AND a ClientWorld-mirror-shaped stub
// (tests/arena_window_view.test.ts / vale_cup_hud_view.test.ts pattern), and
// pins the structural-vs-elided sig split precisely: briefingLeft, the
// per-fighter ready flags, and iAmReady stay OUT of the skeleton sig.

import { describe, expect, it } from 'vitest';
import { SPORT_KITS } from '../src/sim/content/vale_cup';
import { buildVcupBriefingView } from '../src/ui/vale_cup_briefing_view';
import type { CupInfo } from '../src/world_api';

function makeCupInfo(shape: 'sim' | 'client', over: Partial<CupInfo> = {}): CupInfo {
  const junk = shape === 'sim' ? { _seq: 7, _pending: [3, 4] } : {};
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
    id: 9,
    phase: 'briefing',
    countdown: 0,
    timeLeft: 360,
    golden: false,
    scoreA: 0,
    scoreB: 0,
    nationA: 'thornpeak',
    nationB: 'mirefen',
    awayPalette: false,
    team: 'B',
    teamA: [
      {
        pid: 2,
        name: 'Bram',
        role: 'keeper',
        me: false,
        bot: true,
        ready: true,
        wins: 0,
        losses: 0,
        guild: '',
      },
      {
        pid: 3,
        name: 'Rook',
        role: 'striker',
        me: false,
        bot: true,
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
        role: 'sweeper',
        me: true,
        bot: false,
        ready: false,
        wins: 0,
        losses: 0,
        guild: '',
      },
      {
        pid: 4,
        name: 'Ally',
        role: 'striker',
        me: false,
        bot: true,
        ready: true,
        wins: 0,
        losses: 0,
        guild: '',
      },
    ],
    ballId: 42,
    kickoffTeam: 'A',
    briefingLeft: 12,
    iAmReady: false,
    holderPid: null,
    bets: { open: true, poolA: 0, poolB: 0, count: 0, myStake: 0, mySide: null },
    origin: { x: 0, z: 0 },
    ...over,
  };
}

describe('vale_cup_briefing_view', () => {
  it('is hidden without a match and outside the briefing phase', () => {
    expect(buildVcupBriefingView(null).visible).toBe(false);
    expect(buildVcupBriefingView(makeCupInfo('sim')).visible).toBe(false);
    expect(
      buildVcupBriefingView(makeCupInfo('sim', { match: makeMatch({ phase: 'active' }) })).visible,
    ).toBe(false);
    expect(
      buildVcupBriefingView(makeCupInfo('sim', { match: makeMatch({ phase: 'countdown' }) }))
        .visible,
    ).toBe(false);
  });

  it('derives the overlay from the briefing snapshot', () => {
    const v = buildVcupBriefingView(makeCupInfo('sim', { match: makeMatch() }));
    expect(v).toMatchObject({
      visible: true,
      nationA: 'thornpeak',
      nationB: 'mirefen',
      awayPalette: false,
      myTeam: 'B',
      myRole: 'sweeper',
      iAmReady: false,
      briefingLeft: 12,
      format: 2,
    });
    expect(v.teamA.map((p) => p.name)).toEqual(['Bram', 'Rook']);
    expect(v.teamB.map((p) => p.name)).toEqual(['Me', 'Ally']);
  });

  it('takes the kit from my role (SPORT_KITS)', () => {
    const v = buildVcupBriefingView(makeCupInfo('sim', { match: makeMatch() }));
    expect(v.kit.map((k) => k.abilityId)).toEqual([...SPORT_KITS.sweeper]);
  });

  it('falls back to the all-rounder kit when my roster entry is absent', () => {
    const v = buildVcupBriefingView(
      makeCupInfo('sim', {
        match: makeMatch({
          team: null,
          teamB: [
            {
              pid: 1,
              name: 'Sub',
              role: 'striker',
              me: false,
              bot: true,
              ready: false,
              wins: 0,
              losses: 0,
              guild: '',
            },
          ],
        }),
      }),
    );
    expect(v.myRole).toBeNull();
    expect(v.kit.map((k) => k.abilityId)).toEqual([...SPORT_KITS.allrounder]);
  });

  it('rounds the auto-ready countdown up (a 4.2s briefing reads 5)', () => {
    const v = buildVcupBriefingView(
      makeCupInfo('sim', { match: makeMatch({ briefingLeft: 4.2 }) }),
    );
    expect(v.briefingLeft).toBe(5);
  });

  it('keeps the structural sig stable across briefingLeft / ready / iAmReady movement', () => {
    const base = buildVcupBriefingView(makeCupInfo('sim', { match: makeMatch() }));
    const moved = buildVcupBriefingView(
      makeCupInfo('sim', {
        match: makeMatch({
          briefingLeft: 3,
          iAmReady: true,
          teamA: [
            {
              pid: 2,
              name: 'Bram',
              role: 'keeper',
              me: false,
              bot: true,
              ready: false,
              wins: 0,
              losses: 0,
              guild: '',
            },
            {
              pid: 3,
              name: 'Rook',
              role: 'striker',
              me: false,
              bot: true,
              ready: true,
              wins: 0,
              losses: 0,
              guild: '',
            },
          ],
          teamB: [
            {
              pid: 1,
              name: 'Me',
              role: 'sweeper',
              me: true,
              bot: false,
              ready: true,
              wins: 0,
              losses: 0,
              guild: '',
            },
            {
              pid: 4,
              name: 'Ally',
              role: 'striker',
              me: false,
              bot: true,
              ready: false,
              wins: 0,
              losses: 0,
              guild: '',
            },
          ],
        }),
      }),
    );
    expect(moved.sig).toBe(base.sig);
  });

  it('rebuilds the skeleton when the roster, nations, or my role change', () => {
    const base = buildVcupBriefingView(makeCupInfo('sim', { match: makeMatch() }));
    // a new fighter joins the sheet
    const roster = buildVcupBriefingView(
      makeCupInfo('sim', {
        match: makeMatch({
          teamA: [
            {
              pid: 2,
              name: 'Bram',
              role: 'keeper',
              me: false,
              bot: true,
              ready: true,
              wins: 0,
              losses: 0,
              guild: '',
            },
            {
              pid: 5,
              name: 'Fox',
              role: 'sweeper',
              me: false,
              bot: true,
              ready: false,
              wins: 0,
              losses: 0,
              guild: '',
            },
          ],
        }),
      }),
    );
    expect(roster.sig).not.toBe(base.sig);
    // different banners
    const nations = buildVcupBriefingView(
      makeCupInfo('sim', { match: makeMatch({ nationA: 'ogre' }) }),
    );
    expect(nations.sig).not.toBe(base.sig);
    // my role changed
    const role = buildVcupBriefingView(
      makeCupInfo('sim', {
        match: makeMatch({
          teamB: [
            {
              pid: 1,
              name: 'Me',
              role: 'keeper',
              me: true,
              bot: false,
              ready: false,
              wins: 0,
              losses: 0,
              guild: '',
            },
            {
              pid: 4,
              name: 'Ally',
              role: 'striker',
              me: false,
              bot: true,
              ready: true,
              wins: 0,
              losses: 0,
              guild: '',
            },
          ],
        }),
      }),
    );
    expect(role.sig).not.toBe(base.sig);
  });

  it('renders identically from Sim-shaped and mirror-shaped stubs', () => {
    const over: Partial<CupInfo> = {
      match: makeMatch({ awayPalette: true, nationB: 'thornpeak', iAmReady: true }),
    };
    expect(buildVcupBriefingView(makeCupInfo('sim', over))).toEqual(
      buildVcupBriefingView(makeCupInfo('client', over)),
    );
  });
});
