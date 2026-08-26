// The renderer's readouts of three's live program list (`renderer.info.programs`):
// the prewarm counts, the post-reveal watch that names every program the
// driver minted inside a live frame, and the post-reveal link WINDOW that
// counts how much the list grew in the first seconds after the curtain
// (post_reveal_links_core.ts), for the perf beacon.
//
// The watch is the in-game half of what only the external capture kit could say
// before: after the curtain fades, any program that appears is a variant no
// prewarm entry covered, and its first draw linked it synchronously. Recording
// it as a `live-program` gpu-prep event means ANY session (a player's, a bench
// run, a bug report with `?perf`) attributes the escape by name, instead of the
// inventory being only as complete as the last read-through.
//
// State is module-owned rather than a renderer field on purpose: the renderer
// is under a line ratchet, the arm is idempotent, and a graphics rebuild
// re-arms at its own reveal, which re-seats the baseline for the new context.
//
// Every readout here also sweeps the program-key ledger (program_key_ledger.ts,
// off without `?perf`), which is how the ledger sees every program without the
// renderer gaining a call site.

import { recordGpuPrepEvent } from './gpu_prep_events';
import {
  absorbLivePrograms as absorbPrograms,
  armLiveProgramWatch as armWatch,
  collectNewLivePrograms,
  createLiveProgramWatch,
  disarmLiveProgramWatch,
  type LiveProgramEntry,
} from './live_program_watch_core';
import {
  armPostRevealLinkWindow,
  createPostRevealLinkWindow,
  type PostRevealLinksSnapshot,
  resetPostRevealLinkWindow,
  samplePostRevealLinkWindow,
  postRevealLinksSnapshot as snapshotLinkWindow,
} from './post_reveal_links_core';
import { sweepProgramKeyLedger } from './program_key_ledger';

interface ProgramInfoHost {
  info: { programs?: LiveProgramEntry[] | null; memory: { textures: number } };
}

/** The slice the per-draw watch reads: three's program list, when the host
 *  exposes one at all (a test's stub renderer need not). */
export interface ProgramListHost {
  info?: { programs?: LiveProgramEntry[] | null } | null;
}

const watch = createLiveProgramWatch();
const labels: string[] = [];
const linkWindow = createPostRevealLinkWindow();
// Read only while the window is open (its first 20 s), never on a closed one.
const realClock = (): number => performance.now();
let clock: () => number = realClock;

/** Once per DRAWN frame, after the render: the count the draw left behind. */
function sampleLinkWindow(programs: readonly LiveProgramEntry[] | null | undefined): void {
  if (linkWindow.closed || linkWindow.armedAtMs < 0 || !programs) return;
  samplePostRevealLinkWindow(linkWindow, clock(), programs.length);
}

/** The post-curtain link window as the perf beacon reads it; null before the
 *  first reveal of this page. */
export function postRevealLinksSnapshot(): PostRevealLinksSnapshot | null {
  return snapshotLinkWindow(linkWindow);
}

/** Linked programs and resident textures, as three reports them. */
export function programCounts(webgl: ProgramInfoHost): { programs: number; textures: number } {
  sweepProgramKeyLedger(webgl, performance.now());
  return {
    programs: webgl.info.programs?.length ?? 0,
    textures: webgl.info.memory.textures,
  };
}

/** Curtain-fade boundary: everything linked so far is prep, not an escape. */
export function armLiveProgramWatch(webgl: ProgramInfoHost): void {
  sweepProgramKeyLedger(webgl, performance.now());
  armWatch(watch, webgl.info.programs ?? undefined);
  // The escape watch re-baselines on EVERY arm (an arrival's prep is prep);
  // the link window is anchored to the FIRST arm on purpose, the world entry,
  // and later arms only count (post_reveal_links_core.ts). A host without a
  // program list has no baseline to anchor, so it never opens a window.
  if (webgl.info.programs) {
    armPostRevealLinkWindow(linkWindow, clock(), webgl.info.programs.length);
  }
}

/** Right before the frame's render: everything minted since the last draw is
 *  prep (compileAsync prologues push programs too), so it is adopted, not
 *  reported. */
export function absorbLivePrograms(webgl: ProgramListHost): void {
  sweepProgramKeyLedger(webgl, performance.now());
  absorbPrograms(watch, webgl.info?.programs ?? undefined);
}

/**
 * One draw's escapes, recorded (call right after the render). A no-op before
 * the arm (boot links thousands of programs behind the curtain and none of
 * them is news) and a single length compare on the overwhelming majority of
 * frames after it.
 */
export function recordNewLivePrograms(webgl: ProgramListHost): void {
  sweepProgramKeyLedger(webgl, performance.now());
  const found = collectNewLivePrograms(watch, webgl.info?.programs ?? undefined, labels);
  for (let i = 0; i < found; i++) {
    recordGpuPrepEvent({ kind: 'live-program', key: labels[i], ageMs: 0 });
  }
  sampleLinkWindow(webgl.info?.programs);
}

/** Replace the link window's clock; the reset below restores the real one. */
export function setLiveProgramWatchClockForTest(nowMs: () => number): void {
  clock = nowMs;
}

export function resetLiveProgramWatchForTest(): void {
  disarmLiveProgramWatch(watch);
  labels.length = 0;
  resetPostRevealLinkWindow(linkWindow);
  clock = realClock;
}
