import type {
  RendererPrewarmCategory,
  RendererPrewarmManifestEntryStats,
} from './prewarm_compile_lifecycle';
import { type PrewarmEntryProgress, resolvePrewarmEntryStatus } from './prewarm_policy';
import type { PrewarmResumeUnit } from './prewarm_resume';

export interface PrewarmManifestEntry {
  id: string;
  category: RendererPrewarmCategory;
  priority: number;
  required: boolean;
  /** This small entry still runs if an earlier required view consumed maxMs. */
  deadlineExempt?: boolean;
  /** Explicit small units that may resume after world entry. The absence of
   * this hook is intentional: a whole manifest entry is never rerun live. */
  resumeUnits?: () => readonly PrewarmResumeUnit[];
  /** Optional remainder for a started entry that reports partial progress. */
  resumePartialUnits?: () => readonly PrewarmResumeUnit[];
  /** The entry's program links, resumed as DEBT under `programs.<id>` when
   * the entry never ran (a cast VFX has no stand-in). */
  resumeProgramUnits?: () => readonly PrewarmResumeUnit[];
  run: () => void | Promise<void>;
  /** Read after run(): how much of the planned work actually happened. A
   * trimmed report downgrades the entry to 'partial' (prewarm_policy.ts),
   * so a deadline return can never masquerade as completed again. */
  progress?: () => PrewarmEntryProgress | null;
  budgetVariants?: () => NonNullable<RendererPrewarmManifestEntryStats['budgetVariants']>;
  detail?: () => string;
}

export interface StartedPrewarmEntryOutcome {
  status: 'completed' | 'partial' | 'failed';
  progress: PrewarmEntryProgress | null;
  /** The explicit remainder of a partial or failed entry, for the resume lane. */
  partialUnits: readonly PrewarmResumeUnit[];
}

function warnFailed(entry: PrewarmManifestEntry, err: unknown): void {
  console.warn(`Renderer prewarm entry failed: ${entry.id}`, err);
}

/** Runs one entry the deadline admitted. run(), progress() and
 * resumePartialUnits() are one fail-soft unit: a throw from any of them marks
 * the entry failed and never escapes, so none of them can end the manifest
 * and strand the resume lane behind it. */
export async function runStartedPrewarmEntry(
  entry: PrewarmManifestEntry,
  onStart?: () => void,
): Promise<StartedPrewarmEntryOutcome> {
  let status: StartedPrewarmEntryOutcome['status'] = 'completed';
  try {
    try {
      onStart?.();
    } catch {
      // Diagnostics must never change whether a prewarm entry runs.
    }
    await entry.run();
  } catch (err) {
    status = 'failed';
    warnFailed(entry, err);
  }
  // Deadline-limited work with planned units remaining reports 'partial',
  // never 'completed'.
  let progress: PrewarmEntryProgress | null = null;
  try {
    progress = entry.progress?.() ?? null;
  } catch (err) {
    status = 'failed';
    warnFailed(entry, err);
  }
  if (status === 'completed') status = resolvePrewarmEntryStatus(progress);
  // Explicit partial resumes may also recover failed indivisible units.
  let partialUnits: readonly PrewarmResumeUnit[] = [];
  if (status === 'partial' || status === 'failed') {
    try {
      partialUnits = entry.resumePartialUnits?.() ?? [];
    } catch (err) {
      status = 'failed';
      warnFailed(entry, err);
    }
  }
  return { status, progress, partialUnits };
}
