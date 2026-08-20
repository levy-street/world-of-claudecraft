// Aligns the hitch tracker's per-frame sample with the frame its dt measures.
//
// The renderer's callback N receives dt(N), measured at RAF start: it covers
// callback N-1 PLUS the gap before N. The counters the sample used to carry
// (programs, textures, created views, the callback's own ms, the ledger's
// zone spend) were read at the END of callback N, so they described callback
// N: any cause that happened INSIDE a callback was filed one frame late (a
// 100 ms callback N landed on sample N+1, whose own callback was short, as
// `off-frame`), while work in the gap between frames (queue units) happened to
// line up. This aligner receives two readings per callback and emits, at the
// end of callback N, the sample for dt(N): the previous callback's in-callback
// share plus this gap's share, so the sample names what happened inside the
// span its dt measures.
//
// - `atStart`: the counters at the top of the callback, before any view
//   creation, plus the build ledger's frame spend at that moment. The
//   renderer opens a new ledger frame right after that read, so the spend it
//   reads at the top of N is everything since the top of N-1: callback N-1
//   plus the gap before N, exactly dt(N)'s span, so the sample carries that
//   reading as is.
// - `atEnd`: the callback's own outcome (created views, its total ms, its
//   submit ms) and the sample-time readings (heap, dt, timestamp).
//
// The emitted sample carries `programs`/`textures` as read at the top of N:
// the tracker's delta against the previous sample (read at the top of N-1)
// is then (callback N-1's in-callback delta) + (this gap's delta), the
// aligned delta for dt(N). Created views and the renderer ms are callback
// N-1's; the zone and view build ms are the ledger spend read at the top of
// N; the heap is the value at this sample (a collection anywhere inside
// [end N-1, end N] is a drop against the previous sample, which is fine);
// frameMs is dt(N). The first callback only stores.
//
// Pure core: no three import, no DOM, no clocks (every number comes from the
// caller), no allocation on the per-frame path (one reused sample).
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts).

import { emptyHitchFrameSample, type HitchFrameSample } from './scene_census_core';

export interface HitchFrameAligner {
  /** The counters at the top of the callback (program and texture counts)
   *  and the build ledger's zone and view spend since the previous
   *  callback's start reading. Scalars, not a reading object: this runs per
   *  frame while the overlay is up, and the path allocates nothing. */
  atStart(programs: number, textures: number, zoneMs: number, viewMs: number): void;
  /** The callback's own outcome (the views it created, its total ms, its
   *  submit ms) and the sample-time readings (timestamp, dt, heap MB or 0
   *  where unknown). Returns the aligned sample for this callback's dt, or
   *  null while there is no previous callback to attribute it to (the first
   *  callback, or the first after a reset). The returned object is
   *  aligner-owned and rewritten by the next call: read it before then. */
  atEnd(
    atMs: number,
    frameMs: number,
    submitMs: number,
    createdViews: number,
    rendererMs: number,
    heapMb: number,
  ): HitchFrameSample | null;
  reset(): void;
}

export function createHitchFrameAligner(): HitchFrameAligner {
  const sample = emptyHitchFrameSample();
  let started = false;
  let hasPrevious = false;
  let startPrograms = 0;
  let startTextures = 0;
  let startZoneMs = 0;
  let startViewMs = 0;
  let previousCreatedViews = 0;
  let previousRendererMs = 0;
  let previousSubmitMs = 0;
  return {
    atStart(programs, textures, zoneMs, viewMs) {
      started = true;
      startPrograms = programs;
      startTextures = textures;
      startZoneMs = zoneMs;
      startViewMs = viewMs;
    },
    atEnd(atMs, frameMs, submitMs, createdViews, rendererMs, heapMb) {
      let out: HitchFrameSample | null = null;
      if (started && hasPrevious) {
        sample.atMs = atMs;
        sample.frameMs = frameMs;
        sample.submitMs = previousSubmitMs;
        sample.programs = startPrograms;
        sample.textures = startTextures;
        sample.createdViews = previousCreatedViews;
        sample.zoneBuildMs = startZoneMs;
        sample.viewBuildMs = startViewMs;
        sample.rendererMs = previousRendererMs;
        sample.heapMb = heapMb;
        out = sample;
      }
      // A callback whose start was not read (the log switched on mid-frame)
      // is not a previous callback: the next sample would attribute a
      // half-read span.
      hasPrevious = started;
      started = false;
      previousCreatedViews = createdViews;
      previousRendererMs = rendererMs;
      previousSubmitMs = submitMs;
      return out;
    },
    reset() {
      started = false;
      hasPrevious = false;
    },
  };
}
