import { describe, expect, it } from 'vitest';
import {
  areComparable,
  COMPARABILITY_KEYS,
  cacheKeyVariance,
  comparabilityMismatches,
  countEventsInWindow,
  GPU_HITCH_SCHEMA_VERSION,
  linksBeforeQuery,
  measurementParams,
  reflectionAttribution,
  SOFTWARE_RENDERER_PATTERN,
  sanitizeCaptureUrl,
  summarizeCapture,
  uploadBucketsBeforeQuery,
  validateCapture,
  variantDiffParameter,
} from '../scripts/profiler/gpu_hitch_metrics.mjs';
import { SOFTWARE_RENDERER_PATTERN as CANONICAL_SOFTWARE_RENDERER_PATTERN } from '../src/render/software_renderer';

function capture(overrides = {}) {
  return {
    schemaVersion: GPU_HITCH_SCHEMA_VERSION,
    capture: { complete: true, profile: 'shader', scenario: 'offline-entry' },
    provenance: {
      gitHead: 'abc123',
      sourceBuildId: 'source',
      servedBuildId: 'served',
      probeSha256: 'probe',
      analyzerSha256: 'analyzer',
      worktreeName: 'test',
    },
    requested: {
      linkmode: null,
      linkrate: null,
      linkburst: null,
      compileroots: null,
      prewarmdeadline: null,
      modular: null,
      modularpeers: null,
      gfx: 'ultra',
    },
    effective: {
      schemaVersion: GPU_HITCH_SCHEMA_VERSION,
      prewarmPacing: { available: false },
      modular: { available: false },
    },
    environment: {
      browserVersion: 'Chrome/test',
      browserFlags: ['--enable-gpu'],
      shaderDiskCache: 'disabled',
      glVendor: 'vendor',
      glRenderer: 'renderer',
      viewport: '1600x900',
      devicePixelRatio: 1,
      visible: true,
      visibilityTransitions: [{ atMs: 0, state: 'visible' }],
      contextLost: 0,
    },
    timeline: {
      phases: [],
      links: [],
      queries: [],
      programs: [],
      sceneRoots: [],
      compileUnits: [],
      uploadBucketWidthMs: 100,
      uploadBuckets: [],
    },
    ...overrides,
  };
}

describe('gpu hitch metrics', () => {
  it('keeps only allowlisted query parameters and drops credentials', () => {
    expect(measurementParams('?perf&linkrate=24&modularpeers=off&token=secret')).toMatchObject({
      linkrate: 24,
      modularpeers: 'off',
    });
    expect(measurementParams('?gfx=unsafe&modular=1')).toMatchObject({ gfx: null, modular: null });
    expect(
      sanitizeCaptureUrl(
        'https://example.test/private/secret?gfx=ultra&modular=off&token=secret#private',
      ),
    ).toBe('https://example.test/?modular=off&gfx=ultra');
    expect(
      sanitizeCaptureUrl('https://example.test/private/secret?gfx=evil&modular=<script>#private'),
    ).toBe('https://example.test/');
    expect(sanitizeCaptureUrl('https://example.test/?linkrate=24&token=secret#private')).toBe(
      'https://example.test/?linkrate=24',
    );
    expect(sanitizeCaptureUrl('https://example.test/?linkmode=adaptive&token=secret')).toBe(
      'https://example.test/?linkmode=adaptive',
    );
  });

  it('attributes links to the half-open window ending at query start', () => {
    const links = [{ startMs: 1_999 }, { startMs: 2_000 }, { startMs: 9_999 }, { startMs: 10_000 }];
    expect(countEventsInWindow(links, 2_000, 10_000)).toBe(2);
    expect(linksBeforeQuery({ startMs: 10_000 }, links, 8_000)).toEqual({
      startMs: 2_000,
      endMs: 10_000,
      count: 2,
    });
  });

  it('returns certain and possible bounds for partial upload buckets', () => {
    const result = uploadBucketsBeforeQuery(
      { startMs: 1_050 },
      [
        { startMs: 200, count: 10, bytes: 100, unsized: 1 },
        { startMs: 300, count: 20, bytes: 200, unsized: 0 },
        { startMs: 900, count: 30, bytes: 300, unsized: 2 },
        { startMs: 1_000, count: 40, bytes: 400, unsized: 5 },
      ],
      800,
      100,
    );
    expect(result).toMatchObject({ startMs: 250, endMs: 1_050, certain: 50, possible: 100 });
    // An upload the estimator could not size contributes no bytes, so the byte
    // totals are only readable next to how many uploads they leave out.
    expect(result).toMatchObject({
      bytesCertain: 500,
      bytesPossible: 1_000,
      unsizedCertain: 2,
      unsizedPossible: 8,
    });
  });

  it('rejects an effective pacing mismatch instead of accepting a silent no-op', () => {
    const raw = capture({ requested: { ...capture().requested, linkrate: 24 } });
    const result = validateCapture(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('linkrate was requested but link pacing is unavailable');
  });

  it('rejects malformed query intervals and hidden or lost-context captures', () => {
    const raw = capture({
      environment: {
        ...capture().environment,
        visible: false,
        contextLost: 1,
        visibilityTransitions: [
          { atMs: 0, state: 'visible' },
          { atMs: 10, state: 'hidden' },
          { atMs: 20, state: 'visible' },
        ],
      },
      timeline: {
        ...capture().timeline,
        queries: [{ startMs: 20, endMs: 10, durationMs: -10 }],
      },
    });
    const result = validateCapture(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'timeline.queries[0].endMs precedes startMs',
        'WebGL context was lost',
        'capture page became hidden',
      ]),
    );
  });

  it('summarizes query kinds and exact pre-query link pressure', () => {
    const raw = capture({
      timeline: {
        ...capture().timeline,
        links: [
          { startMs: 1_000, endMs: 1_001, lane: 'submit-sync' },
          { startMs: 1_500, endMs: 1_501, lane: 'submit-sync' },
          { startMs: 3_000, endMs: 3_001, lane: 'first-draw' },
        ],
        queries: [
          {
            kind: 'completion-status',
            startMs: 2_000,
            endMs: 2_500,
            durationMs: 500,
            value: false,
          },
          {
            kind: 'active-attributes',
            startMs: 3_000,
            endMs: 3_100,
            durationMs: 100,
            value: 12,
          },
        ],
        compileUnits: [
          {
            id: 'scene:0',
            lane: 'programs.compile-submit',
            submittedAtMs: 100,
            syncEndAtMs: 110,
            settledAtMs: null,
            failedAtMs: null,
            statusAtReveal: 'pending',
          },
        ],
      },
    });
    const summary = summarizeCapture(raw, { slowMs: 100, windowMs: 2_000 });
    expect(summary.linksTotal).toBe(3);
    expect(summary.queriesByKind['active-attributes']).toMatchObject({ calls: 1, maxMs: 100 });
    expect(summary.slowQueries[0].linksBefore.count).toBe(2);
    expect(summary.compileUnitsAtReveal).toEqual({ pending: 1 });
  });

  it('rejects an impossible compile-unit lifecycle', () => {
    const raw = capture({
      timeline: {
        ...capture().timeline,
        compileUnits: [
          {
            id: 'scene:0',
            lane: 'programs.compile',
            submittedAtMs: 20,
            syncEndAtMs: 10,
            settledAtMs: null,
            failedAtMs: null,
            statusAtReveal: 'pending',
          },
        ],
      },
    });
    const result = validateCapture(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('timeline.compileUnits[0].syncEndAtMs precedes submittedAtMs');
  });

  it('refuses A/B legs with different probe, GPU, or viewport evidence', () => {
    const left = capture();
    const right = capture({
      provenance: { ...left.provenance, probeSha256: 'different' },
      environment: { ...left.environment, glRenderer: 'other-renderer' },
    });
    expect(areComparable(left, right)).toBe(false);
    expect(comparabilityMismatches(left, right)).toEqual(['probeSha256', 'glRenderer']);
  });

  // The base for the mutation cases below carries a REAL value for EVERY
  // dimension, unlike the plain fixture: with a field absent, a case only
  // exercises absent-against-present, which a comparator degraded to a presence
  // test would still pass while two legs at linkburst 4 and 8 compared as a
  // valid A/B pair. Every mutation below is therefore value-against-value.
  // Kept separate from capture() so the fallback-chain cases above, which
  // deliberately supply zone from a different surface, keep working.
  const comparabilityBase = (overrides = {}) =>
    capture({
      capture: {
        ...capture().capture,
        zone: 'eastbrook_vale',
        observer: { x: 120, z: -40 },
        groupId: 'linkrate-v38-a1',
        fixture: { kind: 'geared-arrival-v1', count: 20 },
        durationMs: 90_000,
      },
      requested: {
        linkmode: 'fixed',
        linkrate: 12,
        linkburst: 4,
        compileroots: 8,
        prewarmdeadline: 9_000,
        modular: 'on',
        modularpeers: 'on',
        gfx: 'ultra',
      },
      // A stated requested knob nulls its own effective readback for the
      // comparison (the request already carries that dimension), so the two
      // effective blocks are mutated on a field that is always compared.
      effective: {
        schemaVersion: GPU_HITCH_SCHEMA_VERSION,
        prewarmPacing: {
          available: true,
          mode: 'compile-unit-sync-prologue',
          linksPerSecond: 12,
          burst: 4,
          compileBatchRoots: 8,
          hardMaxMs: 9_000,
          scope: 'self',
          reason: 'query',
        },
        modular: { available: true, self: 'on', peers: 'on', reason: 'query' },
        renderer: { tier: 'ultra' },
      },
      ...overrides,
    });

  // One mutation per comparability dimension, spelled out rather than derived
  // from COMPARABILITY_KEYS: the two lists are diffed below, so a dimension
  // dropped from the analyzer cannot quietly drop its own case here too.
  // Refusing a drifted A/B pair is a headline claim of this workflow, and
  // without these most of the list could be deleted with nothing going red.
  const COMPARABILITY_MUTATIONS = {
    sourceBuildId: (base) => ({ provenance: { ...base.provenance, sourceBuildId: 'other' } }),
    servedBuildId: (base) => ({ provenance: { ...base.provenance, servedBuildId: 'other' } }),
    probeSha256: (base) => ({ provenance: { ...base.provenance, probeSha256: 'other' } }),
    analyzerSha256: (base) => ({ provenance: { ...base.provenance, analyzerSha256: 'other' } }),
    schemaVersion: () => ({ schemaVersion: GPU_HITCH_SCHEMA_VERSION + 1 }),
    profile: (base) => ({ capture: { ...base.capture, profile: 'entry' } }),
    browserVersion: (base) => ({
      environment: { ...base.environment, browserVersion: 'Chrome/9' },
    }),
    browserFlags: (base) => ({ environment: { ...base.environment, browserFlags: ['--other'] } }),
    shaderDiskCache: (base) => ({
      environment: { ...base.environment, shaderDiskCache: 'enabled' },
    }),
    glVendor: (base) => ({ environment: { ...base.environment, glVendor: 'other-vendor' } }),
    glRenderer: (base) => ({ environment: { ...base.environment, glRenderer: 'other-renderer' } }),
    viewport: (base) => ({ environment: { ...base.environment, viewport: '2560x1440' } }),
    devicePixelRatio: (base) => ({ environment: { ...base.environment, devicePixelRatio: 2 } }),
    gfx: (base) => ({ requested: { ...base.requested, gfx: 'high' } }),
    scenario: (base) => ({ capture: { ...base.capture, scenario: 'online-geared-entry' } }),
    zone: (base) => ({ capture: { ...base.capture, zone: 'fenbridge' } }),
    observer: (base) => ({ capture: { ...base.capture, observer: { x: 900, z: 1_400 } } }),
    groupId: (base) => ({ capture: { ...base.capture, groupId: 'linkrate-v38-b2' } }),
    fixture: (base) => ({
      capture: { ...base.capture, fixture: { kind: 'geared-arrival-v1', count: 8 } },
    }),
    durationMs: (base) => ({ capture: { ...base.capture, durationMs: 180_000 } }),
    'requested.linkmode': (base) => ({ requested: { ...base.requested, linkmode: 'adaptive' } }),
    'requested.linkrate': (base) => ({ requested: { ...base.requested, linkrate: 24 } }),
    'requested.linkburst': (base) => ({ requested: { ...base.requested, linkburst: 8 } }),
    'requested.compileroots': (base) => ({ requested: { ...base.requested, compileroots: 16 } }),
    'requested.prewarmdeadline': (base) => ({
      requested: { ...base.requested, prewarmdeadline: 15_000 },
    }),
    'requested.modular': (base) => ({ requested: { ...base.requested, modular: 'off' } }),
    'requested.modularpeers': (base) => ({ requested: { ...base.requested, modularpeers: 'off' } }),
    'effective.prewarmPacing': (base) => ({
      effective: {
        ...base.effective,
        prewarmPacing: { ...base.effective.prewarmPacing, reason: 'default' },
      },
    }),
    'effective.modular': (base) => ({
      effective: {
        ...base.effective,
        modular: { ...base.effective.modular, reason: 'unsupported' },
      },
    }),
    rendererTier: (base) => ({ effective: { ...base.effective, renderer: { tier: 'low' } } }),
  };

  it('covers every comparability dimension with a mutation case', () => {
    expect([...COMPARABILITY_KEYS]).toEqual(Object.keys(COMPARABILITY_MUTATIONS));
  });

  /** Every leaf that differs between two captures, as `path: [left, right]`.
   *  Arrays recurse by index rather than being compared whole, so an element
   *  going absent inside one reads as the absent value it is. */
  function changedLeaves(left, right, path = '') {
    const bothArrays = Array.isArray(left) && Array.isArray(right);
    if (bothArrays) {
      const changed = {};
      for (let index = 0; index < Math.max(left.length, right.length); index++) {
        Object.assign(changed, changedLeaves(left[index], right[index], `${path}[${index}]`));
      }
      return changed;
    }
    if (
      left === null ||
      right === null ||
      typeof left !== 'object' ||
      typeof right !== 'object' ||
      Array.isArray(left) ||
      Array.isArray(right)
    ) {
      return JSON.stringify(left) === JSON.stringify(right) ? {} : { [path]: [left, right] };
    }
    const changed = {};
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      Object.assign(changed, changedLeaves(left[key], right[key], path ? `${path}.${key}` : key));
    }
    return changed;
  }

  /** Every leaf of a capture, as `path: value`. */
  function leavesOf(value, path = '') {
    if (value === null || typeof value !== 'object') return { [path]: value };
    const leaves = {};
    for (const [key, child] of Object.entries(value)) {
      Object.assign(leaves, leavesOf(child, path ? `${path}.${key}` : key));
    }
    return leaves;
  }

  it('states a real value on every leg field, so no mutation starts from absent', () => {
    // The base itself, checked directly rather than only through the leaves a
    // mutation happens to touch: the two effective blocks are mutated on one
    // field each, so reverting any of their OTHER fields to null would slip
    // past the per-mutation check below while quietly returning those
    // dimensions to absent-against-present.
    for (const [path, value] of Object.entries(leavesOf(comparabilityBase()))) {
      expect(value ?? null, `${path} is absent in the comparability base`).not.toBeNull();
    }
  });

  it('mutates every dimension from one stated value to another, never from absent', () => {
    // The teeth behind the case list below. A base leaving a knob null makes a
    // case prove only that the comparator notices absent-against-present, which
    // a comparator degraded to a presence check passes: two legs at linkburst 4
    // and 8 would then compare as a valid A/B pair. Read from the captures
    // themselves rather than from a second copy of the analyzer's key mapping.
    for (const [key, mutate] of Object.entries(COMPARABILITY_MUTATIONS)) {
      const left = comparabilityBase();
      const right = comparabilityBase(mutate(left));
      const changed = changedLeaves(left, right);
      expect(Object.keys(changed), `${key} mutated nothing`).not.toHaveLength(0);
      for (const [path, [before, after]] of Object.entries(changed)) {
        expect(before ?? null, `${key} mutates ${path} from an absent value`).not.toBeNull();
        expect(after ?? null, `${key} mutates ${path} to an absent value`).not.toBeNull();
      }
    }
  });

  it.each(Object.keys(COMPARABILITY_MUTATIONS))(
    'refuses an A/B pair that drifted on %s and nothing else',
    (key) => {
      const left = comparabilityBase();
      const right = comparabilityBase(COMPARABILITY_MUTATIONS[key](left));
      // A leg is always its own control, so a comparator that just returned the
      // whole key list could not pass this pair of assertions.
      expect(comparabilityMismatches(left, left)).toEqual([]);
      expect(comparabilityMismatches(left, right)).toEqual([key]);
      expect(areComparable(left, right)).toBe(false);
    },
  );

  it('requires an explicit varying knob for an A/B difference', () => {
    const left = capture({
      requested: { ...capture().requested, linkrate: 0 },
      effective: {
        ...capture().effective,
        prewarmPacing: {
          available: true,
          mode: 'unlimited',
          linksPerSecond: null,
          burst: 8,
          compileBatchRoots: 16,
          hardMaxMs: 15_000,
          scope: 'compile-unit-sync-prologue',
        },
      },
    });
    const right = capture({
      requested: { ...capture().requested, linkrate: 24 },
      effective: {
        ...capture().effective,
        prewarmPacing: {
          available: true,
          mode: 'limited',
          linksPerSecond: 24,
          burst: 8,
          compileBatchRoots: 16,
          hardMaxMs: 15_000,
          scope: 'compile-unit-sync-prologue',
        },
      },
    });
    expect(areComparable(left, right)).toBe(false);
    expect(areComparable(left, right, { varying: ['linkrate'] })).toBe(true);
  });

  it('validates and compares adaptive pacing without treating feedback as configuration', () => {
    const control = capture({
      requested: { ...capture().requested, linkmode: null, linkrate: 0 },
      effective: {
        ...capture().effective,
        prewarmPacing: {
          available: true,
          mode: 'unlimited',
          linksPerSecond: null,
          burst: 8,
          compileBatchRoots: 16,
          hardMaxMs: 15_000,
          scope: 'compile-unit-sync-prologue',
        },
      },
    });
    const adaptive = capture({
      requested: { ...capture().requested, linkmode: 'adaptive' },
      effective: {
        ...capture().effective,
        prewarmPacing: {
          available: true,
          mode: 'adaptive',
          linksPerSecond: null,
          burst: null,
          compileBatchRoots: 16,
          hardMaxMs: 15_000,
          scope: 'compile-unit-lifecycle',
          adaptive: { state: 'revealed', windowLinks: 24, settledUnits: 18 },
        },
      },
    });

    expect(validateCapture(adaptive).valid).toBe(true);
    expect(areComparable(control, adaptive)).toBe(false);
    expect(areComparable(control, adaptive, { varying: ['linkmode'] })).toBe(false);
    expect(areComparable(control, adaptive, { varying: ['linkrate', 'linkmode'] })).toBe(true);

    const anotherAdaptive = structuredClone(adaptive);
    anotherAdaptive.effective.prewarmPacing.adaptive = {
      state: 'revealed',
      windowLinks: 16,
      settledUnits: 9,
    };
    expect(areComparable(adaptive, anotherAdaptive)).toBe(true);
  });

  it('requires complete campaign metadata and the same group for comparable legs', () => {
    const incomplete = capture({
      capture: { ...capture().capture, groupId: 'campaign-a' },
    });
    expect(validateCapture(incomplete).errors).toContain('capture.leg is missing');

    const left = capture({
      capture: {
        ...capture().capture,
        groupId: 'campaign-a',
        leg: 'control',
        repetition: 1,
        order: 1,
      },
    });
    const right = capture({
      capture: {
        ...capture().capture,
        groupId: 'campaign-b',
        leg: 'limited',
        repetition: 1,
        order: 2,
      },
    });
    expect(comparabilityMismatches(left, right)).toContain('groupId');
  });

  it('refuses nominally identical scenarios with different fixture evidence', () => {
    const left = capture({
      capture: { ...capture().capture, fixture: { kind: 'geared-arrival-v1', count: 4 } },
    });
    const right = capture({
      capture: { ...capture().capture, fixture: { kind: 'geared-arrival-v1', count: 20 } },
    });
    expect(comparabilityMismatches(left, right)).toContain('fixture');
  });

  it('compares capture duration and effective renderer tier', () => {
    const left = capture({
      capture: { ...capture().capture, durationMs: 1_000 },
      effective: { ...capture().effective, renderer: { tier: 'ultra' } },
    });
    const right = capture({
      capture: { ...capture().capture, durationMs: 900 },
      effective: { ...capture().effective, renderer: { tier: 'high' } },
    });
    expect(comparabilityMismatches(left, right)).toEqual(
      expect.arrayContaining(['durationMs', 'rendererTier']),
    );
  });

  it('uses contractual duration for A/B comparison while retaining total probe elapsed time', () => {
    const left = capture({
      capture: { ...capture().capture, durationMs: 180_000, totalElapsedMs: 180_347 },
    });
    const right = capture({
      capture: { ...capture().capture, durationMs: 180_000, totalElapsedMs: 181_106 },
    });

    expect(validateCapture(left).valid).toBe(true);
    expect(validateCapture(right).valid).toBe(true);
    expect(comparabilityMismatches(left, right)).not.toContain('durationMs');
    expect(areComparable(left, right)).toBe(true);
  });

  it('validates total probe elapsed time when present', () => {
    const raw = capture({
      capture: { ...capture().capture, durationMs: 180_000, totalElapsedMs: 179_999 },
    });
    const result = validateCapture(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('capture.totalElapsedMs precedes durationMs');
  });

  it('compares an available zone regardless of which capture surface supplied it', () => {
    const left = capture({
      environment: { ...capture().environment, zone: 'eastbrook_vale' },
    });
    const right = capture({
      environment: { ...capture().environment, zone: 'thornhollow_fields' },
    });
    expect(comparabilityMismatches(left, right)).toContain('zone');
  });

  it('keeps headless SwiftShader captures as smoke artifacts, never performance evidence', () => {
    const raw = capture({
      capture: { ...capture().capture, headless: true },
      environment: {
        ...capture().environment,
        browserFlags: ['--headless=new'],
        glRenderer: 'ANGLE (Google, SwiftShader Device (Subzero))',
      },
    });
    const smoke = validateCapture(raw);
    expect(smoke.valid).toBe(true);
    expect(smoke.performanceEvidence).toBe(false);
    expect(smoke.evidenceKind).toBe('smoke');
    expect(smoke.warnings).toEqual(
      expect.arrayContaining([
        'headless capture is smoke-only and cannot be used as performance evidence',
        'SwiftShader software renderer is smoke-only and cannot be used as performance evidence',
      ]),
    );

    const performance = validateCapture(raw, { performanceEvidence: true });
    expect(performance.valid).toBe(false);
    expect(performance.errors).toEqual(
      expect.arrayContaining([
        'headless capture cannot be used as performance evidence',
        'SwiftShader software renderer cannot be used as performance evidence',
      ]),
    );
  });

  it('refuses a WARP or llvmpipe capture through the generic software arm', () => {
    // The SwiftShader case above has its own named arm; this is the OTHER one,
    // which had no coverage at all. WARP is the live hazard: Chromium 141
    // dropped the SwiftShader WebGL fallback, so a Windows machine with no
    // usable GPU now reports "Microsoft Basic Render Driver" instead.
    for (const glRenderer of [
      'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)',
      'Mesa/X.org llvmpipe (LLVM 15.0.6, 256 bits)',
      'Mesa softpipe',
      'Generic Software Renderer',
    ]) {
      const raw = capture({ environment: { ...capture().environment, glRenderer } });
      const smoke = validateCapture(raw);
      expect(smoke.valid).toBe(true);
      expect(smoke.evidenceKind).toBe('smoke');
      expect(smoke.warnings).toContain(
        'software renderer is smoke-only and cannot be used as performance evidence',
      );

      const performance = validateCapture(raw, { performanceEvidence: true });
      expect(performance.valid).toBe(false);
      expect(performance.errors).toContain(
        'software renderer cannot be used as performance evidence',
      );
    }
  });

  it('reads software rasterizers with the repo-wide adapter pattern', () => {
    // The analyzer is plain Node and cannot import the TS source of truth, so
    // the two are pinned here. They drifted once already, and the drift is
    // silent: a software capture simply passes as performance evidence.
    expect(SOFTWARE_RENDERER_PATTERN.source).toBe(CANONICAL_SOFTWARE_RENDERER_PATTERN.source);
    expect(SOFTWARE_RENDERER_PATTERN.flags).toBe(CANONICAL_SOFTWARE_RENDERER_PATTERN.flags);
  });

  it('labels a visible hardware capture as performance evidence', () => {
    const result = validateCapture(capture());
    expect(result).toMatchObject({
      valid: true,
      performanceEvidence: true,
      evidenceKind: 'performance',
    });
    expect(result.warnings).toEqual([]);
  });

  it('refuses two legs captured at different world spots', () => {
    // A different town streams different content, so a leg elsewhere is not a
    // control however well the rest of the protocol matches.
    const left = capture({ capture: { ...capture().capture, observer: { x: 0, z: 0 } } });
    const right = capture({ capture: { ...capture().capture, observer: { x: 0, z: 660 } } });
    expect(comparabilityMismatches(left, right)).toEqual(['observer']);
    expect(areComparable(left, left)).toBe(true);
  });

  it('rejects an artifact from the previous schema by name instead of reading it', () => {
    const result = validateCapture(capture({ schemaVersion: 1 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('capture schemaVersion 1 is not the supported version 4');
  });

  it('refuses a program row that carries a raw cache key or a duplicate ordinal', () => {
    const raw = capture({
      timeline: {
        ...capture().timeline,
        programs: [
          {
            programId: 1,
            cacheKeyHash: 'deadbeef',
            materialType: 'Mesh',
            materialName: '',
            variantDiff: null,
          },
          {
            programId: 1,
            cacheKeyHash: 'lights,fog,customProgramCacheKey',
            materialType: 'Mesh',
            materialName: '',
            variantDiff: null,
          },
        ],
      },
    });
    const result = validateCapture(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'timeline.programs[1].programId is duplicated',
        'timeline.programs[1].cacheKeyHash must be an 8 character hex digest',
      ]),
    );
  });

  it('refuses a completion status without its boolean return value', () => {
    const raw = capture({
      timeline: {
        ...capture().timeline,
        queries: [{ kind: 'completion-status', startMs: 1, endMs: 2, durationMs: 1 }],
      },
    });
    const result = validateCapture(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'timeline.queries[0].value must be the boolean completion status',
    );
  });
});

describe('gpu hitch reflection attribution', () => {
  const reflect = (programId, startMs, durationMs) => ({
    kind: 'active-uniforms',
    programId,
    startMs,
    endMs: startMs + durationMs,
    durationMs,
    value: 100,
    phaseAtStart: 'live',
  });
  const poll = (programId, startMs, value) => ({
    kind: 'completion-status',
    programId,
    startMs,
    endMs: startMs,
    durationMs: 0,
    value,
    phaseAtStart: 'live',
  });

  it('separates a link never submitted to compileAsync from one drawn before it settled', () => {
    const attribution = reflectionAttribution({
      timeline: {
        phases: [{ event: 'reveal', atMs: 500 }],
        links: [],
        programs: [],
        queries: [
          // Never polled at all: the draw both linked and reflected.
          reflect(1, 1_000, 200),
          // Polled and still pending when the draw reached it.
          poll(2, 900, false),
          reflect(2, 1_000, 120),
          // Polled ready before the draw: this is reflection itself.
          poll(3, 800, false),
          poll(3, 900, true),
          reflect(3, 1_000, 0.4),
        ],
      },
    });
    expect(attribution.families['never-compiled'].live).toMatchObject({
      calls: 1,
      totalMs: 200,
      maxMs: 200,
      programs: 1,
    });
    expect(attribution.families['raced-pending-link'].live).toMatchObject({
      calls: 1,
      totalMs: 120,
    });
    expect(attribution.families['settled-first'].live).toMatchObject({
      calls: 1,
      totalMs: 0.4,
    });
  });

  it('does not credit a poll that only reported ready after the reflection query', () => {
    const attribution = reflectionAttribution({
      timeline: {
        phases: [],
        links: [],
        programs: [],
        queries: [poll(1, 900, false), reflect(1, 1_000, 90), poll(1, 1_100, true)],
      },
    });
    expect(attribution.families['raced-pending-link'].all.calls).toBe(1);
    expect(attribution.families['settled-first'].all.calls).toBe(0);
  });

  it('keeps a settled program settled when a later poll re-reports it', () => {
    const attribution = reflectionAttribution({
      timeline: {
        phases: [],
        links: [],
        programs: [],
        queries: [poll(1, 800, true), reflect(1, 1_000, 0.2), poll(1, 1_200, true)],
      },
    });
    expect(attribution.families['settled-first'].all.calls).toBe(1);
    expect(attribution.families['raced-pending-link'].all.calls).toBe(0);
  });

  it('counts a program drawn before its first poll as raced, not never-compiled', () => {
    // WebGLProgram.isReady is the only COMPLETION_STATUS_KHR caller in three
    // r165 and only the compileAsync poll pass calls it, so a poll that starts
    // after the query still proves the program was submitted: it was drawn in
    // the same frame it was submitted, before that first poll. Calling it
    // never-compiled overstates the family the A/B verdict keys on.
    const attribution = reflectionAttribution({
      timeline: {
        phases: [],
        links: [],
        programs: [],
        queries: [reflect(1, 1_000, 150), poll(1, 1_000, true)],
      },
    });
    expect(attribution.families['raced-pending-link'].all.calls).toBe(1);
    expect(attribution.families['never-compiled'].all.calls).toBe(0);
  });

  it('keeps never-compiled for a program with no completion poll at all', () => {
    const attribution = reflectionAttribution({
      timeline: {
        phases: [],
        links: [],
        programs: [],
        queries: [reflect(1, 1_000, 150)],
      },
    });
    expect(attribution.families['never-compiled'].all.calls).toBe(1);
    expect(attribution.families['raced-pending-link'].all.calls).toBe(0);
    // ...and says how many programs were polled AT ALL, because a capture on a
    // context without KHR_parallel_shader_compile never polls and would put
    // every program in this family for a reason that is not about compilation.
    expect(attribution.polledPrograms).toBe(0);
  });

  it('reports how many programs were polled, so a zero is readable as a zero', () => {
    const attribution = reflectionAttribution({
      timeline: {
        phases: [],
        links: [],
        programs: [],
        queries: [poll(1, 900, false), reflect(1, 1_000, 90), poll(2, 1_100, true)],
      },
    });
    expect(attribution.polledPrograms).toBe(2);
  });

  it('splits live links into a variant prewarm already built and one it never built', () => {
    const attribution = reflectionAttribution({
      timeline: {
        phases: [{ event: 'reveal', atMs: 500 }],
        links: [
          { programId: 1, startMs: 100, endMs: 100, lane: 'submit-sync', phaseAtStart: 'cover' },
          { programId: 2, startMs: 600, endMs: 600, lane: 'first-draw', phaseAtStart: 'live' },
          { programId: 3, startMs: 700, endMs: 700, lane: 'first-draw', phaseAtStart: 'live' },
          { programId: 4, startMs: 800, endMs: 800, lane: 'first-draw', phaseAtStart: 'live' },
        ],
        programs: [
          {
            programId: 1,
            cacheKeyHash: 'aaaaaaaa',
            materialType: 'Mesh',
            materialName: '',
            variantDiff: null,
          },
          // Same key as a program already linked under the curtain.
          {
            programId: 2,
            cacheKeyHash: 'aaaaaaaa',
            materialType: 'Mesh',
            materialName: '',
            variantDiff: null,
          },
          {
            programId: 3,
            cacheKeyHash: 'bbbbbbbb',
            materialType: 'Mesh',
            materialName: '',
            variantDiff: null,
          },
        ],
        queries: [],
      },
    });
    expect(attribution).toMatchObject({
      revealAtMs: 500,
      linksCover: 1,
      linksLive: 3,
      liveLinkedKnownKey: 1,
      liveLinkedNewKey: 1,
      liveLinkedUnattributed: 1,
    });
  });

  it('carries the three identity and draw context onto the costliest rows', () => {
    const attribution = reflectionAttribution({
      timeline: {
        phases: [],
        links: [
          { programId: 1, startMs: 999.9, endMs: 1_000, lane: 'first-draw', phaseAtStart: 'live' },
        ],
        programs: [
          {
            programId: 1,
            cacheKeyHash: 'abcd1234',
            materialType: 'MeshStandardMaterial',
            materialName: 'bark',
            variantDiff: null,
          },
        ],
        queries: [
          {
            ...reflect(1, 1_000, 210.8),
            draw: { objectType: 'SkinnedMesh', shadowPass: false, rootIndex: 4 },
          },
        ],
      },
    });
    expect(attribution.rows[0]).toMatchObject({
      programId: 1,
      family: 'never-compiled',
      materialType: 'MeshStandardMaterial',
      materialName: 'bark',
      cacheKeyHash: 'abcd1234',
      activeCount: 100,
      linkLane: 'first-draw',
      draw: { objectType: 'SkinnedMesh', rootIndex: 4 },
    });
    expect(attribution.rows[0].linkToReflectionMs).toBeCloseTo(0.1, 5);
  });

  it('names the changed cache-key parameter by counting back from the fixed trailers', () => {
    // Tail layout: 48 parameters, two boolean masks, output colour space, then
    // customProgramCacheKey. depthPacking is the last parameter, so it sits at
    // position 5 from the end.
    const at = (fromEnd) =>
      variantDiffParameter({ segmentIndex: 100 - fromEnd, segmentsBefore: 100 });
    expect(at(1)).toBe('customProgramCacheKey');
    expect(at(2)).toBe('outputColorSpace');
    expect(at(3)).toBe('programLayersMask2');
    expect(at(4)).toBe('programLayersMask1');
    expect(at(5)).toBe('depthPacking');
    expect(at(19)).toBe('numPointLights');
    expect(at(52)).toBe('precision');
    // Past the front of the parameter block there is a variable-length defines
    // section, so nothing can be named there.
    expect(at(53)).toBeNull();
  });

  it('groups variants by what changed so a global flip is distinguishable from streaming', () => {
    const program = (id, name, before, after) => ({
      programId: id,
      cacheKeyHash: 'aaaaaaaa',
      materialType: 'MeshStandardMaterial',
      materialName: name,
      variantDiff:
        before === null
          ? null
          : { segmentIndex: 81, segmentsBefore: 100, segmentsAfter: 100, before, after },
    });
    const variance = cacheKeyVariance({
      timeline: {
        links: [
          { programId: 2, startMs: 1_000, endMs: 1_000, lane: 'first-draw', phaseAtStart: 'live' },
          { programId: 3, startMs: 1_400, endMs: 1_400, lane: 'first-draw', phaseAtStart: 'live' },
          { programId: 4, startMs: 9_000, endMs: 9_000, lane: 'first-draw', phaseAtStart: 'live' },
        ],
        programs: [
          program(1, 'streetlamp', null, null),
          program(2, 'streetlamp', '4', '5'),
          program(3, 'nature', '4', '5'),
          program(4, 'pirate', '0', '1'),
        ],
      },
    });
    expect(variance.programsAttributed).toBe(4);
    expect(variance.variantPrograms).toBe(3);
    expect(variance.groups[0]).toMatchObject({
      parameter: 'numPointLights',
      before: '4',
      after: '5',
      programs: 2,
      materials: ['nature', 'streetlamp'],
      firstLinkAtMs: 1_000,
      lastLinkAtMs: 1_400,
    });
    expect(variance.groups[1]).toMatchObject({ before: '0', after: '1', programs: 1 });
  });

  it('counts the family keys that collided apart from the variants it grouped', () => {
    // The probe cannot reach the material instance a link belongs to, so two
    // unnamed materials of one class share a retention key. A difference wider
    // than one cache-key segment is reported as ambiguous rather than grouped,
    // and the count of those travels with the verdict.
    const variance = cacheKeyVariance({
      timeline: {
        links: [],
        programs: [
          { programId: 1, cacheKeyHash: 'aaaaaaaa', variantDiff: null, variantAmbiguous: false },
          { programId: 2, cacheKeyHash: 'bbbbbbbb', variantDiff: null, variantAmbiguous: true },
          { programId: 3, cacheKeyHash: 'cccccccc', variantDiff: null, variantAmbiguous: true },
          // A real variant in the same capture: the two counters answer for
          // different programs, so neither can be the other's total.
          {
            programId: 4,
            cacheKeyHash: 'dddddddd',
            materialType: 'MeshStandardMaterial',
            materialName: 'streetlamp',
            variantAmbiguous: false,
            variantDiff: {
              segmentIndex: 81,
              segmentsBefore: 100,
              segmentsAfter: 100,
              spanBefore: 1,
              spanAfter: 1,
              before: '4',
              after: '5',
            },
          },
        ],
      },
    });
    expect(variance.programsAttributed).toBe(4);
    expect(variance.variantPrograms).toBe(1);
    expect(variance.ambiguousPrograms).toBe(2);
    expect(variance.groups).toHaveLength(1);
    expect(variance.groups[0]).toMatchObject({ before: '4', after: '5', programs: 1 });
  });

  it('refuses a variant claim spanning several cache-key segments', () => {
    const raw = capture({
      timeline: {
        ...capture().timeline,
        programs: [
          {
            programId: 1,
            cacheKeyHash: '',
            materialType: 'Mesh',
            materialName: '',
            variantDiff: {
              segmentIndex: 1,
              segmentsBefore: 10,
              segmentsAfter: 10,
              spanBefore: 4,
              spanAfter: 4,
              before: 'a',
              after: 'b',
            },
          },
        ],
      },
    });
    const result = validateCapture(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'timeline.programs[0].variantDiff claims a variant spanning several segments',
      ]),
    );
  });

  it('refuses an upload bucket that leaves its unsized count unsaid', () => {
    // The bucket half of the same rule: uploadBucketsBeforeQuery reads a
    // missing `unsized` as zero, so an artifact that omits it would hand back
    // a byte total that reads as complete when it is not.
    const raw = capture({
      timeline: {
        ...capture().timeline,
        uploadBuckets: [
          { startMs: 0, count: 3, bytes: 128 },
          { startMs: 100, count: 1, bytes: 0, unsized: 4 },
        ],
      },
    });
    const result = validateCapture(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'timeline.uploadBuckets[0].unsized must be a finite number',
        "timeline.uploadBuckets[1].unsized exceeds the bucket's own upload count",
      ]),
    );
  });

  it('refuses a program row that leaves the new variant fields unsaid', () => {
    // Same rule the variantDiff case below applies, and the same rule the
    // schema bump rests on: an absent field is not the claim "nothing
    // collided" or "this span is one segment", it is the producer not saying.
    // Optional fields would let a producer skip the multi-segment rejection
    // entirely and have cacheKeyVariance read the silence as a zero.
    const raw = capture({
      timeline: {
        ...capture().timeline,
        programs: [
          {
            programId: 1,
            cacheKeyHash: '',
            materialType: 'Mesh',
            materialName: '',
            variantDiff: {
              segmentIndex: 1,
              segmentsBefore: 10,
              segmentsAfter: 10,
              before: 'a',
              after: 'b',
            },
          },
        ],
      },
    });
    const result = validateCapture(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'timeline.programs[0].variantAmbiguous must be a boolean',
        'timeline.programs[0].variantDiff.spanBefore must be a non-negative integer',
        'timeline.programs[0].variantDiff.spanAfter must be a non-negative integer',
      ]),
    );
  });

  it('refuses a program row that omits the variant field entirely', () => {
    const raw = capture({
      timeline: {
        ...capture().timeline,
        programs: [{ programId: 1, cacheKeyHash: '', materialType: 'Mesh', materialName: '' }],
      },
    });
    const result = validateCapture(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'timeline.programs[0].variantDiff must be present (null when the program had no variant)',
    );
  });

  it('bounds the reflection rows the summary carries without losing the count', () => {
    const queries = [];
    for (let index = 0; index < 12; index++) queries.push(reflect(index + 1, 1_000 + index, index));
    const raw = capture({ timeline: { ...capture().timeline, queries } });
    const summary = summarizeCapture(raw, { reflectionRows: 3 });
    expect(summary.reflection.rows).toHaveLength(3);
    expect(summary.reflection.rowsTotal).toBe(12);
    expect(summary.reflection.rows[0].durationMs).toBe(11);
    expect(summary.reflection.families['never-compiled'].all.calls).toBe(12);
  });
});
