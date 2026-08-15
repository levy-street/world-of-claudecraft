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

// Every tier that uses the post composer or output-grade path must accumulate
// renderer statistics across the whole logical frame. A sample at the final
// fullscreen-pass floor means the instrument is dead, not the scene cheap.
export const COMPOSER_TIERS = ['medium', 'high', 'ultra', 'insane'];
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

// Distribution summary for a set of measured samples (snapshot sizes in bytes,
// per-frame costs, ...). Same FLOOR nearest-rank pct convention as gapStats, so
// a baseline captured with one is comparable with the other. Values are
// reported to one decimal like gapStats; byte inputs are integers so the
// decimals collapse for them.
export function sampleStats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, c) => a + c, 0);
  return {
    count: sorted.length,
    mean: sorted.length ? +(sum / sorted.length).toFixed(1) : 0,
    p50: +pct(sorted, 50).toFixed(1),
    p95: +pct(sorted, 95).toFixed(1),
    p99: +pct(sorted, 99).toFixed(1),
    max: +(sorted.at(-1) ?? 0).toFixed(1),
  };
}

// The professions rig's observer sample floor. This rig MEASURES saturation:
// past the loop budget the server holds sim ticks up through catch-up (the
// 1,000-bot captures ran 15.4 to 15.8 Hz against the 20 Hz nominal) but
// broadcasts once per loop callback, so the per-client snapshot cadence
// legitimately sheds toward 1.5 to 2 a second at 1,000 connections (observed
// live). The jitter gate's 20 Hz-derived floor would fail every
// honestly-saturated run, so the floor here is one gap per second of window
// (min 50): below ONE snapshot a second the rig or server is broken, not
// merely loaded.
export function profMinGapsFor(durationMs) {
  return Math.max(50, Math.floor(durationMs / 1000));
}

// The hollow-run floor, WINDOW-PROPORTIONAL. A single harvest or a single
// landed cast is not evidence that a three-minute window did professions
// work: the fleet could have produced it in the first second and idled the
// rest, which is the same hollow artifact the boolean floor was written to
// catch, only harder to see. One piece of role evidence per minute of window
// (never below 1, so a sub-minute exploratory run still has to show
// something). The committed 1,000-connection captures predate the per-observer
// evidence rows, but their roles.*.ncd presence counts put the GATHER arm at
// roughly 21 (stable wire) to 275 (legacy wire) ncd-carrying snapshots per
// observer over 180 s against a floor of 3, so honest runs clear it with 7x to
// 92x of margin. The fish arm's outcome count is not recorded in that
// committed set at all.
export function profMinRoleEventsFor(durationMs) {
  return Math.max(1, Math.floor(durationMs / 60000));
}

// The per-observer continuity ceiling in milliseconds: no single
// inter-snapshot gap may exceed it. Distribution summaries average a stall
// away (a 10 s freeze inside a 180 s window barely moves a p95 taken over
// hundreds of gaps), so the WORST gap is gated on its own. Deliberately
// generous against the saturation this rig measures: the committed captures'
// worst gaps ran 707 to 795 ms, more than 12x under the ceiling, so it fires
// on a genuine mid-window stall and never on honest cadence shed.
export const PROF_MAX_OBSERVER_GAP_MS = 10000;

// Judges a professions load-rig run (scripts/load_professions.mjs, the R36
// 1,000-concurrent baseline). Join enforcement is unconditional like the
// sibling gates. The parsing OBSERVERS are the run's evidence: each must have
// captured at least the shed-aware sample floor above, no observer may have
// gone quiet for longer than the continuity ceiling, every observer must sit
// on the ARM the run claims (a stable run whose observer never saw the tw
// echo, or a legacy run whose observer did, measured the wrong wire arm and
// fails), and each role must show a WINDOW-PROPORTIONAL amount of its
// professions evidence (non-empty node-cooldown frames for a gather observer,
// fishing outcome events for a fish one): too little of either means the
// fleet idled and the artifact is hollow.
export function evaluateProfessionsLoadRun({
  joined,
  expected,
  aliveAtEnd,
  mode,
  stable,
  durationMs,
  observers,
}) {
  const failures = [];
  if (!(Number.isFinite(joined) && joined === expected)) {
    // "professions" is load-bearing: without it this string is byte-identical
    // to evaluateJitterRun's join failure, and a message-only assertion could
    // not tell which gate produced a verdict.
    failures.push(
      `joined ${joined} of ${expected} professions bots; partial joins always fail (lower BOTS for exploratory runs)`,
    );
  }
  // Liveness is gated like the join: a fleet that bled sockets mid-window
  // measured a shrinking population, and a dead observer's missing samples
  // must fail the floors below rather than silently vanishing from the
  // evidence (the caller hands over EVERY staged observer, dead or alive).
  if (!(Number.isFinite(aliveAtEnd) && aliveAtEnd === expected)) {
    failures.push(
      `${aliveAtEnd} of ${expected} bots alive at window close; a bleeding fleet is not the staged scenario`,
    );
  }
  const minGaps = profMinGapsFor(durationMs);
  const minRoleEvents = profMinRoleEventsFor(durationMs);
  const rows = observers ?? [];
  if (rows.length === 0) {
    failures.push('no parsing observers were staged; a run with no observer evidence fails');
  }
  const wantGather = mode === 'gather' || mode === 'mixed';
  const wantFish = mode === 'fish' || mode === 'mixed';
  if (wantGather && !rows.some((o) => o.role === 'gather')) {
    failures.push(`mode=${mode} staged no gather observer; the gathering arm has no evidence`);
  }
  if (wantFish && !rows.some((o) => o.role === 'fish')) {
    failures.push(`mode=${mode} staged no fish observer; the fishing arm has no evidence`);
  }
  for (const o of rows) {
    if (!(Number.isFinite(o.gaps) && o.gaps >= minGaps)) {
      failures.push(
        `observer ${o.label} captured ${o.gaps} snapshot gaps, below the ${minGaps} floor for ${durationMs}ms; too few samples to gate`,
      );
    }
    if (!(Number.isFinite(o.gapMaxMs) && o.gapMaxMs <= PROF_MAX_OBSERVER_GAP_MS)) {
      failures.push(
        `observer ${o.label} went ${o.gapMaxMs}ms without a snapshot, past the ${PROF_MAX_OBSERVER_GAP_MS}ms continuity ceiling; the window carried a stall the averages hide`,
      );
    }
    if (stable && !o.sawStableTw) {
      failures.push(
        `observer ${o.label} never saw the stable timer-wire echo (tw); a STABLE=1 run that rode the legacy arm measured the wrong protocol`,
      );
    }
    if (!stable && o.sawStableTw) {
      failures.push(
        `observer ${o.label} saw the stable timer-wire echo (tw) on a legacy run; the arm under measurement is not the one claimed`,
      );
    }
    if (o.role === 'gather' && !(Number.isFinite(o.ncdFrames) && o.ncdFrames >= minRoleEvents)) {
      failures.push(
        `gather observer ${o.label} received ${o.ncdFrames} snapshots carrying a non-empty node-cooldown map (ncd), under the ${minRoleEvents} floor for ${durationMs}ms; too few harvests landed, the run is hollow`,
      );
    }
    if (
      o.role === 'fish' &&
      !(Number.isFinite(o.fishingOutcomes) && o.fishingOutcomes >= minRoleEvents)
    ) {
      failures.push(
        `fish observer ${o.label} saw ${o.fishingOutcomes} fishing outcome events, under the ${minRoleEvents} floor for ${durationMs}ms; too few casts resolved, the run is hollow`,
      );
    }
  }
  return { ok: failures.length === 0, failures, minGaps, minRoleEvents };
}
