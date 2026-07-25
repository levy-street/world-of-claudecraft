// Pure pass/fail logic for the crowd and jitter benchmarks, kept side-effect-free
// so the Vitest suite (tests/bench_gate.test.ts) can pin every verdict arm. The
// harness entry scripts (scripts/crowd_fps_bench.mjs, scripts/server_load_jitter.mjs)
// stay thin orchestrators per scripts/CLAUDE.md: they collect evidence, hand it here,
// and route the verdict to their exit code.
//
// Design rulings (docs/design/player-performance/packet-0-instruments.md, R12):
// join enforcement is UNCONDITIONAL, with no escape-hatch env; an exploratory run
// lowers CROWD_BATCHES / BOTS instead of tolerating a partial join. A metric that is
// missing or non-finite is missing evidence and FAILS; it never silently passes a
// ceiling comparison the way NaN slides through a `<` check.

// Parses an optional numeric threshold env var. The input is trimmed first and a
// set-but-blank value (including pure whitespace, where Number('  ') === 0) means
// "unset", never a zero threshold. A non-numeric value throws instead of silently
// disabling the gate: a typo like CROWD_MIN_FPS=30fps must not run ungated.
export function parseCeilingEnv(name, raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be a finite number, got ${JSON.stringify(raw)}`);
  }
  return n;
}

// The composer pipeline tiers, where phase 01's draw_stats accumulator made the
// draw counts real. Before it, every composer frame reported the final fullscreen
// pass: 1 call / 1 triangle (brainstorm finding 19), so a crowd sample on these
// tiers sitting at that floor means the instrument is dead, not the scene cheap.
export const COMPOSER_TIERS = ['high', 'ultra'];
export const FULLSCREEN_DRAW_FLOOR = 1;

// Judges a crowd bench run. Every sample must carry finite evidence; samples that
// staged a crowd carry expectedJoined/actualJoined (ACTUAL sockets in the world,
// bots.length, never join attempts) and must match EXACTLY. minFps (from
// CROWD_MIN_FPS) gates every sample's fps when set.
export function evaluateCrowdRun({ samples, minFps }) {
  const failures = [];
  const rows = samples ?? [];
  if (rows.length === 0) {
    failures.push('no samples were captured; a run with no evidence fails');
  }
  for (const s of rows) {
    if (s.expectedJoined != null || s.actualJoined != null) {
      if (!(Number.isFinite(s.actualJoined) && s.actualJoined === s.expectedJoined)) {
        failures.push(
          `${s.label}: joined ${s.actualJoined} of ${s.expectedJoined} bots; the crowd was not staged exactly (partial joins always fail; lower CROWD_BATCHES for exploratory runs)`,
        );
      }
    }
    if (!Number.isFinite(s.fps)) {
      failures.push(`${s.label}: fps=${s.fps} is not a finite number; missing evidence fails`);
    } else if (minFps != null && s.fps < minFps) {
      failures.push(`${s.label}: fps ${s.fps} is below the CROWD_MIN_FPS floor ${minFps}`);
    }
    if (COMPOSER_TIERS.includes(s.tier)) {
      if (!Number.isFinite(s.calls) || s.calls <= FULLSCREEN_DRAW_FLOOR) {
        failures.push(
          `${s.label}: composer tier ${s.tier} reports ${s.calls} draw calls, at or under the fullscreen floor ${FULLSCREEN_DRAW_FLOOR}; the draw instrument is dead or the accumulator regressed`,
        );
      }
    }
  }
  return { ok: failures.length === 0, failures };
}

// The observer sample floor for a jitter run: the server broadcasts roughly every
// 50 ms, so a healthy observer sees about DURATION_MS / 50 gaps; refuse to gate on
// fewer than half of that.
export function minGapsFor(durationMs) {
  return Math.floor((durationMs / 50) * 0.5);
}

// Judges a jitter run. Join enforcement is unconditional (exact BOTS count). The
// maxP95 ceiling (from JITTER_MAX_P95) gates the OBSERVER p95 only, refusing to
// pass when the observer is disabled or captured fewer than minGaps samples: a
// ceiling with no observer evidence is a vacuous gate, so it fails instead.
export function evaluateJitterRun({ joined, expected, observer, durationMs, maxP95 }) {
  const failures = [];
  if (!(Number.isFinite(joined) && joined === expected)) {
    failures.push(
      `joined ${joined} of ${expected} bots; partial joins always fail (lower BOTS for exploratory runs)`,
    );
  }
  const minGaps = minGapsFor(durationMs);
  if (maxP95 != null) {
    if (!observer) {
      failures.push(
        `JITTER_MAX_P95=${maxP95} is set but the observer is disabled or never joined; the ceiling gates the observer p95 and refuses to pass without it`,
      );
    } else if (!(Number.isFinite(observer.gaps) && observer.gaps >= minGaps)) {
      failures.push(
        `observer captured ${observer.gaps} snapshot gaps, below the ${minGaps} floor for ${durationMs}ms; too few samples to gate`,
      );
    } else if (!Number.isFinite(observer.p95)) {
      failures.push(`observer p95=${observer.p95} is not a finite number; missing evidence fails`);
    } else if (observer.p95 > maxP95) {
      failures.push(
        `observer snapshot-gap p95 ${observer.p95}ms exceeds the JITTER_MAX_P95 ceiling ${maxP95}ms`,
      );
    }
  }
  return { ok: failures.length === 0, failures, minGaps };
}

// ---------------------------------------------------------------------------
// gapStats + pct: moved VERBATIM from scripts/server_load_jitter.mjs so the
// percentile convention is pinned by tests. pct is FLOOR nearest-rank on a
// 0-based index (i = floor(p/100 * n), clamped to the last element); flipping it
// to ceil, or to the 1-based ceil textbook convention, changes every reported
// p50/p95/p99, so tests/bench_gate.test.ts pins fixtures where those conventions
// disagree. Do not "fix" the convention without refreshing every baseline that
// was captured with it.
// ---------------------------------------------------------------------------

export function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

export function gapStats(snapTimes) {
  const gaps = [];
  for (let i = 1; i < snapTimes.length; i++) gaps.push(snapTimes[i] - snapTimes[i - 1]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const over = (t) => gaps.filter((g) => g > t).length;
  return {
    snapshots: snapTimes.length,
    gaps: gaps.length,
    p50: +pct(sorted, 50).toFixed(1),
    p95: +pct(sorted, 95).toFixed(1),
    p99: +pct(sorted, 99).toFixed(1),
    max: +(sorted.at(-1) ?? 0).toFixed(1),
    over100: over(100),
    over150: over(150),
    over250: over(250),
    over500: over(500),
  };
}
