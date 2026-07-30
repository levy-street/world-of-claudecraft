import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const captureContract =
  // @ts-expect-error The executable capture contract intentionally ships as plain Node ESM.
  await import('../scripts/assets/eastbrook_grand_armoury/capture_contract.mjs');
const {
  assertTownArmouryIdentity,
  assertTownAttributionTargetState,
  assertTownCaptureMetadata,
  assertNoCaptureErrors,
  assertTownPerformanceBlockState,
  deriveTownPerformanceDeltas,
  round: roundPerformanceValue,
  EASTBROOK_ARMOURY_CAPTURE_SEED,
  EASTBROOK_ARMOURY_PLAYER_STATE,
  EASTBROOK_POLISH_BASELINE_REVISION,
  EASTBROOK_POLISH_PROVENANCE_INPUTS,
  EASTBROOK_TOWN_CAPTURE_PROFILES,
  EASTBROOK_TOWN_CAPTURE_SETTLE_MS,
  EASTBROOK_TOWN_POLISH_MATCHED_CAPTURE_VIEWS,
  EASTBROOK_TOWN_PERF_SCENARIOS,
  deriveEastbrookPolishCompositeProvenance,
} = captureContract;

const REPO_ROOT = path.join(__dirname, '..');
const POLISH_ROOT = path.join(__dirname, '..', 'docs/screenshots/eastbrook-vale-rebuild/polish');
const IMG2THREE_ROOT = path.join(
  REPO_ROOT,
  'docs/design/eastbrook-vale-rebuild/polish-img2threejs',
);
const PNG_SIGNATURE = '89504e470d0a1a0a';
const BASELINE_POLISH_PROVENANCE = {
  schemaVersion: 1,
  mode: 'baseline-revision',
  baselineRevision: EASTBROOK_POLISH_BASELINE_REVISION,
} as const;

const VIEW_NAMES = [
  'elevated-overview',
  'planning-top-down',
  'gate-approach',
  'central-square',
  'armoury-facade',
  'armoury-relation',
  'bank-and-chest',
  'smithy-and-forge',
  'inn-and-kitchens',
  'market-and-fence',
  'chapel-and-weaving',
  'toolworks-service-perimeter',
  'player-scale',
  'interaction-collider-overlay',
  'side-rear-proof',
  'stall-world-market',
  'stall-provisions',
  'apothecary-lin',
  'ravenpost-mailbox',
  'noticeboard',
  'civic-motion',
  'ravenpost-chronicler',
  'west-wall-quartermaster',
] as const;

const PROFILES = [
  {
    name: 'desktop-ultra',
    cssWidth: 1600,
    cssHeight: 900,
    deviceScaleFactor: 1,
    pixelWidth: 1600,
    pixelHeight: 900,
  },
  {
    name: 'mobile-low',
    cssWidth: 844,
    cssHeight: 390,
    deviceScaleFactor: 3,
    pixelWidth: 2532,
    pixelHeight: 1170,
  },
] as const;

const MOTION_MODES = ['motion-on', 'reduced-motion'] as const;
const MOTION_PHASES = ['t0', 't1'] as const;

// The full 23-view capture matrix across both profiles (plus the four civic-motion
// frames per profile) was captured and visually accepted. After acceptance the
// full-resolution capture PNGs were deliberately pruned to a hero subset to keep the
// repository small; the complete per-view acceptance record still lives in the metadata
// records (polish/metadata/*.json), the performance evidence (polish/performance/*.json),
// and the contact sheets (polish/contacts/*.webp). The disk-inventory checks below assert
// this retained hero subset exactly (still add-AND-delete strict), while the metadata
// record structure is still verified against the full VIEW_NAMES matrix.
const RETAINED_BEFORE_VIEWS: Readonly<Record<string, readonly string[]>> = {
  'desktop-ultra': [
    'elevated-overview',
    'central-square',
    'gate-approach',
    'ravenpost-mailbox',
    'noticeboard',
    'planning-top-down',
  ],
  'mobile-low': ['elevated-overview', 'central-square'],
};
const RETAINED_AFTER_VIEWS: Readonly<Record<string, readonly string[]>> = {
  'desktop-ultra': [
    'elevated-overview',
    'central-square',
    'gate-approach',
    'ravenpost-mailbox',
    'noticeboard',
    'planning-top-down',
    'player-scale',
    'side-rear-proof',
    'armoury-relation',
    'market-and-fence',
  ],
  'mobile-low': ['elevated-overview', 'central-square'],
};
// Civic-motion frames were retained for the desktop-ultra profile only.
const RETAINED_MOTION_PROFILES: readonly string[] = ['desktop-ultra'];

const MAILBOX_EVIDENCE = [
  'optimized-contact.png',
  'optimized-lookdev-contact.png',
  'optimized-lookdev/dusk.png',
  'optimized-lookdev/low.png',
  'optimized-lookdev/neutral.png',
  'optimized-lookdev/player-scale.png',
  'optimized/back.png',
  'optimized/front-3q.png',
  'optimized/front.png',
  'optimized/grazing.png',
  'optimized/left.png',
  'optimized/rear-3q.png',
  'optimized/right.png',
  'procedural-contact.png',
  'procedural/back.png',
  'procedural/front-3q.png',
  'procedural/front.png',
  'procedural/grazing.png',
  'procedural/left.png',
  'procedural/rear-3q.png',
  'procedural/right.png',
  'raw-contact.png',
  'raw/back.png',
  'raw/front-3q.png',
  'raw/front.png',
  'raw/grazing.png',
  'raw/left.png',
  'raw/rear-3q.png',
  'raw/right.png',
  'reference-vs-optimized-contact.png',
  'stages-contact.png',
  'stages/blockout.png',
  'stages/form.png',
  'stages/material.png',
  'stages/structural.png',
] as const;

const NOTICEBOARD_EVIDENCE = [
  'optimized-contact.png',
  'optimized-lookdev-contact.png',
  'optimized-lookdev/collider-overlay.png',
  'optimized-lookdev/dusk.png',
  'optimized-lookdev/grazing.png',
  'optimized-lookdev/low.png',
  'optimized-lookdev/neutral.png',
  'optimized-lookdev/player-scale.png',
  'optimized/back.png',
  'optimized/front-3q.png',
  'optimized/front.png',
  'optimized/grazing.png',
  'optimized/left.png',
  'optimized/rear-3q.png',
  'optimized/right.png',
  'raw-contact.png',
  'raw/back.png',
  'raw/front-3q.png',
  'raw/front.png',
  'raw/grazing.png',
  'raw/left.png',
  'raw/rear-3q.png',
  'raw/right.png',
  'reference-vs-optimized-contact.png',
  'stages-contact.png',
  'stages/blockout/contact.png',
  'stages/blockout/front-3q.png',
  'stages/blockout/front.png',
  'stages/final/collider-overlay.png',
  'stages/final/contact.png',
  'stages/final/dusk.png',
  'stages/final/front-3q.png',
  'stages/final/neutral.png',
  'stages/final/player-scale.png',
  'stages/final/rear-3q.png',
  'stages/form/contact.png',
  'stages/form/front-3q.png',
  'stages/form/grazing.png',
  'stages/interaction/collider-overlay.png',
  'stages/interaction/contact.png',
  'stages/interaction/player-scale.png',
  'stages/lighting/contact.png',
  'stages/lighting/dusk.png',
  'stages/lighting/neutral.png',
  'stages/material/contact.png',
  'stages/material/front-3q.png',
  'stages/material/neutral.png',
  'stages/optimization/contact.png',
  'stages/optimization/front-3q.png',
  'stages/optimization/grazing.png',
  'stages/optimization/rear-3q.png',
  'stages/structural/back.png',
  'stages/structural/contact.png',
  'stages/structural/rear-3q.png',
  'stages/surface/contact.png',
  'stages/surface/front.png',
  'stages/surface/grazing.png',
] as const;

type PngDimensions = readonly [width: number, height: number];

const MAILBOX_NONSTANDARD_DIMENSIONS: Readonly<Record<string, PngDimensions>> = {
  'optimized-contact.png': [1260, 1180],
  'optimized-lookdev-contact.png': [1260, 804],
  'procedural-contact.png': [1260, 1180],
  'raw-contact.png': [1260, 1180],
  'reference-vs-optimized-contact.png': [1520, 690],
  'stages-contact.png': [1260, 804],
};

const NOTICEBOARD_NONSTANDARD_DIMENSIONS: Readonly<Record<string, PngDimensions>> = {
  'optimized-contact.png': [1260, 1180],
  'optimized-lookdev-contact.png': [1260, 804],
  'raw-contact.png': [1260, 1180],
  'reference-vs-optimized-contact.png': [1520, 690],
  'stages-contact.png': [1260, 1180],
  'stages/blockout/contact.png': [1260, 428],
  'stages/final/contact.png': [1260, 804],
  'stages/form/contact.png': [1260, 428],
  'stages/interaction/contact.png': [1260, 428],
  'stages/lighting/contact.png': [1260, 428],
  'stages/material/contact.png': [1260, 428],
  'stages/optimization/contact.png': [1260, 428],
  'stages/structural/contact.png': [1260, 428],
  'stages/surface/contact.png': [1260, 428],
};

function listFilesRecursive(root: string, extension: string): string[] {
  const walk = (directory: string, prefix = ''): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return walk(path.join(directory, entry.name), relativePath);
      return entry.isFile() && entry.name.endsWith(extension) ? [relativePath] : [];
    });
  return walk(root).sort();
}

function assertPng(
  filePath: string,
  [expectedWidth, expectedHeight]: PngDimensions,
  minimumBytes: number,
): void {
  const bytes = readFileSync(filePath);
  expect(statSync(filePath).size, filePath).toBeGreaterThan(minimumBytes);
  expect(bytes.subarray(0, 8).toString('hex'), filePath).toBe(PNG_SIGNATURE);
  expect(bytes.readUInt32BE(8), filePath).toBe(13);
  expect(bytes.subarray(12, 16).toString('ascii'), filePath).toBe('IHDR');
  expect(bytes.readUInt32BE(16), filePath).toBe(expectedWidth);
  expect(bytes.readUInt32BE(20), filePath).toBe(expectedHeight);
}

function baseCaptureNames(prefix: 'before' | 'after', profile: string): string[] {
  return VIEW_NAMES.map((view) => `${prefix}-${view}-${profile}.png`);
}

function motionCaptureNames(profile: string): string[] {
  return MOTION_MODES.flatMap((mode) =>
    MOTION_PHASES.map((phase) => `after-civic-motion-${profile}-${mode}-${phase}.png`),
  );
}

function retainedBaseCaptureNames(prefix: 'before' | 'after', profile: string): string[] {
  const views =
    prefix === 'before' ? RETAINED_BEFORE_VIEWS[profile] : RETAINED_AFTER_VIEWS[profile];
  return (views ?? []).map((view) => `${prefix}-${view}-${profile}.png`);
}

function retainedMotionCaptureNames(profile: string): string[] {
  return RETAINED_MOTION_PROFILES.includes(profile) ? motionCaptureNames(profile) : [];
}

async function deriveCurrentPolishProvenance(): Promise<CurrentPolishProvenance> {
  const [{ readFile }, townFingerprint, mailboxFingerprint, noticeboardFingerprint] =
    await Promise.all([
      import('node:fs/promises'),
      import('../scripts/assets/eastbrook_town/source_fingerprint.mjs'),
      import('../scripts/assets/eastbrook_mailbox/source_fingerprint.mjs'),
      import('../scripts/assets/eastbrook_noticeboard/source_fingerprint.mjs'),
    ]);
  const repoRoot = new URL('../', import.meta.url);
  const fileSha256 = async (relativePath: string) =>
    createHash('sha256')
      .update(await readFile(new URL(relativePath, repoRoot)))
      .digest('hex');

  return deriveEastbrookPolishCompositeProvenance({
    townAssetSourceFingerprint: townFingerprint.eastbrookTownSourceFingerprint(),
    authoritativeLayoutSha256: await fileSha256(
      EASTBROOK_POLISH_PROVENANCE_INPUTS.authoritativeLayout,
    ),
    civicShaderSha256: await fileSha256(EASTBROOK_POLISH_PROVENANCE_INPUTS.civicShader),
    townRuntimeSha256: await fileSha256(EASTBROOK_POLISH_PROVENANCE_INPUTS.townRuntime),
    mailboxRuntimeSha256: await fileSha256(EASTBROOK_POLISH_PROVENANCE_INPUTS.mailboxRuntime),
    noticeboardRuntimeSha256: await fileSha256(
      EASTBROOK_POLISH_PROVENANCE_INPUTS.noticeboardRuntime,
    ),
    rendererIntegrationSha256: await fileSha256(
      EASTBROOK_POLISH_PROVENANCE_INPUTS.rendererIntegration,
    ),
    viewPriorityPolicySha256: await fileSha256(
      EASTBROOK_POLISH_PROVENANCE_INPUTS.viewPriorityPolicy,
    ),
    mailboxSourceFingerprint: mailboxFingerprint.eastbrookMailboxSourceFingerprint(),
    mailboxGlbSha256: await fileSha256(EASTBROOK_POLISH_PROVENANCE_INPUTS.mailboxGlb),
    noticeboardSourceFingerprint: noticeboardFingerprint.eastbrookNoticeboardSourceFingerprint(),
    noticeboardGlbSha256: await fileSha256(EASTBROOK_POLISH_PROVENANCE_INPUTS.noticeboardGlb),
  });
}

type Vec3 = { x: number; y: number; z: number };
type NumericRecord = Record<string, number>;
type PolishProvenance = { mode: string; [key: string]: unknown };
type CurrentPolishProvenance = PolishProvenance & {
  fingerprint: string;
  components: {
    townAsset: { sourceFingerprint: string };
    [key: string]: unknown;
  };
};
type CaptureSource = { comparison: string; revision: string; fingerprint: string };

type CaptureProfileContract = {
  name: string;
  tier: string;
  settings: Record<string, unknown>;
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
    isMobile?: boolean;
    hasTouch?: boolean;
  };
  mobile: boolean;
};

type CaptureViewContract = { name: string; camera: Vec3; target: Vec3 };

type CaptureRecord = {
  output: string;
  schemaVersion: number;
  captureScope: string;
  source: CaptureSource;
  polishProvenance: PolishProvenance;
  townContract: { id: string };
  renderer: { tier: string; settings: Record<string, unknown> };
  world: { lot: unknown };
  viewport: {
    physical: { width: number; height: number };
    observed: { touch: boolean; maxTouchPoints: number };
    touchHudVisible: boolean;
  };
  motionEvidence: null | {
    modes: Array<{ frames: Array<{ output: string }> }>;
  };
};

type CaptureMetadata = {
  schemaVersion: number;
  captureScope: string;
  shotPrefix: 'before' | 'after';
  profile: string;
  townContractId: string;
  sourceRevision: string;
  sourceFingerprint: string;
  polishProvenance: PolishProvenance;
  records: CaptureRecord[];
};

type TownBlockState = {
  label: string;
  requested: { rootVisible: boolean; shadowEnabled: boolean };
  targets: unknown[];
};

type SampledTownBlock = TownBlockState & {
  timingBasis: string;
  renderMedian: NumericRecord;
  renderWorst: NumericRecord;
  resourcesMedian: NumericRecord;
  resourcesWorst: NumericRecord;
  rafFrameInterval: NumericRecord;
  rafFrameIntervalStats: NumericRecord;
  longTasks: NumericRecord;
  rendererCpu: NumericRecord;
  inputToVisibleP95Ms: number | null;
  perfReportSummary: {
    textures: number;
    longTaskCount: number;
    longTaskP95: number;
    longTaskMax: number;
    tier: string;
    autoGovernor: boolean;
  };
  context: { lost: number; restored: number };
  assetFailures: unknown[];
};

type ConditionSummary = {
  blocks: number;
  renderMedian: NumericRecord;
  renderWorst: NumericRecord;
  resourcesMedian: NumericRecord;
  resourcesWorst: NumericRecord;
  rafFrameIntervalStats: NumericRecord;
  cpuSubmitMsMedian: number;
};

type DirectTownBlock = TownBlockState & { render: NumericRecord };
type DirectConditionSummary = { samples: number; renderMedian: NumericRecord };

type PerformanceScenario = {
  name: string;
  view: string;
  world: {
    seed: number;
    lot: unknown;
    player: Vec3 & { facing: number };
    camera: Vec3;
    target: Vec3;
  };
  settle: { requestedMs: number; observedMs: number };
  attributionTargets: unknown[];
  sequence: SampledTownBlock[];
  conditions: Record<string, ConditionSummary>;
  sampledDeltas: unknown;
  directRenderAttribution: {
    sequence: DirectTownBlock[];
    conditions: Record<string, DirectConditionSummary>;
    deltas: unknown;
  };
  deltas: unknown;
};

type PerformanceEvidence = {
  schemaVersion: number;
  captureScope: string;
  shotPrefix: 'before' | 'after';
  profile: string;
  expectedTown: boolean;
  expectedArmoury: boolean;
  source: CaptureSource;
  polishProvenance: unknown;
  townContract: { id: string };
  timingBasis: string;
  gl: { vendor: string; renderer: string };
  settings: Record<string, unknown>;
  coldStart: {
    navigationAndBootMs: number;
    bootSettleMs: number;
    preloadWaitMs: number;
    preload: { tasks: number; waitMs: number; complete: boolean };
    rendererPrewarm: {
      timedOut: boolean;
      compileTimedOut: boolean;
      manifestFailed: number;
      manifestTimedOut: number;
      failedEntryIds: string[];
      timedOutEntryIds: string[];
    };
  };
  sample: { phase: string; warmupMs: number; sampleMs: number; repeats: number };
  initialResources: NumericRecord;
  assetFailures: unknown[];
  captureDiagnostics: { pageErrors: unknown[]; consoleErrors: unknown[]; assetFailures: unknown[] };
  scenarios: PerformanceScenario[];
};

type ReferenceFileRecord = {
  id?: string;
  path: string;
  sha256: string;
  width: number;
  height: number;
  verdict?: string;
};

type ReferenceAdmission = {
  assetId: string;
  sourceSheet: ReferenceFileRecord;
  admittedViews: ReferenceFileRecord[];
  supplementaryViews?: ReferenceFileRecord[];
};

type DetailRecord = { id: string; kind: string; mapsTo: unknown };

type VisualEvidenceRecord = {
  passId: string;
  aiVisionScore: number;
  visualAcceptanceThreshold: number;
  layerScores: NumericRecord;
  featureReviews: Array<{ score?: number; visible: boolean }>;
  referenceScreenshot: string;
  renderScreenshot: string;
  comparisonImage: string;
};

type SculptSpec = {
  sourceImage: string;
  sourceImageSha256: string;
  referenceAdmission: string;
  componentTree: unknown[];
  materials: unknown[];
  preSpecAssessment: {
    detailInventory: {
      scanMethod: string;
      targetMinDetails: number;
      details: DetailRecord[];
    };
  };
  viewEvidence: Array<{ id: string; path: string; sha256: string }>;
  performanceBudget: {
    actualTriangles: number;
    hardTriangleCeiling: number;
    actualPrimitives: number;
    maxPrimitives: number;
    actualMaterials: number;
    maxMaterials: number;
    actualCompressedBytes: number;
    maxCompressedBytes: number;
    actualSha256: string;
    actualSourceFingerprint: string;
    actualBoundsMin: number[];
    actualBoundsMax: number[];
    usedAndRequiredExtensions: string[];
    embeddedTextures: number;
    animations: number;
    skins: number;
    cameras: number;
  };
  visualEvidence: VisualEvidenceRecord[];
  reviewHistory: Array<{
    passId: string;
    aiVisionScore: number;
    layerScores: NumericRecord;
    featureReviews: Array<{ score?: number; visible: boolean }>;
    visualEvidence: {
      referenceScreenshot: string;
      renderScreenshot: string;
      comparisonImage: string;
    };
    evidence: string[];
  }>;
};

type PreSpecAssessment = {
  sourceImage: string;
  referenceAdmission: string;
  preSpecAssessment: {
    detailInventory: {
      scanMethod: string;
      targetMinDetails: number;
      inventoryPath: string;
      details: DetailRecord[];
    };
  };
};

type DetailInventory = {
  sourceImage: string;
  scanMethod: string;
  targetMinDetails: number;
  details: DetailRecord[];
};

type ShippingOutput = {
  triangles: number;
  primitives: number;
  materials: number;
  compressedBytes: number;
  bounds: number[];
  embeddedTextures: number;
  animations: number;
  skins: number;
  cameras: number;
  extensions: string[];
  sha256: string;
  sourceFingerprint: string;
};

type ValidationRecord = {
  assetId: string;
  spec: string;
  normal: { ok: boolean; errors: number; warnings: number; components: number; materials: number };
  strictQuality: {
    ok: boolean;
    errors: number;
    warnings: number;
    components: number;
    materials: number;
  };
  pipeline: { currentPass: string; completedPasses: string[] };
  reviewAcceptance: {
    reviews: number;
    minimumGlobalScore: number;
    minimumLayerScore: number;
    minimumVisibleFeatureScore: number;
  };
  shippingOutput: ShippingOutput;
};

type ValidationResults = {
  gateThresholds: {
    globalVisualAcceptance: number;
    criticalFeatureMinimum: number;
    importantFeatureAverage: number;
  };
  referenceAdmission: {
    mailbox: AdmissionSummary;
    noticeboard: AdmissionSummary;
  };
  specValidation: ValidationRecord[];
};

type AdmissionSummary = {
  primaryViews: number;
  admitted: number;
  rejected: number;
  supplementaryRejectedAsDuplicate?: number;
};

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function resolveRepoPath(relativePath: string): string {
  expect(path.isAbsolute(relativePath), relativePath).toBe(false);
  const resolved = path.resolve(REPO_ROOT, relativePath);
  expect(resolved.startsWith(`${REPO_ROOT}${path.sep}`), relativePath).toBe(true);
  return resolved;
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function assertRecordedPng(record: ReferenceFileRecord): void {
  const filePath = resolveRepoPath(record.path);
  const bytes = readFileSync(filePath);
  expect(statSync(filePath).isFile(), record.path).toBe(true);
  expect(sha256File(filePath), record.path).toBe(record.sha256);
  expect(bytes.subarray(0, 8).toString('hex'), record.path).toBe(PNG_SIGNATURE);
  expect(bytes.readUInt32BE(16), `${record.path} width`).toBe(record.width);
  expect(bytes.readUInt32BE(20), `${record.path} height`).toBe(record.height);
}

function projectDetails(details: DetailRecord[]): DetailRecord[] {
  return details.map(({ id, kind, mapsTo }) => ({ id, kind, mapsTo }));
}

function expectFiniteNonNegative(value: number, label: string): void {
  expect(Number.isFinite(value), label).toBe(true);
  expect(value, label).toBeGreaterThanOrEqual(0);
}

function expectFiniteRecord(record: NumericRecord, label: string): void {
  for (const [key, value] of Object.entries(record)) {
    expectFiniteNonNegative(value, `${label}.${key}`);
  }
}

function expectRafStats(stats: NumericRecord, label: string): void {
  expectFiniteRecord(stats, label);
  expect(stats.p50Ms, `${label}.p50Ms`).toBeLessThanOrEqual(stats.p95Ms);
  expect(stats.p95Ms, `${label}.p95Ms`).toBeLessThanOrEqual(stats.p99Ms);
  expect(stats.p99Ms, `${label}.p99Ms`).toBeLessThanOrEqual(stats.p999Ms);
  expect(stats.p999Ms, `${label}.p999Ms`).toBeLessThanOrEqual(stats.maxMs);
  expect(stats.meanMs, `${label}.meanMs`).toBeLessThanOrEqual(stats.maxMs);
  for (const count of ['frames', 'long50', 'stutter100'] as const) {
    expect(Number.isInteger(stats[count]), `${label}.${count} integer`).toBe(true);
  }
  expect(stats.long50, `${label}.long50 frame bound`).toBeLessThanOrEqual(stats.frames);
  expect(stats.stutter100, `${label}.stutter100 frame bound`).toBeLessThanOrEqual(stats.long50);
  expect(stats.jankPct, `${label}.jankPct`).toBeLessThanOrEqual(100);
}

function expectConditionSummary(
  summary: ConditionSummary,
  blocks: SampledTownBlock[],
  label: string,
): void {
  expect(blocks, `${label} source blocks`).toHaveLength(2);
  expect(summary.blocks, `${label} block count`).toBe(blocks.length);
  for (const [summaryKey, blockKey] of [
    ['renderMedian', 'renderMedian'],
    ['resourcesMedian', 'resourcesMedian'],
  ] as const) {
    const actual = summary[summaryKey];
    expect(Object.keys(actual).sort(), `${label} ${summaryKey} keys`).toEqual(
      Object.keys(blocks[0][blockKey]).sort(),
    );
    for (const key of Object.keys(actual)) {
      const sourceValues = blocks.map((block) => block[blockKey][key]);
      expect(actual[key], `${label} ${summaryKey}.${key}`).toBe(
        roundPerformanceValue((sourceValues[0] + sourceValues[1]) / 2),
      );
    }
  }
  for (const [summaryKey, blockKey] of [
    ['renderWorst', 'renderWorst'],
    ['resourcesWorst', 'resourcesWorst'],
  ] as const) {
    const actual = summary[summaryKey];
    const summaryMedian =
      summaryKey === 'renderWorst' ? summary.renderMedian : summary.resourcesMedian;
    expect(Object.keys(actual).sort(), `${label} ${summaryKey} keys`).toEqual(
      Object.keys(blocks[0][blockKey]).sort(),
    );
    for (const key of Object.keys(actual)) {
      expect(actual[key], `${label} ${summaryKey}.${key}`).toBe(
        Math.max(...blocks.map((block) => block[blockKey][key])),
      );
      expect(actual[key], `${label} ${summaryKey}.${key} median bound`).toBeGreaterThanOrEqual(
        summaryMedian[key],
      );
    }
  }
  const raf = summary.rafFrameIntervalStats;
  expectRafStats(raf, `${label}.rafFrameIntervalStats`);
  expect(raf.frames, `${label} RAF frames`).toBe(
    blocks.reduce((total, block) => total + block.rafFrameIntervalStats.frames, 0),
  );
  expect(raf.long50, `${label} RAF long50`).toBe(
    blocks.reduce((total, block) => total + block.rafFrameIntervalStats.long50, 0),
  );
  expect(raf.stutter100, `${label} RAF stutter100`).toBe(
    blocks.reduce((total, block) => total + block.rafFrameIntervalStats.stutter100, 0),
  );
  expect(raf.maxMs, `${label} RAF max`).toBe(
    Math.max(...blocks.map((block) => block.rafFrameIntervalStats.maxMs)),
  );
  expect(summary.cpuSubmitMsMedian, `${label} submit median`).toBe(
    summary.renderMedian.cpuSubmitMs,
  );
}

function expectSampledBlockSummary(
  block: SampledTownBlock,
  profile: CaptureProfileContract,
  timingBasis: string,
  label: string,
): void {
  expect(block.timingBasis, `${label} timing basis`).toBe(timingBasis);
  expect(block.context, `${label} context`).toEqual({ lost: 0, restored: 0 });
  expect(block.assetFailures, `${label} asset failures`).toEqual([]);
  for (const [key, summary] of Object.entries({
    renderMedian: block.renderMedian,
    renderWorst: block.renderWorst,
    resourcesMedian: block.resourcesMedian,
    resourcesWorst: block.resourcesWorst,
    rafFrameInterval: block.rafFrameInterval,
    rafFrameIntervalStats: block.rafFrameIntervalStats,
    longTasks: block.longTasks,
    rendererCpu: block.rendererCpu,
  })) {
    expectFiniteRecord(summary, `${label}.${key}`);
  }
  for (const key of Object.keys(block.renderMedian)) {
    expect(block.renderWorst[key], `${label} render worst ${key}`).toBeGreaterThanOrEqual(
      block.renderMedian[key],
    );
  }
  for (const key of Object.keys(block.resourcesMedian)) {
    expect(block.resourcesWorst[key], `${label} resource worst ${key}`).toBeGreaterThanOrEqual(
      block.resourcesMedian[key],
    );
  }
  expect(block.rafFrameInterval.samples, `${label} RAF samples`).toBeGreaterThan(0);
  expectRafStats(block.rafFrameIntervalStats, `${label}.rafFrameIntervalStats`);
  expect(block.rafFrameIntervalStats.frames, `${label} RAF frame attribution`).toBe(
    block.rafFrameInterval.samples,
  );
  expect(block.rafFrameIntervalStats.meanMs, `${label} RAF mean attribution`).toBe(
    block.rafFrameInterval.meanMs,
  );
  expect(block.rafFrameInterval.p95Ms, `${label} RAF p95`).toBeLessThanOrEqual(
    block.rafFrameInterval.p99Ms,
  );
  expect(block.rafFrameInterval.p99Ms, `${label} RAF p99`).toBeLessThanOrEqual(
    block.rafFrameInterval.maxMs,
  );
  expect(block.rafFrameInterval.long50, `${label} RAF long50 attribution`).toBe(
    block.rafFrameIntervalStats.long50,
  );
  expect(block.rafFrameIntervalStats.long50, `${label} RAF frames above 50 ms`).toBe(0);
  expect(block.rafFrameIntervalStats.stutter100, `${label} RAF frames above 100 ms`).toBe(0);
  expect(block.longTasks.count, `${label} long-task count`).toBe(0);
  expect(block.longTasks.p95Ms, `${label} long-task p95`).toBe(0);
  expect(block.longTasks.maxMs, `${label} long-task max`).toBe(0);
  expect(
    block.inputToVisibleP95Ms === null ||
      (Number.isFinite(block.inputToVisibleP95Ms) && block.inputToVisibleP95Ms >= 0),
    `${label} input latency`,
  ).toBe(true);
  expect(block.perfReportSummary, `${label} report render attribution`).toMatchObject({
    textures: block.resourcesMedian.textures,
    longTaskCount: block.longTasks.count,
    longTaskP95: block.longTasks.p95Ms,
    longTaskMax: block.longTasks.maxMs,
    autoGovernor: false,
    tier: profile.tier,
  });
}

function expectDirectConditionSummary(
  summary: DirectConditionSummary,
  blocks: DirectTownBlock[],
  label: string,
): void {
  expect(blocks, `${label} direct blocks`).toHaveLength(2);
  expect(summary.samples, `${label} direct samples`).toBe(blocks.length);
  expect(Object.keys(summary.renderMedian).sort(), `${label} direct render keys`).toEqual(
    Object.keys(blocks[0].render).sort(),
  );
  for (const key of Object.keys(summary.renderMedian)) {
    const sourceValues = blocks.map((block) => block.render[key]);
    expect(summary.renderMedian[key], `${label} direct render ${key}`).toBe(
      (sourceValues[0] + sourceValues[1]) / 2,
    );
  }
}

describe('Eastbrook polish committed capture artifacts', () => {
  it('pins the matched view/profile contract and every before/after PNG', () => {
    expect(
      EASTBROOK_TOWN_POLISH_MATCHED_CAPTURE_VIEWS.map((view: { name: string }) => view.name),
    ).toEqual(VIEW_NAMES);
    expect(
      EASTBROOK_TOWN_CAPTURE_PROFILES.map(
        (profile: {
          name: string;
          viewport: { width: number; height: number; deviceScaleFactor: number };
        }) => ({
          name: profile.name,
          cssWidth: profile.viewport.width,
          cssHeight: profile.viewport.height,
          deviceScaleFactor: profile.viewport.deviceScaleFactor,
          pixelWidth: profile.viewport.width * profile.viewport.deviceScaleFactor,
          pixelHeight: profile.viewport.height * profile.viewport.deviceScaleFactor,
        }),
      ),
    ).toEqual(PROFILES);

    // Every retained hero view must be a real member of the accepted capture matrix, so
    // a typo in the retained lists cannot silently pass by matching a stray disk file.
    for (const profile of PROFILES) {
      for (const view of [
        ...RETAINED_BEFORE_VIEWS[profile.name],
        ...RETAINED_AFTER_VIEWS[profile.name],
      ]) {
        expect(VIEW_NAMES, `retained view ${view}`).toContain(view);
      }
    }

    const expectedBefore = PROFILES.flatMap((profile) =>
      retainedBaseCaptureNames('before', profile.name),
    ).sort();
    const expectedAfter = PROFILES.flatMap((profile) => [
      ...retainedBaseCaptureNames('after', profile.name),
      ...retainedMotionCaptureNames(profile.name),
    ]).sort();
    expect(listFilesRecursive(path.join(POLISH_ROOT, 'before'), '.png')).toEqual(expectedBefore);
    expect(listFilesRecursive(path.join(POLISH_ROOT, 'after'), '.png')).toEqual(expectedAfter);

    for (const prefix of ['before', 'after'] as const) {
      for (const profile of PROFILES) {
        for (const fileName of retainedBaseCaptureNames(prefix, profile.name)) {
          assertPng(
            path.join(POLISH_ROOT, prefix, fileName),
            [profile.pixelWidth, profile.pixelHeight],
            50_000,
          );
        }
      }
    }
    for (const profile of PROFILES) {
      for (const fileName of retainedMotionCaptureNames(profile.name)) {
        assertPng(
          path.join(POLISH_ROOT, 'after', fileName),
          [profile.pixelWidth, profile.pixelHeight],
          50_000,
        );
      }
    }
  });

  it('pins the visually accepted after-capture set byte for byte', () => {
    const acceptedFiles = [
      ...listFilesRecursive(path.join(POLISH_ROOT, 'after'), '.png').map(
        (fileName) => `after/${fileName}`,
      ),
      'contacts/after-desktop-ultra-contact.webp',
      'contacts/after-mobile-low-contact.webp',
    ].sort();
    const fingerprint = createHash('sha256');
    for (const relativePath of acceptedFiles) {
      fingerprint.update(relativePath);
      fingerprint.update('\0');
      fingerprint.update(readFileSync(path.join(POLISH_ROOT, relativePath)));
      fingerprint.update('\0');
    }
    expect(acceptedFiles).toHaveLength(18);
    expect(fingerprint.digest('hex')).toBe(
      '031d3a72fe04c1b4b084ca6608ce137d4078f9ddff42c488efe6ca8624fcc1b4',
    );
  });

  it('pins the exact metadata inventory to every base capture and motion frame', async () => {
    const currentPolishProvenance = await deriveCurrentPolishProvenance();
    const expectedTownSourceFingerprint =
      currentPolishProvenance.components.townAsset.sourceFingerprint;
    const metadataRoot = path.join(POLISH_ROOT, 'metadata');
    const expectedMetadataFiles = [
      'after-desktop-ultra.json',
      'after-mobile-low.json',
      'before-desktop-ultra.json',
      'before-mobile-low.json',
    ];
    expect(listFilesRecursive(metadataRoot, '.json')).toEqual(expectedMetadataFiles);

    for (const prefix of ['before', 'after'] as const) {
      for (const profile of PROFILES) {
        const fileName = `${prefix}-${profile.name}.json`;
        const filePath = path.join(metadataRoot, fileName);
        expect(statSync(filePath).size, filePath).toBeGreaterThan(100_000);
        const metadata = readJsonFile<CaptureMetadata>(filePath);
        const contractId = prefix === 'before' ? 'polish-baseline' : 'polish-v2';
        const expectedPolishProvenance =
          prefix === 'before' ? BASELINE_POLISH_PROVENANCE : currentPolishProvenance;
        const contractProfile = (
          EASTBROOK_TOWN_CAPTURE_PROFILES as readonly CaptureProfileContract[]
        ).find((candidate) => candidate.name === profile.name);
        if (!contractProfile) throw new Error(`missing capture profile ${profile.name}`);

        expect(metadata).toMatchObject({
          schemaVersion: 2,
          captureScope: 'town',
          shotPrefix: prefix,
          profile: profile.name,
          townContractId: contractId,
        });
        expect(metadata.polishProvenance, `${fileName} independently anchored provenance`).toEqual(
          expectedPolishProvenance,
        );
        expect(metadata.sourceFingerprint, `${fileName} wrapper town fingerprint`).toBe(
          expectedTownSourceFingerprint,
        );
        if (prefix === 'before') {
          expect(metadata.sourceRevision).toBe(EASTBROOK_POLISH_BASELINE_REVISION);
        }
        expect(metadata.records.map((record) => path.basename(record.output))).toEqual(
          baseCaptureNames(prefix, profile.name),
        );
        const canonicalSource = metadata.records[0]?.source;
        if (!canonicalSource) throw new Error(`missing canonical source for ${fileName}`);
        for (const [index, record] of metadata.records.entries()) {
          const view = (
            EASTBROOK_TOWN_POLISH_MATCHED_CAPTURE_VIEWS as readonly CaptureViewContract[]
          )[index];
          if (!view) throw new Error(`missing capture view ${index} for ${fileName}`);
          expect(record).toMatchObject({
            schemaVersion: 2,
            captureScope: 'town',
            townContract: { id: contractId },
            viewport: {
              physical: { width: profile.pixelWidth, height: profile.pixelHeight },
            },
          });
          expect(record.polishProvenance, `${fileName} record ${index} provenance`).toEqual(
            metadata.polishProvenance,
          );
          expect(record.source, `${fileName} record ${index} source identity`).toEqual(
            canonicalSource,
          );
          expect(record.source.revision, `${fileName} record ${index} source revision`).toBe(
            metadata.sourceRevision,
          );
          expect(record.source.fingerprint, `${fileName} record ${index} town fingerprint`).toBe(
            expectedTownSourceFingerprint,
          );
          expect(() =>
            assertTownCaptureMetadata({
              metadata: record,
              contractId,
              expectedTown: true,
              expectedArmoury: true,
              profile: contractProfile,
              view,
              playerState: EASTBROOK_ARMOURY_PLAYER_STATE,
              expectedSeed: EASTBROOK_ARMOURY_CAPTURE_SEED,
              settleMs: EASTBROOK_TOWN_CAPTURE_SETTLE_MS,
              expectedPolishProvenance,
            }),
          ).not.toThrow();
        }

        const civicRecord = metadata.records.find((record) =>
          path.basename(record.output).includes('-civic-motion-'),
        );
        expect(civicRecord).toBeDefined();
        if (!civicRecord) throw new Error(`missing civic motion metadata in ${fileName}`);
        if (prefix === 'before') {
          expect(civicRecord.motionEvidence).toBeNull();
        } else {
          expect(
            civicRecord.motionEvidence?.modes.flatMap((mode) =>
              mode.frames.map((frame) => path.basename(frame.output)),
            ),
          ).toEqual(motionCaptureNames(profile.name));
        }
      }
    }
  });
});

describe('Eastbrook polish accepted asset evidence', () => {
  it('pins every Ravenpost mailbox evidence PNG and its authored turnaround', () => {
    const evidenceRoot = path.join(POLISH_ROOT, 'assets/ravenpost-mailbox');
    expect(listFilesRecursive(evidenceRoot, '.png')).toEqual([...MAILBOX_EVIDENCE].sort());
    for (const relativePath of MAILBOX_EVIDENCE) {
      assertPng(
        path.join(evidenceRoot, relativePath),
        MAILBOX_NONSTANDARD_DIMENSIONS[relativePath] ?? [900, 720],
        25_000,
      );
    }
    assertPng(path.join(POLISH_ROOT, 'turnarounds/ravenpost-mailbox.png'), [1536, 1024], 250_000);
  });

  it('pins every noticeboard evidence PNG and its authored turnaround', () => {
    const evidenceRoot = path.join(POLISH_ROOT, 'assets/noticeboard');
    expect(listFilesRecursive(evidenceRoot, '.png')).toEqual([...NOTICEBOARD_EVIDENCE].sort());
    for (const relativePath of NOTICEBOARD_EVIDENCE) {
      assertPng(
        path.join(evidenceRoot, relativePath),
        NOTICEBOARD_NONSTANDARD_DIMENSIONS[relativePath] ?? [900, 720],
        25_000,
      );
    }
    assertPng(path.join(POLISH_ROOT, 'turnarounds/noticeboard.png'), [1536, 1024], 250_000);
  });

  it('keeps the turnaround inventory exact', () => {
    expect(listFilesRecursive(path.join(POLISH_ROOT, 'turnarounds'), '.png')).toEqual([
      'noticeboard.png',
      'ravenpost-mailbox.png',
    ]);
  });
});

describe('Eastbrook polish img2threejs provenance', () => {
  it('ties validation and review records to committed source evidence and shipping outputs', async () => {
    const [mailboxFingerprint, noticeboardFingerprint] = await Promise.all([
      import('../scripts/assets/eastbrook_mailbox/source_fingerprint.mjs'),
      import('../scripts/assets/eastbrook_noticeboard/source_fingerprint.mjs'),
    ]);
    const validation = readJsonFile<ValidationResults>(
      path.join(IMG2THREE_ROOT, 'validation-results.json'),
    );
    expect(validation.gateThresholds).toEqual({
      globalVisualAcceptance: 0.7,
      criticalFeatureMinimum: 0.7,
      importantFeatureAverage: 0.7,
    });
    const expectedPassIds = [
      'blockout',
      'structural-pass',
      'form-refinement',
      'material-pass',
      'lighting-pass',
      'interaction-pass',
      'optimization-pass',
    ];
    const assets = [
      {
        key: 'mailbox' as const,
        validationAssetId: 'ravenpost-mailbox',
        admissionAssetId: 'ravenpost-mailbox',
        spec: 'docs/design/eastbrook-vale-rebuild/polish-img2threejs/mailbox/object-sculpt-spec.json',
        preSpec:
          'docs/design/eastbrook-vale-rebuild/polish-img2threejs/mailbox/pre-spec-assessment.json',
        detailInventory:
          'docs/design/eastbrook-vale-rebuild/polish-img2threejs/mailbox/detail-inventory.json',
        admission:
          'docs/design/eastbrook-vale-rebuild/polish-img2threejs/mailbox/reference-admission.json',
        admittedViewIds: [
          'front',
          'right',
          'rear-detail',
          'left',
          'front-three-quarter',
          'rear-three-quarter',
          'grazing',
        ],
        glb: 'public/models/props/mailbox_pillar.glb',
        shippingCeilings: {
          hardTriangleCeiling: 3_000,
          maxPrimitives: 2,
          maxMaterials: 2,
          maxCompressedBytes: 102_400,
        },
        liveSourceFingerprint: mailboxFingerprint.eastbrookMailboxSourceFingerprint(),
      },
      {
        key: 'noticeboard' as const,
        validationAssetId: 'eastbrook-civic-noticeboard',
        admissionAssetId: 'eastbrook-noticeboard',
        spec: 'docs/design/eastbrook-vale-rebuild/polish-img2threejs/noticeboard/object-sculpt-spec.json',
        preSpec:
          'docs/design/eastbrook-vale-rebuild/polish-img2threejs/noticeboard/pre-spec-assessment.json',
        detailInventory:
          'docs/design/eastbrook-vale-rebuild/polish-img2threejs/noticeboard/detail-inventory.json',
        admission:
          'docs/design/eastbrook-vale-rebuild/polish-img2threejs/noticeboard/reference-admission.json',
        admittedViewIds: [
          'front',
          'right',
          'rear',
          'left',
          'front-three-quarter',
          'rear-three-quarter',
          'grazing',
        ],
        glb: 'public/models/props/eastbrook_noticeboard.glb',
        shippingCeilings: {
          hardTriangleCeiling: 2_500,
          maxPrimitives: 2,
          maxMaterials: 2,
          maxCompressedBytes: 102_400,
        },
        liveSourceFingerprint: noticeboardFingerprint.eastbrookNoticeboardSourceFingerprint(),
      },
    ];

    expect(validation.specValidation.map(({ assetId, spec }) => ({ assetId, spec }))).toEqual(
      assets.map(({ validationAssetId, spec }) => ({ assetId: validationAssetId, spec })),
    );

    for (const asset of assets) {
      const label = asset.key;
      const record = validation.specValidation.find(
        (candidate) => candidate.assetId === asset.validationAssetId,
      );
      if (!record) throw new Error(`missing ${label} validation record`);
      const spec = readJsonFile<SculptSpec>(resolveRepoPath(record.spec));
      const admission = readJsonFile<ReferenceAdmission>(resolveRepoPath(asset.admission));
      const preSpec = readJsonFile<PreSpecAssessment>(resolveRepoPath(asset.preSpec));
      const inventory = readJsonFile<DetailInventory>(resolveRepoPath(asset.detailInventory));

      expect(record.spec, `${label} spec path`).toBe(asset.spec);
      expect(admission.assetId, `${label} admission asset alias`).toBe(asset.admissionAssetId);
      expect(spec.referenceAdmission, `${label} admission link`).toBe(asset.admission);
      expect(preSpec.referenceAdmission, `${label} pre-spec admission link`).toBe(asset.admission);

      assertRecordedPng(admission.sourceSheet);
      expect(
        admission.admittedViews.map(({ id }) => id),
        `${label} admitted view inventory`,
      ).toEqual(asset.admittedViewIds);
      expect(
        admission.admittedViews.every(({ verdict }) => verdict === 'pass'),
        `${label} primary admission verdicts`,
      ).toBe(true);
      for (const view of [...admission.admittedViews, ...(admission.supplementaryViews ?? [])]) {
        assertRecordedPng(view);
      }
      const sourceView = admission.admittedViews.find((view) => view.path === spec.sourceImage);
      expect(sourceView, `${label} admitted source view`).toBeDefined();
      if (!sourceView) throw new Error(`missing ${label} admitted source view`);
      expect(sourceView.sha256, `${label} source image hash`).toBe(spec.sourceImageSha256);
      expect(
        spec.viewEvidence.map(({ id, path: viewPath, sha256 }) => ({
          id,
          path: viewPath,
          sha256,
        })),
        `${label} admitted view projection`,
      ).toEqual(
        admission.admittedViews.map(({ id, path: viewPath, sha256 }) => ({
          id,
          path: viewPath,
          sha256,
        })),
      );

      const admissionSummary = validation.referenceAdmission[asset.key];
      expect(admissionSummary, `${label} admission summary`).toMatchObject({
        primaryViews: asset.admittedViewIds.length,
        admitted: asset.admittedViewIds.length,
        rejected: 0,
      });
      const supplementaryRejected = (admission.supplementaryViews ?? []).filter((view) =>
        view.verdict?.startsWith('rejected'),
      ).length;
      if (supplementaryRejected > 0) {
        expect(
          admissionSummary.supplementaryRejectedAsDuplicate,
          `${label} supplementary rejection count`,
        ).toBe(supplementaryRejected);
      } else {
        expect(admissionSummary.supplementaryRejectedAsDuplicate).toBeUndefined();
      }

      expect(preSpec.sourceImage, `${label} pre-spec source`).toBe(spec.sourceImage);
      expect(inventory.sourceImage, `${label} detail source`).toBe(spec.sourceImage);
      expect(
        preSpec.preSpecAssessment.detailInventory.inventoryPath,
        `${label} detail inventory link`,
      ).toBe(asset.detailInventory);
      expect(projectDetails(preSpec.preSpecAssessment.detailInventory.details)).toEqual(
        projectDetails(inventory.details),
      );
      expect(projectDetails(spec.preSpecAssessment.detailInventory.details)).toEqual(
        projectDetails(inventory.details),
      );
      for (const detailSet of [
        preSpec.preSpecAssessment.detailInventory,
        spec.preSpecAssessment.detailInventory,
        inventory,
      ]) {
        expect(detailSet.details.length, `${label} detail inventory size`).toBeGreaterThanOrEqual(
          detailSet.targetMinDetails,
        );
      }

      const expectedValidationCounts = {
        ok: true,
        errors: 0,
        warnings: 0,
        components: spec.componentTree.length,
        materials: spec.materials.length,
      };
      expect(record.normal, `${label} normal validation`).toEqual(expectedValidationCounts);
      expect(record.strictQuality, `${label} strict validation`).toEqual(expectedValidationCounts);
      const visualPassIds = spec.visualEvidence.map(({ passId }) => passId);
      expect(visualPassIds, `${label} required pass inventory`).toEqual(expectedPassIds);
      expect(record.pipeline, `${label} pipeline`).toEqual({
        currentPass: 'complete',
        completedPasses: expectedPassIds,
      });
      expect(
        spec.reviewHistory.map(({ passId }) => passId),
        `${label} review history`,
      ).toEqual(expectedPassIds);

      const visibleFeatureScores = spec.visualEvidence.flatMap(({ featureReviews }) =>
        featureReviews.flatMap((review) =>
          review.visible && typeof review.score === 'number' ? [review.score] : [],
        ),
      );
      expect(visibleFeatureScores.length, `${label} scored visible features`).toBeGreaterThan(0);
      expect(
        visibleFeatureScores.reduce((total, score) => total + score, 0) /
          visibleFeatureScores.length,
        `${label} important feature average`,
      ).toBeGreaterThanOrEqual(validation.gateThresholds.importantFeatureAverage);
      expect(record.reviewAcceptance, `${label} derived acceptance`).toEqual({
        reviews: spec.visualEvidence.length,
        minimumGlobalScore: Math.min(
          ...spec.visualEvidence.map(({ aiVisionScore }) => aiVisionScore),
        ),
        minimumLayerScore: Math.min(
          ...spec.visualEvidence.flatMap(({ layerScores }) => Object.values(layerScores)),
        ),
        minimumVisibleFeatureScore: Math.min(...visibleFeatureScores),
      });

      for (const visual of spec.visualEvidence) {
        expect(visual.visualAcceptanceThreshold, `${label} ${visual.passId} threshold`).toBe(
          validation.gateThresholds.globalVisualAcceptance,
        );
        expect(
          visual.aiVisionScore,
          `${label} ${visual.passId} accepted global score`,
        ).toBeGreaterThanOrEqual(validation.gateThresholds.globalVisualAcceptance);
        for (const [layer, score] of Object.entries(visual.layerScores)) {
          expect(score, `${label} ${visual.passId} accepted layer ${layer}`).toBeGreaterThanOrEqual(
            validation.gateThresholds.globalVisualAcceptance,
          );
        }
        for (const feature of visual.featureReviews.filter(({ visible }) => visible)) {
          if (typeof feature.score !== 'number') {
            throw new Error(`${label} ${visual.passId} visible feature lacks a score`);
          }
          expect(
            feature.score,
            `${label} ${visual.passId} accepted visible feature`,
          ).toBeGreaterThanOrEqual(validation.gateThresholds.criticalFeatureMinimum);
        }
        const review = spec.reviewHistory.find(({ passId }) => passId === visual.passId);
        expect(review, `${label} ${visual.passId} review`).toBeDefined();
        if (!review) throw new Error(`missing ${label} ${visual.passId} review`);
        expect(review.aiVisionScore, `${label} ${visual.passId} global score`).toBe(
          visual.aiVisionScore,
        );
        expect(review.layerScores, `${label} ${visual.passId} layer scores`).toEqual(
          visual.layerScores,
        );
        expect(review.featureReviews, `${label} ${visual.passId} feature scores`).toEqual(
          visual.featureReviews,
        );
        expect(review.visualEvidence, `${label} ${visual.passId} evidence identity`).toMatchObject({
          referenceScreenshot: visual.referenceScreenshot,
          renderScreenshot: visual.renderScreenshot,
          comparisonImage: visual.comparisonImage,
        });
        expect(review.evidence, `${label} ${visual.passId} evidence links`).toEqual(
          expect.arrayContaining([visual.renderScreenshot, visual.comparisonImage]),
        );
        for (const evidencePath of new Set([
          visual.referenceScreenshot,
          visual.renderScreenshot,
          visual.comparisonImage,
          ...review.evidence,
        ])) {
          expect(statSync(resolveRepoPath(evidencePath)).isFile(), evidencePath).toBe(true);
        }
      }

      const budget = spec.performanceBudget;
      expect(budget, `${label} fixed shipping ceilings`).toMatchObject(asset.shippingCeilings);
      expect(record.shippingOutput, `${label} numeric shipping contract`).toMatchObject({
        triangles: budget.actualTriangles,
        primitives: budget.actualPrimitives,
        materials: budget.actualMaterials,
        compressedBytes: budget.actualCompressedBytes,
        embeddedTextures: budget.embeddedTextures,
        animations: budget.animations,
        skins: budget.skins,
        cameras: budget.cameras,
        extensions: budget.usedAndRequiredExtensions,
        sha256: budget.actualSha256,
        sourceFingerprint: budget.actualSourceFingerprint,
      });
      expect(budget.actualTriangles, `${label} triangle ceiling`).toBeLessThanOrEqual(
        budget.hardTriangleCeiling,
      );
      expect(budget.actualPrimitives, `${label} primitive ceiling`).toBeLessThanOrEqual(
        budget.maxPrimitives,
      );
      expect(budget.actualMaterials, `${label} material ceiling`).toBeLessThanOrEqual(
        budget.maxMaterials,
      );
      expect(budget.actualCompressedBytes, `${label} byte ceiling`).toBeLessThanOrEqual(
        budget.maxCompressedBytes,
      );
      expect(record.shippingOutput.bounds, `${label} shipping bounds`).toHaveLength(
        budget.actualBoundsMin.length,
      );
      expect(budget.actualBoundsMax, `${label} budget bound pairs`).toHaveLength(
        budget.actualBoundsMin.length,
      );
      for (const [index, extent] of record.shippingOutput.bounds.entries()) {
        expect(extent, `${label} bound ${index}`).toBeCloseTo(
          budget.actualBoundsMax[index] - budget.actualBoundsMin[index],
          4,
        );
      }
      const glbPath = resolveRepoPath(asset.glb);
      expect(statSync(glbPath).size, `${label} GLB bytes`).toBe(
        record.shippingOutput.compressedBytes,
      );
      expect(sha256File(glbPath), `${label} GLB hash`).toBe(record.shippingOutput.sha256);
      expect(record.shippingOutput.sourceFingerprint, `${label} live source fingerprint`).toBe(
        asset.liveSourceFingerprint,
      );
    }
  });
});

describe('Eastbrook polish performance and contact evidence', () => {
  it('pins the accepted matched performance evidence byte for byte', () => {
    const performanceRoot = path.join(POLISH_ROOT, 'performance');
    const acceptedFiles = [
      'after-desktop-ultra-town.json',
      'after-mobile-low-town.json',
      'before-desktop-ultra-town.json',
      'before-mobile-low-town.json',
    ].sort();
    const fingerprint = createHash('sha256');
    for (const fileName of acceptedFiles) {
      fingerprint.update(fileName);
      fingerprint.update('\0');
      fingerprint.update(readFileSync(path.join(performanceRoot, fileName)));
      fingerprint.update('\0');
    }
    expect(acceptedFiles).toHaveLength(4);
    // Second-order seal, recomputed LAST in the re-mint recipe: it hashes the
    // performance evidence files, which carry the composite polish provenance.
    // The release/v0.33.0 resync of the draw-call diet branch moved the
    // runtimeRender.renderer.sha256 leaf (census hooks and the diet's batching
    // seams merged over the streaming and cull deltas), so the composite
    // polish provenance followed, and this seal follows the composite. Every
    // measured value (frame timings, draw stats, triangle and scenario
    // numbers) is byte-identical, and no capture was retaken.
    expect(fingerprint.digest('hex')).toBe(
      'efc71e4dc8dca63654d4e712474a5caa82b6aee34909b6d45b358a0b1d7c347c',
    );
  });

  it('binds every after record to the current source and shipping asset provenance', async () => {
    const current = await deriveCurrentPolishProvenance();
    for (const profile of PROFILES) {
      for (const [directory, suffix] of [
        ['metadata', ''],
        ['performance', '-town'],
      ] as const) {
        const fileName = `after-${profile.name}${suffix}.json`;
        const filePath = path.join(POLISH_ROOT, directory, fileName);
        const artifact = JSON.parse(readFileSync(filePath, 'utf8')) as {
          polishProvenance: { fingerprint: string; components: unknown };
        };
        expect(artifact.polishProvenance.fingerprint, `${filePath} fingerprint`).toBe(
          current.fingerprint,
        );
        expect(artifact.polishProvenance.components, `${filePath} components`).toEqual(
          current.components,
        );
      }
    }
  });

  it('validates every committed performance scenario, attribution block, and summary', async () => {
    const currentPolishProvenance = await deriveCurrentPolishProvenance();
    const expectedTownSourceFingerprint =
      currentPolishProvenance.components.townAsset.sourceFingerprint;
    const performanceRoot = path.join(POLISH_ROOT, 'performance');
    const expectedFiles = [
      'after-desktop-ultra-town.json',
      'after-mobile-low-town.json',
      'before-desktop-ultra-town.json',
      'before-mobile-low-town.json',
    ];
    expect(listFilesRecursive(performanceRoot, '.json')).toEqual(expectedFiles);

    const conditionContracts = [
      { key: 'visibleShadowOn', rootVisible: true, shadowEnabled: true },
      { key: 'hiddenShadowOn', rootVisible: false, shadowEnabled: true },
      { key: 'visibleShadowOff', rootVisible: true, shadowEnabled: false },
      { key: 'hiddenShadowOff', rootVisible: false, shadowEnabled: false },
    ] as const;
    const sampledBlockContracts = [
      { label: 'town-visible-shadow-on-1', rootVisible: true, shadowEnabled: true },
      { label: 'town-hidden-shadow-on-1', rootVisible: false, shadowEnabled: true },
      { label: 'town-hidden-shadow-on-2', rootVisible: false, shadowEnabled: true },
      { label: 'town-visible-shadow-on-2', rootVisible: true, shadowEnabled: true },
      { label: 'town-visible-shadow-off-1', rootVisible: true, shadowEnabled: false },
      { label: 'town-hidden-shadow-off-1', rootVisible: false, shadowEnabled: false },
      { label: 'town-hidden-shadow-off-2', rootVisible: false, shadowEnabled: false },
      { label: 'town-visible-shadow-off-2', rootVisible: true, shadowEnabled: false },
    ] as const;
    const directBlockContracts = sampledBlockContracts.map(({ label, ...state }) => ({
      label: label.replace(/-\d$/, '').replace(/^town-/, 'direct-town-'),
      ...state,
    }));
    const scenarioContracts = EASTBROOK_TOWN_PERF_SCENARIOS as ReadonlyArray<{
      name: string;
      viewName: string;
    }>;
    const views = EASTBROOK_TOWN_POLISH_MATCHED_CAPTURE_VIEWS as readonly CaptureViewContract[];

    for (const prefix of ['before', 'after'] as const) {
      for (const profile of PROFILES) {
        const fileName = `${prefix}-${profile.name}-town.json`;
        const filePath = path.join(performanceRoot, fileName);
        expect(statSync(filePath).size, filePath).toBeGreaterThan(100_000);
        const evidence = readJsonFile<PerformanceEvidence>(filePath);
        const metadata = readJsonFile<CaptureMetadata>(
          path.join(POLISH_ROOT, 'metadata', `${prefix}-${profile.name}.json`),
        );
        const profileContract = (
          EASTBROOK_TOWN_CAPTURE_PROFILES as readonly CaptureProfileContract[]
        ).find((candidate) => candidate.name === profile.name);
        if (!profileContract) throw new Error(`missing capture profile ${profile.name}`);
        const contractId = prefix === 'before' ? 'polish-baseline' : 'polish-v2';
        const expectedPolishProvenance =
          prefix === 'before' ? BASELINE_POLISH_PROVENANCE : currentPolishProvenance;
        const metadataIdentity = metadata.records[0];
        if (!metadataIdentity) throw new Error(`missing metadata identity for ${fileName}`);

        expect(evidence).toMatchObject({
          schemaVersion: 2,
          captureScope: 'town',
          shotPrefix: prefix,
          profile: profile.name,
          expectedTown: true,
          expectedArmoury: true,
          townContract: { id: contractId },
          assetFailures: [],
          captureDiagnostics: { assetFailures: [] },
        });
        expect(() =>
          assertNoCaptureErrors(
            evidence.captureDiagnostics.pageErrors,
            evidence.captureDiagnostics.consoleErrors,
          ),
        ).not.toThrow();
        for (const [recordIndex, record] of metadata.records.entries()) {
          expect(record.source, `${fileName} metadata source ${recordIndex}`).toEqual(
            metadataIdentity.source,
          );
          expect(record.source.fingerprint, `${fileName} town fingerprint ${recordIndex}`).toBe(
            expectedTownSourceFingerprint,
          );
        }
        expect(evidence.source, `${fileName} source`).toEqual(metadataIdentity.source);
        expect(metadata.polishProvenance, `${fileName} metadata provenance`).toEqual(
          expectedPolishProvenance,
        );
        expect(metadata.sourceFingerprint, `${fileName} metadata town fingerprint`).toBe(
          expectedTownSourceFingerprint,
        );
        expect(evidence.polishProvenance, `${fileName} provenance`).toEqual(
          expectedPolishProvenance,
        );
        expect(evidence.townContract, `${fileName} contract`).toEqual(
          metadataIdentity.townContract,
        );
        expect(evidence.settings, `${fileName} settings identity`).toEqual(
          metadataIdentity.renderer.settings,
        );
        expect(metadataIdentity.renderer.tier, `${fileName} profile tier`).toBe(
          profileContract.tier,
        );
        for (const [key, value] of Object.entries(profileContract.settings)) {
          expect(evidence.settings[key], `${fileName} setting ${key}`).toBe(value);
        }
        if (profileContract.mobile) {
          expect(metadataIdentity.viewport, `${fileName} touch capture`).toMatchObject({
            observed: { touch: true, maxTouchPoints: 1 },
            touchHudVisible: true,
          });
        } else {
          expect(metadataIdentity.viewport, `${fileName} desktop capture`).toMatchObject({
            observed: { touch: false, maxTouchPoints: 0 },
            touchHudVisible: false,
          });
        }

        expect(evidence.gl.vendor.length, `${fileName} GL vendor`).toBeGreaterThan(0);
        expect(evidence.gl.renderer.length, `${fileName} GL renderer`).toBeGreaterThan(0);
        expect(evidence.coldStart.navigationAndBootMs, `${fileName} boot`).toBeGreaterThanOrEqual(
          evidence.coldStart.bootSettleMs,
        );
        expect(evidence.coldStart.bootSettleMs, `${fileName} boot settle`).toBeGreaterThan(0);
        expectFiniteNonNegative(evidence.coldStart.preloadWaitMs, `${fileName} preload wait`);
        expect(evidence.coldStart.preload, `${fileName} preload`).toMatchObject({
          waitMs: evidence.coldStart.preloadWaitMs,
          complete: true,
        });
        expect(evidence.coldStart.preload.tasks, `${fileName} preload tasks`).toBeGreaterThan(0);
        expect(evidence.coldStart.rendererPrewarm, `${fileName} renderer prewarm`).toMatchObject({
          timedOut: false,
          compileTimedOut: false,
          manifestFailed: 0,
          manifestTimedOut: 0,
          failedEntryIds: [],
          timedOutEntryIds: [],
        });
        expect(evidence.sample.phase, `${fileName} sample phase`).toBe('warmed');
        expect(evidence.sample.warmupMs, `${fileName} warmup`).toBeGreaterThan(0);
        expect(evidence.sample.sampleMs, `${fileName} sample duration`).toBeGreaterThan(0);
        expect(Number.isInteger(evidence.sample.repeats), `${fileName} sample repeats`).toBe(true);
        expect(evidence.sample.repeats, `${fileName} sample repeats`).toBeGreaterThan(0);
        expectFiniteRecord(evidence.initialResources, `${fileName}.initialResources`);
        expect(evidence.initialResources, `${fileName} initial context`).toMatchObject({
          contextLost: 0,
          contextRestored: 0,
        });
        expect(
          evidence.scenarios.map((scenario) => ({ name: scenario.name, view: scenario.view })),
          `${fileName} scenario contract`,
        ).toEqual(
          scenarioContracts.map((scenario) => ({
            name: scenario.name,
            view: scenario.viewName,
          })),
        );

        for (const [scenarioIndex, scenario] of evidence.scenarios.entries()) {
          const scenarioContract = scenarioContracts[scenarioIndex];
          const view = views.find((candidate) => candidate.name === scenarioContract.viewName);
          if (!view) throw new Error(`missing performance view ${scenarioContract.viewName}`);
          const label = `${fileName} ${scenario.name}`;

          expect(scenario.world, `${label} world`).toMatchObject({
            seed: EASTBROOK_ARMOURY_CAPTURE_SEED,
            player: EASTBROOK_ARMOURY_PLAYER_STATE,
            camera: view.camera,
            target: view.target,
          });
          expect(scenario.world.lot, `${label} metadata lot identity`).toEqual(
            metadataIdentity.world.lot,
          );
          expect(() => assertTownArmouryIdentity(scenario.world.lot, true)).not.toThrow();
          expect(scenario.settle.requestedMs, `${label} requested settle`).toBeGreaterThan(0);
          expectFiniteNonNegative(scenario.settle.observedMs, `${label} observed settle`);
          expect(() =>
            assertTownAttributionTargetState({
              targets: scenario.attributionTargets,
              contractId,
              requestedVisible: true,
            }),
          ).not.toThrow();
          expect(scenario.sequence[0]?.targets, `${label} initial target identity`).toEqual(
            scenario.attributionTargets,
          );
          expect(
            scenario.sequence.map((block) => ({ label: block.label, ...block.requested })),
            `${label} sampled sequence`,
          ).toEqual(sampledBlockContracts);
          expect(Object.keys(scenario.conditions).sort(), `${label} condition inventory`).toEqual(
            conditionContracts.map((condition) => condition.key).sort(),
          );

          for (const [blockIndex, block] of scenario.sequence.entries()) {
            const expectedBlock = sampledBlockContracts[blockIndex];
            if (!expectedBlock) throw new Error(`unexpected sampled block ${blockIndex}`);
            const blockLabel = `${label} ${block.label}`;
            expect(() =>
              assertTownPerformanceBlockState({
                raw: block,
                label: blockLabel,
                rootVisible: expectedBlock.rootVisible,
                shadowEnabled: expectedBlock.shadowEnabled,
                contractId,
              }),
            ).not.toThrow();
            expect(() =>
              assertTownAttributionTargetState({
                targets: block.targets,
                contractId,
                requestedVisible: expectedBlock.rootVisible,
              }),
            ).not.toThrow();
            expectSampledBlockSummary(block, profileContract, evidence.timingBasis, blockLabel);
          }

          for (const condition of conditionContracts) {
            const blocks = scenario.sequence.filter(
              (block) =>
                block.requested.rootVisible === condition.rootVisible &&
                block.requested.shadowEnabled === condition.shadowEnabled,
            );
            expectConditionSummary(
              scenario.conditions[condition.key],
              blocks,
              `${label} ${condition.key}`,
            );
          }
          const sampledDeltas = deriveTownPerformanceDeltas(scenario.conditions);
          expect(scenario.sampledDeltas, `${label} sampled deltas`).toEqual(sampledDeltas);
          for (const key of ['townWithoutShadows', 'townWithShadows'] as const) {
            expect(sampledDeltas[key].calls, `${label} sampled ${key} calls`).toBeGreaterThan(0);
            expect(
              sampledDeltas[key].triangles,
              `${label} sampled ${key} triangles`,
            ).toBeGreaterThan(0);
          }

          const direct = scenario.directRenderAttribution;
          expect(
            direct.sequence.map((block) => ({ label: block.label, ...block.requested })),
            `${label} direct sequence`,
          ).toEqual(directBlockContracts);
          expect(
            Object.keys(direct.conditions).sort(),
            `${label} direct condition inventory`,
          ).toEqual(conditionContracts.map((condition) => condition.key).sort());
          for (const [blockIndex, block] of direct.sequence.entries()) {
            const expectedBlock = directBlockContracts[blockIndex];
            if (!expectedBlock) throw new Error(`unexpected direct block ${blockIndex}`);
            const blockLabel = `${label} ${block.label}`;
            expect(() =>
              assertTownPerformanceBlockState({
                raw: block,
                label: blockLabel,
                rootVisible: expectedBlock.rootVisible,
                shadowEnabled: expectedBlock.shadowEnabled,
                contractId,
              }),
            ).not.toThrow();
            expect(() =>
              assertTownAttributionTargetState({
                targets: block.targets,
                contractId,
                requestedVisible: expectedBlock.rootVisible,
              }),
            ).not.toThrow();
            expectFiniteRecord(block.render, `${blockLabel}.render`);
          }
          for (const condition of conditionContracts) {
            const blocks = direct.sequence.filter(
              (block) =>
                block.requested.rootVisible === condition.rootVisible &&
                block.requested.shadowEnabled === condition.shadowEnabled,
            );
            expectDirectConditionSummary(
              direct.conditions[condition.key],
              blocks,
              `${label} ${condition.key}`,
            );
          }
          const directDeltas = deriveTownPerformanceDeltas(direct.conditions);
          expect(direct.deltas, `${label} direct deltas`).toEqual(directDeltas);
          expect(scenario.deltas, `${label} final deltas`).toEqual(directDeltas);
        }
      }
    }
  });

  it('pins exact WebP contact sheets, RIFF integrity, dimensions, and minimum size', () => {
    const contactsRoot = path.join(POLISH_ROOT, 'contacts');
    const expectedFiles = [
      'after-desktop-ultra-contact.webp',
      'after-mobile-low-contact.webp',
      'before-desktop-ultra-contact.webp',
      'before-mobile-low-contact.webp',
    ];
    expect(listFilesRecursive(contactsRoot, '.webp')).toEqual(expectedFiles);

    for (const prefix of ['before', 'after'] as const) {
      for (const profile of PROFILES) {
        const fileName = `${prefix}-${profile.name}-contact.webp`;
        const filePath = path.join(contactsRoot, fileName);
        const bytes = readFileSync(filePath);
        const dimensions = profile.name === 'desktop-ultra' ? [1600, 1608] : [1600, 1374];
        expect(bytes.length, filePath).toBeGreaterThan(100_000);
        expect(bytes.subarray(0, 4).toString('ascii'), filePath).toBe('RIFF');
        expect(bytes.readUInt32LE(4) + 8, filePath).toBe(bytes.length);
        expect(bytes.subarray(8, 12).toString('ascii'), filePath).toBe('WEBP');
        expect(bytes.subarray(12, 16).toString('ascii'), filePath).toBe('VP8 ');
        expect(bytes.subarray(23, 26).toString('hex'), filePath).toBe('9d012a');
        expect(bytes.readUInt16LE(26) & 0x3fff, filePath).toBe(dimensions[0]);
        expect(bytes.readUInt16LE(28) & 0x3fff, filePath).toBe(dimensions[1]);
      }
    }
  });
});
