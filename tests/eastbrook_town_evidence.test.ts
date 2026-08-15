import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';

const captureContract =
  // @ts-expect-error The executable capture contract intentionally ships as plain Node ESM.
  await import('../scripts/assets/eastbrook_grand_armoury/capture_contract.mjs');
const {
  assertTownCaptureMetadata,
  EASTBROOK_ARMOURY_CAPTURE_SEED,
  EASTBROOK_ARMOURY_PLAYER_STATE,
  EASTBROOK_TOWN_CAPTURE_PROFILES,
  EASTBROOK_TOWN_CAPTURE_SETTLE_MS,
  EASTBROOK_TOWN_CAPTURE_VIEWS,
  EASTBROOK_TOWN_PERF_SCENARIOS,
} = captureContract;

type CaptureProfile = {
  name: 'desktop-ultra' | 'mobile-low';
  tier: 'ultra' | 'low';
  viewport: { width: number; height: number; deviceScaleFactor: number };
  settings: { graphicsPreset: number };
};

type CaptureView = { name: string };
type PerfScenarioContract = { name: string; viewName: string };
type Diagnostics = {
  pageErrors: unknown[];
  consoleErrors: unknown[];
  assetFailures: unknown[];
};
type CaptureRecord = {
  output: string | null;
  schemaVersion: number;
  captureScope: string;
  renderer: { tier: string };
  viewport: { physical: { width: number; height: number } };
  observed: {
    townRoot: { drawStats: { colorDraws: number; shadowDraws: number; triangles: number } };
  };
  diagnostics: Diagnostics;
};
type CaptureMetadata = {
  schemaVersion: number;
  captureScope: string;
  shotPrefix: string;
  profile: string;
  records: CaptureRecord[];
};
type PerfCounts = { calls: number; triangles: number; lines: number; points: number };
type PerfSequenceRecord = {
  label: string;
  drawStats?: { colorDraws: number; shadowDraws: number; triangles: number };
  timingBasis: string;
  renderMedian: PerfCounts & { shadowDraws: number; cpuSubmitMs: number };
  renderWorst: PerfCounts & { shadowDraws: number; cpuSubmitMs: number };
  resourcesMedian: {
    geometries: number;
    textures: number;
    programs: number;
    heapUsedMb: number;
  };
  resourcesWorst: {
    geometries: number;
    textures: number;
    programs: number;
    heapUsedMb: number;
  };
  rafFrameInterval: {
    samples: number;
    meanMs: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
    long50: number;
  };
  rafFrameIntervalStats: {
    frames: number;
    meanMs: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
    long50: number;
    stutter100: number;
  };
  longTasks: { count: number; p95Ms: number; maxMs: number };
  rendererCpu: { worldP95Ms: number; submitP95Ms: number };
  inputToVisibleP95Ms: number | null;
  perfReportSummary: {
    programs: number;
    textures: number;
    long50: number;
    longTaskCount: number;
    longTaskP95: number;
    longTaskMax: number;
    autoGovernor: boolean;
    tier: string;
  };
  context: { lost: number; restored: number };
  assetFailures: unknown[];
};
type PerfScenario = {
  name: string;
  view: string;
  sequence: PerfSequenceRecord[];
  conditions: Record<string, unknown>;
  directRenderAttribution: {
    sequence: Array<{
      drawStats: { colorDraws: number; shadowDraws: number; triangles: number };
    }>;
    deltas: {
      townWithoutShadows: PerfCounts;
      townWithShadows: PerfCounts;
      shadowPassAttribution: PerfCounts;
    };
  } | null;
};
type PerformanceEvidence = {
  schemaVersion: number;
  captureScope: string;
  shotPrefix: string;
  profile: string;
  timingBasis: string;
  gl: { vendor: string; renderer: string };
  settings: Record<string, boolean | number>;
  coldStart: {
    navigationAndBootMs: number;
    bootSettleMs: number;
    preloadWaitMs: number;
    preload: { tasks: number; waitMs: number; complete: boolean };
    rendererPrewarm: { timedOut: boolean; compileTimedOut: boolean };
  };
  sample: { phase: string; warmupMs: number; sampleMs: number; repeats: number };
  initialResources: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
    programs: number;
    contextLost: number;
    contextRestored: number;
  };
  scenarios: PerfScenario[];
  assetFailures: unknown[];
  captureDiagnostics: Diagnostics;
};

const evidenceRoot = new URL('../docs/screenshots/eastbrook-vale-rebuild/', import.meta.url);
const phases = ['before', 'after'] as const;
const profiles = EASTBROOK_TOWN_CAPTURE_PROFILES as readonly CaptureProfile[];
const views = EASTBROOK_TOWN_CAPTURE_VIEWS as readonly CaptureView[];
const perfScenarioContracts = EASTBROOK_TOWN_PERF_SCENARIOS as readonly PerfScenarioContract[];
const PNG_SIGNATURE = '89504e470d0a1a0a';
const EXPECTED_TOWN_COLOR = { calls: 18, triangles: 29_436 };
const EXPECTED_TOWN_SHADOW = { calls: 9, triangles: 27_840 };
// The full 15-view x 2-profile Eastbrook rebuild-v1 matrix (60 images) was
// captured and accepted for rebuild v1. After the polish-v2 pass superseded
// that layout, v1 was pruned to the four matched hero views at the
// desktop-ultra profile (before and after), the eight files retained on disk
// and pinned below. The pruning only deleted files: every retained PNG's
// sha256 is byte-identical to its accepted rebuild-v1 value.
const EXPECTED_SCREENSHOT_SHA256: Readonly<Record<string, string>> = Object.freeze({
  'before/before-central-square-desktop-ultra.png':
    '51a1644ded0bc082a8f6c5753fd5aaf26bac2eeb5d83f6e9a15c02d9729e70de',
  'before/before-elevated-overview-desktop-ultra.png':
    '221696438c6497e98c3d64217c1335ee1569a576fb792eb9650eafccef52dd89',
  'before/before-gate-approach-desktop-ultra.png':
    '48f2b5608e52bdeba10b125907ef5ddf4e6af73d52cdaf902b9fc0b16f6f633d',
  'before/before-planning-top-down-desktop-ultra.png':
    'a42b55c509607130f21e9c9ec772ab72ae18d57e624c57eddfc73f495b4f2ce9',
  'after/after-central-square-desktop-ultra.png':
    '75faf659213ca14f462d0ef31e036ba659b22144c48996986cfabe7424adf7f8',
  'after/after-elevated-overview-desktop-ultra.png':
    'f95a771a28eba3edbc263d6caad068141fa6bece6271817e833f072dad1b1b40',
  'after/after-gate-approach-desktop-ultra.png':
    'db40614f6c8ec9b26fc869ffc76bac04c4b67593039b12b0323617f7db337d58',
  'after/after-planning-top-down-desktop-ultra.png':
    '9b4f26003c1078b8374a47a2e8c8309a53bc047ab0225346591571699662600d',
});
const RETAINED_VIEW_NAMES = [
  'elevated-overview',
  'central-square',
  'gate-approach',
  'planning-top-down',
] as const;
const RETAINED_PROFILE_NAME = 'desktop-ultra';

function expectedScreenshotBasename(
  phase: (typeof phases)[number],
  view: CaptureView,
  profile: CaptureProfile,
) {
  return `${phase}-${view.name}-${profile.name}.png`;
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, evidenceRoot), 'utf8')) as T;
}

function expectNoCaptureFailures(diagnostics: Diagnostics, label: string) {
  expect(diagnostics.pageErrors, `${label} page errors`).toEqual([]);
  expect(diagnostics.consoleErrors, `${label} console errors`).toEqual([]);
  expect(diagnostics.assetFailures, `${label} asset failures`).toEqual([]);
}

function expectFiniteNonNegative(value: number, label: string): void {
  expect(Number.isFinite(value), label).toBe(true);
  expect(value, label).toBeGreaterThanOrEqual(0);
}

describe('Eastbrook town committed evidence', () => {
  it('ships the retained hero screenshot matrix at native output dimensions', () => {
    // The 15-view x 2-profile matrix still lives in the capture contract, but
    // the on-disk evidence was pruned to the four matched hero views at the
    // desktop-ultra profile (see EXPECTED_SCREENSHOT_SHA256 above). Assert the
    // contract still declares the full matrix, then re-baseline the retained
    // subset against disk.
    expect(views).toHaveLength(15);
    expect(profiles.map((profile) => profile.name)).toEqual(['desktop-ultra', 'mobile-low']);

    const retainedProfile = profiles.find((profile) => profile.name === RETAINED_PROFILE_NAME);
    expect(retainedProfile, 'retained desktop-ultra profile').toBeDefined();
    const profile = retainedProfile as CaptureProfile;
    const retainedViews = RETAINED_VIEW_NAMES.map((name) => {
      const view = views.find((candidate) => candidate.name === name);
      expect(view, `retained view ${name}`).toBeDefined();
      return view as CaptureView;
    });

    const expectedRelativePaths = phases.flatMap((phase) =>
      retainedViews.map((view) => `${phase}/${expectedScreenshotBasename(phase, view, profile)}`),
    );
    const actualRelativePaths = phases.flatMap((phase) =>
      readdirSync(new URL(`${phase}/`, evidenceRoot), { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isFile() && entry.name.startsWith(`${phase}-`) && entry.name.endsWith('.png'),
        )
        .map((entry) => `${phase}/${entry.name}`),
    );

    expect(expectedRelativePaths).toHaveLength(8);
    expect([...actualRelativePaths].sort()).toEqual([...expectedRelativePaths].sort());
    expect(Object.keys(EXPECTED_SCREENSHOT_SHA256).sort()).toEqual(
      [...expectedRelativePaths].sort(),
    );

    const physicalWidth = profile.viewport.width * profile.viewport.deviceScaleFactor;
    const physicalHeight = profile.viewport.height * profile.viewport.deviceScaleFactor;
    expect(
      { width: physicalWidth, height: physicalHeight },
      `${profile.name} physical viewport`,
    ).toEqual({ width: 1600, height: 900 });

    for (const phase of phases) {
      for (const view of retainedViews) {
        const name = expectedScreenshotBasename(phase, view, profile);
        const imageUrl = new URL(`${phase}/${name}`, evidenceRoot);
        const bytes = readFileSync(imageUrl);
        expect(statSync(imageUrl).size, name).toBeGreaterThan(50_000);
        expect(bytes.subarray(0, 8).toString('hex'), name).toBe(PNG_SIGNATURE);
        expect(bytes.readUInt32BE(8), `${name} IHDR length`).toBe(13);
        expect(bytes.subarray(12, 16).toString('ascii'), `${name} IHDR type`).toBe('IHDR');
        expect(bytes.readUInt32BE(16), `${name} width`).toBe(physicalWidth);
        expect(bytes.readUInt32BE(20), `${name} height`).toBe(physicalHeight);
        expect(createHash('sha256').update(bytes).digest('hex'), `${name} identity`).toBe(
          EXPECTED_SCREENSHOT_SHA256[`${phase}/${name}`],
        );
      }
    }
  });

  it('ships four ordered metadata manifests with one clean record per canonical view', () => {
    const expectedMetadataFiles = phases.flatMap((phase) =>
      profiles.map((profile) => `${phase}-${profile.name}-town.json`),
    );
    const actualMetadataFiles = readdirSync(new URL('metadata/', evidenceRoot))
      .filter((name) => name.endsWith('.json'))
      .sort();
    expect(actualMetadataFiles).toEqual([...expectedMetadataFiles].sort());

    for (const phase of phases) {
      for (const profile of profiles) {
        const metadataName = `${phase}-${profile.name}-town.json`;
        const metadata = readJson<CaptureMetadata>(`metadata/${metadataName}`);
        expect(metadata.schemaVersion, metadataName).toBe(2);
        expect(metadata.captureScope, metadataName).toBe('town');
        expect(metadata.shotPrefix, metadataName).toBe(phase);
        expect(metadata.profile, metadataName).toBe(profile.name);
        expect(metadata.records, metadataName).toHaveLength(15);

        const expectedOutputs = views.map((view) =>
          expectedScreenshotBasename(phase, view, profile),
        );
        const observedOutputs = metadata.records.map((record, index) => {
          const label = `${metadataName} record ${index}`;
          expect(typeof record.output, `${label} output`).toBe('string');
          expect(record.output, `${label} output`).not.toBeNull();
          expect(record.schemaVersion, label).toBe(2);
          expect(record.captureScope, label).toBe('town');
          expect(record.renderer.tier, label).toBe(profile.tier);
          expect(record.viewport.physical, label).toEqual({
            width: profile.viewport.width * profile.viewport.deviceScaleFactor,
            height: profile.viewport.height * profile.viewport.deviceScaleFactor,
          });
          expectNoCaptureFailures(record.diagnostics, label);
          assertTownCaptureMetadata({
            metadata: record,
            expectedTown: phase === 'after',
            expectedArmoury: true,
            profile,
            view: views[index],
            playerState: EASTBROOK_ARMOURY_PLAYER_STATE,
            expectedSeed: EASTBROOK_ARMOURY_CAPTURE_SEED,
            settleMs: EASTBROOK_TOWN_CAPTURE_SETTLE_MS,
          });

          if (phase === 'after') {
            expect(record.observed.townRoot.drawStats, label).toMatchObject({
              colorDraws: EXPECTED_TOWN_COLOR.calls,
              shadowDraws: EXPECTED_TOWN_SHADOW.calls,
              triangles: EXPECTED_TOWN_COLOR.triangles,
            });
          }
          return basename(record.output as string);
        });
        expect(observedOutputs, metadataName).toEqual(expectedOutputs);
      }
    }
  });

  it('ships four clean schema-v2 performance captures with final direct town attribution', () => {
    const expectedPerformanceFiles = phases.flatMap((phase) =>
      profiles.map((profile) => `${phase}-${profile.name}-town.json`),
    );
    const actualPerformanceFiles = readdirSync(new URL('performance/', evidenceRoot))
      .filter((name) => name.endsWith('.json'))
      .sort();
    expect(actualPerformanceFiles).toEqual([...expectedPerformanceFiles].sort());

    const expectedScenarioNames = perfScenarioContracts.map((scenario) => scenario.name);
    const expectedScenarioViews = perfScenarioContracts.map((scenario) => scenario.viewName);
    const expectedDirectDeltas = {
      townWithoutShadows: { ...EXPECTED_TOWN_COLOR, lines: 0, points: 0 },
      townWithShadows: {
        calls: EXPECTED_TOWN_COLOR.calls + EXPECTED_TOWN_SHADOW.calls,
        triangles: EXPECTED_TOWN_COLOR.triangles + EXPECTED_TOWN_SHADOW.triangles,
        lines: 0,
        points: 0,
      },
      shadowPassAttribution: { ...EXPECTED_TOWN_SHADOW, lines: 0, points: 0 },
    };

    for (const phase of phases) {
      for (const profile of profiles) {
        const evidenceName = `${phase}-${profile.name}-town.json`;
        const evidence = readJson<PerformanceEvidence>(`performance/${evidenceName}`);
        expect(evidence.schemaVersion, evidenceName).toBe(2);
        expect(evidence.captureScope, evidenceName).toBe('town');
        expect(evidence.shotPrefix, evidenceName).toBe(phase);
        expect(evidence.profile, evidenceName).toBe(profile.name);
        expect(evidence.scenarios, evidenceName).toHaveLength(4);
        expect(
          evidence.scenarios.map((scenario) => scenario.name),
          evidenceName,
        ).toEqual(expectedScenarioNames);
        expect(
          evidence.scenarios.map((scenario) => scenario.view),
          evidenceName,
        ).toEqual(expectedScenarioViews);
        expect(evidence.initialResources.contextLost, evidenceName).toBe(0);
        expect(evidence.initialResources.contextRestored, evidenceName).toBe(0);
        expect(evidence.timingBasis, evidenceName).toBe(
          'CPU and requestAnimationFrame timing only; GPU timing was not measured',
        );
        expect(evidence.gl.vendor.length, `${evidenceName} renderer vendor`).toBeGreaterThan(0);
        expect(evidence.gl.renderer.length, `${evidenceName} renderer identity`).toBeGreaterThan(0);
        expect(evidence.settings.graphicsPreset, evidenceName).toBe(
          profile.settings.graphicsPreset,
        );
        expect(evidence.coldStart.navigationAndBootMs, evidenceName).toBeGreaterThan(0);
        expect(evidence.coldStart.bootSettleMs, evidenceName).toBe(2_000);
        expectFiniteNonNegative(evidence.coldStart.preloadWaitMs, `${evidenceName} preload wait`);
        expect(evidence.coldStart.preload.tasks, evidenceName).toBeGreaterThan(0);
        expect(evidence.coldStart.preload.complete, evidenceName).toBe(true);
        expect(evidence.coldStart.rendererPrewarm.timedOut, evidenceName).toBe(false);
        expect(evidence.coldStart.rendererPrewarm.compileTimedOut, evidenceName).toBe(false);
        expect(evidence.sample, evidenceName).toEqual({
          phase: 'warmed',
          warmupMs: 800,
          sampleMs: 2_400,
          repeats: 2,
        });
        for (const [key, value] of Object.entries(evidence.initialResources)) {
          expectFiniteNonNegative(value, `${evidenceName} initial ${key}`);
        }
        expect(evidence.assetFailures, evidenceName).toEqual([]);
        expectNoCaptureFailures(evidence.captureDiagnostics, evidenceName);

        for (const scenario of evidence.scenarios) {
          const label = `${evidenceName} ${scenario.name}`;
          const expectedSequenceLabels =
            phase === 'before'
              ? [
                  'town-baseline-total-shadow-on-1',
                  'town-baseline-total-shadow-on-2',
                  'town-baseline-total-shadow-off-1',
                  'town-baseline-total-shadow-off-2',
                ]
              : [
                  'town-visible-shadow-on-1',
                  'town-hidden-shadow-on-1',
                  'town-hidden-shadow-on-2',
                  'town-visible-shadow-on-2',
                  'town-visible-shadow-off-1',
                  'town-hidden-shadow-off-1',
                  'town-hidden-shadow-off-2',
                  'town-visible-shadow-off-2',
                ];
          expect(
            scenario.sequence.map((record) => record.label),
            `${label} repeated sequence`,
          ).toEqual(expectedSequenceLabels);
          for (const record of scenario.sequence) {
            expect(record.context, `${label} context`).toEqual({ lost: 0, restored: 0 });
            expect(record.assetFailures, `${label} asset failures`).toEqual([]);
            expect(record.timingBasis, label).toBe(evidence.timingBasis);
            expect(Object.keys(record.renderWorst).sort(), `${label} render worst schema`).toEqual([
              'calls',
              'cpuSubmitMs',
              'lines',
              'points',
              'shadowDraws',
              'triangles',
            ]);
            expect(
              Object.keys(record.resourcesWorst).sort(),
              `${label} resources worst schema`,
            ).toEqual(['geometries', 'heapUsedMb', 'programs', 'textures']);
            for (const [name, value] of Object.entries({
              callsMedian: record.renderMedian.calls,
              shadowDrawsMedian: record.renderMedian.shadowDraws,
              trianglesMedian: record.renderMedian.triangles,
              linesMedian: record.renderMedian.lines,
              pointsMedian: record.renderMedian.points,
              submitMedian: record.renderMedian.cpuSubmitMs,
              callsWorst: record.renderWorst.calls,
              shadowDrawsWorst: record.renderWorst.shadowDraws,
              trianglesWorst: record.renderWorst.triangles,
              linesWorst: record.renderWorst.lines,
              pointsWorst: record.renderWorst.points,
              submitWorst: record.renderWorst.cpuSubmitMs,
              geometriesMedian: record.resourcesMedian.geometries,
              texturesMedian: record.resourcesMedian.textures,
              programsMedian: record.resourcesMedian.programs,
              heapMedian: record.resourcesMedian.heapUsedMb,
              geometriesWorst: record.resourcesWorst.geometries,
              texturesWorst: record.resourcesWorst.textures,
              programsWorst: record.resourcesWorst.programs,
              heapWorst: record.resourcesWorst.heapUsedMb,
              rafMean: record.rafFrameInterval.meanMs,
              worldP95: record.rendererCpu.worldP95Ms,
              submitP95: record.rendererCpu.submitP95Ms,
            })) {
              expectFiniteNonNegative(value, `${label} ${record.label} ${name}`);
            }
            expect(record.renderMedian.calls, label).toBeGreaterThan(0);
            expect(record.renderMedian.triangles, label).toBeGreaterThan(0);
            expect(record.renderWorst.calls, label).toBeGreaterThan(0);
            expect(record.renderWorst.triangles, label).toBeGreaterThan(0);
            expect(record.renderWorst.calls, label).toBeGreaterThanOrEqual(
              record.renderMedian.calls,
            );
            expect(record.renderWorst.shadowDraws, label).toBeGreaterThanOrEqual(
              record.renderMedian.shadowDraws,
            );
            expect(record.renderWorst.triangles, label).toBeGreaterThanOrEqual(
              record.renderMedian.triangles,
            );
            expect(record.renderWorst.lines, label).toBeGreaterThanOrEqual(
              record.renderMedian.lines,
            );
            expect(record.renderWorst.points, label).toBeGreaterThanOrEqual(
              record.renderMedian.points,
            );
            expect(record.renderWorst.cpuSubmitMs, label).toBeGreaterThanOrEqual(
              record.renderMedian.cpuSubmitMs,
            );
            const expectedTownShadowDraws =
              phase === 'after' && record.label.includes('town-visible-shadow-on')
                ? EXPECTED_TOWN_SHADOW.calls
                : 0;
            expect(record.renderMedian.shadowDraws, label).toBe(expectedTownShadowDraws);
            expect(record.renderWorst.shadowDraws, label).toBe(expectedTownShadowDraws);
            expect(record.resourcesMedian.geometries, label).toBeGreaterThan(0);
            expect(record.resourcesMedian.textures, label).toBeGreaterThan(0);
            expect(record.resourcesMedian.programs, label).toBeGreaterThan(0);
            expect(record.resourcesMedian.heapUsedMb, label).toBeGreaterThan(0);
            expect(record.resourcesWorst.geometries, label).toBeGreaterThan(0);
            expect(record.resourcesWorst.textures, label).toBeGreaterThan(0);
            expect(record.resourcesWorst.programs, label).toBeGreaterThan(0);
            expect(record.resourcesWorst.heapUsedMb, label).toBeGreaterThan(0);
            expect(record.resourcesWorst.geometries, label).toBeGreaterThanOrEqual(
              record.resourcesMedian.geometries,
            );
            expect(record.resourcesWorst.textures, label).toBeGreaterThanOrEqual(
              record.resourcesMedian.textures,
            );
            expect(record.resourcesWorst.programs, label).toBeGreaterThanOrEqual(
              record.resourcesMedian.programs,
            );
            expect(record.resourcesWorst.heapUsedMb, label).toBeGreaterThanOrEqual(
              record.resourcesMedian.heapUsedMb,
            );
            expect(record.rafFrameInterval.samples, label).toBeGreaterThanOrEqual(200);
            expect(record.rafFrameInterval.meanMs, label).toBeGreaterThan(0);
            expect(record.rafFrameInterval.meanMs, label).toBe(record.rafFrameIntervalStats.meanMs);
            expect(record.rafFrameInterval.meanMs, label).toBeLessThanOrEqual(
              record.rafFrameInterval.p95Ms,
            );
            expect(record.rafFrameIntervalStats.frames, label).toBe(
              record.rafFrameInterval.samples,
            );
            expect(record.rafFrameInterval.p95Ms, label).toBeLessThanOrEqual(
              record.rafFrameInterval.p99Ms,
            );
            expect(record.rafFrameInterval.p99Ms, label).toBeLessThanOrEqual(
              record.rafFrameInterval.maxMs,
            );
            expect(record.rafFrameInterval.long50, label).toBe(0);
            expect(record.rafFrameIntervalStats.long50, label).toBe(0);
            expect(record.rafFrameIntervalStats.stutter100, label).toBe(0);
            expect(record.longTasks, label).toEqual({ count: 0, p95Ms: 0, maxMs: 0 });
            expect(record, label).toHaveProperty('inputToVisibleP95Ms');
            expect(
              record.inputToVisibleP95Ms === null || record.inputToVisibleP95Ms >= 0,
              `${label} input latency`,
            ).toBe(true);
            expect(record.perfReportSummary.long50, label).toBe(0);
            expect(record.perfReportSummary.longTaskCount, label).toBe(0);
            expect(record.perfReportSummary.longTaskP95, label).toBe(0);
            expect(record.perfReportSummary.longTaskMax, label).toBe(0);
            expect(record.perfReportSummary.autoGovernor, label).toBe(false);
            expect(record.perfReportSummary.tier, label).toBe(profile.tier);
          }

          if (phase === 'before') {
            expect(Object.keys(scenario.conditions), label).toEqual([
              'baselineTotalShadowOn',
              'baselineTotalShadowOff',
            ]);
            expect(scenario.directRenderAttribution, label).toBeNull();
            continue;
          }

          expect(Object.keys(scenario.conditions), label).toEqual([
            'visibleShadowOn',
            'hiddenShadowOn',
            'visibleShadowOff',
            'hiddenShadowOff',
          ]);
          expect(scenario.directRenderAttribution, label).not.toBeNull();
          expect(scenario.directRenderAttribution?.deltas, label).toEqual(expectedDirectDeltas);
          expect(scenario.directRenderAttribution?.sequence, label).toHaveLength(8);
          for (const record of scenario.directRenderAttribution?.sequence ?? []) {
            expect(record.drawStats, label).toMatchObject({
              colorDraws: EXPECTED_TOWN_COLOR.calls,
              shadowDraws: EXPECTED_TOWN_SHADOW.calls,
              triangles: EXPECTED_TOWN_COLOR.triangles,
            });
          }
        }
      }
    }
  });
});
