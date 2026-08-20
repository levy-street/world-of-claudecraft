import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  browserFlags,
  buildCapture,
  CROWD_ARRIVE_STAGING_OFFSET,
  crowdCenter,
  crowdStagingCenter,
  harnessTimelineEvents,
  parseArgs,
  prepareOnlineGearedRoster,
  runTimedWindow,
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

  it('parses the far-band scenario options and records them for provenance', () => {
    const args = parseArgs([
      '--mode',
      'online-geared',
      '--observer',
      '0,640',
      '--crowd-offset',
      '80,-0.5',
      '--hop',
      '35000:0,640',
      '--hop',
      '15000:80,640',
      '--duration-ms',
      '60000',
    ]);
    expect(args.crowdOffset).toEqual({ dx: 80, dz: -0.5 });
    // kept in command-line order here; runTimedWindow sorts by delay
    expect(args.hops).toEqual([
      { atMs: 35000, x: 0, z: 640 },
      { atMs: 15000, x: 80, z: 640 },
    ]);
    // the camera-relative form, and the browser GPU backend passthrough
    const relative = parseArgs([
      '--mode',
      'online-geared',
      '--hop',
      '20000:retreat:82',
      '--hop',
      '55000:retreat:-82',
      '--angle',
      'gl-egl',
    ]);
    expect(relative.hops).toEqual([
      { atMs: 20000, retreat: 82 },
      { atMs: 55000, retreat: -82 },
    ]);
    expect(relative.angle).toBe('gl-egl');
    expect(parseArgs([]).angle).toBeNull();
    expect(crowdCenter({ x: 0, z: 640 }, args.crowdOffset)).toEqual({ x: 80, z: 639.5 });
    expect(crowdCenter({ x: 0, z: 640 }, null)).toEqual({ x: 0, z: 640 });
    // both change what is measured, so both land in the artifact
    const snapshot = {
      startedAtEpochMs: 0,
      elapsedMs: 1,
      stopReason: 'duration',
      transitions: [],
      links: [],
      queries: [],
      frames: [],
      longTasks: [],
      uploads: [],
      programs: [],
      sceneRoots: [],
      rendererStats: null,
    };
    const raw = buildCapture({
      args,
      url: 'http://localhost:5173/?perf',
      snapshot,
      browserVersion: 'Chrome/1',
      flags: [],
      provenance: {},
    });
    expect(raw.capture.crowdOffset).toEqual({ dx: 80, dz: -0.5 });
    expect(raw.capture.hops).toHaveLength(2);
    // defaults: no offset, no hops, so an existing campaign artifact reads the same
    const plain = parseArgs(['--mode', 'online-geared']);
    expect(plain.crowdOffset).toBeNull();
    expect(plain.hops).toEqual([]);
  });

  it('parses --crowd-arrive, defaults it off, and stages the crowd out of range until it fires', () => {
    const args = parseArgs(['--mode', 'online-geared', '--crowd-arrive', '12000']);
    expect(args.crowdArriveMs).toBe(12000);
    expect(parseArgs(['--mode', 'online-geared']).crowdArriveMs).toBeNull();
    expect(parseArgs([]).crowdArriveMs).toBeNull();
    expect(() => parseArgs(['--crowd-arrive', '12000'])).toThrow(/online-geared/);
    expect(() =>
      parseArgs(['--mode', 'online-geared', '--crowd-arrive', '90000', '--duration-ms', '60000']),
    ).toThrow(/inside --duration-ms/);
    expect(() => parseArgs(['--mode', 'online-geared', '--crowd-arrive', '-1'])).toThrow(
      /non-negative/,
    );
    // the staging spot is the crowd's own spot pushed 400 yd down Z: past the
    // 96 yd view destroy range, so the walk-in streams every body in cold
    expect(CROWD_ARRIVE_STAGING_OFFSET).toEqual({ dx: 0, dz: 400 });
    expect(crowdStagingCenter({ x: 0, z: 640 }, { dx: 80, dz: -0.5 })).toEqual({
      x: 80,
      z: 1039.5,
    });
    expect(crowdStagingCenter({ x: 0, z: 640 }, null)).toEqual({ x: 0, z: 1040 });
  });

  it('fires the crowd walk-in on the hop schedule, records it, and puts it on the probe timeline', async () => {
    let clock = 1000;
    const waits = [];
    const placed = [];
    let waitCalls = 0;
    const page = {
      waitForFunction: async () => {
        waitCalls++;
        clock += waitCalls === 1 ? 1000 : 6000;
      },
      evaluate: async (fn, entry) => {
        globalThis.window = {
          __game: {
            world: { player: { pos: { x: 0, y: 0, z: 640 } } },
            renderer: { camera: { matrixWorld: { elements: new THREE.Matrix4().elements } } },
            online: { devCmd: () => {} },
          },
        };
        try {
          return await fn(entry);
        } finally {
          globalThis.window = undefined;
        }
      },
    };
    const wait = async (ms) => {
      waits.push(ms);
      clock += ms;
    };
    const roster = { placeAll: (center) => placed.push(center) };
    const hops = [{ atMs: 30000, retreat: 82 }];
    const args = {
      durationMs: 60000,
      hops,
      crowdArriveMs: 12000,
      observer: { x: 0, z: 640 },
      crowdOffset: { dx: 80, dz: -0.5 },
    };
    await runTimedWindow(page, args, wait, () => clock, roster);
    // anchored on the reveal (+7 s) like the hops: the walk-in at +19 s, the
    // hop at +37 s, the window closes at anchor + 60 s
    expect(waits).toEqual([12000, 18000, 30000]);
    expect(placed).toEqual([{ x: 80, z: 639.5 }]);
    expect(args.crowdArrive).toEqual({
      atMs: 12000,
      firedAtMs: 19000,
      firedAtEpochMs: 20000,
      from: { x: 80, z: 1039.5 },
      to: { x: 80, z: 639.5 },
    });
    expect(hops[0].firedAtMs).toBe(37000);
    // the artifact carries it beside the hops, and as a probe-time mark
    expect(harnessTimelineEvents(args, 20000 - 15000)).toEqual([
      { atMs: 15000, event: 'crowd-arrive' },
    ]);
    expect(harnessTimelineEvents({ crowdArrive: null }, 0)).toEqual([]);
    const snapshot = {
      startedAtEpochMs: 5000,
      elapsedMs: 1,
      stopReason: 'duration',
      transitions: [],
      links: [],
      queries: [],
      frames: [],
      longTasks: [],
      uploads: [],
      programs: [],
      sceneRoots: [],
      rendererStats: null,
    };
    const raw = buildCapture({
      args,
      url: 'http://localhost:5173/?perf',
      snapshot,
      browserVersion: 'Chrome/1',
      flags: [],
      provenance: {},
    });
    expect(raw.capture.crowdArrive).toEqual(args.crowdArrive);
    expect(raw.timeline.events).toEqual([{ atMs: 15000, event: 'crowd-arrive' }]);
    // a walk-in with no roster to move is recorded, not thrown, like a failed hop
    const alone = { durationMs: 1000, hops: [], crowdArriveMs: 0 };
    waitCalls = 0;
    await runTimedWindow(page, alone, wait, () => clock, null);
    expect(alone.crowdArrive.error).toBe('no roster to move');
    // without the flag nothing is recorded and the window is unchanged
    const plain = { durationMs: 1234, hops: [] };
    waits.length = 0;
    await runTimedWindow(page, plain, wait, () => clock);
    expect(waits).toEqual([1234]);
    expect(plain.crowdArrive).toBeUndefined();
    expect(
      buildCapture({
        args: plain,
        url: 'http://localhost:5173/',
        snapshot,
        browserVersion: 'x',
        flags: [],
        provenance: {},
      }).timeline.events,
    ).toEqual([]);
  });

  it('rejects far-band options that cannot mean anything', () => {
    expect(() => parseArgs(['--crowd-offset', '80,0'])).toThrow(/online-geared/);
    expect(() => parseArgs(['--mode', 'online-geared', '--crowd-offset', '80'])).toThrow(/DX,DZ/);
    expect(() => parseArgs(['--hop', '1000:0,0'])).toThrow(/online-geared/);
    expect(() => parseArgs(['--mode', 'online-geared', '--hop', '0,0'])).toThrow(/MS:X,Z/);
    expect(() => parseArgs(['--mode', 'online-geared', '--hop', '5:retreat:x'])).toThrow(/MS:X,Z/);
    expect(() => parseArgs(['--angle', 'gl egl'])).toThrow(/identifier/);
    expect(() =>
      parseArgs(['--mode', 'online-geared', '--duration-ms', '5000', '--hop', '5000:0,0']),
    ).toThrow(/inside --duration-ms/);
  });

  it('anchors hops on the reveal after the entry teleport, fires them in delay order, records the landing, keeps the window from the anchor', async () => {
    // A fake clock: waits advance it; the cover-up wait costs 1 s and the
    // reveal wait 6 s, so hop delays and the window count from +7 s.
    let clock = 1000;
    const waits = [];
    const teleports = [];
    let waitCalls = 0;
    const page = {
      waitForFunction: async () => {
        waitCalls++;
        clock += waitCalls === 1 ? 1000 : 6000;
      },
      // The hop body runs for real against a fake page global: identity
      // camera (forward is -Z), player at the observer spot.
      evaluate: async (fn, entry) => {
        globalThis.window = {
          __game: {
            world: { player: { pos: { x: 0, y: 0, z: 640 } } },
            renderer: { camera: { matrixWorld: { elements: new THREE.Matrix4().elements } } },
            online: { devCmd: (cmd) => teleports.push(cmd) },
          },
        };
        try {
          return await fn(entry);
        } finally {
          globalThis.window = undefined;
        }
      },
    };
    const wait = async (ms) => {
      waits.push(ms);
      clock += ms;
    };
    const hops = [
      { atMs: 35000, x: 5, z: 6 },
      { atMs: 15000, retreat: 82 },
    ];
    const args = { durationMs: 60000, hops };
    await runTimedWindow(page, args, wait, () => clock);
    // retreat backs away from the facing (+Z here), the absolute hop lands as given
    expect(teleports).toEqual([
      { cmd: 'dev_teleport', x: 0, z: 722 },
      { cmd: 'dev_teleport', x: 5, z: 6 },
    ]);
    // reveal anchor at +7 s: hop 1 at +22 s, hop 2 at +42 s, window closes at anchor + 60 s
    expect(waits).toEqual([15000, 20000, 25000]);
    expect(args.hopAnchorMs).toBe(7000);
    expect(hops[1]).toMatchObject({
      firedAtMs: 22000,
      from: { x: 0, z: 640 },
      to: { x: 0, z: 722 },
    });
    expect(hops[0]).toMatchObject({ firedAtMs: 42000, to: { x: 5, z: 6 } });
    // a negative retreat advances
    const advance = [{ atMs: 0, retreat: -10 }];
    teleports.length = 0;
    waitCalls = 0;
    await runTimedWindow(page, { durationMs: 1000, hops: advance }, wait, () => clock);
    expect(teleports[0]).toEqual({ cmd: 'dev_teleport', x: 0, z: 630 });
    // no hops: no reveal wait, one wait for the whole window from its opening
    waits.length = 0;
    await runTimedWindow(page, { durationMs: 1234, hops: [] }, wait, () => clock);
    expect(waits).toEqual([1234]);
  });

  it('a hop whose page call fails is recorded and the window still runs to its end', async () => {
    let clock = 0;
    const waits = [];
    const page = {
      waitForFunction: async () => {},
      evaluate: async () => {
        throw new Error('page gone');
      },
    };
    const hops = [{ atMs: 100, x: 1, z: 2 }];
    await runTimedWindow(
      page,
      { durationMs: 5000, hops },
      async (ms) => {
        waits.push(ms);
        clock += ms;
      },
      () => clock,
    );
    expect(hops[0].error).toBe('page gone');
    expect(waits).toEqual([100, 4900]);
  });

  it('runs the timed window (with its hops) in capture, never a flat sleep (source pin)', () => {
    const source = codeWithoutLineComments(
      readFileSync(new URL('../scripts/gpu_hitch_capture.mjs', import.meta.url), 'utf8'),
    );
    const captureStart = source.indexOf('export async function capture(');
    const captureBody = source.slice(
      captureStart,
      source.indexOf('\nif (import.meta.url', captureStart),
    );
    expect(captureBody).toContain(
      'await runTimedWindow(page, args, sleep, () => Date.now(), roster ?? null);',
    );
    expect(captureBody).not.toContain('await sleep(args.durationMs)');
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

  it('takes the CPU profile destination off --cpu-profile, and records none without it', () => {
    expect(parseArgs(['--cpu-profile', 'tmp/x.cpuprofile']).cpuProfile).toBe('tmp/x.cpuprofile');
    expect(parseArgs([]).cpuProfile).toBeNull();
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
    // The report type is named (renderer_perf_stats.ts RendererPerfStats), so
    // the anchor is the method signature, not an inline return-type literal.
    const statsStart = renderer.indexOf('  perfStats(): RendererPerfStats {');
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

  it('places the crowd at observer + --crowd-offset, and around the observer without it', async () => {
    const centers = [];
    const roster = { prepare: async ({ center }) => centers.push(center) };
    const common = {
      runId: 'capture-2',
      databaseUrl: 'postgres://localhost/test',
      checkCapability: async () => {},
      rosterFactory: () => roster,
    };
    await prepareOnlineGearedRoster({
      ...common,
      args: {
        url: 'http://localhost:5173/?perf',
        serverUrl: 'http://localhost:8787',
        bots: 2,
        observer: { x: 0, z: 640 },
        crowdOffset: { dx: 80, dz: -0.5 },
      },
    });
    await prepareOnlineGearedRoster({
      ...common,
      args: {
        url: 'http://localhost:5173/?perf',
        serverUrl: 'http://localhost:8787',
        bots: 2,
        observer: { x: 0, z: 640 },
        crowdOffset: null,
      },
    });
    // --crowd-arrive: prepared at the staging spot, the walk-in brings it home
    await prepareOnlineGearedRoster({
      ...common,
      args: {
        url: 'http://localhost:5173/?perf',
        serverUrl: 'http://localhost:8787',
        bots: 2,
        observer: { x: 0, z: 640 },
        crowdOffset: { dx: 80, dz: -0.5 },
        crowdArriveMs: 12000,
      },
    });
    expect(centers).toEqual([
      { x: 80, z: 639.5 },
      { x: 0, z: 640 },
      { x: 80, z: 1039.5 },
    ]);
  });

  it('passes --angle to the browser as --use-angle and records it in the flags', () => {
    const viewport = { width: 1600, height: 900 };
    expect(browserFlags(true, viewport, 'gl-egl')).toContain('--use-angle=gl-egl');
    expect(browserFlags(true, viewport, null).some((f) => f.startsWith('--use-angle'))).toBe(false);
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
