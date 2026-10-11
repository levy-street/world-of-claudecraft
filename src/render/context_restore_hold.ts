// The world-draw hold of a WebGL context restore, as module state between the
// renderer's restore host (context_restore.ts, the one writer) and its two
// readers on the game side: the presentation gate (src/game/presentation_gate.ts
// folds it into `worldDrawHeld`, the seam the blocking arrival already holds
// the world draw through) and the "restoring graphics" note
// (src/ui/graphics_restore_note_controller.ts). Module state for the reason
// arrival_cover.ts gives: the renderer and main.ts are ratcheted.
//
// The hold carries its own deadline, read at every query: even a host whose
// release never ran (a throw, a timer a hidden tab never fired) cannot
// withhold the world past the bound it was raised with.

type HoldListener = (held: boolean) => void;

let heldUntilMs: number | null = null;
// Owned by the host with the arrival cover it raises, not derived from the
// self-expiring hold: past the hold's own deadline the cover can still stand
// until the host's timer runs, and a cover that stops pacing there would admit
// its whole backlog in one task into a frame that draws the world again.
let pacing = false;
const listeners = new Set<HoldListener>();

const clock = (): number => performance.now();

function notify(held: boolean): void {
  for (const listener of listeners) {
    try {
      listener(held);
    } catch (error) {
      console.warn('[context-restore] hold listener failed', error);
    }
  }
}

/** Raise the hold for at most `boundMs` from `nowMs`. */
export function beginContextRestoreHold(boundMs: number, nowMs: number = clock()): void {
  const wasHeld = heldUntilMs !== null;
  heldUntilMs = nowMs + Math.max(0, boundMs);
  if (!wasHeld) notify(true);
}

export function endContextRestoreHold(): void {
  if (heldUntilMs === null) return;
  heldUntilMs = null;
  notify(false);
}

/** Whether the world draw is withheld now: raised, and not past its bound. */
export function contextRestoreDrawHeld(nowMs: number = clock()): boolean {
  return heldUntilMs !== null && nowMs < heldUntilMs;
}

export function setContextRestorePacing(active: boolean): void {
  pacing = active;
}

/** Whether the arrival cover standing now is a restore's: the GPU admission
 *  paces it under the frame budget (gpu_prep_budget_core.ts coverPaced). */
export function contextRestorePacingActive(): boolean {
  return pacing;
}

/** Subscribe to hold edges (true on raise, false on release). Returns the
 *  unsubscribe. A listener added during a hold is told at once. */
export function onContextRestoreHoldChange(listener: HoldListener): () => void {
  listeners.add(listener);
  if (heldUntilMs !== null) listener(true);
  return () => {
    listeners.delete(listener);
  };
}

export function resetContextRestoreHoldForTest(): void {
  heldUntilMs = null;
  pacing = false;
  listeners.clear();
}
