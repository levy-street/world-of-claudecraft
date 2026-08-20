// The adapter between the two halves of GPU-preparation pacing: the queue's
// admission seam (background_gpu_queue.ts, which knows a candidate only by its
// label and priority) and the budget core (gpu_prep_budget_core.ts, which
// decides in terms of a cost KIND and an admission CLASS).
//
// It is deliberately the only place the two vocabularies meet, so the queue
// never learns what a class is and the core never learns what a queue unit is.
import { arrivalCoverActive } from './arrival_cover';
import type { GpuWorkAdmission } from './background_gpu_queue';
import {
  type GpuPrepBudget,
  gpuPrepClassForPriority,
  gpuPrepCoverAdmits,
  gpuPrepKindOfLabel,
} from './gpu_prep_budget_core';

/** Wrap a budget as the queue's admission: label to kind, priority to class,
 *  and a spend that both LEARNS the piece's real cost and charges the frame. */
export function createGpuPrepAdmission(budget: GpuPrepBudget): GpuWorkAdmission {
  return {
    admit(candidate): boolean {
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
        cls: gpuPrepClassForPriority(candidate.priority),
        deferredFrames: candidate.deferredFrames,
        cover: arrivalCoverActive(),
        priority: candidate.priority,
      }).admit;
    },
    agesDeferral(candidate): boolean {
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
