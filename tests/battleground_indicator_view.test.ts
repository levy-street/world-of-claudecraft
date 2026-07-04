// Tests for the battleground indicator pure core (battleground_indicator_view.ts):
//  - the priority order (in-match / spectating hide it; queued beats live),
//  - the headline live-match pick (fullest match wins),
//  - the text-independent render-skip signature,
//  - same-shape parity: a Sim-shaped snapshot (with junk extra fields) and a
//    ClientWorld-mirror-shaped snapshot with the same logical data render an
//    identical view, plus same-input determinism (arena_window_view pattern).

import { describe, expect, it } from 'vitest';
import { buildBgIndicatorView } from '../src/ui/battleground_indicator_view';
import type { BgInfo, BgLiveMatch, BgMatchInfo } from '../src/world_api';

function liveMatch(over: Partial<BgLiveMatch> = {}): BgLiveMatch {
  return {
    id: 1,
    elapsed: 462,
    killsA: 12,
    killsB: 9,
    structuresDownA: 1,
    structuresDownB: 2,
    players: 10,
    ...over,
  };
}

/** A BgInfo snapshot. `shape: 'sim'` carries extra fields the core must ignore. */
function makeBgInfo(shape: 'sim' | 'client', over: Partial<BgInfo> = {}): BgInfo {
  const junk = shape === 'sim' ? { _tickSeq: 41, _dirtyFlags: ['queue'] } : {};
  return {
    standing: { rating: 1500, wins: 3, losses: 1 },
    queued: false,
    queueSize: 0,
    position: 0,
    waitSec: 0,
    deserterFor: 0,
    match: null,
    liveMatches: [],
    ladder: [],
    spectating: null,
    ...junk,
    ...over,
  } as unknown as BgInfo;
}

describe('buildBgIndicatorView: state priority', () => {
  it('hides when there is no snapshot yet (online not synced)', () => {
    expect(buildBgIndicatorView(null).kind).toBe('hidden');
  });

  it('hides while in a match (the in-match HUD takes over)', () => {
    const info = makeBgInfo('sim', {
      match: { id: 7 } as unknown as BgMatchInfo,
      queued: false,
      liveMatches: [liveMatch()],
    });
    expect(buildBgIndicatorView(info).kind).toBe('hidden');
  });

  it('hides while spectating (the spectate badge shows instead)', () => {
    const info = makeBgInfo('sim', { spectating: 3, liveMatches: [liveMatch({ id: 3 })] });
    expect(buildBgIndicatorView(info).kind).toBe('hidden');
  });

  it('shows the queue state, beating a live match', () => {
    const info = makeBgInfo('sim', {
      queued: true,
      position: 4,
      waitSec: 93,
      liveMatches: [liveMatch()],
    });
    const v = buildBgIndicatorView(info);
    expect(v).toMatchObject({ kind: 'queued', position: 4, waitSec: 93 });
  });

  it('shows the fullest live match when idle', () => {
    const info = makeBgInfo('sim', {
      liveMatches: [liveMatch({ id: 1, players: 6 }), liveMatch({ id: 2, players: 9 })],
    });
    const v = buildBgIndicatorView(info);
    expect(v).toMatchObject({ kind: 'live', matchId: 2 });
  });

  it('hides when idle with nothing running', () => {
    expect(buildBgIndicatorView(makeBgInfo('sim')).kind).toBe('hidden');
  });
});

describe('buildBgIndicatorView: render-skip signature', () => {
  it('is text-independent, stable for identical input, moved by data changes', () => {
    const a = buildBgIndicatorView(makeBgInfo('sim', { queued: true, position: 2, waitSec: 10 }));
    const b = buildBgIndicatorView(makeBgInfo('sim', { queued: true, position: 2, waitSec: 10 }));
    expect(a.sig).toBe(b.sig);
    expect(/^[a-z0-9|]+$/i.test(a.sig)).toBe(true); // kind + numbers, no prose
    const c = buildBgIndicatorView(makeBgInfo('sim', { queued: true, position: 2, waitSec: 11 }));
    expect(c.sig).not.toBe(a.sig);
    // Distinct states never share a sig.
    const live = buildBgIndicatorView(makeBgInfo('sim', { liveMatches: [liveMatch()] }));
    expect(live.sig).not.toBe(a.sig);
    expect(buildBgIndicatorView(null).sig).not.toBe(a.sig);
  });
});

describe('buildBgIndicatorView: shape parity (the offline-vs-online trap)', () => {
  it('renders identically from a Sim-shaped and a ClientWorld-shaped snapshot', () => {
    const over: Partial<BgInfo> = { queued: true, position: 1, waitSec: 30 };
    expect(buildBgIndicatorView(makeBgInfo('sim', over))).toEqual(
      buildBgIndicatorView(makeBgInfo('client', over)),
    );
    const liveOver: Partial<BgInfo> = { liveMatches: [liveMatch()] };
    expect(buildBgIndicatorView(makeBgInfo('sim', liveOver))).toEqual(
      buildBgIndicatorView(makeBgInfo('client', liveOver)),
    );
  });

  it('is deterministic: identical inputs produce a deep-equal view', () => {
    const info = makeBgInfo('sim', { liveMatches: [liveMatch()] });
    expect(buildBgIndicatorView(info)).toEqual(buildBgIndicatorView(info));
  });
});
