// The adapter between the two halves of GPU-preparation pacing: the queue's
// admission seam (background_gpu_queue.ts, which knows a candidate only by its
// label and priority) and the budget core (gpu_prep_budget_core.ts, which
// decides in terms of a cost KIND and an admission CLASS).
//
// It is deliberately the only place the two vocabularies meet, so the queue
// never learns what a class is and the core never learns what a queue unit is.
import { arrivalCoverActive } from './arrival_cover';
import type { GpuWorkAdmission } from './background_gpu_queue';
import { contextRestorePacingActive } from './context_restore_hold';
import {
  type GpuPrepBudget,
  gpuPrepClassForPriority,
  gpuPrepCoverAdmits,
  gpuPrepKindOfLabel,
} from './gpu_prep_budget_core';
import {
  linkHeldSinceLastFrame,
  linkHoldsCandidate,
  noteLinkFrame,
  noteLinkFrameEnded,
} from './link_frame_ledger';

/** Wrap a budget as the queue's admission: label to kind, priority to class,
 *  and a spend that both LEARNS the piece's real cost and charges the frame.
 *  The deferred link pacing (link_frame_ledger.ts) answers first: while issued
 *  links still owe frames, or the frame's own task is still running, a unit of a
 *  kind known to link waits for the gap after a frame that owes none, whatever
 *  the budget would say (so `?prep=legacy` keeps it), and that wait does not
 *  age it toward the budget's starvation bound. */
export function createGpuPrepAdmission(budget: GpuPrepBudget): GpuWorkAdmission {
  return {
    noteFrame(): boolean {
      return noteLinkFrame();
    },
    frameEnded(): void {
      noteLinkFrameEnded();
    },
    admit(candidate): boolean {
      const cls = gpuPrepClassForPriority(candidate.priority);
      if (linkHoldsCandidate(candidate.label, cls === 'actionable')) return false;
      // Under the arrival curtain there is no frame to protect: the player is
      // looking at a loading screen, and every unit admitted now is one that
      // does not link inside a live frame after it lifts. The budget still
      // decides, but on the COVER rule rather than on headroom
      // (gpuPrepCoverAdmits): free admission for everything is what starved
      // the arrival, because the boot-debt and background lanes drained at
      // full speed ahead of the very keys the camera landed among. The boot
      // cover has its own pacing lane and does not come through here.
      return budget.admit({
        kind: gpuPrepKindOfLabel(candidate.label),
        cls,
        deferredFrames: candidate.deferredFrames,
        cover: arrivalCoverActive(),
        coverPaced: contextRestorePacingActive(),
        priority: candidate.priority,
      }).admit;
    },
    agesDeferral(candidate): boolean {
      // A link hold is a wait for the GPU process, not for headroom: ageing it
      // would make the unit starvation-admissible, past the budget's headroom,
      // the moment the hold lifts (link_frame_ledger.ts).
      if (linkHeldSinceLastFrame(candidate.label)) return false;
      // A `cover-not-arrival` refusal is not a wait for headroom: the unit is
      // refused because the curtain's budget belongs to the arrival, and it
      // will be reconsidered on its own terms the moment the cover drops.
      // Ageing it meanwhile ticked deferredFrames through the whole curtain,
      // so at the drop every BOOT_DEBT / BACKGROUND / BOOT_RESUME unit was
      // already past maxDeferFrames and admitted as `starvation` on the first
      // live frame: the entire debt lane, unpaced, into the frame the player
      // just got back.
      if (!arrivalCoverActive()) return true;
      return gpuPrepCoverAdmits(candidate.priority);
    },
    spend(syncMs, label): void {
      // Record BEFORE spending: both are per-piece bookkeeping, but only the
      // record survives the frame, and it is what prices the next candidate of
      // this kind rather than the unknown prior.
      budget.record(gpuPrepKindOfLabel(label), syncMs);
      budget.spend(syncMs);
    },
  };
}
