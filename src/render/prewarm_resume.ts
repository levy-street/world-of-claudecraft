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

/**
 * Turns materialized archetype roots into explicit resume units. Reference
 * deduplication prevents one shared root from being compiled twice when it is
 * reachable through more than one prewarm group. The caller supplies the
 * compile operation so this seam stays Three-free and executable in Node.
 */
export function buildPrewarmCompileUnits<T extends object>(
  groups: readonly PrewarmResumeGroup<T>[],
  compile: (root: T) => unknown | Promise<unknown>,
): PrewarmResumeUnit[] {
  const seen = new Set<T>();
  const units: PrewarmResumeUnit[] = [];
  for (const group of groups) {
    for (let index = 0; index < group.roots.length; index++) {
      const root = group.roots[index];
      if (seen.has(root)) continue;
      seen.add(root);
      units.push({
        id: `${group.id}:${index}`,
        run: async () => {
          await compile(root);
        },
      });
    }
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
