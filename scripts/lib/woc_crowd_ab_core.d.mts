export declare const AB_SCHEMA: string;
export declare const AB_CLASSES: ReadonlyArray<string>;
export declare const AB_BOT_COUNT: number;
export declare const AB_WORN_SET: Readonly<
  Record<'helmet' | 'shoulder' | 'gloves' | 'chest' | 'waist' | 'feet', string>
>;
export declare const AB_SCENE_BANDS: Readonly<{
  close: Readonly<SceneBand>;
  far: Readonly<SceneBand>;
}>;
export declare const AB_GRID_COLUMNS: number;
export declare const AB_GRID_COLUMN_SPACING: number;
export declare const AB_SLOW_FRAME_MS: number;
export declare const AB_HITCH_FRAME_MS: number;
export declare const AB_FRAME_DT_CLAMP_MS: number;
export declare const AB_GPU_TIMER_RING: number;
export declare const AB_BUSY_LOAD_PER_CORE: number;
export declare const AB_BUSY_SWAP_MB: number;

export interface SceneBand {
  near: number;
  far: number;
}

export interface CrowdBot {
  index: number;
  cls: string;
  gender: 'male' | 'female';
  name: string;
}

export interface GridAnchor {
  x: number;
  z: number;
  facing: number;
}

export interface GridSpot {
  index: number;
  x: number;
  z: number;
  forward: number;
  lateral: number;
  distance: number;
}

export interface FrameWindowStats {
  rendered: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  over33_4: number;
  over50: number;
  timeOver33_4Ms: number;
  atClamp: number;
  totalMs: number;
}

export interface RafGapStats {
  callbacks: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  over50: number;
}

export interface LongTaskStats {
  count: number;
  maxMs: number;
  totalMs: number;
}

/** One 1 s sample of the renderer's stats, as the page rig records it. */
export interface WindowSample {
  calls?: number;
  triangles?: number;
  gpuAvail: boolean;
  gpuFrames: number;
  gpuAvg: number;
  gpuP95?: number;
  brackets?: Record<string, number>;
}

export interface GpuWindowMean {
  available: boolean;
  meanMs: number | null;
  p95Ms?: number;
  chunks: number;
  basis: 'chunks' | 'rolling' | 'none';
  framesResolved?: number;
  brackets?: Record<string, number>;
}

export interface DrawWindowStats {
  samples: number;
  callsMedian: number | null;
  callsMin: number | null;
  callsMax: number | null;
  trianglesMedian: number | null;
}

export interface LedgerKind {
  count: number;
  totalMs: number;
  maxMs: number;
}

export interface LedgerRow {
  kind: string;
  count: number;
  totalMs: number;
  meanMs: number;
  lifetimeMaxMs: number;
}

export interface QueueKindRow {
  kind: string;
  units: number;
  emaMs: number;
}

export interface CrowdOverSoloRow {
  scene: string;
  calls: number;
  callsPerBody: number;
  triangles: number;
  trianglesPerBody: number;
  gpuMs: number | null;
  gpuMsPerBody: number | null;
}

export interface HostLoad {
  load1: number | null;
  perCore: number | null;
  busy: boolean | null;
}

export interface AbWindow {
  scene: string;
  cpuThrottle: number;
  frames: FrameWindowStats;
  raf: RafGapStats;
  longTasks: LongTaskStats;
  gpu: GpuWindowMean;
  draws: DrawWindowStats;
  programs: { start: number; end: number; delta: number };
  events: { counts: Record<string, number> };
  ledger: LedgerRow[];
  ledgerSlowestInWindow?: Array<{ kind: string; ms: number; atMs: number }>;
  /** Background GPU queue units that ran inside the window, per kind. */
  queueWork?: QueueKindRow[];
  rigOverheadMs: number;
  bodies: { expected: number; drawn: number; articulated: number; onFarMesh: number } | null;
  arrival: {
    expected: number;
    firstDrawnAfterMs: number | null;
    halfDrawnAfterMs: number | null;
    allDrawnAfterMs: number | null;
    /** Every body has a view: the nameplate and click target, body or not. */
    allViewsAfterMs: number | null;
    lastChangeMs: number | null;
    spawnTaskMs: number | null;
    assetRequests: number;
    assetBytes: number;
    characterAssetRequests: number;
    characterAssetBytes: number;
  } | null;
  /** The window that starts when the crowd is moved to the far band. */
  transit?: {
    expected: number;
    firstOnFarMeshAfterMs: number | null;
    halfOnFarMeshAfterMs: number | null;
    allOnFarMeshAfterMs: number | null;
    moveTaskMs: number | null;
  } | null;
}

export interface AbResult {
  schema: string;
  provenance: {
    label: string;
    note: string;
    startedAtUtc: string;
    arm: {
      url: string;
      servedDir: string | null;
      servedDirSource: string;
      gitShaShort: string | null;
      branch: string | null;
      dirty: boolean | null;
      servedDirty: boolean | null;
      build: string;
      pageBuildId: string | null;
    };
    browser: { version: string; headless: boolean };
    webgl: { renderer: string; gpuTimer: boolean };
    flags: { query: string; gfx: string };
    viewport: {
      width: number;
      height: number;
      dpr: number;
      drawingBuffer?: { width: number; height: number } | null;
    };
    pacing: {
      mode: string;
      cadence: { verdict: string; refreshHz: number; intent: number } | null;
      rafMedianMs: number | null;
    };
    /** The time of day the run was frozen at, null when left on the live cycle. */
    dayNight?: { pinnedPhase: number | null };
    cpuThrottle: { rate: number; note: string };
    host: {
      cpu: string;
      logicalCpus: number;
      loadStart: HostLoad;
      loadEnd: HostLoad;
      swap?: SwapActivity;
    };
    evidence: { performanceEvidence: boolean; reasons: string[] };
  };
  crowd: {
    count: number;
    classes: number;
    male: number;
    female: number;
    dressed: number;
    wornSet: Record<string, string>;
    asymmetry: string;
  } | null;
  /** How long each settle waited before its window, and whether it found quiet. */
  settles?: Record<string, { waitedMs: number; quiet: boolean }>;
  windows: AbWindow[];
  crowdOverSolo?: CrowdOverSoloRow[];
  health: {
    pageErrors: string[];
    consoleErrors: string[];
    webglMessages: string[];
    failedAssets: string[];
  };
  warnings?: string[];
  /** What makes the run invalid (a body not drawn, a wrong tier): exit code 1. */
  failures?: string[];
}

export declare function crowdRoster(count?: number): CrowdBot[];
export declare function crowdGrid(
  anchor: GridAnchor,
  band: SceneBand,
  count?: number,
  columns?: number,
  columnSpacing?: number,
): GridSpot[];
export declare function median(values: ReadonlyArray<number>): number | null;
export declare function frameWindowStats(frameMs: ReadonlyArray<number>): FrameWindowStats;
export declare function rafGapStats(timestamps: ReadonlyArray<number>): RafGapStats;
export declare function longTaskStats(
  entries: ReadonlyArray<readonly [number, number]>,
  t0: number,
  t1: number,
): LongTaskStats;
export declare function gpuWindowMean(
  samples: ReadonlyArray<WindowSample>,
  framesAtStart: number,
  ring?: number,
): GpuWindowMean;
export declare function drawWindowStats(samples: ReadonlyArray<WindowSample>): DrawWindowStats;
export declare function countsDelta(
  before: Readonly<Record<string, number>> | null | undefined,
  after: Readonly<Record<string, number>>,
): Record<string, number>;
export declare function ledgerDelta(
  before: Readonly<Record<string, LedgerKind>> | null | undefined,
  after: Readonly<Record<string, LedgerKind>>,
): LedgerRow[];
export declare function queueKindDelta(
  before: Readonly<Record<string, { units: number; emaMs: number }>> | null | undefined,
  after: Readonly<Record<string, { units: number; emaMs: number }>> | null | undefined,
): QueueKindRow[];
export declare function crowdOverSolo(
  windows: ReadonlyArray<Pick<AbWindow, 'scene' | 'draws' | 'gpu'>>,
  bodies: number,
): CrowdOverSoloRow[];
export declare function hostLoad(loadAvg1: number, logicalCpus: number): HostLoad;
export interface SwapCounters {
  pageSize: number | null;
  swapins: number | null;
  swapouts: number | null;
}
export interface SwapActivity {
  swappedMb: number | null;
  busy: boolean | null;
}
export declare function parseVmStat(text: string | null | undefined): SwapCounters;
export declare function swapActivity(
  before: SwapCounters | null | undefined,
  after: SwapCounters | null | undefined,
): SwapActivity;
export declare function evidenceReasons(input: {
  headless: boolean;
  busyStart: boolean | null;
  busyEnd: boolean | null;
  swapping?: boolean | null;
  softwareGl: boolean;
  smoke: boolean;
  hiddenWindows: number;
}): string[];
export declare function formatSummary(result: AbResult): string;
export declare function comparisonTables(results: ReadonlyArray<AbResult>): string;
