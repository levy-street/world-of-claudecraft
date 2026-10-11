// The browser exposes no display refresh rate, so it is read off the cadence of
// requestAnimationFrame callbacks. Pure and allocation-free after construction:
// the frame loop feeds it one delta per callback.
//
// Three verdicts. `paced`: the deltas sit on a lattice (integer multiples of one
// base period), which is what a vsync-aligned rAF produces even on a machine that
// misses slots. `unpaced`: rAF is uncapped (the vsync-off browser flags), seen
// directly as an idle callback answered faster than any display could refresh.
// `unknown`: no lattice to be seen (not enough evidence yet, timestamps too
// coarse, or an uncapped rAF hidden behind a busy GPU: an idle callback is then
// NOT answered at once, it waits for the GPU like any other). An explicit
// ceiling falls back to a plain time limiter there; the automatic mode, which
// needs slots to mean anything, does nothing.
//
// The one bound in here is the range of plausible display rates. It is a
// property of displays, not a timing calibrated on a machine.

export type RefreshVerdict = 'unknown' | 'paced' | 'unpaced';

export const MIN_PLAUSIBLE_REFRESH_HZ = 24;
export const MAX_PLAUSIBLE_REFRESH_HZ = 500;
const MIN_PLAUSIBLE_PERIOD_MS = 1000 / MAX_PLAUSIBLE_REFRESH_HZ;
const MAX_PLAUSIBLE_PERIOD_MS = 1000 / MIN_PLAUSIBLE_REFRESH_HZ;

const WINDOW = 120;
const RECOMPUTE_EVERY = 30;
const MIN_SAMPLES = 45;
/** A delta this many base periods long is a stall or a resume, not a cadence. */
const MAX_LATTICE_MULTIPLE = 6;
/** Share of a base period a delta may sit off the lattice. Wide enough for the
 *  1 ms timestamp coarsening some engines apply, at a 144 Hz period. */
const LATTICE_TOLERANCE = 0.15;
const LATTICE_FIT_SHARE = 0.85;
/** A machine that never lands two callbacks on consecutive slots only shows
 *  multiples of the period (33 and 50 ms on a 60 Hz display), so the base is
 *  searched among the shortest delta divided by these. */
const BASE_SUBDIVISIONS = 3;
const MULTIPLE_COUNTS = new Uint16Array(MAX_LATTICE_MULTIPLE + 1);
/** A finer base replaces a coarser one only when it explains this much more. */
const FINER_BASE_FIT_GAIN = 0.05;
/** Consecutive recomputes with no lattice before a paced reading is withdrawn. */
const LATTICE_MISSES_TO_UNKNOWN = 4;
/** A new base must differ by this ratio to replace the published one. */
const REFRESH_CHANGE_RATIO = 0.08;
/** Idle callbacks answered faster than any display, in a row, to call rAF
 *  uncapped; slower answers, in a row, to take the verdict back. Biased toward
 *  `paced`: a wrong `unpaced` beats the display's slots for the whole session. */
const UNPACED_ENTER_STREAK = 6;
const UNPACED_EXIT_STREAK = 2;

export interface RefreshEstimatorState {
  readonly deltas: Float64Array;
  readonly scratch: Float64Array;
  count: number;
  head: number;
  sinceRecompute: number;
  verdict: RefreshVerdict;
  /** The display period, meaningful only while the verdict is `paced`. */
  refreshMs: number;
  fastIdleStreak: number;
  slowIdleStreak: number;
  latticeMisses: number;
}

export function createRefreshEstimator(): RefreshEstimatorState {
  return {
    deltas: new Float64Array(WINDOW),
    scratch: new Float64Array(WINDOW),
    count: 0,
    head: 0,
    sinceRecompute: 0,
    verdict: 'unknown',
    refreshMs: 0,
    fastIdleStreak: 0,
    slowIdleStreak: 0,
    latticeMisses: 0,
  };
}

/** Forget the cadence (hidden span, resume, display change) but keep the
 *  published reading until fresh evidence replaces it. */
export function resetRefreshEstimatorWindow(state: RefreshEstimatorState): void {
  state.count = 0;
  state.head = 0;
  state.sinceRecompute = 0;
  state.fastIdleStreak = 0;
  state.slowIdleStreak = 0;
}

/**
 * Feed one callback-to-callback delta. `afterIdleCallback` is true when the
 * previous callback did no work (a cadence skip), which is the only moment an
 * uncapped rAF shows itself: a busy callback hides it behind its own cost.
 * Deltas that crossed a timer sleep must never be fed (the limiter would read
 * its own cadence back as a display).
 */
export function noteRefreshDelta(
  state: RefreshEstimatorState,
  deltaMs: number,
  afterIdleCallback: boolean,
): void {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
  if (afterIdleCallback) {
    if (deltaMs < MIN_PLAUSIBLE_PERIOD_MS) {
      state.slowIdleStreak = 0;
      if (++state.fastIdleStreak >= UNPACED_ENTER_STREAK && state.verdict !== 'unpaced') {
        state.verdict = 'unpaced';
        state.count = 0;
        state.head = 0;
        state.sinceRecompute = 0;
      }
      return;
    }
    state.fastIdleStreak = 0;
    if (state.verdict === 'unpaced' && ++state.slowIdleStreak >= UNPACED_EXIT_STREAK) {
      state.verdict = state.refreshMs > 0 ? 'paced' : 'unknown';
    }
  }
  if (state.verdict === 'unpaced') return;
  if (deltaMs > MAX_PLAUSIBLE_PERIOD_MS * MAX_LATTICE_MULTIPLE) {
    resetRefreshEstimatorWindow(state);
    return;
  }
  state.deltas[state.head] = deltaMs;
  state.head = (state.head + 1) % WINDOW;
  if (state.count < WINDOW) state.count++;
  if (++state.sinceRecompute < RECOMPUTE_EVERY || state.count < MIN_SAMPLES) return;
  state.sinceRecompute = 0;
  recompute(state);
}

function recompute(state: RefreshEstimatorState): void {
  const n = state.count;
  const sorted = state.scratch;
  for (let i = 0; i < WINDOW; i++) sorted[i] = i < n ? state.deltas[i] : Number.POSITIVE_INFINITY;
  sorted.sort();
  const shortest = sorted[Math.floor(n * 0.1)];
  // The coarsest base that explains the deltas wins, unless a finer one explains
  // clearly more: a 50 ms delta beside 33 ms ones is a slot and a half of a
  // 30 Hz reading, which no display produces, and exactly three 60 Hz slots.
  let base = 0;
  let baseFit = 0;
  for (let k = 1; k <= BASE_SUBDIVISIONS; k++) {
    const candidate = refineBase(sorted, n, shortest / k);
    if (candidate < MIN_PLAUSIBLE_PERIOD_MS) break;
    if (candidate > MAX_PLAUSIBLE_PERIOD_MS) continue;
    const fit = latticeFit(sorted, n, candidate);
    if (fit < LATTICE_FIT_SHARE) continue;
    // A lattice needs proof it is one. Two observed multiples are proof (33 and
    // 50 ms are two and three 60 Hz slots). A single cluster is only a display
    // when it is as tight as a display's clock: a steady frame cost on an
    // uncapped loop clusters too, loosely (read as "56.5 Hz" on a Windows HD 530
    // with vsync off). And a fine enough base "explains" any deltas at all.
    if (!showsTwoMultiples(sorted, n, candidate)) {
      if (k > 1 || !tightSingleCluster(sorted, n, candidate)) continue;
    }
    if (base === 0 || fit > baseFit + FINER_BASE_FIT_GAIN) {
      base = candidate;
      baseFit = fit;
    }
  }
  // No lattice: coarse timestamps, or a source with no slots at all. One miss
  // is noise and the paced reading stands (hysteresis toward paced); a run of
  // them is the answer. Measured on a Windows HD 530 with vsync off: a steady
  // frame cost reads as a one-cluster lattice (a "39 Hz display"), and only the
  // deltas that follow break it.
  if (base === 0) {
    if (++state.latticeMisses >= LATTICE_MISSES_TO_UNKNOWN && state.verdict === 'paced') {
      state.verdict = 'unknown';
      state.refreshMs = 0;
    }
    return;
  }
  state.latticeMisses = 0;
  const published = state.refreshMs;
  if (
    state.verdict !== 'paced' ||
    published <= 0 ||
    Math.abs(base - published) > published * REFRESH_CHANGE_RATIO
  ) {
    state.refreshMs = base;
  } else {
    state.refreshMs = published + (base - published) * 0.25;
  }
  state.verdict = 'paced';
}

/** Mean per-slot period of the deltas that sit on the candidate's lattice. */
function refineBase(sorted: Float64Array, n: number, candidate: number): number {
  let sum = 0;
  let slots = 0;
  for (let i = 0; i < n; i++) {
    const multiple = Math.round(sorted[i] / candidate);
    if (multiple < 1 || multiple > MAX_LATTICE_MULTIPLE) continue;
    if (Math.abs(sorted[i] - multiple * candidate) > candidate * LATTICE_TOLERANCE) continue;
    sum += sorted[i];
    slots += multiple;
  }
  return slots > 0 ? sum / slots : candidate;
}

function showsTwoMultiples(sorted: Float64Array, n: number, base: number): boolean {
  const counts = MULTIPLE_COUNTS;
  counts.fill(0);
  for (let i = 0; i < n; i++) {
    const multiple = Math.round(sorted[i] / base);
    if (multiple >= 1 && multiple <= MAX_LATTICE_MULTIPLE) counts[multiple]++;
  }
  let seen = 0;
  for (let m = 1; m <= MAX_LATTICE_MULTIPLE; m++) if (counts[m] >= n * 0.1) seen++;
  return seen >= 2;
}

/** The deltas one period long, spread over less than this share of it. Wide
 *  enough for 1 ms timestamp coarsening at 60 Hz (16 and 17 ms). */
const DISPLAY_CLOCK_SPREAD = 0.08;

function tightSingleCluster(sorted: Float64Array, n: number, base: number): boolean {
  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (Math.round(sorted[i] / base) !== 1) continue;
    if (first < 0) first = i;
    last = i;
  }
  if (first < 0) return false;
  const span = last - first;
  const lo = sorted[first + Math.floor(span * 0.1)];
  const hi = sorted[first + Math.floor(span * 0.9)];
  return hi - lo <= base * DISPLAY_CLOCK_SPREAD;
}

function latticeFit(sorted: Float64Array, n: number, base: number): number {
  let fit = 0;
  let considered = 0;
  for (let i = 0; i < n; i++) {
    const multiple = Math.round(sorted[i] / base);
    if (multiple > MAX_LATTICE_MULTIPLE) continue;
    considered++;
    if (multiple >= 1 && Math.abs(sorted[i] - multiple * base) <= base * LATTICE_TOLERANCE) fit++;
  }
  return considered > 0 ? fit / considered : 0;
}
