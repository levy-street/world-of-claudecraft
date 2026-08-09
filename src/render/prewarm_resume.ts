// Bounded background sequencing for prewarm work dropped by the world-entry
// deadline. A resume entry contains explicit small units. There is deliberately
// no whole-entry callback: requestIdleCallback cannot preempt synchronous work
// once it starts, including Three r165's compileAsync traversal prologue.

export interface PrewarmResumeUnit {
  id: string;
  run: () => void | Promise<void>;
}

export interface PrewarmResumeEntry {
  id: string;
  units: readonly PrewarmResumeUnit[];
}

export interface PrewarmResumeGroup<T> {
  id: string;
  roots: readonly T[];
}

export interface PrewarmResumeHooks<T extends PrewarmResumeEntry> {
  idleSlot: () => Promise<unknown>;
  runUnit?: (unit: PrewarmResumeUnit) => void | Promise<void>;
  afterEntry?: (entry: T) => void;
  onUnitError?: (entry: T, unit: PrewarmResumeUnit, error: unknown) => void;
}

/** Publishes retained prewarm artifacts only after all resumed work settles. */
export async function settlePrewarmBeforePublish<T>(
  work: () => T | Promise<T>,
  publish: () => void,
): Promise<T> {
  try {
    return await work();
  } finally {
    publish();
  }
}

export interface PrewarmCompileUnitOptions<T> {
  /** Program-content keys for a root (e.g. material identity plus the mesh
   *  shape bits that pick the program variant). A root whose every key an
   *  earlier root already produced links nothing new and is skipped: each
   *  awaited r165 compileAsync costs a 10 ms poll floor plus a synchronous
   *  scene walk, so redundant roots are pure wall-clock. A root with no keys
   *  is always kept (fail-open). */
  dedupeKeys?: (root: T) => Iterable<unknown>;
  /** Roots per unit. One unit launches its batch's compiles and awaits them
   *  TOGETHER, so the 10 ms poll floors overlap instead of stacking. Each
   *  compile call keeps its own bounded synchronous prologue, so a batch
   *  stays preemptible between calls only at unit granularity: keep it small
   *  (the entry path uses 16). Default 1 preserves one-root units. */
  batchSize?: number;
}

/**
 * Turns materialized archetype roots into explicit resume units. Reference
 * deduplication prevents one shared root from being compiled twice when it is
 * reachable through more than one prewarm group. The caller supplies the
 * compile operation so this seam stays Three-free and executable in Node.
 */
export function buildPrewarmCompileUnits<T extends object>(
  groups: readonly PrewarmResumeGroup<T>[],
  compile: (root: T) => unknown | Promise<unknown>,
  options?: PrewarmCompileUnitOptions<T>,
): PrewarmResumeUnit[] {
  const seen = new Set<T>();
  const seenKeys = new Set<unknown>();
  const batchSize = Math.max(1, options?.batchSize ?? 1);
  const units: PrewarmResumeUnit[] = [];
  for (const group of groups) {
    let unitIndex = 0;
    let batch: T[] = [];
    const flush = (): void => {
      if (batch.length === 0) return;
      const roots = batch;
      batch = [];
      units.push({
        id: `${group.id}:${unitIndex++}`,
        run: async () => {
          // allSettled, then rethrow the first failure: Promise.all would
          // short-circuit the unit on one rejection and blur which of its
          // batch-mates actually compiled; every root still gets its attempt
          // and the unit's caller still sees the failure.
          const results = await Promise.allSettled(
            roots.map((root) => Promise.resolve(compile(root))),
          );
          const failed = results.find(
            (result): result is PromiseRejectedResult => result.status === 'rejected',
          );
          if (failed) throw failed.reason;
        },
      });
    };
    for (const root of group.roots) {
      if (seen.has(root)) continue;
      seen.add(root);
      if (options?.dedupeKeys) {
        const keys = [...options.dedupeKeys(root)];
        const fresh = keys.length === 0 || keys.some((key) => !seenKeys.has(key));
        for (const key of keys) seenKeys.add(key);
        if (!fresh) continue;
      }
      batch.push(root);
      if (batch.length >= batchSize) flush();
    }
    flush();
  }
  return units;
}

/**
 * Runs one explicitly bounded unit per idle slot. A failed unit is reported and
 * skipped so independent shader families later in the manifest still warm.
 */
export async function resumeDroppedPrewarmEntries<T extends PrewarmResumeEntry>(
  dropped: readonly T[],
  hooks: PrewarmResumeHooks<T>,
): Promise<void> {
  for (const entry of dropped) {
    for (const unit of entry.units) {
      await hooks.idleSlot();
      try {
        await (hooks.runUnit ? hooks.runUnit(unit) : unit.run());
      } catch (error) {
        hooks.onUnitError?.(entry, unit, error);
      }
    }
    hooks.afterEntry?.(entry);
  }
}
