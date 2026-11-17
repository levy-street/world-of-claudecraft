// Budgeted, resumable zone feature builds.
//
// A zone feature builder (realm_flora.ts and siblings) used to run in one
// main-thread call inside a streaming prepare, so the zone a walking player
// approached was built in a single frame: Veiled Hollow's flora was a 161 ms
// frame on the calibrated desktop proxy and 222 ms on the reference phone.
// This core lets a builder be written as a generator that yields between
// bounded pieces of work (a placement grid column, one instanced family) and
// returns its view. A background prepare steps it across idle slots in slices
// of at most a few milliseconds; a gating prepare (behind the loading cover)
// drains it at once, exactly as before.
//
// Slicing moves only WHEN the work happens, never WHAT it produces: a builder
// must not read the clock between its yields, so its output is identical
// however the frames divide it (tests/stepped_build_core.test.ts pins the
// driver, tests/realm_flora_placements.test.ts the real builder).
//
// The deadline check precedes every piece (runSlicedBuild), so a slice costs
// the budget plus at most the one piece that crossed it. The clock and the
// yield are injected: this core stays deterministic and Node-testable per the
// RENDER_PURE_CORES contract.

import { runSlicedBuild } from './grass_build_slicer_core';

/** The longest piece of an idle-sliced build per idle slot, and how long a
 *  slot may be waited for under sustained frame load (the terrain lane's
 *  values). Shared by every idle-sliced build lane. */
export const IDLE_SLICE_MS = 6;
export const IDLE_SLICE_TIMEOUT_MS = 200;

/** A builder as a generator: yields between pieces of work, returns its result. */
export type SteppedBuild<T> = Generator<void, T, void>;

/** Run a stepped build to completion in this call. */
export function drainBuild<T>(build: SteppedBuild<T>): T {
  for (;;) {
    const next = build.next();
    if (next.done) return next.value;
  }
}

export interface SliceHost {
  now(): number;
  /** Resolves when the next slice may run (an idle slot, a later frame). */
  yieldSlice(): Promise<void>;
  /** True once the result is no longer wanted: the build stops between slices. */
  cancelled?(): boolean;
  /** Each slice's start and cost, for the build ledger. */
  onSlice?(startedMs: number, ms: number): void;
}

/**
 * Steps `build` in slices of at most `sliceMs` (plus the one piece that
 * crosses it), waiting on `host.yieldSlice()` before each slice. Resolves to
 * the build's result, or to undefined when `host.cancelled()` turns true
 * between slices (the generator is closed, no further piece runs).
 */
export async function runBuildInSlices<T>(
  build: SteppedBuild<T>,
  sliceMs: number,
  host: SliceHost,
): Promise<T | undefined> {
  let result: { value: T } | undefined;
  const job = {
    step(): boolean {
      const next = build.next();
      if (!next.done) return true;
      result = { value: next.value };
      return false;
    },
  };
  for (;;) {
    await host.yieldSlice();
    if (host.cancelled?.()) {
      build.return(undefined as T);
      return undefined;
    }
    const started = host.now();
    const outcome = runSlicedBuild(job, started + sliceMs, () => host.now());
    host.onSlice?.(started, host.now() - started);
    if (outcome === 'completed') return (result as { value: T }).value;
  }
}
