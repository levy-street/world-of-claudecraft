import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import {
  createGpuPrepBudget,
  DEFAULT_GPU_PREP_BUDGET_CONFIG,
  type GpuPrepBudgetConfig,
  gpuPrepClassForPriority,
  gpuPrepCoverAdmits,
  gpuPrepKindOfLabel,
} from '../src/render/gpu_prep_budget_core';
import { LINKED_PROGRAM_TOUCH_LABEL } from '../src/render/linked_program_touch_lane';
import {
  PREVIEW_TEXTURE_PREP_LABEL,
  TEXTURE_PREP_LABEL,
  texturePieceLabel,
  texturePrepPriority,
} from '../src/render/texture_prep_lane';

/** texturePieceLabel reads only these four fields off a texture. */
const sizedTexture = (width: number, height: number): THREE.Texture =>
  ({ image: { width, height }, name: 'slab', uuid: 'abcdef0123' }) as unknown as THREE.Texture;

// targetFrameMs 24 with a 2 ms floor makes every headroom below an exact
// integer, so a wrong clamp or a missed spend shows up as a number, not as a
// tolerance. frameEmaAlpha 1 makes noteFrame set the average outright.
const CONFIG: GpuPrepBudgetConfig = {
  targetFrameMs: 24,
  minSliceMs: 2,
  // The proportional overrun floor is exercised on its own below; zero here
  // keeps every headroom an exact integer.
  overrunSliceShare: 0,
  maxDeferFrames: 5,
  cosmeticMaxDeferFrames: 5,
  unknownCostMs: 9,
  emaAlpha: 0.5,
  frameEmaAlpha: 1,
};

const budgetAt = (frameMs: number, over: Partial<GpuPrepBudgetConfig> = {}) => {
  const budget = createGpuPrepBudget({ ...CONFIG, ...over });
  budget.noteFrame(frameMs);
  return budget;
};

describe('gpu prep class mapping', () => {
  it('maps every queue priority constant onto its admission class', () => {
    expect(gpuPrepClassForPriority(GPU_WORK_PRIORITY.ACTIONABLE_VIEW)).toBe('actionable');
    expect(gpuPrepClassForPriority(GPU_WORK_PRIORITY.LIVE_VIEW)).toBe('visible');
    expect(gpuPrepClassForPriority(GPU_WORK_PRIORITY.VISIBLE_PREWARM)).toBe('approaching');
    // The load-bearing one: unpaid link debt surfaces as a live first-draw
    // stall, so it must NOT fall in with the cosmetic warmers below it.
    expect(gpuPrepClassForPriority(GPU_WORK_PRIORITY.BOOT_DEBT)).toBe('approaching');
    // A gate's tail pieces queue below the debt but are never cosmetic.
    expect(gpuPrepClassForPriority(GPU_WORK_PRIORITY.TAIL_PIECE)).toBe('approaching');
    expect(gpuPrepClassForPriority(GPU_WORK_PRIORITY.TAIL_PIECE - 1)).toBe('cosmetic');
    expect(gpuPrepClassForPriority(GPU_WORK_PRIORITY.BACKGROUND)).toBe('cosmetic');
    expect(gpuPrepClassForPriority(GPU_WORK_PRIORITY.BOOT_RESUME)).toBe('cosmetic');
  });

  it('puts each boundary on the lower class and survives junk priorities', () => {
    expect(gpuPrepClassForPriority(GPU_WORK_PRIORITY.ACTIONABLE_VIEW - 1)).toBe('visible');
    expect(gpuPrepClassForPriority(GPU_WORK_PRIORITY.LIVE_VIEW - 1)).toBe('approaching');
    expect(gpuPrepClassForPriority(GPU_WORK_PRIORITY.BOOT_DEBT - 1)).toBe('cosmetic');
    expect(gpuPrepClassForPriority(GPU_WORK_PRIORITY.ACTIONABLE_VIEW + 100)).toBe('actionable');
    expect(gpuPrepClassForPriority(-5)).toBe('cosmetic');
    expect(gpuPrepClassForPriority(Number.NaN)).toBe('cosmetic');
  });
});

describe('gpu prep cover rule', () => {
  it('admits the arrival lanes and refuses the debt and background ones', () => {
    // What an arrival curtain's frames are for: the keys the camera landed
    // among, their links and the tail pieces those keys settle on. The lanes
    // that pay old debt or warm what nobody is looking at wait for the lift.
    expect(gpuPrepCoverAdmits(GPU_WORK_PRIORITY.ACTIONABLE_VIEW)).toBe(true);
    expect(gpuPrepCoverAdmits(GPU_WORK_PRIORITY.LIVE_VIEW)).toBe(true);
    expect(gpuPrepCoverAdmits(GPU_WORK_PRIORITY.VISIBLE_PREWARM)).toBe(true);
    expect(gpuPrepCoverAdmits(GPU_WORK_PRIORITY.TAIL_PIECE)).toBe(true);
    expect(gpuPrepCoverAdmits(GPU_WORK_PRIORITY.BOOT_DEBT)).toBe(false);
    expect(gpuPrepCoverAdmits(GPU_WORK_PRIORITY.BACKGROUND)).toBe(false);
    expect(gpuPrepCoverAdmits(GPU_WORK_PRIORITY.BOOT_RESUME)).toBe(false);
  });

  it('draws the line right below VISIBLE_PREWARM, tail pieces excepted', () => {
    expect(gpuPrepCoverAdmits(GPU_WORK_PRIORITY.VISIBLE_PREWARM - 1)).toBe(false);
    expect(gpuPrepCoverAdmits(GPU_WORK_PRIORITY.TAIL_PIECE + 1)).toBe(false);
    expect(gpuPrepCoverAdmits(GPU_WORK_PRIORITY.TAIL_PIECE - 1)).toBe(false);
  });

  it('admits a candidate with no usable priority, the cover historical answer', () => {
    expect(gpuPrepCoverAdmits(undefined)).toBe(true);
    expect(gpuPrepCoverAdmits(Number.NaN)).toBe(true);
  });
});

describe('gpu prep kind of label', () => {
  it('keeps the prefix up to the first colon, so instances share one estimate', () => {
    expect(gpuPrepKindOfLabel('live-gate:Group')).toBe('live-gate');
    expect(gpuPrepKindOfLabel('reveal-gate:eastbrookBuilding:x')).toBe('reveal-gate');
    expect(gpuPrepKindOfLabel('preview:char-skin:0')).toBe('preview');
  });

  it('leaves a colon-free label alone and falls back to unlabeled on nothing', () => {
    expect(gpuPrepKindOfLabel('texture-chunk-upload')).toBe('texture-chunk-upload');
    expect(gpuPrepKindOfLabel('unlabeled')).toBe('unlabeled');
    expect(gpuPrepKindOfLabel('')).toBe('unlabeled');
    expect(gpuPrepKindOfLabel(':x')).toBe('unlabeled');
    expect(gpuPrepKindOfLabel('   :x')).toBe('unlabeled');
  });

  it('bounds the key length, because the label is caller-supplied', () => {
    const kind = gpuPrepKindOfLabel('k'.repeat(200));
    expect(kind.length).toBe(48);
    expect(gpuPrepKindOfLabel(`${'k'.repeat(200)}:tail`).length).toBe(48);
  });
});

describe('gpu prep budget: the gate upload pieces (upload:texture)', () => {
  const label = TEXTURE_PREP_LABEL;
  const kind = gpuPrepKindOfLabel(label);

  it('prices the uploads apart from the touch tail and the sky chunk path', () => {
    expect(kind).toBe('upload');
    expect(kind).not.toBe(gpuPrepKindOfLabel(LINKED_PROGRAM_TOUCH_LABEL));
    expect(kind).not.toBe(gpuPrepKindOfLabel('texture-chunk-upload'));
    expect(gpuPrepKindOfLabel(PREVIEW_TEXTURE_PREP_LABEL)).toBe('upload-preview');
  });

  it('classes a gate upload piece approaching at TAIL_PIECE, actionable on the floor', () => {
    expect(gpuPrepClassForPriority(texturePrepPriority(GPU_WORK_PRIORITY.VISIBLE_PREWARM))).toBe(
      'approaching',
    );
    expect(gpuPrepClassForPriority(texturePrepPriority(GPU_WORK_PRIORITY.ACTIONABLE_VIEW))).toBe(
      'actionable',
    );
  });

  it('takes the unknown prior and exactly one first-sample slot per frame', () => {
    const budget = budgetAt(20);
    const cls = gpuPrepClassForPriority(GPU_WORK_PRIORITY.TAIL_PIECE);
    expect(budget.predictMs(label)).toBe(CONFIG.unknownCostMs);

    const first = budget.admit({ kind: label, cls, deferredFrames: 0 });
    const second = budget.admit({ kind: label, cls, deferredFrames: 0 });

    expect(first).toMatchObject({ admit: true, reason: 'first-sample' });
    expect(second).toMatchObject({ admit: false, reason: 'unknown-cap' });

    // One sample is all it takes: the kind now has a learned cost, and a
    // sibling label of the same kind reads it too.
    budget.record(label, 3);
    expect(budget.predictMs(label)).toBe(3);
    expect(budget.predictMs('upload:whatever')).toBe(3);
  });

  it('gives every upload size class its own kind, straight off texturePieceLabel', () => {
    expect(gpuPrepKindOfLabel(texturePieceLabel(label, sizedTexture(1024, 1024)))).toBe(
      'upload-big',
    );
    expect(gpuPrepKindOfLabel(texturePieceLabel(label, sizedTexture(512, 512)))).toBe('upload-mid');
    expect(gpuPrepKindOfLabel(texturePieceLabel(label, sizedTexture(64, 64)))).toBe('upload');
    expect(gpuPrepKindOfLabel('upload-big:texture:slab:1024x1024u')).toBe('upload-big');
    expect(gpuPrepKindOfLabel('upload-mid:texture:slab:512x512u')).toBe('upload-mid');
  });

  it('keeps the size classes separate ledgers, in both directions', () => {
    const small = budgetAt(20);
    small.record(label, 3);
    expect(small.predictMs('upload-big:texture:slab:1024x1024u')).toBe(CONFIG.unknownCostMs);
    expect(small.predictMs('upload:texture:pebble:64x64u')).toBe(3);

    const big = budgetAt(20);
    big.record('upload-big:texture:slab:1024x1024u', 300);
    expect(big.predictMs('upload-big:texture:other:2048x2048c')).toBe(300);
    expect(big.predictMs(label)).toBe(CONFIG.unknownCostMs);
  });
});

describe('gpu prep headroom arithmetic', () => {
  it('is the target minus the measured frame', () => {
    expect(budgetAt(20).headroomMs()).toBe(4);
  });

  it('floors at minSliceMs when the frame already overruns the target', () => {
    expect(budgetAt(40).headroomMs()).toBe(2);
    // Not the negative the raw subtraction would give, and not zero either:
    // the slowest machine is the one carrying the most preparation debt.
    expect(budgetAt(24).headroomMs()).toBe(2);
  });

  it('shrinks as the frame is charged and never goes below zero', () => {
    const budget = budgetAt(20);
    budget.spend(1.5);
    expect(budget.headroomMs()).toBe(2.5);
    budget.spend(10);
    expect(budget.headroomMs()).toBe(0);
  });

  it('resets the frame spend on the next frame', () => {
    const budget = budgetAt(20);
    budget.spend(4);
    expect(budget.headroomMs()).toBe(0);
    budget.noteFrame(20);
    expect(budget.headroomMs()).toBe(4);
  });

  it('ignores a junk spend and a junk frame duration', () => {
    const budget = budgetAt(20);
    budget.spend(Number.NaN);
    budget.spend(-5);
    expect(budget.headroomMs()).toBe(4);
    budget.noteFrame(Number.NaN);
    expect(budget.snapshot().frameEmaMs).toBe(20);
    budget.noteFrame(-3);
    expect(budget.snapshot().frameEmaMs).toBe(20);
  });

  it('seeds the frame average at the target, so nothing is spent on an unmeasured frame', () => {
    expect(createGpuPrepBudget(CONFIG).headroomMs()).toBe(2);
  });

  it('smooths later frames instead of tracking the last one', () => {
    const budget = createGpuPrepBudget({ ...CONFIG, frameEmaAlpha: 0.5 });
    budget.noteFrame(20);
    expect(budget.snapshot().frameEmaMs).toBe(20);
    budget.noteFrame(16);
    expect(budget.snapshot().frameEmaMs).toBe(18);
  });
});

describe('gpu prep cost ledger', () => {
  it('predicts the unknown prior until a kind has a sample', () => {
    const budget = createGpuPrepBudget(CONFIG);
    expect(budget.predictMs('reveal-gate:tavern')).toBe(9);
    budget.record('reveal-gate:tavern', 3);
    expect(budget.predictMs('reveal-gate:tavern')).toBe(3);
    // The estimate is per KIND, so a sibling instance inherits it and an
    // unrelated kind does not.
    expect(budget.predictMs('reveal-gate:forge:2')).toBe(3);
    expect(budget.predictMs('texture-chunk-upload')).toBe(9);
  });

  it('sets on the first sample, then blends at emaAlpha', () => {
    const budget = createGpuPrepBudget(CONFIG);
    budget.record('live-gate:Group', 10);
    expect(budget.predictMs('live-gate:Group')).toBe(10);
    budget.record('live-gate:Other', 20);
    expect(budget.predictMs('live-gate:x')).toBe(15);
    budget.record('live-gate:x', 5);
    expect(budget.predictMs('live-gate:x')).toBe(10);
    expect(budget.snapshot().kinds).toEqual([{ kind: 'live-gate', emaMs: 10, samples: 3 }]);
  });

  it('ignores a non-finite or negative sample rather than poisoning the estimate', () => {
    const budget = createGpuPrepBudget(CONFIG);
    budget.record('preview:0', 4);
    budget.record('preview:1', Number.NaN);
    budget.record('preview:2', Number.POSITIVE_INFINITY);
    budget.record('preview:3', -2);
    expect(budget.predictMs('preview')).toBe(4);
    expect(budget.snapshot().kinds).toEqual([{ kind: 'preview', emaMs: 4, samples: 1 }]);
  });

  it('bounds the kinds map and keeps learning the kinds it already holds', () => {
    const budget = createGpuPrepBudget(CONFIG);
    for (let index = 0; index < 64; index++) budget.record(`kind-${index}`, 1);
    expect(budget.snapshot().kinds.length).toBe(64);
    budget.record('kind-overflow', 7);
    expect(budget.snapshot().kinds.length).toBe(64);
    expect(budget.predictMs('kind-overflow')).toBe(9);
    // The bound drops the new kind, never the learning on a resident one.
    budget.record('kind-0', 3);
    expect(budget.predictMs('kind-0')).toBe(2);
  });
});

describe('gpu prep admission rules, in order', () => {
  it('admits actionable work with no headroom at all', () => {
    const budget = budgetAt(40);
    budget.spend(2);
    expect(budget.headroomMs()).toBe(0);
    budget.record('live-gate:Group', 8);
    expect(budget.admit({ kind: 'live-gate:Group', cls: 'actionable', deferredFrames: 0 })).toEqual(
      { admit: true, reason: 'actionable-floor', predictedMs: 8 },
    );
    // Same kind, same ZERO headroom: the visible class is refused too, since
    // the progress slot needs some headroom left (an exhausted frame takes no
    // oversized piece); with a little headroom left it takes the slot once.
    expect(budget.admit({ kind: 'live-gate:Group', cls: 'visible', deferredFrames: 0 })).toEqual({
      admit: false,
      reason: 'no-headroom',
      predictedMs: 8,
      headroomMs: 0,
    });
    budget.noteFrame(40);
    budget.spend(1);
    expect(budget.admit({ kind: 'live-gate:Group', cls: 'visible', deferredFrames: 0 })).toEqual({
      admit: true,
      reason: 'progress',
      predictedMs: 8,
    });
    expect(budget.admit({ kind: 'live-gate:Group', cls: 'visible', deferredFrames: 0 })).toEqual({
      admit: false,
      reason: 'no-headroom',
      predictedMs: 8,
      headroomMs: 1,
    });
  });

  it('admits at exactly maxDeferFrames and not one frame earlier', () => {
    const budget = budgetAt(40);
    budget.spend(2);
    budget.record('bg-warm:0', 8);
    expect(budget.admit({ kind: 'bg-warm:1', cls: 'cosmetic', deferredFrames: 4 })).toMatchObject({
      admit: false,
      reason: 'no-headroom',
    });
    expect(budget.admit({ kind: 'bg-warm:1', cls: 'cosmetic', deferredFrames: 5 })).toEqual({
      admit: true,
      reason: 'starvation',
      predictedMs: 8,
    });
  });

  it('defers cosmetic work under pressure, and only cosmetic work', () => {
    const budget = budgetAt(20);
    budget.record('bg-warm:0', 1);
    budget.record('live-gate:0', 1);
    budget.notePressure(true);
    expect(budget.admit({ kind: 'bg-warm:1', cls: 'cosmetic', deferredFrames: 0 })).toEqual({
      admit: false,
      reason: 'pressure',
      predictedMs: 1,
      headroomMs: 4,
    });
    expect(budget.admit({ kind: 'live-gate:1', cls: 'visible', deferredFrames: 0 })).toMatchObject({
      admit: true,
      reason: 'fits',
    });
    expect(
      budget.admit({ kind: 'live-gate:1', cls: 'approaching', deferredFrames: 0 }),
    ).toMatchObject({ admit: true, reason: 'fits' });
    expect(
      budget.admit({ kind: 'live-gate:1', cls: 'actionable', deferredFrames: 0 }),
    ).toMatchObject({ admit: true, reason: 'actionable-floor' });
    // Pressure delays; the starvation bound still ends the delay.
    expect(budget.admit({ kind: 'bg-warm:1', cls: 'cosmetic', deferredFrames: 5 })).toMatchObject({
      admit: true,
      reason: 'starvation',
    });
    budget.notePressure(false);
    expect(budget.admit({ kind: 'bg-warm:1', cls: 'cosmetic', deferredFrames: 0 })).toMatchObject({
      admit: true,
      reason: 'fits',
    });
  });

  it('lets one unmeasured kind through per frame, then caps the rest', () => {
    const budget = budgetAt(40);
    budget.spend(2);
    // Zero headroom, and the prior (9 ms) would never fit: the first-sample
    // slot is what turns a guess into a measurement.
    expect(budget.headroomMs()).toBe(0);
    expect(budget.admit({ kind: 'reveal-gate:a', cls: 'visible', deferredFrames: 0 })).toEqual({
      admit: true,
      reason: 'first-sample',
      predictedMs: 9,
    });
    expect(
      budget.admit({ kind: 'texture-chunk-upload', cls: 'visible', deferredFrames: 0 }),
    ).toEqual({ admit: false, reason: 'unknown-cap', predictedMs: 9, headroomMs: 0 });
    // Still unknown until something is recorded, slot spent either way.
    expect(
      budget.admit({ kind: 'reveal-gate:b', cls: 'visible', deferredFrames: 0 }),
    ).toMatchObject({ admit: false, reason: 'unknown-cap' });
    budget.noteFrame(20);
    expect(
      budget.admit({ kind: 'texture-chunk-upload', cls: 'visible', deferredFrames: 0 }),
    ).toMatchObject({ admit: true, reason: 'first-sample' });
    // Once measured, the kind is priced instead of slotted.
    budget.record('texture-chunk-upload', 1);
    budget.noteFrame(20);
    expect(
      budget.admit({ kind: 'texture-chunk-upload', cls: 'visible', deferredFrames: 0 }),
    ).toMatchObject({ admit: true, reason: 'fits' });
    expect(
      budget.admit({ kind: 'reveal-gate:c', cls: 'visible', deferredFrames: 0 }),
    ).toMatchObject({ admit: true, reason: 'first-sample' });
  });

  it('flips from fits to no-headroom exactly at predicted === headroom', () => {
    const budget = budgetAt(20);
    budget.record('reveal-gate:a', 4);
    budget.record('texture-chunk-upload', 4.5);
    expect(budget.headroomMs()).toBe(4);
    // Equality admits.
    expect(budget.admit({ kind: 'reveal-gate:b', cls: 'visible', deferredFrames: 0 })).toEqual({
      admit: true,
      reason: 'fits',
      predictedMs: 4,
    });
    // Half a millisecond over the same headroom does not (cosmetic: the visible
    // and approaching classes would take the per-frame progress slot instead).
    expect(
      budget.admit({ kind: 'texture-chunk-upload', cls: 'cosmetic', deferredFrames: 0 }),
    ).toEqual({ admit: false, reason: 'no-headroom', predictedMs: 4.5, headroomMs: 4 });
    // ...and the charged frame moves the line under the kind that just fitted:
    // the visible piece takes the frame's progress slot once (a spend does not
    // close it), and the one behind it is refused on the smaller headroom.
    budget.spend(0.5);
    expect(budget.admit({ kind: 'reveal-gate:b', cls: 'visible', deferredFrames: 0 })).toEqual({
      admit: true,
      reason: 'progress',
      predictedMs: 4,
    });
    expect(budget.admit({ kind: 'reveal-gate:b', cls: 'visible', deferredFrames: 0 })).toEqual({
      admit: false,
      reason: 'no-headroom',
      predictedMs: 4,
      headroomMs: 3.5,
    });
  });

  it('treats a junk deferredFrames as zero rather than as starvation', () => {
    const budget = budgetAt(40);
    budget.spend(2);
    budget.record('bg-warm:0', 8);
    expect(
      budget.admit({ kind: 'bg-warm:1', cls: 'cosmetic', deferredFrames: Number.NaN }),
    ).toMatchObject({ admit: false, reason: 'no-headroom' });
  });
});

describe('gpu prep legacy switch', () => {
  it('admits everything while on and still learns, and restores the policy when off', () => {
    const budget = budgetAt(40);
    budget.spend(2);
    budget.notePressure(true);
    budget.setLegacy(true);
    expect(budget.admit({ kind: 'bg-warm:1', cls: 'cosmetic', deferredFrames: 0 })).toEqual({
      admit: true,
      reason: 'legacy',
      predictedMs: 9,
    });
    budget.record('bg-warm:1', 6);
    expect(budget.predictMs('bg-warm')).toBe(6);
    expect(budget.snapshot()).toMatchObject({ legacy: true, degrading: true });
    budget.setLegacy(false);
    expect(budget.admit({ kind: 'bg-warm:1', cls: 'cosmetic', deferredFrames: 0 })).toMatchObject({
      admit: false,
      reason: 'pressure',
    });
  });
});

describe('gpu prep snapshot', () => {
  it('counts decisions per reason since creation and leads with the costliest kind', () => {
    const budget = budgetAt(20);
    budget.record('cheap:0', 1);
    budget.record('dear:0', 12);
    budget.admit({ kind: 'cheap:1', cls: 'visible', deferredFrames: 0 });
    budget.admit({ kind: 'dear:1', cls: 'visible', deferredFrames: 0 });
    budget.admit({ kind: 'dear:1', cls: 'actionable', deferredFrames: 0 });
    budget.admit({ kind: 'fresh:1', cls: 'visible', deferredFrames: 0 });
    budget.admit({ kind: 'fresh:2', cls: 'visible', deferredFrames: 0 });
    budget.admit({ kind: 'dear:1', cls: 'visible', deferredFrames: 5 });
    budget.notePressure(true);
    budget.admit({ kind: 'cheap:1', cls: 'cosmetic', deferredFrames: 0 });
    budget.admit({
      kind: 'cheap:1',
      cls: 'cosmetic',
      deferredFrames: 0,
      cover: true,
      priority: GPU_WORK_PRIORITY.BOOT_DEBT,
    });
    budget.admit({
      kind: 'cheap:1',
      cls: 'approaching',
      deferredFrames: 0,
      cover: true,
      priority: GPU_WORK_PRIORITY.TAIL_PIECE,
    });
    budget.setLegacy(true);
    budget.admit({ kind: 'cheap:1', cls: 'cosmetic', deferredFrames: 0 });
    budget.spend(0.5);

    const snapshot = budget.snapshot();
    expect(snapshot.decisions).toEqual({
      'actionable-floor': 1,
      fits: 1,
      progress: 1,
      starvation: 1,
      legacy: 1,
      'first-sample': 1,
      cover: 1,
      'no-headroom': 0,
      'unknown-cap': 1,
      pressure: 1,
      'cover-not-arrival': 1,
    });
    expect(snapshot.kinds).toEqual([
      { kind: 'dear', emaMs: 12, samples: 1 },
      { kind: 'cheap', emaMs: 1, samples: 1 },
    ]);
    expect(snapshot).toMatchObject({
      frameEmaMs: 20,
      headroomMs: 3.5,
      spentThisFrameMs: 0.5,
      legacy: true,
      degrading: true,
    });
  });
});

describe('gpu prep defaults', () => {
  it('keeps a frame-rate-agnostic target and a pessimistic unknown prior', () => {
    expect(DEFAULT_GPU_PREP_BUDGET_CONFIG.targetFrameMs).toBeCloseTo(1000 / 60, 6);
    expect(DEFAULT_GPU_PREP_BUDGET_CONFIG.minSliceMs).toBeGreaterThan(0);
    expect(DEFAULT_GPU_PREP_BUDGET_CONFIG.unknownCostMs).toBeGreaterThan(
      DEFAULT_GPU_PREP_BUDGET_CONFIG.minSliceMs,
    );
    expect(DEFAULT_GPU_PREP_BUDGET_CONFIG.maxDeferFrames).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_GPU_PREP_BUDGET_CONFIG.emaAlpha).toBeGreaterThan(
      DEFAULT_GPU_PREP_BUDGET_CONFIG.frameEmaAlpha,
    );
  });

  it('falls back to a default for every junk config field', () => {
    const budget = createGpuPrepBudget({
      targetFrameMs: Number.NaN,
      minSliceMs: -1,
      overrunSliceShare: 2,
      maxDeferFrames: 0,
      unknownCostMs: Number.POSITIVE_INFINITY,
      emaAlpha: 0,
      frameEmaAlpha: 2,
    });
    budget.noteFrame(1000);
    expect(budget.headroomMs()).toBe(1000 * DEFAULT_GPU_PREP_BUDGET_CONFIG.overrunSliceShare);
    expect(budget.predictMs('anything')).toBe(DEFAULT_GPU_PREP_BUDGET_CONFIG.unknownCostMs);
    expect(
      budget.admit({
        kind: 'anything',
        cls: 'cosmetic',
        deferredFrames: DEFAULT_GPU_PREP_BUDGET_CONFIG.cosmeticMaxDeferFrames,
      }),
    ).toMatchObject({ admit: true, reason: 'starvation' });
  });
});

describe('gpu prep budget: progress and class-specific starvation', () => {
  it('lets one oversized visible piece through per frame', () => {
    const budget = budgetAt(40); // headroom = floor 2 ms
    budget.record('touch:0', 15);
    expect(budget.admit({ kind: 'touch:1', cls: 'visible', deferredFrames: 0 })).toEqual({
      admit: true,
      reason: 'progress',
      predictedMs: 15,
    });
    // The second oversized visible piece of the frame waits.
    expect(budget.admit({ kind: 'touch:2', cls: 'visible', deferredFrames: 0 })).toMatchObject({
      admit: false,
      reason: 'no-headroom',
    });
    // The next frame re-arms the rule.
    budget.noteFrame(40);
    expect(budget.admit({ kind: 'touch:3', cls: 'visible', deferredFrames: 0 })).toMatchObject({
      admit: true,
      reason: 'progress',
    });
  });

  it('keeps the progress slot open on a frame that already spent, never for cosmetic', () => {
    // The slot is per FRAME, not per unspent frame: gating it on a frame that
    // had spent nothing let any actionable unit that ran first close it for
    // every visible and approaching piece behind it.
    const budget = budgetAt(40);
    budget.record('touch:0', 15);
    budget.spend(0.5);
    expect(budget.admit({ kind: 'touch:1', cls: 'visible', deferredFrames: 0 })).toMatchObject({
      admit: true,
      reason: 'progress',
    });
    // Still one per frame: the second oversized piece of the frame waits.
    expect(budget.admit({ kind: 'touch:2', cls: 'visible', deferredFrames: 0 })).toMatchObject({
      admit: false,
      reason: 'no-headroom',
    });
    // Approaching work (a reveal-gate compile, a tail piece) shares the slot:
    // a band's escape draws it cold if its compile waits behind the frame.
    const fresh = budgetAt(40);
    fresh.record('touch:0', 15);
    expect(fresh.admit({ kind: 'touch:1', cls: 'approaching', deferredFrames: 0 })).toMatchObject({
      admit: true,
      reason: 'progress',
    });
    const cosmetic = budgetAt(40);
    cosmetic.record('touch:0', 15);
    expect(cosmetic.admit({ kind: 'touch:1', cls: 'cosmetic', deferredFrames: 0 })).toMatchObject({
      admit: false,
      reason: 'no-headroom',
    });
    // ...but never on a frame an earlier piece already exhausted: the cheap
    // link submissions behind it would lose the whole frame.
    const exhausted = budgetAt(40);
    exhausted.record('touch:0', 15);
    exhausted.spend(2); // headroom floor 2 -> 0 left
    expect(exhausted.headroomMs()).toBe(0);
    expect(exhausted.admit({ kind: 'touch:1', cls: 'visible', deferredFrames: 0 })).toMatchObject({
      admit: false,
      reason: 'no-headroom',
    });
  });

  it('leaves an unmeasured visible kind to the first-sample slot, not to progress', () => {
    const budget = budgetAt(40);
    expect(budget.admit({ kind: 'fresh:1', cls: 'visible', deferredFrames: 0 })).toMatchObject({
      admit: true,
      reason: 'first-sample',
    });
    expect(budget.admit({ kind: 'other:1', cls: 'visible', deferredFrames: 0 })).toMatchObject({
      admit: false,
      reason: 'unknown-cap',
    });
    // The progress slot is still free for a MEASURED oversized visible piece.
    budget.record('touch:0', 15);
    expect(budget.admit({ kind: 'touch:1', cls: 'visible', deferredFrames: 0 })).toMatchObject({
      admit: true,
      reason: 'progress',
    });
  });

  it('takes a live frame target from noteFrame, so a tier change moves the headroom', () => {
    // GFX is REASSIGNED on a tier change, so a target captured once at
    // construction leaves the session pacing against the tier it booted on.
    const budget = budgetAt(20); // 24 ms target, 20 ms frames: 4 ms of headroom
    expect(budget.headroomMs()).toBe(4);
    budget.noteFrame(20, 30);
    expect(budget.headroomMs()).toBe(10);
    // Junk keeps the target that is running.
    budget.noteFrame(20, Number.NaN);
    expect(budget.headroomMs()).toBe(10);
    budget.noteFrame(20, -5);
    expect(budget.headroomMs()).toBe(10);
    budget.noteFrame(20);
    expect(budget.headroomMs()).toBe(10);
  });

  it('gives cosmetic work its own, longer starvation bound', () => {
    const budget = budgetAt(40, { maxDeferFrames: 5, cosmeticMaxDeferFrames: 8 });
    budget.record('warm:0', 30);
    expect(budget.admit({ kind: 'warm:1', cls: 'cosmetic', deferredFrames: 5 })).toMatchObject({
      admit: false,
      reason: 'no-headroom',
    });
    expect(budget.admit({ kind: 'warm:1', cls: 'cosmetic', deferredFrames: 8 })).toMatchObject({
      admit: true,
      reason: 'starvation',
    });
    expect(budget.admit({ kind: 'warm:1', cls: 'approaching', deferredFrames: 5 })).toMatchObject({
      admit: true,
      reason: 'starvation',
    });
    expect(DEFAULT_GPU_PREP_BUDGET_CONFIG.cosmeticMaxDeferFrames).toBeGreaterThan(
      DEFAULT_GPU_PREP_BUDGET_CONFIG.maxDeferFrames,
    );
  });
});

describe('gpu prep budget: the overrun floor is a share of the frame', () => {
  it('gives a slow machine a proportional slice instead of the fixed floor', () => {
    const budget = createGpuPrepBudget({ ...CONFIG, overrunSliceShare: 0.1 });
    // 40 ms frames against a 24 ms target: the fixed floor would be 2 ms, the
    // share gives 4 ms, and spend still comes off it.
    budget.noteFrame(40);
    expect(budget.headroomMs()).toBe(4);
    budget.spend(1);
    expect(budget.headroomMs()).toBe(3);
    // Under the target the real headroom wins over the share.
    budget.noteFrame(10);
    expect(budget.headroomMs()).toBe(14);
    // A tiny frame keeps the fixed floor.
    budget.noteFrame(1);
    expect(budget.headroomMs()).toBe(23);
  });

  it('never lets the share fall below minSliceMs', () => {
    const budget = createGpuPrepBudget({ ...CONFIG, minSliceMs: 5, overrunSliceShare: 0.1 });
    budget.noteFrame(30);
    expect(budget.headroomMs()).toBe(5);
    expect(DEFAULT_GPU_PREP_BUDGET_CONFIG.overrunSliceShare).toBeGreaterThan(0);
    expect(DEFAULT_GPU_PREP_BUDGET_CONFIG.overrunSliceShare).toBeLessThan(0.5);
  });
});
