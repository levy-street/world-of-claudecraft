// The adapter between the queue's admission seam and the budget core
// (src/render/gpu_prep_admission.ts). Its whole job is translation, so these
// cases pin the translation: label to cost KIND, priority to admission CLASS,
// and a spend that both learns the piece's cost and charges the frame.
import { afterEach, describe, expect, it } from 'vitest';
import { resetArrivalCoverForTest, setArrivalCover } from '../src/render/arrival_cover';
import { GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import { createGpuPrepAdmission } from '../src/render/gpu_prep_admission';
import { createGpuPrepBudget } from '../src/render/gpu_prep_budget_core';

afterEach(() => {
  resetArrivalCoverForTest();
});

describe('createGpuPrepAdmission', () => {
  it('admits an actionable-priority candidate whatever the frame costs', () => {
    const budget = createGpuPrepBudget({ targetFrameMs: 16.7 });
    const admission = createGpuPrepAdmission(budget);
    budget.noteFrame(90);

    expect(
      admission.admit({
        label: 'live-gate:target',
        priority: GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
        deferredFrames: 0,
      }),
    ).toBe(true);
    expect(budget.snapshot().decisions['actionable-floor']).toBe(1);
  });

  it('prices a candidate by its label KIND, so every piece of a family shares one estimate', () => {
    const budget = createGpuPrepBudget({ targetFrameMs: 16.7, minSliceMs: 1.5 });
    const admission = createGpuPrepAdmission(budget);
    budget.noteFrame(16.7);

    // The first piece of an unmeasured kind rides the first-sample slot and
    // teaches the ledger what the kind costs...
    expect(
      admission.admit({
        label: 'reveal-gate:tavern:1',
        priority: GPU_WORK_PRIORITY.VISIBLE_PREWARM,
        deferredFrames: 0,
      }),
    ).toBe(true);
    admission.spend(40, 'reveal-gate:tavern:1');
    expect(budget.snapshot().kinds).toEqual([{ kind: 'reveal-gate', emaMs: 40, samples: 1 }]);

    // ...so a DIFFERENT instance of the same family is priced by it, not by
    // the unknown prior, and 40 ms does not fit a frame already at its target.
    // The frame's one progress slot goes to the first approaching piece; the
    // next one of the family is refused on the headroom.
    budget.noteFrame(16.7);
    budget.spend(0.1);
    expect(
      admission.admit({
        label: 'reveal-gate:forge:7',
        priority: GPU_WORK_PRIORITY.VISIBLE_PREWARM,
        deferredFrames: 0,
      }),
    ).toBe(true);
    expect(
      admission.admit({
        label: 'reveal-gate:forge:8',
        priority: GPU_WORK_PRIORITY.VISIBLE_PREWARM,
        deferredFrames: 0,
      }),
    ).toBe(false);
    expect(budget.snapshot().decisions['no-headroom']).toBe(1);
  });

  it('maps a background priority onto the cosmetic class, which pressure defers', () => {
    const budget = createGpuPrepBudget({ targetFrameMs: 16.7 });
    const admission = createGpuPrepAdmission(budget);
    budget.noteFrame(8);
    budget.record('touch', 0.2);
    budget.notePressure(true);

    expect(
      admission.admit({
        label: 'touch:program',
        priority: GPU_WORK_PRIORITY.BACKGROUND,
        deferredFrames: 0,
      }),
    ).toBe(false);
    expect(budget.snapshot().decisions.pressure).toBe(1);
    // The same piece for a LIVE view is the 'visible' class, which pressure
    // never touches: a graphics knob may not delay what a player reacts to.
    expect(
      admission.admit({
        label: 'touch:program',
        priority: GPU_WORK_PRIORITY.LIVE_VIEW,
        deferredFrames: 0,
      }),
    ).toBe(true);
  });

  it('honours the starvation bound the queue counts for it', () => {
    const budget = createGpuPrepBudget({
      targetFrameMs: 16.7,
      maxDeferFrames: 4,
      cosmeticMaxDeferFrames: 6,
    });
    const admission = createGpuPrepAdmission(budget);
    budget.noteFrame(60);
    budget.spend(0.1);
    budget.record('touch', 99);

    // BACKGROUND is cosmetic: its own, longer bound applies.
    const candidate = { label: 'touch:program', priority: GPU_WORK_PRIORITY.BACKGROUND };
    expect(admission.admit({ ...candidate, deferredFrames: 4 })).toBe(false);
    expect(admission.admit({ ...candidate, deferredFrames: 6 })).toBe(true);
    // VISIBLE_PREWARM is approaching: the general bound. Its per-frame
    // progress slot comes first, so consume it and let the bound be what the
    // two arms below actually test.
    const approaching = { label: 'touch:program', priority: GPU_WORK_PRIORITY.VISIBLE_PREWARM };
    expect(admission.admit({ ...approaching, deferredFrames: 0 })).toBe(true);
    expect(admission.admit({ ...approaching, deferredFrames: 3 })).toBe(false);
    expect(admission.admit({ ...approaching, deferredFrames: 4 })).toBe(true);
    expect(budget.snapshot().decisions.starvation).toBe(2);
  });

  it('spends the frame it charges, so a second piece sees the smaller headroom', () => {
    const budget = createGpuPrepBudget({ targetFrameMs: 30, minSliceMs: 1 });
    const admission = createGpuPrepAdmission(budget);
    budget.noteFrame(20);
    expect(budget.headroomMs()).toBe(10);

    admission.spend(4, 'touch:program');

    expect(budget.headroomMs()).toBe(6);
    expect(budget.predictMs('touch:anything')).toBe(4);
  });

  it('admits everything while the legacy kill switch is on, and keeps learning', () => {
    const budget = createGpuPrepBudget({ targetFrameMs: 16.7 });
    const admission = createGpuPrepAdmission(budget);
    budget.noteFrame(120);
    budget.setLegacy(true);

    expect(
      admission.admit({
        label: 'touch:program',
        priority: GPU_WORK_PRIORITY.BOOT_RESUME,
        deferredFrames: 0,
      }),
    ).toBe(true);
    admission.spend(3, 'touch:program');

    const snapshot = budget.snapshot();
    expect(snapshot.decisions.legacy).toBe(1);
    expect(snapshot.kinds).toEqual([{ kind: 'touch', emaMs: 3, samples: 1 }]);
  });
  it('under the arrival curtain admits the arrival lanes and refuses the debt ones', () => {
    // The frame behind a loading screen is not a frame to protect, but it is
    // not a frame to give away either: free admission for everything is what
    // starved the arrival, because the boot-debt and background lanes drained
    // at full speed ahead of the very keys the camera landed among (measured
    // at an online entry: after a full second of hold, 0 of 1 roots ready on
    // every band key and 0 of 12 on the town).
    const budget = createGpuPrepBudget({ targetFrameMs: 16.7, minSliceMs: 1 });
    const admission = createGpuPrepAdmission(budget);
    budget.noteFrame(120);
    budget.record('touch', 40);
    budget.record('reveal-gate', 40);
    const debt = {
      label: 'reveal-gate:tavern',
      priority: GPU_WORK_PRIORITY.BOOT_DEBT,
      deferredFrames: 0,
    };
    const imminentPiece = {
      label: 'touch:program',
      priority: GPU_WORK_PRIORITY.TAIL_PIECE,
      deferredFrames: 0,
    };
    const imminentLink = {
      label: 'reveal-gate:tavern',
      priority: GPU_WORK_PRIORITY.LIVE_VIEW,
      deferredFrames: 0,
    };

    setArrivalCover(true);
    // An imminent key's LINK and its tail PIECES both get through, which is
    // the whole point: a held key settles on its pieces, not on its link.
    expect(admission.admit(imminentLink)).toBe(true);
    expect(admission.admit(imminentPiece)).toBe(true);
    // The debt and background lanes wait for the lift.
    expect(admission.admit(debt)).toBe(false);
    expect(
      admission.admit({
        label: 'touch:program',
        priority: GPU_WORK_PRIORITY.BACKGROUND,
        deferredFrames: 0,
      }),
    ).toBe(false);
    const covered = budget.snapshot();
    expect(covered.decisions.cover).toBe(2);
    expect(covered.decisions['cover-not-arrival']).toBe(2);
    // The frame budget was not consulted at all, so its per-frame slots are
    // still there for the frames that do need them.
    expect(covered.decisions['first-sample']).toBe(0);
    expect(covered.decisions['no-headroom']).toBe(0);

    // Learning still happens under the cover, in the spend.
    admission.spend(3, 'touch:program');
    expect(budget.snapshot().kinds).toContainEqual({ kind: 'touch', emaMs: 28.9, samples: 2 });

    // Off the cover, the ordinary frame budget is back in charge.
    setArrivalCover(false);
    expect(
      admission.admit({
        label: 'touch:program',
        priority: GPU_WORK_PRIORITY.BACKGROUND,
        deferredFrames: 0,
      }),
    ).toBe(false);
    expect(budget.snapshot().decisions['no-headroom']).toBe(1);
  });

  it('stops the deferral clock for exactly the lanes the cover refuses', () => {
    // A `cover-not-arrival` refusal is not a wait for headroom, so it must not
    // age: ticking deferredFrames through a whole curtain left every
    // BOOT_DEBT / BACKGROUND / BOOT_RESUME unit past maxDeferFrames, and the
    // first live frame after the drop admitted the entire debt lane on
    // `starvation`.
    const budget = createGpuPrepBudget({ targetFrameMs: 16.7 });
    const admission = createGpuPrepAdmission(budget);
    const ages = (priority: number): boolean =>
      admission.agesDeferral?.({ label: 'touch:program', priority, deferredFrames: 0 }) ?? true;

    setArrivalCover(true);
    expect(ages(GPU_WORK_PRIORITY.BOOT_DEBT)).toBe(false);
    expect(ages(GPU_WORK_PRIORITY.BACKGROUND)).toBe(false);
    expect(ages(GPU_WORK_PRIORITY.BOOT_RESUME)).toBe(false);
    // The lanes the cover ADMITS never reach the ageing question refused, but
    // if the frame budget refuses one of them it is an ordinary wait.
    expect(ages(GPU_WORK_PRIORITY.TAIL_PIECE)).toBe(true);
    expect(ages(GPU_WORK_PRIORITY.LIVE_VIEW)).toBe(true);
    expect(ages(GPU_WORK_PRIORITY.VISIBLE_PREWARM)).toBe(true);
    expect(ages(GPU_WORK_PRIORITY.ACTIONABLE_VIEW)).toBe(true);

    // Cover off, every lane ages again: the pause belongs to the curtain, not
    // to the priority.
    setArrivalCover(false);
    for (const priority of Object.values(GPU_WORK_PRIORITY)) expect(ages(priority)).toBe(true);
  });

  it('the cover never overrules the legacy kill switch', () => {
    const budget = createGpuPrepBudget({ targetFrameMs: 16.7 });
    const admission = createGpuPrepAdmission(budget);
    budget.noteFrame(120);
    budget.setLegacy(true);
    setArrivalCover(true);
    expect(
      admission.admit({
        label: 'touch:program',
        priority: GPU_WORK_PRIORITY.BOOT_DEBT,
        deferredFrames: 0,
      }),
    ).toBe(true);
    expect(budget.snapshot().decisions.legacy).toBe(1);
    expect(budget.snapshot().decisions['cover-not-arrival']).toBe(0);
  });
});
