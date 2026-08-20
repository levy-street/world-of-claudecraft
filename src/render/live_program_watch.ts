// The renderer's readouts of three's live program list (`renderer.info.programs`):
// the prewarm counts, and the post-reveal watch that names every program the
// driver minted inside a live frame.
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

import { recordGpuPrepEvent } from './gpu_prep_events';
import {
  absorbLivePrograms as absorbPrograms,
  armLiveProgramWatch as armWatch,
  collectNewLivePrograms,
  createLiveProgramWatch,
  disarmLiveProgramWatch,
  type LiveProgramEntry,
} from './live_program_watch_core';

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

/** Linked programs and resident textures, as three reports them. */
export function programCounts(webgl: ProgramInfoHost): { programs: number; textures: number } {
  return {
    programs: webgl.info.programs?.length ?? 0,
    textures: webgl.info.memory.textures,
  };
}

/** Curtain-fade boundary: everything linked so far is prep, not an escape. */
export function armLiveProgramWatch(webgl: ProgramInfoHost): void {
  armWatch(watch, webgl.info.programs ?? undefined);
}

/** Right before the frame's render: everything minted since the last draw is
 *  prep (compileAsync prologues push programs too), so it is adopted, not
 *  reported. */
export function absorbLivePrograms(webgl: ProgramListHost): void {
  absorbPrograms(watch, webgl.info?.programs ?? undefined);
}

/**
 * One draw's escapes, recorded (call right after the render). A no-op before
 * the arm (boot links thousands of programs behind the curtain and none of
 * them is news) and a single length compare on the overwhelming majority of
 * frames after it.
 */
export function recordNewLivePrograms(webgl: ProgramListHost): void {
  const found = collectNewLivePrograms(watch, webgl.info?.programs ?? undefined, labels);
  for (let i = 0; i < found; i++) {
    recordGpuPrepEvent({ kind: 'live-program', key: labels[i], ageMs: 0 });
  }
}

export function resetLiveProgramWatchForTest(): void {
  disarmLiveProgramWatch(watch);
  labels.length = 0;
}
