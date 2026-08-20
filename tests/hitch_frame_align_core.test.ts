// The hitch sample aligner (src/render/hitch_frame_align_core.ts): the sample
// emitted at the end of callback N describes dt(N), the previous callback
// plus the gap before this one, so a cause inside a callback lands on the
// frame that paid it instead of one frame late. Composed with the tracker for
// the attribution cases.

import { describe, expect, it } from 'vitest';
import { createHitchFrameAligner } from '../src/render/hitch_frame_align_core';
import { createHitchTracker } from '../src/render/scene_census_core';

type Start = [programs: number, textures: number, zoneMs: number, viewMs: number];
type End = [
  atMs: number,
  frameMs: number,
  submitMs: number,
  createdViews: number,
  rendererMs: number,
  heapMb: number,
];
const start = (programs: number, textures = 50, zoneMs = 0, viewMs = 0): Start => [
  programs,
  textures,
  zoneMs,
  viewMs,
];
const end = (
  frameMs: number,
  extra: Partial<{
    atMs: number;
    submitMs: number;
    createdViews: number;
    rendererMs: number;
    heapMb: number;
  }> = {},
): End => {
  const e = { atMs: 1000, submitMs: 5, createdViews: 0, rendererMs: 8, heapMb: 0, ...extra };
  return [e.atMs, frameMs, e.submitMs, e.createdViews, e.rendererMs, e.heapMb];
};

describe('createHitchFrameAligner', () => {
  it('only stores on the first callback, then emits one sample per callback for its dt', () => {
    const aligner = createHitchFrameAligner();
    aligner.atStart(...start(100));
    expect(aligner.atEnd(...end(16))).toBeNull();
    aligner.atStart(...start(100));
    const sample = aligner.atEnd(...end(16.7, { atMs: 2000 }));
    expect(sample).not.toBeNull();
    expect(sample?.frameMs).toBe(16.7);
    expect(sample?.atMs).toBe(2000);
  });

  it('carries the previous callback outcome and the start-of-callback readings, the heap at the sample', () => {
    const aligner = createHitchFrameAligner();
    // callback 1: created two views in 40 ms, one program linked inside it
    aligner.atStart(...start(100, 50, 0, 0));
    aligner.atEnd(...end(16, { createdViews: 2, rendererMs: 40, submitMs: 3, heapMb: 200 }));
    // gap before callback 2: a queue unit linked one more program, a zone
    // step ran in an idle callback; the ledger read at the top of 2 also
    // holds callback 1's own view build ms
    aligner.atStart(...start(102, 50, 12, 30));
    const sample = aligner.atEnd(
      ...end(60, { createdViews: 0, rendererMs: 5, submitMs: 1, heapMb: 150 }),
    );
    expect(sample).toEqual({
      atMs: 1000,
      frameMs: 60,
      submitMs: 3,
      programs: 102,
      textures: 50,
      createdViews: 2,
      zoneBuildMs: 12,
      viewBuildMs: 30,
      rendererMs: 40,
      heapMb: 150,
    });
  });

  it('reuses one sample object across calls (allocation-free per frame)', () => {
    const aligner = createHitchFrameAligner();
    aligner.atStart(...start(1));
    aligner.atEnd(...end(16));
    aligner.atStart(...start(1));
    const first = aligner.atEnd(...end(16));
    aligner.atStart(...start(1));
    const second = aligner.atEnd(...end(20));
    expect(second).toBe(first);
    expect(first?.frameMs).toBe(20);
  });

  it('an end without a start (the log switched on mid-callback) emits nothing and is not a previous callback', () => {
    const aligner = createHitchFrameAligner();
    expect(aligner.atEnd(...end(16))).toBeNull();
    // the following callback has no fully read predecessor: still nothing
    aligner.atStart(...start(1));
    expect(aligner.atEnd(...end(16))).toBeNull();
    aligner.atStart(...start(1));
    expect(aligner.atEnd(...end(16))).not.toBeNull();
  });

  it('reset drops the previous callback, so the next sample is a fresh baseline', () => {
    const aligner = createHitchFrameAligner();
    aligner.atStart(...start(1));
    aligner.atEnd(...end(16));
    aligner.reset();
    aligner.atStart(...start(1));
    expect(aligner.atEnd(...end(16))).toBeNull();
    aligner.atStart(...start(1));
    expect(aligner.atEnd(...end(16))).not.toBeNull();
  });
});

describe('aligned attribution through the tracker', () => {
  /** Drives aligner + tracker like the renderer: atStart at the top of each
   *  callback, atEnd at its end, the tracker fed with what atEnd returns. */
  function session() {
    const aligner = createHitchFrameAligner();
    const tracker = createHitchTracker();
    const callback = (s: Start, e: End): ReturnType<typeof tracker.frame> => {
      aligner.atStart(...s);
      const sample = aligner.atEnd(...e);
      return sample ? tracker.frame(sample) : null;
    };
    return { callback, tracker };
  }

  it('files a program linked INSIDE a 100 ms callback on the sample whose dt covers that callback', () => {
    const { callback } = session();
    // two quiet callbacks establish the baseline
    callback(start(100), end(16, { rendererMs: 8 }));
    callback(start(100), end(16, { rendererMs: 8 }));
    // callback 3 links a program inside itself and takes 100 ms; its OWN dt is
    // still the quiet 16 ms before it, so nothing is filed here
    expect(callback(start(100), end(16, { rendererMs: 100 }))).toBeNull();
    // callback 4's dt covers callback 3: the compile is filed HERE, as
    // shader-compile, not as an off-frame stall of a short callback 4
    const hitch = callback(start(101), end(105, { rendererMs: 8 }));
    expect(hitch?.cause).toBe('shader-compile');
    expect(hitch?.programDelta).toBe(1);
    expect(hitch?.rendererMs).toBe(100);
    expect(hitch?.frameMs).toBe(105);
  });

  it('files a compile that ran in the GAP (a queue unit) on the sample right after it', () => {
    const { callback } = session();
    callback(start(100), end(16, { rendererMs: 8 }));
    callback(start(100), end(16, { rendererMs: 8 }));
    // the gap before callback 3 ran a queue unit that linked two programs and
    // took 60 ms: callback 3's own dt covers it, and its start reading shows it
    const hitch = callback(start(102), end(70, { rendererMs: 8 }));
    expect(hitch?.cause).toBe('shader-compile');
    expect(hitch?.programDelta).toBe(2);
    // the previous callback was short and is what the sample's rendererMs names
    expect(hitch?.rendererMs).toBe(8);
  });

  it('files created views and their build ms on the frame that paid them, view over a light zone step', () => {
    const { callback } = session();
    callback(start(100), end(16, { rendererMs: 8 }));
    callback(start(100), end(16, { rendererMs: 8 }));
    // callback 3 creates three views (50 ms of view builds) in 60 ms of
    // callback; a 0.3 ms zone step ran in the gap after it
    expect(callback(start(100), end(16, { createdViews: 3, rendererMs: 60 }))).toBeNull();
    const hitch = callback(start(100, 50, 0.3, 50), end(64, { rendererMs: 8 }));
    expect(hitch?.cause).toBe('view-create');
    expect(hitch?.createdViews).toBe(3);
    expect(hitch?.viewBuildMs).toBe(50);
    expect(hitch?.zoneBuildMs).toBe(0.3);
    expect(hitch?.rendererMs).toBe(60);
  });

  it('a short callback after a quiet gap that still ran long is off-frame, not the next frame stall', () => {
    const { callback } = session();
    callback(start(100), end(16, { rendererMs: 8 }));
    callback(start(100), end(16, { rendererMs: 8 }));
    // nothing linked, nothing built, the callback before was 8 ms: the 90 ms
    // passed outside the render path
    const hitch = callback(start(100), end(98, { rendererMs: 8 }));
    expect(hitch?.cause).toBe('off-frame');
    expect(hitch?.rendererMs).toBe(8);
  });
});
