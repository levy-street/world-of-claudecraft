import type { PrewarmPacingReceipt } from './link_rate_budget';
import type { PrewarmResumeStats } from './prewarm_resume_ledger_core';
import type { RenderBudgetLevels } from './render_budget';

export type RendererPrewarmCategory =
  | 'views'
  | 'world'
  | 'sky'
  | 'props'
  | 'entities'
  | 'objects'
  | 'vfx'
  | 'post'
  | 'diagnostics';

export interface RendererPrewarmManifestEntryStats {
  id: string;
  category: RendererPrewarmCategory;
  priority: number;
  required: boolean;
  status: 'completed' | 'partial' | 'skipped' | 'timed-out' | 'failed';
  elapsedMs: number;
  remainingMsAfter: number;
  passes: number;
  programsBefore: number;
  programsAfter: number;
  programDelta: number;
  texturesBefore: number;
  texturesAfter: number;
  textureDelta: number;
  workDone?: number;
  workPlanned?: number;
  detail?: string;
  budgetVariants?: RendererPrewarmBudgetVariantStats[];
}

export interface RendererPrewarmBudgetVariantStats {
  index: number;
  levels: RenderBudgetLevels;
  elapsedMs: number;
  syncMs: number;
  programsBefore: number;
  programsAfter: number;
  programDelta: number;
  passes: number;
}

export interface PrewarmBudgetVariantHost {
  deadlineMs: number;
  now: () => number;
  programCount: () => number;
  applyLevels: (levels: RenderBudgetLevels) => void;
  renderPass: () => number;
}

export interface PrewarmBudgetVariantHostOptions {
  /**
   * The caller's GPU SUBMIT GUARD, never its hard deadline.
   *
   * Each variant runs a real prewarm render pass, and an already-started WebGL
   * call cannot be cancelled, so a pass launched at `hardDeadline - epsilon`
   * overshoots the wall and defers every manifest entry behind it, the
   * deadline-exempt debt payers included (`prewarmEntryShouldDefer`). The
   * guard exists precisely to leave room for the last started GPU unit to
   * settle. Pinned at the renderer call site by
   * tests/prewarm_compile_lifecycle.test.ts.
   */
  deadlineMs: number;
  programCount: () => number;
  applyLevels: (levels: RenderBudgetLevels) => void;
  renderPass: () => number;
}

export interface PrewarmClock {
  now(): number;
}

/** Builds the renderer host with a receiver-safe monotonic clock. */
export function createPrewarmBudgetVariantHost(
  options: PrewarmBudgetVariantHostOptions,
  clock: PrewarmClock = performance,
): PrewarmBudgetVariantHost {
  return {
    ...options,
    now: () => clock.now(),
  };
}

/** Measures each bounded quality variant without retaining renderer-owned GPU objects. */
export function runPrewarmBudgetVariants(
  levels: readonly RenderBudgetLevels[],
  stats: RendererPrewarmBudgetVariantStats[],
  host: PrewarmBudgetVariantHost,
): { timedOut: boolean } {
  for (const [index, variantLevels] of levels.entries()) {
    if (host.now() >= host.deadlineMs) return { timedOut: true };
    const variantStarted = host.now();
    const before = host.programCount();
    const passesBefore = stats.reduce((total, stat) => total + stat.passes, 0);
    host.applyLevels(variantLevels);
    const syncStarted = host.now();
    const passesAfter = host.renderPass();
    const ended = host.now();
    const after = host.programCount();
    stats.push({
      index,
      levels: { ...variantLevels },
      elapsedMs: roundedMs(ended - variantStarted),
      syncMs: roundedMs(ended - syncStarted),
      programsBefore: before,
      programsAfter: after,
      programDelta: after - before,
      passes: passesAfter - passesBefore,
    });
  }
  return { timedOut: false };
}

export interface RendererPrewarmCompileUnitStats {
  id: string;
  lane: string;
  submittedAtMs: number | null;
  syncEndAtMs: number | null;
  settledAtMs: number | null;
  failedAtMs: number | null;
  programsBefore: number | null;
  programsAfter: number | null;
  programDelta: number | null;
  chargedLinks: number | null;
  syncMs: number | null;
  settledDurationMs: number | null;
  /** State observed when the loading curtain starts to reveal. */
  statusAtReveal: 'settled' | 'pending' | 'deferred' | 'failed' | 'post-reveal' | null;
  /** The unit's roots as labels (name or type, plus the material name), so a
   *  capture can say WHICH scene objects a deferred unit left unlinked.
   *  Bounded per unit (COMPILE_UNIT_ROOT_LABELS); absent when the host
   *  installs no labeler. */
  roots?: string[];
}

/** Labels kept per unit; a batch is at most 32 roots. */
export const COMPILE_UNIT_ROOT_LABELS = 32;

/** The structural slice of a compile root the label reads (a three mesh). */
export interface CompileRootLike {
  name?: string;
  type?: string;
  material?: { name?: string } | { name?: string }[] | null;
}

/** `name|material` (or the type when unnamed): enough to find the object in
 *  a capture, never a free-form string beyond what the scene already names. */
export function compileRootLabel(root: CompileRootLike): string {
  const materials = Array.isArray(root.material)
    ? root.material
    : root.material
      ? [root.material]
      : [];
  const material = materials.map((entry) => entry?.name ?? '').find((name) => name !== '') ?? '';
  const self = root.name || root.type || 'object';
  return material ? `${self}|${material}` : self;
}

export interface RendererPrewarmDiagnosticsBaselineStats {
  programs: number;
  textures: number;
  totalObjects: number;
  estimatedDraws: number;
  estimatedTriangles: number;
  categories: Record<string, { draws: number; triangles: number; materials: number }>;
}

export interface RendererPrewarmStats {
  elapsedMs: number;
  maxMs: number;
  createdViews: number;
  candidateViews: number;
  renderPasses: number;
  programsBefore: number;
  programsAfter: number;
  texturesBefore: number;
  texturesAfter: number;
  textureUploads: number;
  compileMode: 'async' | 'sync' | 'none';
  compileMs: number;
  compileTimedOut: boolean;
  timedOut: boolean;
  remainingMs: number;
  budgetUsedRatio: number;
  createdViewTypes: string[];
  manifestPlanned: number;
  manifestEntries: RendererPrewarmManifestEntryStats[];
  manifestCompleted: number;
  manifestPartial: number;
  manifestSkipped: number;
  manifestTimedOut: number;
  manifestFailed: number;
  partialEntryIds: string[];
  timedOutEntryIds: string[];
  failedEntryIds: string[];
  diagnosticsBaseline: RendererPrewarmDiagnosticsBaselineStats | null;
  compileUnits?: RendererPrewarmCompileUnitStats[];
  prewarmPacing?: PrewarmPacingReceipt;
  /** What became of the entries the deadline dropped. Read LIVE: the resume
   *  lane is fire-and-forget and settles long after the pass returns, so this
   *  is a getter over the ledger rather than a value frozen at pass end.
   *  Without it a report can say an entry timed out and still not say whether
   *  its work ever happened. */
  readonly resume: PrewarmResumeStats;
}

export interface PrewarmCompileSyncStats {
  programsBefore: number;
  programsAfter: number;
  chargedLinks: number;
}

/** The five per-status rollups over one pass's entries. Derived, so it lives
 *  beside the interface it fills rather than as five filter passes at the end
 *  of the renderer's prewarm method. */
export function summarizePrewarmManifest(
  entries: readonly RendererPrewarmManifestEntryStats[],
): Pick<
  RendererPrewarmStats,
  | 'manifestCompleted'
  | 'manifestPartial'
  | 'manifestSkipped'
  | 'manifestTimedOut'
  | 'manifestFailed'
  | 'partialEntryIds'
  | 'timedOutEntryIds'
  | 'failedEntryIds'
> {
  const idsWith = (status: RendererPrewarmManifestEntryStats['status']): string[] =>
    entries.filter((entry) => entry.status === status).map((entry) => entry.id);
  const partialEntryIds = idsWith('partial');
  const timedOutEntryIds = idsWith('timed-out');
  const failedEntryIds = idsWith('failed');
  return {
    manifestCompleted: entries.filter((entry) => entry.status === 'completed').length,
    manifestPartial: partialEntryIds.length,
    manifestSkipped: entries.filter((entry) => entry.status === 'skipped').length,
    manifestTimedOut: timedOutEntryIds.length,
    manifestFailed: failedEntryIds.length,
    partialEntryIds,
    timedOutEntryIds,
    failedEntryIds,
  };
}

interface CompileUnitIdentity {
  id: string;
  roots?: readonly object[];
}

export interface PrewarmCompileLifecycle {
  readonly records: RendererPrewarmCompileUnitStats[];
  recordFor(unit: CompileUnitIdentity & object, lane: string): RendererPrewarmCompileUnitStats;
  markSubmitted(record: RendererPrewarmCompileUnitStats): void;
  markSyncEnd(record: RendererPrewarmCompileUnitStats, stats?: PrewarmCompileSyncStats): void;
  markSettled(record: RendererPrewarmCompileUnitStats): void;
  markFailed(record: RendererPrewarmCompileUnitStats): void;
  markReveal(): void;
}

const roundedMs = (value: number): number => Math.round(value * 100) / 100;

/** Pure lifecycle bookkeeping. The renderer injects its monotonic clock and,
 *  optionally, the root labeler (compileRootLabel) for the capture's unit rows. */
export function createPrewarmCompileLifecycle(
  now: () => number,
  labelRoot?: (root: object) => string,
): PrewarmCompileLifecycle {
  const records: RendererPrewarmCompileUnitStats[] = [];
  const byUnit = new WeakMap<object, RendererPrewarmCompileUnitStats>();
  let revealed = false;
  const stamp = (): number => roundedMs(now());
  return {
    records,
    recordFor(unit, lane) {
      let record = byUnit.get(unit);
      if (!record) {
        record = {
          id: unit.id,
          lane,
          submittedAtMs: null,
          syncEndAtMs: null,
          settledAtMs: null,
          failedAtMs: null,
          programsBefore: null,
          programsAfter: null,
          programDelta: null,
          chargedLinks: null,
          syncMs: null,
          settledDurationMs: null,
          statusAtReveal: revealed ? 'post-reveal' : null,
        };
        if (labelRoot && unit.roots) {
          record.roots = unit.roots.slice(0, COMPILE_UNIT_ROOT_LABELS).map(labelRoot);
        }
        byUnit.set(unit, record);
        records.push(record);
      } else if (record.lane !== lane && record.submittedAtMs === null) {
        record.lane = lane;
      }
      return record;
    },
    markSubmitted(record) {
      record.submittedAtMs = stamp();
    },
    markSyncEnd(record, stats) {
      const syncEndAtMs = stamp();
      record.syncEndAtMs = syncEndAtMs;
      if (stats) {
        record.programsBefore = stats.programsBefore;
        record.programsAfter = stats.programsAfter;
        record.programDelta = stats.programsAfter - stats.programsBefore;
        record.chargedLinks = stats.chargedLinks;
      }
      record.syncMs =
        record.submittedAtMs === null
          ? null
          : roundedMs(Math.max(0, syncEndAtMs - record.submittedAtMs));
    },
    markSettled(record) {
      const settledAtMs = stamp();
      record.settledAtMs = settledAtMs;
      const startedAtMs = record.syncEndAtMs ?? record.submittedAtMs;
      record.settledDurationMs =
        startedAtMs === null ? null : roundedMs(Math.max(0, settledAtMs - startedAtMs));
    },
    markFailed(record) {
      record.failedAtMs = stamp();
    },
    markReveal() {
      revealed = true;
      for (const record of records) {
        if (record.statusAtReveal !== null) continue;
        if (record.failedAtMs !== null) record.statusAtReveal = 'failed';
        else if (record.settledAtMs !== null) record.statusAtReveal = 'settled';
        else if (record.submittedAtMs === null) record.statusAtReveal = 'deferred';
        else record.statusAtReveal = 'pending';
      }
    },
  };
}
