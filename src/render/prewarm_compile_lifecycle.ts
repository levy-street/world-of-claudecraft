import type { PrewarmPacingReceipt } from './link_rate_budget';

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
}

export interface RendererPrewarmCompileUnitStats {
  id: string;
  lane: string;
  submittedAtMs: number | null;
  syncEndAtMs: number | null;
  settledAtMs: number | null;
  failedAtMs: number | null;
  /** State observed when the loading curtain starts to reveal. */
  statusAtReveal: 'settled' | 'pending' | 'deferred' | 'failed' | 'post-reveal' | null;
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
}

interface CompileUnitIdentity {
  id: string;
}

export interface PrewarmCompileLifecycle {
  readonly records: RendererPrewarmCompileUnitStats[];
  recordFor(unit: CompileUnitIdentity & object, lane: string): RendererPrewarmCompileUnitStats;
  markSubmitted(record: RendererPrewarmCompileUnitStats): void;
  markSyncEnd(record: RendererPrewarmCompileUnitStats): void;
  markSettled(record: RendererPrewarmCompileUnitStats): void;
  markFailed(record: RendererPrewarmCompileUnitStats): void;
  markReveal(): void;
}

const roundedMs = (value: number): number => Math.round(value * 100) / 100;

/** Pure lifecycle bookkeeping. The renderer injects its monotonic clock. */
export function createPrewarmCompileLifecycle(now: () => number): PrewarmCompileLifecycle {
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
          statusAtReveal: revealed ? 'post-reveal' : null,
        };
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
    markSyncEnd(record) {
      record.syncEndAtMs = stamp();
    },
    markSettled(record) {
      record.settledAtMs = stamp();
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
