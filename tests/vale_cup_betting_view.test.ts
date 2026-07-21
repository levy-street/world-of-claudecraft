// Pure-core tests for the Vale Cup spectator betting view (vale_cup_betting_view.ts):
//  - it is driven off cupInfo.spectate (the walk-up view), never cupInfo.match;
//  - the pool split, prize pool, and decimal odds are derived correctly;
//  - the structural sig excludes the live pool/odds/countdown/my-wager so the
//    card skeleton does not rebuild on the per-tick money movement.

import { describe, expect, it } from 'vitest';
import { buildVcupBettingView } from '../src/ui/vale_cup_betting_view';
import type { CupInfo, VcMatchInfo } from '../src/world_api';

function makeMatch(over: Partial<VcMatchInfo> = {}): VcMatchInfo {
  return {
    id: 11,
    phase: 'briefing',
    countdown: 0,
    timeLeft: 360,
    golden: false,
    scoreA: 0,
    scoreB: 0,
    nationA: 'vale',
    nationB: 'ogre',
    awayPalette: false,
    team: null,
    teamA: [
      {
        pid: 2,
        name: 'Hobb',
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
        pid: 3,
        name: 'Mera',
        role: 'keeper',
        me: false,
        bot: false,
        ready: true,
        wins: 4,
        losses: 2,
        guild: '',
      },
    ],
    ballId: null,
    kickoffTeam: 'A',
    holderPid: null,
    briefingLeft: 18,
    iAmReady: false,
    bets: { open: true, poolA: 300, poolB: 100, count: 3, myStake: 100, mySide: 'A' },
    origin: { x: 0, z: 0 },
    ...over,
  };
}

function makeCup(over: Partial<CupInfo> = {}): CupInfo {
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
    spectate: null,
    betRecord: { wins: 2, losses: 1, net: 250 },
    live: null,
    board: [],
    ...over,
  } as CupInfo;
}

describe('vale_cup_betting_view', () => {
  it('is hidden without a spectate view (and never keys off cupInfo.match)', () => {
    expect(buildVcupBettingView(null).visible).toBe(false);
    expect(buildVcupBettingView(makeCup()).visible).toBe(false);
    // A participant (cupInfo.match set, spectate null) does NOT get the banner.
    expect(buildVcupBettingView(makeCup({ match: makeMatch() })).visible).toBe(false);
  });

  it('derives the pool split, prize pool, and decimal odds', () => {
    const v = buildVcupBettingView(makeCup({ spectate: makeMatch() }));
    expect(v.visible).toBe(true);
    expect(v.prizePool).toBe(400);
    expect(v.pctA).toBe(75);
    expect(v.pctB).toBe(25);
    // parimutuel payout multiplier = total / side pool
    expect(v.oddsA).toBeCloseTo(400 / 300, 5);
    expect(v.oddsB).toBeCloseTo(400 / 100, 5);
    expect(v.myStake).toBe(100);
    expect(v.mySide).toBe('A');
    expect(v.countdown).toBe(18);
    expect(v.record).toEqual({ wins: 2, losses: 1, net: 250 });
  });

  it('reads 50/50 with no odds on an empty pool', () => {
    const v = buildVcupBettingView(
      makeCup({
        spectate: makeMatch({
          bets: { open: true, poolA: 0, poolB: 0, count: 0, myStake: 0, mySide: null },
          origin: { x: 0, z: 0 },
        }),
      }),
    );
    expect(v.pctA).toBe(50);
    expect(v.pctB).toBe(50);
    expect(v.oddsA).toBeNull();
    expect(v.oddsB).toBeNull();
  });

  it('keeps the structural sig stable as the pool, odds, and countdown move', () => {
    const base = buildVcupBettingView(makeCup({ spectate: makeMatch() }));
    const moved = buildVcupBettingView(
      makeCup({
        spectate: makeMatch({
          briefingLeft: 3,
          bets: { open: true, poolA: 999, poolB: 500, count: 9, myStake: 500, mySide: 'B' },
          origin: { x: 0, z: 0 },
        }),
      }),
    );
    expect(moved.sig).toBe(base.sig);
    // but a different match (or roster) rebuilds the skeleton
    const other = buildVcupBettingView(makeCup({ spectate: makeMatch({ id: 12 }) }));
    expect(other.sig).not.toBe(base.sig);
  });

  // The per-side stake locks the painter applies as `disabled` + `.locked`:
  // a parimutuel wager is one-sided, so backing a side locks only the OTHER
  // side while the window is open, and closing the window locks both.
  it('locks neither side while the window is open and I have not bet', () => {
    const v = buildVcupBettingView(
      makeCup({
        spectate: makeMatch({
          bets: { open: true, poolA: 300, poolB: 100, count: 3, myStake: 0, mySide: null },
          origin: { x: 0, z: 0 },
        }),
      }),
    );
    expect(v.lockA).toBe(false);
    expect(v.lockB).toBe(false);
  });

  it('locks ONLY the opposite side once I have backed one', () => {
    const backedA = buildVcupBettingView(makeCup({ spectate: makeMatch() })); // mySide 'A'
    expect(backedA.lockA).toBe(false);
    expect(backedA.lockB).toBe(true);
    const backedB = buildVcupBettingView(
      makeCup({
        spectate: makeMatch({
          bets: { open: true, poolA: 300, poolB: 100, count: 3, myStake: 100, mySide: 'B' },
          origin: { x: 0, z: 0 },
        }),
      }),
    );
    expect(backedB.lockA).toBe(true);
    expect(backedB.lockB).toBe(false);
  });

  it('locks both sides once the wager window closes, whatever I backed', () => {
    for (const mySide of [null, 'A', 'B'] as const) {
      const v = buildVcupBettingView(
        makeCup({
          spectate: makeMatch({
            bets: { open: false, poolA: 300, poolB: 100, count: 3, myStake: 100, mySide },
            origin: { x: 0, z: 0 },
          }),
        }),
      );
      expect(v.lockA, `lockA with mySide=${mySide}`).toBe(true);
      expect(v.lockB, `lockB with mySide=${mySide}`).toBe(true);
    }
  });

  it('locks both sides on the inactive view (nothing to wager on)', () => {
    const v = buildVcupBettingView(null);
    expect(v.lockA).toBe(true);
    expect(v.lockB).toBe(true);
  });
});
