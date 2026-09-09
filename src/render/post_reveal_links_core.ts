// How much three's live program list GREW in the first seconds AFTER the
// loading curtain lifted, for the perf beacon.
//
// The prewarm block already says what linked BEFORE the reveal
// (rendererPrewarmSummary.programsDelta). Nothing fleet-side said what the
// first live seconds cost in programs: the reveal compiles, the resume lane,
// the background queue and the live escapes all mint programs after the
// curtain, and the hitch tracker that counts them (scene_census_core
// programsAdded) is overlay-gated. This core turns the program-list length the
// live-program watch already reads after every draw into one bounded window
// total.
//
// What the number IS: the net growth of `renderer.info.programs` between the
// reveal and the last in-window draw. three pushes a program onto that list at
// getProgram time (submission, before the driver link resolves) and
// releaseProgram shrinks it, so this is a submission-time, release-adjusted
// delta, not a count of driver links. It is named `programsGained` for that
// reason.
//
// The window opens on the FIRST arm (the world entry's reveal; a logout
// reloads the page) and later arms only count, so every beacon of a session
// describes the same entry, the way the prewarm block does. It closes on the
// first sample at or past `windowMs`, on the LAST in-window count: a hidden
// tab that stops frames must not hand the programs of a whole minimized span
// to the window when frames resume. Two things a reader needs beside the
// delta: `unsampledMs`, the wall time inside the window that passed between
// samples further apart than a frame stop (a hidden tab, a multi-second
// stall), and `baselineLost`, set when the list shrank below the reveal
// baseline by more than three's parked-program eviction can explain (a
// graphics rebuild swapped the GL context and its program list), which closes
// the window: a delta against a vanished baseline is not a number.
//
// Pure and allocation-free on the sample path: the state is one record the
// host mutates, the clock is an input, and a closed window costs one boolean.

export const POST_REVEAL_LINK_WINDOW_MS = 20_000;

/** A gap between two samples at or past this is a frame stop, not a frame. */
export const POST_REVEAL_FRAME_STOP_MS = 1000;

/** How far below the reveal baseline the list may shrink before the baseline
 *  counts as lost. Under the repo's three patch a released program stays
 *  parked until the retention bound evicts it, so a live context shrinks by
 *  ones; a rebuilt context drops to a near-empty list. */
export const POST_REVEAL_BASELINE_EPSILON = 16;

export interface PostRevealLinkWindow {
  windowMs: number;
  /** Arms seen on this page; only the first one opens the window. */
  reveals: number;
  /** Arms that landed while the window was open (the first one included). */
  revealsInWindow: number;
  /** Clock at the first arm, -1 before it. */
  armedAtMs: number;
  programsAtReveal: number;
  /** Program count at the last sample INSIDE the window. */
  lastPrograms: number;
  /** Clock at the last in-window sample (the arm before any). */
  lastSampleAtMs: number;
  /** Samples taken inside the window. */
  samples: number;
  /** Wall time inside the window not covered by frames (see the header). */
  unsampledMs: number;
  closed: boolean;
  baselineLost: boolean;
}

export interface PostRevealLinksSnapshot {
  reveals: number;
  revealsInWindow: number;
  windowMs: number;
  programsAtReveal: number;
  programsGained: number;
  samples: number;
  unsampledMs: number;
  closed: boolean;
  baselineLost: boolean;
}

export function createPostRevealLinkWindow(
  windowMs = POST_REVEAL_LINK_WINDOW_MS,
): PostRevealLinkWindow {
  return {
    windowMs,
    reveals: 0,
    revealsInWindow: 0,
    armedAtMs: -1,
    programsAtReveal: 0,
    lastPrograms: 0,
    lastSampleAtMs: -1,
    samples: 0,
    unsampledMs: 0,
    closed: false,
    baselineLost: false,
  };
}

/** Curtain-lift boundary. Opens the window once; later arms are counted only. */
export function armPostRevealLinkWindow(
  state: PostRevealLinkWindow,
  nowMs: number,
  programs: number,
): void {
  state.reveals++;
  if (state.armedAtMs >= 0) {
    if (!state.closed) state.revealsInWindow++;
    return;
  }
  state.revealsInWindow++;
  state.armedAtMs = nowMs;
  state.programsAtReveal = programs;
  state.lastPrograms = programs;
  state.lastSampleAtMs = nowMs;
}

/** One drawn frame's program count. A no-op before the arm and after the close. */
export function samplePostRevealLinkWindow(
  state: PostRevealLinkWindow,
  nowMs: number,
  programs: number,
): void {
  if (state.closed || state.armedAtMs < 0) return;
  if (nowMs - state.armedAtMs >= state.windowMs) {
    state.closed = true;
    // The tail between the last frame and the window's end is unsampled too,
    // whatever happened after it.
    const tailMs = state.armedAtMs + state.windowMs - state.lastSampleAtMs;
    if (tailMs >= POST_REVEAL_FRAME_STOP_MS) state.unsampledMs += tailMs;
    return;
  }
  const gapMs = nowMs - state.lastSampleAtMs;
  if (gapMs >= POST_REVEAL_FRAME_STOP_MS) state.unsampledMs += gapMs;
  state.lastSampleAtMs = nowMs;
  if (programs < state.programsAtReveal - POST_REVEAL_BASELINE_EPSILON) {
    state.closed = true;
    state.baselineLost = true;
    return;
  }
  state.lastPrograms = programs;
  state.samples++;
}

/** Null before the arm. `programsGained` never goes negative: a list a few
 *  programs shorter than the baseline is three evicting parked programs. */
export function postRevealLinksSnapshot(
  state: PostRevealLinkWindow,
): PostRevealLinksSnapshot | null {
  if (state.armedAtMs < 0) return null;
  return {
    reveals: state.reveals,
    revealsInWindow: state.revealsInWindow,
    windowMs: state.windowMs,
    programsAtReveal: state.programsAtReveal,
    programsGained: Math.max(0, state.lastPrograms - state.programsAtReveal),
    samples: state.samples,
    unsampledMs: Math.round(state.unsampledMs),
    closed: state.closed,
    baselineLost: state.baselineLost,
  };
}

export function resetPostRevealLinkWindow(state: PostRevealLinkWindow): void {
  state.reveals = 0;
  state.revealsInWindow = 0;
  state.armedAtMs = -1;
  state.programsAtReveal = 0;
  state.lastPrograms = 0;
  state.lastSampleAtMs = -1;
  state.samples = 0;
  state.unsampledMs = 0;
  state.closed = false;
  state.baselineLost = false;
}
