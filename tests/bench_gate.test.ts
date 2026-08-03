import { describe, expect, it } from 'vitest';
import type { CrowdSample } from '../scripts/lib/bench_gate.mjs';
import {
  COMPOSER_TIERS,
  evaluateCrowdRun,
  evaluateJitterRun,
  FULLSCREEN_DRAW_FLOOR,
  gapStats,
  minGapsFor,
  parseCeilingEnv,
  pct,
} from '../scripts/lib/bench_gate.mjs';

// A healthy fully-joined crowd sample; each case overrides the one field under test.
function crowdSample(over: Partial<CrowdSample> = {}): CrowdSample {
  return {
    label: 'crowd-50',
    fps: 48.5,
    tier: 'medium',
    calls: 900,
    expectedJoined: 50,
    actualJoined: 50,
    ...over,
  };
}

describe('evaluateCrowdRun join enforcement', () => {
  it('fails a partial join naming the joined and expected counts', () => {
    const v = evaluateCrowdRun({ samples: [crowdSample({ actualJoined: 47 })], minFps: null });
    expect(v.ok).toBe(false);
    expect(v.failures).toHaveLength(1);
    expect(v.failures[0]).toContain('joined 47 of 50');
  });

  it('enforces the join exactly, an overshoot fails too', () => {
    const v = evaluateCrowdRun({ samples: [crowdSample({ actualJoined: 51 })], minFps: null });
    expect(v.ok).toBe(false);
    expect(v.failures[0]).toContain('joined 51 of 50');
  });

  it('treats a missing actual-join count as a join failure, never a pass', () => {
    const v = evaluateCrowdRun({
      samples: [crowdSample({ actualJoined: undefined })],
      minFps: null,
    });
    expect(v.ok).toBe(false);
    expect(v.failures[0]).toContain('of 50');
  });

  it('passes an exact join and skips the join check on unstaged samples', () => {
    const solo = crowdSample({
      label: 'solo',
      expectedJoined: undefined,
      actualJoined: undefined,
    });
    const v = evaluateCrowdRun({ samples: [solo, crowdSample()], minFps: null });
    expect(v).toEqual({ ok: true, failures: [] });
  });

  it('fails a run that captured no samples at all', () => {
    const v = evaluateCrowdRun({ samples: [], minFps: null });
    expect(v.ok).toBe(false);
    expect(v.failures[0]).toContain('no samples');
  });
});

describe('evaluateCrowdRun min-fps ceiling', () => {
  it('passes at exactly the CROWD_MIN_FPS floor', () => {
    const v = evaluateCrowdRun({ samples: [crowdSample({ fps: 30 })], minFps: 30 });
    expect(v).toEqual({ ok: true, failures: [] });
  });

  it('fails one below the floor naming both values', () => {
    const v = evaluateCrowdRun({ samples: [crowdSample({ fps: 29 })], minFps: 30 });
    expect(v.ok).toBe(false);
    expect(v.failures).toHaveLength(1);
    expect(v.failures[0]).toContain('29');
    expect(v.failures[0]).toContain('30');
  });

  it('does not apply a floor when CROWD_MIN_FPS is unset', () => {
    const v = evaluateCrowdRun({ samples: [crowdSample({ fps: 2 })], minFps: null });
    expect(v.ok).toBe(true);
  });
});

describe('evaluateCrowdRun non-finite metric refusal', () => {
  it('treats a NaN fps as missing evidence even with no ceiling set', () => {
    const v = evaluateCrowdRun({ samples: [crowdSample({ fps: Number.NaN })], minFps: null });
    expect(v.ok).toBe(false);
    expect(v.failures[0]).toContain('not a finite number');
  });

  it('treats a null fps as missing evidence rather than letting it slide past the ceiling', () => {
    // NaN < minFps is false, so without the explicit refusal a dead fps counter would
    // silently PASS the ceiling comparison; that is exactly the finding-21 hole.
    const v = evaluateCrowdRun({ samples: [crowdSample({ fps: null })], minFps: 30 });
    expect(v.ok).toBe(false);
    expect(v.failures).toHaveLength(1);
    expect(v.failures[0]).toContain('missing evidence');
  });

  it('accumulates one attributed failure per bad sample across the run', () => {
    const v = evaluateCrowdRun({
      samples: [
        crowdSample({ label: 'crowd-25', expectedJoined: 25, actualJoined: 23 }),
        crowdSample({ label: 'crowd-50', fps: 12 }),
      ],
      minFps: 30,
    });
    expect(v.ok).toBe(false);
    expect(v.failures).toHaveLength(2);
    expect(v.failures[0]).toContain('crowd-25');
    expect(v.failures[1]).toContain('crowd-50');
  });
});

describe('evaluateCrowdRun composer-tier draw sanity', () => {
  it('fails a composer tier stuck at the fullscreen draw floor', () => {
    const v = evaluateCrowdRun({
      samples: [crowdSample({ tier: 'ultra', calls: 1 })],
      minFps: null,
    });
    expect(v.ok).toBe(false);
    expect(v.failures[0]).toContain('fullscreen floor');
  });

  it.each(['medium', 'insane'])('enforces the fullscreen floor for %s', (tier) => {
    const v = evaluateCrowdRun({
      samples: [crowdSample({ tier, calls: FULLSCREEN_DRAW_FLOOR })],
      minFps: null,
    });
    expect(v.ok).toBe(false);
    expect(v.failures[0]).toContain(`composer tier ${tier}`);
  });

  it('fails a composer tier with missing draw evidence', () => {
    const v = evaluateCrowdRun({
      samples: [crowdSample({ tier: 'high', calls: undefined })],
      minFps: null,
    });
    expect(v.ok).toBe(false);
    expect(v.failures[0]).toContain('draw');
  });

  it('passes a composer tier with real accumulated draw counts', () => {
    const v = evaluateCrowdRun({
      samples: [crowdSample({ tier: 'ultra', calls: 850 })],
      minFps: null,
    });
    expect(v.ok).toBe(true);
  });

  it('does not gate draw counts outside the composer tiers', () => {
    const v = evaluateCrowdRun({ samples: [crowdSample({ tier: 'low', calls: 1 })], minFps: null });
    expect(v.ok).toBe(true);
  });

  it('passes at the first draw count above the fullscreen floor', () => {
    const v = evaluateCrowdRun({
      samples: [crowdSample({ tier: 'high', calls: 2 })],
      minFps: null,
    });
    expect(v.ok).toBe(true);
  });

  it('pins the composer tier list and the floor constant', () => {
    expect(COMPOSER_TIERS).toEqual(['medium', 'high', 'ultra', 'insane']);
    expect(FULLSCREEN_DRAW_FLOOR).toBe(1);
  });
});

describe('evaluateJitterRun join enforcement', () => {
  const observer = { gaps: 500, p95: 60 };

  it('fails a partial join naming the joined and expected counts', () => {
    const v = evaluateJitterRun({
      joined: 39,
      expected: 40,
      observer,
      durationMs: 30000,
      maxP95: null,
    });
    expect(v.ok).toBe(false);
    expect(v.failures).toHaveLength(1);
    expect(v.failures[0]).toContain('joined 39 of 40');
  });

  it('passes an exact join with no ceiling set', () => {
    const v = evaluateJitterRun({
      joined: 40,
      expected: 40,
      observer,
      durationMs: 30000,
      maxP95: null,
    });
    expect(v.ok).toBe(true);
    expect(v.failures).toEqual([]);
  });
});

describe('evaluateJitterRun observer ceiling', () => {
  it('passes when the observer p95 sits exactly at the ceiling', () => {
    const v = evaluateJitterRun({
      joined: 40,
      expected: 40,
      observer: { gaps: 500, p95: 100 },
      durationMs: 30000,
      maxP95: 100,
    });
    expect(v).toEqual({ ok: true, failures: [], minGaps: 300 });
  });

  it('fails when the observer p95 exceeds the ceiling by one naming both values', () => {
    const v = evaluateJitterRun({
      joined: 40,
      expected: 40,
      observer: { gaps: 500, p95: 101 },
      durationMs: 30000,
      maxP95: 100,
    });
    expect(v.ok).toBe(false);
    expect(v.failures).toHaveLength(1);
    expect(v.failures[0]).toContain('101');
    expect(v.failures[0]).toContain('100');
  });

  it('refuses when the ceiling is set but the observer is disabled', () => {
    const v = evaluateJitterRun({
      joined: 40,
      expected: 40,
      observer: null,
      durationMs: 30000,
      maxP95: 100,
    });
    expect(v.ok).toBe(false);
    expect(v.failures).toHaveLength(1);
    expect(v.failures[0]).toContain('observer is disabled');
  });

  it('does not demand an observer when no ceiling is set', () => {
    // R12 scopes the refusal to the ceiling gate: an exploratory run with OBSERVER=0
    // and no JITTER_MAX_P95 is not gating anything, so only join enforcement applies.
    const v = evaluateJitterRun({
      joined: 40,
      expected: 40,
      observer: null,
      durationMs: 30000,
      maxP95: null,
    });
    expect(v.ok).toBe(true);
  });

  it('refuses a non-finite observer p95 as missing evidence', () => {
    const v = evaluateJitterRun({
      joined: 40,
      expected: 40,
      observer: { gaps: 500, p95: Number.NaN },
      durationMs: 30000,
      maxP95: 100,
    });
    expect(v.ok).toBe(false);
    expect(v.failures[0]).toContain('not a finite number');
  });
});

describe('evaluateJitterRun minGaps refusal', () => {
  it('refuses to gate on one fewer than minGaps observer samples', () => {
    const v = evaluateJitterRun({
      joined: 40,
      expected: 40,
      observer: { gaps: 299, p95: 10 },
      durationMs: 30000,
      maxP95: 100,
    });
    expect(v.minGaps).toBe(300);
    expect(v.ok).toBe(false);
    expect(v.failures).toHaveLength(1);
    expect(v.failures[0]).toContain('299');
    expect(v.failures[0]).toContain('300');
  });

  it('gates normally at exactly minGaps samples', () => {
    const v = evaluateJitterRun({
      joined: 40,
      expected: 40,
      observer: { gaps: 300, p95: 55 },
      durationMs: 30000,
      maxP95: 100,
    });
    expect(v.ok).toBe(true);
  });

  it('pins the minGaps formula as floor of half the broadcast-cadence expectation', () => {
    expect(minGapsFor(30000)).toBe(300);
    expect(minGapsFor(1000)).toBe(10);
    // 4950 ms -> 99 expected gaps -> half is 49.5 -> FLOOR 49; a round() drift gives 50.
    expect(minGapsFor(4950)).toBe(49);
  });
});

describe('gapStats percentile convention', () => {
  it('pins pct to floor nearest-rank on a fixture where a ceil index disagrees', () => {
    // 5 elements at p50: 0.5 * 5 = 2.5 -> FLOOR -> index 2 -> 3. A plain-ceil index
    // gives index 3 -> 4. The two conventions disagree here; floor is pinned.
    expect(pct([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  it('pins pct against the one-based ceil textbook convention on an integer rank', () => {
    // 4 elements at p50: 0.5 * 4 = 2 exactly. The 0-based floor convention reads
    // index 2 -> 30; the 1-based ceil nearest-rank convention reads rank 2 -> 20.
    expect(pct([10, 20, 30, 40], 50)).toBe(30);
  });

  it('clamps the top rank to the last element and maps an empty set to zero', () => {
    expect(pct([7], 99)).toBe(7);
    expect(pct([], 50)).toBe(0);
  });

  it('computes gapStats percentiles with the floor convention end to end', () => {
    // Snapshot times whose consecutive gaps are exactly 1..21 ms. With 21 gaps,
    // p50: 0.5 * 21 = 10.5 -> floor index 10 -> 11 (ceil would read 12);
    // p95: 0.95 * 21 = 19.95 -> floor index 19 -> 20 (ceil would read 21).
    const snapTimes = [0];
    let t = 0;
    for (let gap = 1; gap <= 21; gap++) {
      t += gap;
      snapTimes.push(t);
    }
    const s = gapStats(snapTimes);
    expect(s.snapshots).toBe(22);
    expect(s.gaps).toBe(21);
    expect(s.p50).toBe(11);
    expect(s.p95).toBe(20);
    // p99: 0.99 * 21 = 20.79 -> floor index 20 -> 21, distinct from p95 so a
    // label-swap mutation (p99 serving the p95 rank) dies here.
    expect(s.p99).toBe(21);
    expect(s.max).toBe(21);
    expect(s.over100).toBe(0);
  });

  it('maps an empty and a single-snapshot series to zero gaps end to end', () => {
    const none = gapStats([]);
    expect(none.snapshots).toBe(0);
    expect(none.gaps).toBe(0);
    expect(none.max).toBe(0);
    expect(none.p95).toBe(0);
    const one = gapStats([1234]);
    expect(one.snapshots).toBe(1);
    expect(one.gaps).toBe(0);
    expect(one.max).toBe(0);
  });

  it('counts the over-threshold hitches strictly above each threshold', () => {
    const s = gapStats([0, 50, 150, 400, 1000]);
    // gaps are 50, 100, 250, 600: over100 counts strictly greater than 100.
    expect(s.over100).toBe(2);
    expect(s.over150).toBe(2);
    expect(s.over250).toBe(1);
    expect(s.over500).toBe(1);
    expect(s.max).toBe(600);
  });
});

describe('parseCeilingEnv', () => {
  it('returns null for unset empty and whitespace-only values never zero', () => {
    expect(parseCeilingEnv('CROWD_MIN_FPS', undefined)).toBeNull();
    expect(parseCeilingEnv('CROWD_MIN_FPS', '')).toBeNull();
    // Number('   ') === 0: whitespace must mean "unset", never a zero threshold.
    expect(parseCeilingEnv('CROWD_MIN_FPS', '   ')).toBeNull();
    expect(parseCeilingEnv('CROWD_MIN_FPS', '\t')).toBeNull();
  });

  it('parses trimmed numeric values including an explicit zero', () => {
    expect(parseCeilingEnv('JITTER_MAX_P95', ' 120 ')).toBe(120);
    expect(parseCeilingEnv('JITTER_MAX_P95', '62.5')).toBe(62.5);
    expect(parseCeilingEnv('CROWD_MIN_FPS', '0')).toBe(0);
  });

  it('throws on a non-numeric value naming the variable instead of running ungated', () => {
    expect(() => parseCeilingEnv('CROWD_MIN_FPS', '30fps')).toThrow(/CROWD_MIN_FPS/);
    expect(() => parseCeilingEnv('JITTER_MAX_P95', 'abc')).toThrow(/finite/);
  });
});
