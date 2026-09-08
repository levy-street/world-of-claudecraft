import type {
  RendererPrewarmCategory,
  RendererPrewarmManifestEntryStats,
} from './prewarm_compile_lifecycle';
import type { PrewarmEntryProgress } from './prewarm_policy';
import type { PrewarmResumeUnit } from './prewarm_resume';

/** Shared contract for the renderer manifest and separately authored VFX entries. */
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
  run: () => void | Promise<void>;
  /** Read after run(): how much of the planned work actually happened. A
   * trimmed report downgrades the entry to 'partial' (prewarm_policy.ts),
   * so a deadline return can never masquerade as completed again. */
  progress?: () => PrewarmEntryProgress | null;
  budgetVariants?: () => NonNullable<RendererPrewarmManifestEntryStats['budgetVariants']>;
  detail?: () => string;
}
