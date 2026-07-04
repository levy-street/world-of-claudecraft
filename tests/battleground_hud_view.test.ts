// Tests for the in-match battleground HUD pure core (battleground_hud_view.ts):
//  - hidden without a match,
//  - the strip derivation (kills, count-down timer, per-team structure pips in
//    warstone-first order, Knell status precedence),
//  - the countdown / respawn / aftermath sub-states per match phase,
//  - the text-independent strip sig,
//  - same-shape parity: a Sim-shaped BgMatchInfo (junk extra fields) and a
//    ClientWorld-mirror-shaped one render identically (arena pattern).

import { describe, expect, it } from 'vitest';
import { buildBgHudView } from '../src/ui/battleground_hud_view';
import type { BgMatchInfo, BgStructureView } from '../src/world_api';

function structure(over: Partial<BgStructureView>): BgStructureView {
  return {
    id: 'a_west_outer',
    team: 'A',
    kind: 'bulwark',
    lane: 'west',
    tier: 'outer',
    x: 0,
    z: 0,
    hpFrac: 1,
    alive: true,
    shielded: false,
    ...over,
  };
}

/** A BgMatchInfo snapshot. `shape: 'sim'` carries junk fields the core ignores. */
function makeMatch(shape: 'sim' | 'client', over: Partial<BgMatchInfo> = {}): BgMatchInfo {
  const junk = shape === 'sim' ? { _laneTimers: [3, 5], _rngCursor: 12 } : {};
  return {
    id: 1,
    state: 'active',
    countdown: 0,
    timeLeft: 522,
    team: 'A',
    killsA: 4,
    killsB: 7,
    structures: [
      structure({ id: 'a_warstone', kind: 'warstone', lane: null, tier: null }),
      structure({ id: 'a_west_outer', alive: false }),
      structure({ id: 'b_warstone', team: 'B', kind: 'warstone', lane: null, tier: null }),
      structure({ id: 'b_west_outer', team: 'B' }),
    ],
    knell: { alive: true, spawnsIn: 0, x: 0, z: 0 },
    knellSilencedBy: null,
    knellSilencedFor: 0,
    teamA: [],
    teamB: [],
    down: false,
    respawnIn: 0,
    allies: [],
    origin: { x: 9900, z: -1250 },
    rated: true,
    ...junk,
    ...over,
  } as unknown as BgMatchInfo;
}

function activeView(match: BgMatchInfo) {
  const v = buildBgHudView(match);
  if (v.kind !== 'match') throw new Error('expected a match view');
  return v;
}

describe('buildBgHudView: visibility', () => {
  it('hides without a match', () => {
    expect(buildBgHudView(null).kind).toBe('hidden');
  });

  it('shows for a live match', () => {
    expect(buildBgHudView(makeMatch('sim')).kind).toBe('match');
  });
});

describe('buildBgHudView: the strip', () => {
  it('carries kills, the count-down timer, and my team', () => {
    const v = activeView(makeMatch('sim'));
    expect(v.strip).toMatchObject({ myTeam: 'A', killsA: 4, killsB: 7, timeLeft: 522 });
  });

  it('orders pips warstone-first per team and marks destroyed ones', () => {
    const v = activeView(makeMatch('sim'));
    expect(v.strip.pipsA.map((p) => p.kind)).toEqual(['warstone', 'bulwark']);
    expect(v.strip.pipsA.map((p) => p.alive)).toEqual([true, false]);
    expect(v.strip.pipsB.every((p) => p.alive)).toBe(true);
  });

  it('reports the Knell up / spawns-in / silenced states, silence winning', () => {
    expect(activeView(makeMatch('sim')).strip.knell).toEqual({ kind: 'up' });
    expect(
      activeView(makeMatch('sim', { knell: { alive: false, spawnsIn: 45, x: 0, z: 0 } })).strip
        .knell,
    ).toEqual({ kind: 'spawns', seconds: 45 });
    // Silence is the headline even while the Warden is down awaiting respawn.
    expect(
      activeView(
        makeMatch('sim', {
          knell: { alive: false, spawnsIn: 45, x: 0, z: 0 },
          knellSilencedBy: 'B',
          knellSilencedFor: 31,
        }),
      ).strip.knell,
    ).toEqual({ kind: 'silenced', team: 'B', seconds: 31 });
  });
});

describe('buildBgHudView: phases', () => {
  it('exposes the countdown during the countdown state only', () => {
    const v = activeView(makeMatch('sim', { state: 'countdown', countdown: 6 }));
    expect(v.countdown).toBe(6);
    expect(v.respawn).toBeNull();
    expect(v.aftermath).toBeNull();
    expect(activeView(makeMatch('sim')).countdown).toBeNull();
  });

  it('exposes the respawn clock while down in an active match', () => {
    const v = activeView(makeMatch('sim', { down: true, respawnIn: 9 }));
    expect(v.respawn).toBe(9);
    // Benched during the countdown is not a respawn overlay.
    expect(
      activeView(makeMatch('sim', { state: 'countdown', countdown: 3, down: true, respawnIn: 9 }))
        .respawn,
    ).toBeNull();
  });

  it('exposes the aftermath outcome + return clock once over', () => {
    const v = activeView(makeMatch('sim', { state: 'over', outcome: 'win', returnIn: 8 }));
    expect(v.aftermath).toEqual({ outcome: 'win', returnIn: 8 });
    expect(activeView(makeMatch('sim')).aftermath).toBeNull();
  });
});

describe('buildBgHudView: render-skip signature + parity', () => {
  it('keeps the strip sig text-independent, stable, and change-sensitive', () => {
    const a = activeView(makeMatch('sim')).strip.sig;
    expect(a).toBe(activeView(makeMatch('sim')).strip.sig);
    expect(/^[A-Za-z0-9|]+$/.test(a)).toBe(true);
    expect(activeView(makeMatch('sim', { killsA: 5 })).strip.sig).not.toBe(a);
    expect(activeView(makeMatch('sim', { timeLeft: 521 })).strip.sig).not.toBe(a);
  });

  it('renders identically from a Sim-shaped and a ClientWorld-shaped match', () => {
    expect(buildBgHudView(makeMatch('sim'))).toEqual(buildBgHudView(makeMatch('client')));
    const over: Partial<BgMatchInfo> = { state: 'over', outcome: 'draw', returnIn: 3 };
    expect(buildBgHudView(makeMatch('sim', over))).toEqual(
      buildBgHudView(makeMatch('client', over)),
    );
  });
});
