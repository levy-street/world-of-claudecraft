import { describe, expect, it } from 'vitest';
import {
  boundedInt,
  evaluateStaging,
  parseHeartbeat,
  parseSimline,
  timingPair,
} from '../scripts/lib/mob_stall_parse.mjs';

// Real lines captured verbatim from a local `npm run server` with PERF_TICK_LOG=1
// (the emitters live in server/game.ts). If the heartbeat format changes, these
// fixtures must be refreshed from a live run, not hand-edited.
const REAL_HEARTBEAT =
  '[perf] online=20 ents=430 tickHz=20.1 tickMs=1.83 | p95/max total=2.82/7.27 tick=1.19/2.74 broadcast=1.44/4.07 bcastSelf=0.47/2.02 bcastGrid=0.59/1.04 events=0.02/0.66 social=0/0.05 | visits=1941 serializes=75 serializeMs=0.13 aggroVisits=131 threatVisits=0';
const REAL_SIMLINE =
  '[perf.sim] mean/p95/max mob.update=0.24/0.33/0.73 p.move=0.17/0.34/1.18 despawnDecay=0.1/0.13/0.18 mob.auras=0.07/0.11/0.26 mob.update|beast=0.07/0.11/0.34 mob.update|humanoid=0.04/0.08/0.15 mob.update|undead=0.04/0.06/0.06 deeds=0.03/0.29/0.98 gridRefresh=0.03/0.05/0.09 p.regen=0.02/0.04/0.14 arena=0.02/0.02/0.28 mob.update|mudfin=0.02/0.04/0.07 mob.update|spider=0.02/0.03/0.04 mob.update|burrower=0.02/0.03/0.04';
// Synthetic, following the server template exactly: ` OVER` lands right after
// tickMs and before the ` | p95/max` section when the tick went over budget,
// and tickHz prints `n/a` until the rate window fills.
const OVER_HEARTBEAT =
  '[perf] online=80 ents=641 tickHz=19.2 tickMs=61.02 OVER | p95/max total=64.11/98.5 tick=55.2/73.4 broadcast=6.14/9.8 | visits=9000 serializes=300 serializeMs=1.9 aggroVisits=584 threatVisits=12';
const NA_HEARTBEAT =
  '[perf] online=0 ents=412 tickHz=n/a tickMs=0.42 | p95/max total=0.5/0.9 tick=0.2/0.3 | visits=0 serializes=0 serializeMs=0 aggroVisits=0 threatVisits=0';

describe('timingPair', () => {
  it('extracts the exact pair for a named bucket', () => {
    expect(timingPair('total', REAL_HEARTBEAT)).toEqual({ p95: 2.82, max: 7.27 });
    expect(timingPair('bcastGrid', REAL_HEARTBEAT)).toEqual({ p95: 0.59, max: 1.04 });
    expect(timingPair('social', REAL_HEARTBEAT)).toEqual({ p95: 0, max: 0.05 });
  });

  it('does not let tick= capture tickMs= or tickHz=', () => {
    expect(timingPair('tick', REAL_HEARTBEAT)).toEqual({ p95: 1.19, max: 2.74 });
    expect(timingPair('tick', NA_HEARTBEAT)).toEqual({ p95: 0.2, max: 0.3 });
  });

  it('returns null for a bucket missing from the line', () => {
    expect(timingPair('events', NA_HEARTBEAT)).toBeNull();
    expect(timingPair('nosuch', REAL_HEARTBEAT)).toBeNull();
  });
});

describe('parseHeartbeat', () => {
  it('parses every field of a real heartbeat line', () => {
    const hb = parseHeartbeat(REAL_HEARTBEAT);
    expect(hb.online).toBe(20);
    expect(hb.ents).toBe(430);
    expect(hb.tickHz).toBe(20.1);
    expect(hb.tickMs).toBe(1.83);
    expect(hb.over).toBe(false);
    expect(hb.visits).toBe(1941);
    expect(hb.serializes).toBe(75);
    expect(hb.serializeMs).toBe(0.13);
    expect(hb.aggroVisits).toBe(131);
    expect(hb.threatVisits).toBe(0);
    expect(hb.timings.tick).toEqual({ p95: 1.19, max: 2.74 });
    expect(hb.timings.social).toEqual({ p95: 0, max: 0.05 });
    expect(Object.keys(hb.timings).sort()).toEqual(
      ['bcastGrid', 'bcastSelf', 'broadcast', 'events', 'social', 'tick', 'total'].sort(),
    );
  });

  it('flags the OVER token and only the standalone token', () => {
    expect(parseHeartbeat(OVER_HEARTBEAT).over).toBe(true);
    expect(parseHeartbeat(REAL_HEARTBEAT).over).toBe(false);
    expect(parseHeartbeat(REAL_HEARTBEAT.replace('| visits', '| OVERLOAD=1 visits')).over).toBe(
      false,
    );
  });

  it('maps tickHz=n/a to null', () => {
    const hb = parseHeartbeat(NA_HEARTBEAT);
    expect(hb.tickHz).toBeNull();
    expect(hb.tickMs).toBe(0.42);
  });
});

describe('parseSimline', () => {
  it('captures the aggregate mob.update bucket and its family children', () => {
    const buckets = parseSimline(REAL_SIMLINE);
    expect(buckets['mob.update']).toEqual({ mean: 0.24, p95: 0.33, max: 0.73 });
    expect(buckets['mob.update|beast']).toEqual({ mean: 0.07, p95: 0.11, max: 0.34 });
    expect(buckets['mob.update|mudfin']).toEqual({ mean: 0.02, p95: 0.04, max: 0.07 });
    expect(buckets['p.move']).toEqual({ mean: 0.17, p95: 0.34, max: 1.18 });
    expect(Object.keys(buckets)).toHaveLength(14);
  });

  it('treats a bucket absent from the top-14 as missing, never zero', () => {
    const buckets = parseSimline(REAL_SIMLINE);
    expect(buckets['mob.update|elemental']).toBeUndefined();
    expect('worldBosses' in buckets).toBe(false);
  });

  it('accepts family names containing digits and underscores', () => {
    const buckets = parseSimline('[perf.sim] mean/p95/max mob.update|dire_wolf2=0.01/0.02/0.03');
    expect(buckets['mob.update|dire_wolf2']).toEqual({ mean: 0.01, p95: 0.02, max: 0.03 });
  });
});

describe('evaluateStaging', () => {
  it('reports empty when no heartbeats were parsed at all', () => {
    const v = evaluateStaging([], 'aggro', 20);
    expect(v.ok).toBe(false);
    expect(v.empty).toBe(true);
    expect(v.detail).toBe('no [perf] heartbeat lines were observed during the staging window');
  });

  it('passes the aggro signature at exactly the crowd size and fails one below', () => {
    const pass = evaluateStaging([{ aggroVisits: 20, threatVisits: 0 }], 'aggro', 20);
    expect(pass).toEqual({
      ok: true,
      empty: false,
      detail: 'aggroVisits max=20 (need >= 20); threatVisits max=0 (expect ~0)',
    });
    expect(evaluateStaging([{ aggroVisits: 19, threatVisits: 0 }], 'aggro', 20).ok).toBe(false);
  });

  it('takes the max across heartbeats and treats null counters as zero', () => {
    const v = evaluateStaging(
      [
        { aggroVisits: null, threatVisits: null },
        { aggroVisits: 44, threatVisits: 3 },
        { aggroVisits: 12, threatVisits: 1 },
      ],
      'aggro',
      40,
    );
    expect(v.ok).toBe(true);
    expect(v.detail).toBe('aggroVisits max=44 (need >= 40); threatVisits max=3 (expect ~0)');
  });

  it('passes the threat signature at the half-crowd floor with a minimum of 2', () => {
    expect(evaluateStaging([{ aggroVisits: 0, threatVisits: 10 }], 'threat', 20).ok).toBe(true);
    expect(evaluateStaging([{ aggroVisits: 0, threatVisits: 9 }], 'threat', 20).ok).toBe(false);
    expect(evaluateStaging([{ aggroVisits: 0, threatVisits: 2 }], 'threat', 3).ok).toBe(true);
    expect(evaluateStaging([{ aggroVisits: 0, threatVisits: 1 }], 'threat', 3).ok).toBe(false);
  });
});

describe('boundedInt', () => {
  it('clamps, truncates, and falls back', () => {
    expect(boundedInt('5', 20, 1, 100)).toBe(5);
    expect(boundedInt('999', 20, 1, 100)).toBe(100);
    expect(boundedInt('-3', 20, 1, 100)).toBe(1);
    expect(boundedInt('7.9', 20, 1, 100)).toBe(7);
    expect(boundedInt('abc', 20, 1, 100)).toBe(20);
    expect(boundedInt(undefined, 20, 1, 100)).toBe(20);
  });

  it('treats a set-but-empty env value as unset, not as zero', () => {
    expect(boundedInt('', 20, 1, 100)).toBe(20);
  });
});
