import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildCapture,
  parseArgs,
  prepareOnlineGearedRoster,
} from '../scripts/gpu_hitch_capture.mjs';
import {
  GPU_HITCH_SCHEMA_VERSION,
  validateCapture,
} from '../scripts/profiler/gpu_hitch_metrics.mjs';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

describe('gpu hitch capture program attribution', () => {
  const snapshotWith = (extra) => ({
    captureId: 'capture-2',
    startedAtEpochMs: Date.parse('2026-08-13T10:00:00.000Z'),
    startedAtPerformanceMs: 0,
    elapsedMs: 1_000,
    stopReason: 'duration',
    visible: true,
    visibilityTransitions: [],
    contextLost: 0,
    transitions: [],
    links: [],
    queries: [],
    controls: {},
    running: false,
    uploadBucketWidthMs: 100,
    uploadBuckets: [],
    ...extra,
  });
  const build = (snapshot) =>
    buildCapture({
      args: { mode: 'offline', profile: 'shader', durationMs: 1_000 },
      url: 'http://localhost:5173/?perf',
      snapshot,
      browserVersion: 'Chrome test',
      flags: [],
      provenance: {},
    });

  it('carries the program identities and the scene root census onto the timeline', () => {
    const raw = build(
      snapshotWith({
        programs: [
          {
            programId: 3,
            threeId: 9,
            materialType: 'MeshDepthMaterial',
            materialName: '',
            cacheKeyHash: 'abcd1234',
            cacheKeyLength: 412,
            variantDiff: null,
            resolvedAtMs: 12.5,
          },
        ],
        sceneRoots: [{ index: 0, type: 'Group', name: 'props', children: 8, visible: true }],
      }),
    );
    expect(raw.timeline.programs).toEqual([
      {
        programId: 3,
        threeId: 9,
        materialType: 'MeshDepthMaterial',
        materialName: '',
        cacheKeyHash: 'abcd1234',
        cacheKeyLength: 412,
        variantDiff: null,
        resolvedAtMs: 12.5,
      },
    ]);
    expect(raw.timeline.sceneRoots).toEqual([
      { index: 0, type: 'Group', name: 'props', children: 8, visible: true },
    ]);
  });

  it('defaults both to an empty array so a probe that resolved nothing still validates', () => {
    const raw = build(snapshotWith({}));
    expect(raw.timeline.programs).toEqual([]);
    expect(raw.timeline.sceneRoots).toEqual([]);
  });
});

describe('gpu hitch capture CLI', () => {
  it('parses the supported capture modes and profiles', () => {
    expect(
      parseArgs([
        '--url',
        'http://localhost:5173/?perf&gfx=ultra',
        '--mode',
        'manual',
        '--profile',
        'full',
        '--duration-ms',
        '5000',
        '--viewport',
        '1920x1080',
        '--headless',
        '--allow-dirty',
        '--group-id',
        'linkrate-v38-a1',
        '--leg',
        'limited-8',
        '--repetition',
        '2',
        '--order',
        '4',
      ]),
    ).toMatchObject({
      mode: 'manual',
      profile: 'full',
      durationMs: 5000,
      viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
      headless: true,
      allowDirty: true,
      groupId: 'linkrate-v38-a1',
      leg: 'limited-8',
      repetition: 2,
      order: 4,
    });
  });

  it('rejects unknown modes, profiles, and non-positive durations', () => {
    expect(() => parseArgs(['--mode', 'online'])).toThrow(
      '--mode must be offline, manual, or online-geared',
    );
    expect(() => parseArgs(['--profile', 'all'])).toThrow(
      '--profile must be shader, upload, or full',
    );
    expect(() => parseArgs(['--duration-ms', '0'])).toThrow(
      '--duration-ms must be a positive integer',
    );
    expect(() =>
      parseArgs(['--mode', 'online-geared', '--url', 'https://capture.example/?perf']),
    ).toThrow(/non-loopback --url/);
    expect(() => parseArgs(['--viewport', '1920'])).toThrow(
      '--viewport must use WIDTHxHEIGHT with positive integers',
    );
    expect(() => parseArgs(['--viewport', '1920x0'])).toThrow(
      '--viewport must use WIDTHxHEIGHT with positive integers',
    );
  });

  it('defaults to the reference 1600x900 viewport', () => {
    expect(parseArgs([]).viewport).toEqual({ width: 1600, height: 900, deviceScaleFactor: 1 });
  });

  it('requires complete, safe A/B metadata', () => {
    // Every field on its own, not just --group-id: the rule is symmetric, and a
    // capture labelled with three of the four cannot be placed in its campaign.
    const together = '--group-id, --leg, --repetition, and --order must be supplied together';
    expect(() => parseArgs(['--group-id', 'campaign'])).toThrow(together);
    expect(() => parseArgs(['--leg', 'limited'])).toThrow(together);
    expect(() => parseArgs(['--repetition', '1'])).toThrow(together);
    expect(() => parseArgs(['--order', '2'])).toThrow(together);
    expect(() =>
      parseArgs(['--group-id', 'campaign', '--leg', 'limited', '--repetition', '1']),
    ).toThrow(together);
    // All four together is the only accepted shape.
    expect(
      parseArgs([
        '--group-id',
        'campaign',
        '--leg',
        'limited',
        '--repetition',
        '1',
        '--order',
        '2',
      ]),
    ).toMatchObject({ groupId: 'campaign', leg: 'limited', repetition: 1, order: 2 });
    expect(() => parseArgs(['--leg', 'bad leg'])).toThrow(
      '--leg must be a 1-64 character identifier',
    );
  });

  it('resolves the capture zone from the live player position, not a constant', () => {
    // The producer end of the `zone` comparability dimension. buildCapture is
    // covered below, but perfStats() is where the value is DERIVED, and it
    // cannot run in Node: regressing it to a literal null would silently
    // disable the analyzer's zone check with every other test still green.
    // Comments stripped, and the renderer half anchored to the perfStats body:
    // a raw whole-file scan is satisfied by leaving the old line commented out
    // above a `currentZoneId: null,`, which is exactly the regression named.
    const renderer = codeWithoutLineComments(
      readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8'),
    );
    const statsStart = renderer.indexOf('  perfStats(): {');
    const statsEnd = renderer.indexOf('\n  private ', statsStart);
    expect(statsStart, 'perfStats was renamed; re-anchor this pin').toBeGreaterThan(-1);
    expect(statsEnd).toBeGreaterThan(statsStart);
    expect(renderer.slice(statsStart, statsEnd)).toContain(
      'currentZoneId: this.zoneIdAt(this.sim.player.pos.x, this.sim.player.pos.z),',
    );
    const capture = codeWithoutLineComments(
      readFileSync(new URL('../scripts/gpu_hitch_capture.mjs', import.meta.url), 'utf8'),
    );
    expect(capture).toContain('zone: snapshot.rendererStats?.currentZoneId ?? null,');
  });

  it('assembles a complete capture artifact from a probe snapshot without a browser', () => {
    const raw = buildCapture({
      args: {
        mode: 'online-geared',
        profile: 'full',
        groupId: 'campaign',
        leg: 'limited',
        repetition: 1,
        order: 2,
        durationMs: 180_000,
        fixtureEvidence: { kind: 'geared-arrival-v1', count: 2 },
      },
      url: 'http://localhost:5173/?linkrate=8&gfx=high&token=must-not-survive',
      snapshot: {
        captureId: 'capture-1',
        startedAtEpochMs: Date.parse('2026-08-13T10:00:00.000Z'),
        startedAtPerformanceMs: 1_000,
        elapsedMs: 180_347,
        stopReason: 'duration',
        visible: true,
        visibilityTransitions: [],
        contextLost: 0,
        transitions: [{ phase: 'entry', atMs: 0 }],
        links: [],
        queries: [],
        controls: { profile: 'full' },
        running: false,
        uploadBucketWidthMs: 100,
        uploadBuckets: [],
        runtimeReceipt: {
          schemaVersion: GPU_HITCH_SCHEMA_VERSION,
          buildId: 'served-build',
          effective: {
            prewarmPacing: { available: true, deadlineMs: 12 },
            modular: { available: true },
            renderer: { tier: 'ultra' },
          },
        },
        rendererStats: {
          width: 1600,
          height: 900,
          pixelRatio: 1,
          glVendor: 'vendor',
          glRenderer: 'renderer',
          tier: 'stats-tier',
          currentZoneId: 'eastbrook_vale',
          prewarm: {
            compileUnits: [
              {
                id: 'unit-1',
                submittedAtMs: 1_010,
                syncEndAtMs: 1_020,
                settledAtMs: 1_030,
              },
            ],
          },
        },
      },
      browserVersion: 'Chrome test',
      flags: ['--headless=new'],
      provenance: {
        schemaVersion: GPU_HITCH_SCHEMA_VERSION,
        sourceBuildId: 'source-build',
        probeSha256: 'probe-sha',
        analyzerSha256: 'analyzer-sha',
      },
    });

    expect(raw.capture).toMatchObject({
      id: 'capture-1',
      scenario: 'online-geared-entry',
      durationMs: 180_000,
      totalElapsedMs: 180_347,
      complete: true,
      fixture: { kind: 'geared-arrival-v1', count: 2 },
      zone: 'eastbrook_vale',
      url: 'http://localhost:5173/?linkrate=8&gfx=high',
    });
    expect(raw.provenance).toMatchObject({
      sourceBuildId: 'source-build',
      servedBuildId: 'served-build',
    });
    expect(raw.effective).toEqual({
      schemaVersion: GPU_HITCH_SCHEMA_VERSION,
      prewarmPacing: { available: true, deadlineMs: 12 },
      modular: { available: true },
      renderer: { tier: 'ultra' },
    });
    expect(raw.timeline.compileUnits).toEqual([
      {
        id: 'unit-1',
        submittedAtMs: 10,
        syncEndAtMs: 20,
        settledAtMs: 30,
      },
    ]);
    expect(raw.environment).toMatchObject({
      browserVersion: 'Chrome test',
      browserFlags: ['--headless=new'],
      glVendor: 'vendor',
      glRenderer: 'renderer',
      rendererTier: 'ultra',
      viewport: '1600x900',
      visible: true,
    });
    expect(raw.diagnostics.runtimeReceipt.buildId).toBe('served-build');
  });

  it('writes the evidence claim into the artifact so a re-run reaches the same verdict', () => {
    // The CLI demands performance evidence of any headed run, so a headed
    // software rasterizer is an error rather than a warning. That demand has to
    // travel IN the artifact: reading it back through the analyzer alone must
    // reproduce the verdict the capture embedded, not soften it to a smoke pass.
    const softwareStats = {
      width: 1600,
      height: 900,
      pixelRatio: 1,
      glVendor: 'Mesa',
      glRenderer: 'llvmpipe (LLVM 17.0.6, 256 bits)',
      tier: 'low',
    };
    const snapshot = {
      captureId: 'capture-3',
      startedAtEpochMs: Date.parse('2026-08-13T10:00:00.000Z'),
      startedAtPerformanceMs: 0,
      elapsedMs: 1_000,
      stopReason: 'duration',
      visible: true,
      visibilityTransitions: [],
      contextLost: 0,
      transitions: [],
      links: [],
      queries: [],
      controls: {},
      running: false,
      uploadBucketWidthMs: 100,
      uploadBuckets: [],
      rendererStats: softwareStats,
    };
    const headed = buildCapture({
      args: { mode: 'offline', profile: 'shader', durationMs: 1_000, headless: false },
      url: 'http://localhost:5173/?perf',
      snapshot,
      browserVersion: 'Chrome test',
      flags: [],
      provenance: {},
    });
    expect(headed.capture.performanceEvidence).toBe(true);
    const headedVerdict = validateCapture(headed);
    expect(headedVerdict.valid).toBe(false);
    expect(headedVerdict.errors).toContain(
      'software renderer cannot be used as performance evidence',
    );

    // A --headless run claims smoke only, and the same rasterizer is then a
    // warning on a valid artifact.
    const headless = buildCapture({
      args: { mode: 'offline', profile: 'shader', durationMs: 1_000, headless: true },
      url: 'http://localhost:5173/?perf',
      snapshot,
      browserVersion: 'Chrome test',
      flags: ['--headless=new'],
      provenance: {},
    });
    expect(headless.capture.performanceEvidence).toBe(false);
    const headlessVerdict = validateCapture(headless);
    expect(headlessVerdict.errors).not.toContain(
      'software renderer cannot be used as performance evidence',
    );
    expect(headlessVerdict.warnings).toContain(
      'software renderer is smoke-only and cannot be used as performance evidence',
    );
  });

  it('refuses manual mode without a terminal, before launching anything', async () => {
    // The behaviour the doc states as a contract. capture() is not drivable
    // from a unit test (it launches a real browser), so the two halves are
    // pinned where they live: the refusal must sit in capture() ahead of the
    // launch, and the stdin wait must always release. Comments are stripped, so
    // a commented-out guard cannot satisfy either pin.
    const source = codeWithoutLineComments(
      readFileSync(new URL('../scripts/gpu_hitch_capture.mjs', import.meta.url), 'utf8'),
    );
    const captureStart = source.indexOf('export async function capture(args) {');
    const refusal = source.indexOf(
      "if (args.mode === 'manual' && !process.stdin.isTTY)",
      captureStart,
    );
    const launch = source.indexOf('await puppeteer.launch(', captureStart);
    expect(captureStart).toBeGreaterThan(-1);
    expect(refusal).toBeGreaterThan(captureStart);
    expect(launch).toBeGreaterThan(refusal);
    expect(source).toContain(
      "throw new Error('--mode manual needs an interactive terminal; use --mode offline instead')",
    );
    expect(source).toContain('} finally {\n    process.stdin.pause();\n  }');
  });

  it('checks capability before constructing or preparing the mutable roster', async () => {
    const events = [];
    const roster = {
      prepare: async () => events.push('prepare'),
    };
    const prepared = await prepareOnlineGearedRoster({
      args: {
        url: 'http://localhost:5173/?perf',
        serverUrl: 'http://localhost:8787',
        bots: 2,
      },
      runId: 'capture-1',
      databaseUrl: 'postgres://localhost/test',
      checkCapability: async (serverUrl) => events.push(`capability:${serverUrl}`),
      rosterFactory: (options) => {
        events.push(`construct:${options.count}`);
        return roster;
      },
    });

    expect(prepared).toBe(roster);
    expect(events).toEqual(['capability:http://localhost:8787', 'construct:2', 'prepare']);
  });

  it('closes a roster whose prepare failed partway through', async () => {
    // prepare() registers accounts and opens sockets one bot at a time and has
    // no cleanup of its own. A failure on bot 7 of 20 used to strand every
    // account it had already inserted plus the open pg client, because the
    // caller's finally only ever sees a roster this function RETURNED.
    const events = [];
    const roster = {
      prepare: async () => {
        events.push('prepare');
        throw new Error('bot 7 failed to enter the world');
      },
      close: async () => events.push('close'),
    };
    await expect(
      prepareOnlineGearedRoster({
        args: {
          url: 'http://localhost:5173/?perf',
          serverUrl: 'http://localhost:8787',
          bots: 20,
        },
        runId: 'capture-1',
        databaseUrl: 'postgres://localhost/test',
        checkCapability: async () => {},
        rosterFactory: () => roster,
      }),
    ).rejects.toThrow('bot 7 failed to enter the world');
    expect(events).toEqual(['prepare', 'close']);
  });

  it('surfaces the prepare failure even when the cleanup close also fails', () => {
    // The cleanup must not become the error the operator sees: a close that
    // rejects (a pg client already gone, a socket half-open) would otherwise
    // replace "bot 7 failed to enter the world" with a teardown message and
    // send the diagnosis in the wrong direction.
    const roster = {
      prepare: async () => {
        throw new Error('bot 7 failed to enter the world');
      },
      close: async () => {
        throw new Error('pg client already ended');
      },
    };
    return expect(
      prepareOnlineGearedRoster({
        args: { url: 'http://localhost:5173/?perf', serverUrl: 'http://localhost:8787', bots: 20 },
        runId: 'capture-1',
        databaseUrl: 'postgres://localhost/test',
        checkCapability: async () => {},
        rosterFactory: () => roster,
      }),
    ).rejects.toThrow('bot 7 failed to enter the world');
  });

  it('rejects a remote page before capability checks or roster mutation', async () => {
    const events = [];
    await expect(
      prepareOnlineGearedRoster({
        args: {
          url: 'https://capture.example/?perf',
          serverUrl: 'http://localhost:8787',
          bots: 1,
        },
        runId: 'capture-1',
        databaseUrl: 'postgres://localhost/test',
        checkCapability: async () => events.push('capability'),
        rosterFactory: () => {
          events.push('construct');
          return { prepare: async () => events.push('prepare') };
        },
      }),
    ).rejects.toThrow(/non-loopback --url/);
    expect(events).toEqual([]);
  });
});
