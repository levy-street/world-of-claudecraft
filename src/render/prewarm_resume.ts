// Sequencing for resuming world-entry prewarm manifest entries that the
// original wall-clock deadline dropped (renderer.ts's prewarmInitialScene).
// A dropped entry was previously silently and permanently skipped, so its
// compile cost paid out later as a mid-play shader-compile stall instead of
// during the loading screen (issue #2571). This module is the pure
// sequencing policy, Three/DOM-free and Vitest-driven; renderer.ts supplies
// the actual work through hooks.

export interface PrewarmResumeEntry {
  id: string;
}

export interface PrewarmResumeHooks<T extends PrewarmResumeEntry> {
  /** Wait for a browser idle slot (or its bounded fallback) before each entry. */
  idleSlot: () => Promise<void>;
  /** Give the entry a fresh deadline window so its own internal checks don't
   *  immediately re-drop it the moment it resumes. */
  extendDeadline: () => void;
  /** Re-run the dropped entry's original manifest logic. */
  runEntry: (entry: T) => Promise<void>;
  /** Runs after the entry settles, before the next entry's idle wait. Lets the
   *  caller hide whatever scene state the entry just staged so it never sits
   *  visible in front of the player between idle slots. */
  afterEntry?: (entry: T) => void;
}

/**
 * Resume every dropped entry, one at a time, each behind its own idle slot
 * and freshly extended deadline, in the same order they were originally
 * scheduled. Order matters: a later entry can depend on state an earlier one
 * staged (the whole-scene shader compile depends on the groups staged before
 * it in the manifest). `runEntry` is expected to report and swallow its own
 * per-entry failures (renderer.ts's runEntry does), so a rejection here
 * simply stops resuming the remaining entries rather than retrying.
 */
export async function resumeDroppedPrewarmEntries<T extends PrewarmResumeEntry>(
  dropped: readonly T[],
  hooks: PrewarmResumeHooks<T>,
): Promise<void> {
  for (const entry of dropped) {
    await hooks.idleSlot();
    hooks.extendDeadline();
    await hooks.runEntry(entry);
    hooks.afterEntry?.(entry);
  }
}
