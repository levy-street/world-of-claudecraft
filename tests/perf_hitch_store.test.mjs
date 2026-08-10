import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  browserEvidenceFromScenarios,
  closeHitchBrowser,
  HITCH_BROWSER_EXTRA_ARGS,
  HITCH_BROWSER_FLAGS,
  HITCH_SETTLED_HEAP_WAIT_MS,
  HITCH_VIEWPORT,
  programKeysCreatedSince,
  readSettledHeapMb,
  runMeasuredWindow,
  startCollector,
} from '../scripts/lib/perf_hitch_browser.mjs';
import { buildHitchCliPlan } from '../scripts/lib/perf_hitch_cli.mjs';
import {
  HITCH_CROWD_CHAT_RETRY_MS,
  HITCH_CROWD_COMBAT_QUIET_MS,
  HITCH_CROWD_INFLUX_X,
  HITCH_CROWD_INFLUX_Z,
  HITCH_CROWD_PARKING_TOLERANCE,
  HITCH_CROWD_PARKING_X,
  HITCH_CROWD_PARKING_Z,
} from '../scripts/lib/perf_hitch_crowd_reset.mjs';
import {
  acquireHitchFixtureLock,
  appendHitchBotServerError,
  applySoakAppearance,
  assertExactFixtureIds,
  buildHitchFixtureRows,
  crowdInflux,
  HITCH_CHURN_SIZE,
  HITCH_CROWD_RESET_TIMEOUT_MS,
  HITCH_CROWD_SIZE,
  HITCH_ROSTER_SIZE,
  HitchBot,
  HitchRoster,
  mergeLegacySelfSnapshot,
  prepareCrowdBots,
  recoverCrowdBots,
  runBounded,
  runHitchScenario,
  seedHitchFixtureWithClient,
  soakCosmeticInputs,
  stageCrowdInfluxArena,
  validateHitchFixtureRows,
} from '../scripts/lib/perf_hitch_scenarios.mjs';
import { buildSoakChurnPlan } from '../scripts/lib/perf_hitch_soak.mjs';
import {
  assertNoCalibrationFlaps,
  compareRunToGate,
  deriveCalibration,
  formatGateComparison,
  HITCH_METRIC_KINDS,
  historyTable,
  MAX_SOAK_SETTLED_HEAP_RELATIVE_SPREAD,
  MIN_BASELINE_PROGRAM_COUNT,
  makeRunRecord,
  parseHistoryJsonl,
  SCENARIO_NAMES,
  SCENARIO_SPECS,
  summarizeScenario,
} from '../scripts/lib/perf_hitch_store.mjs';
import { Profiler, profilerBrowserLaunchOptions } from '../scripts/profiler/harness.mjs';
import { CLASSES as SIM_CLASSES } from '../src/sim/content/classes.ts';
import { weaponSkinTypeMatches } from '../src/sim/content/weapon_skin_rules.ts';
import { WEAPON_SKINS } from '../src/sim/content/weapon_skins.ts';

const rawScenario = (name, overrides = {}) => ({
  name,
  warmupMs: SCENARIO_SPECS[name].warmupMs,
  measureMs: SCENARIO_SPECS[name].measureMs,
  frames: [
    {
      atMs: 1000,
      dtMs: 16,
      programs: 10,
      textures: 20,
      pooledVisuals: 2,
      renderBudget: { reason: 'stable', recentSubmitStalls: 0, lastSubmitStallMs: 0 },
    },
    {
      atMs: SCENARIO_SPECS[name].warmupMs + 16,
      dtMs: 16,
      programs: 10,
      textures: 20,
      pooledVisuals: 2,
      renderBudget: { reason: 'stable', recentSubmitStalls: 0, lastSubmitStallMs: 0 },
    },
    {
      atMs: SCENARIO_SPECS[name].warmupMs + 76,
      dtMs: 60,
      programs: 11,
      textures: 23,
      pooledVisuals: 5,
      renderBudget: {
        reason: 'submit-stall',
        recentSubmitStalls: 1,
        lastSubmitStallMs: 145,
      },
    },
    {
      atMs: SCENARIO_SPECS[name].warmupMs + 96,
      dtMs: 20,
      programs: 11,
      textures: 22,
      pooledVisuals: 4,
      renderBudget: { reason: 'stable', recentSubmitStalls: 0.8, lastSubmitStallMs: 145 },
    },
  ],
  newProgramKeys: ['program-a'],
  baselineProgramKeys: ['boot-a', 'boot-b', 'boot-b'],
  report: {
    renderer: {
      tier: 'insane',
      autoGovernor: false,
      contextLost: 0,
      glRenderer: 'Apple M4',
    },
    heapSawtooth: {
      samples: 10,
      seconds: 9,
      gcDropCount: 2,
      avgDropMb: 4,
      allocRateMbPerSec: 3.25,
      amplitudeMb: 8,
      lastUsedMb: 120,
    },
  },
  heapFloor: { startMb: 90, endMb: 999, growthMb: 909, floorSamples: 3 },
  heapFloorSeries: [
    { atMs: 0, floorMb: 90 },
    { atMs: 1000, floorMb: 92 },
    { atMs: 2000, floorMb: 94.5 },
  ],
  settledHeap: { warmupMb: 100, endMb: 130.25, deltaMb: 30.25 },
  pageErrors: [],
  ...overrides,
});

const scenario = (name, overrides = {}) => ({
  name,
  warmupMs: SCENARIO_SPECS[name].warmupMs,
  measureMs: SCENARIO_SPECS[name].measureMs,
  frames: 1000,
  postWarmupFrames: 800,
  longFrames: 4,
  worstFrameMs: 240,
  p99FrameMs: 24,
  programCompiles: name === 'crowd-influx' || name === 'cosmetic-churn' ? 3 : 0,
  baselineProgramCount: 320,
  texturesCreated: 2,
  pooledVisualsCreated: 5,
  submitStallLatched: true,
  submitStallFrames: 1,
  maxSubmitStallMs: 145,
  heapFloorGrowthMb: name === 'soak' ? 40 : 2,
  settledHeapDeltaMb: name === 'soak' ? 40 : 2,
  allocationRateMbPerSec: 3,
  pageErrorCount: 0,
  heapSawtooth: { gcDropCount: 2, amplitudeMb: 8, lastUsedMb: 120 },
  tier: 'insane',
  autoGovernor: true,
  contextLost: 0,
  glRenderer: 'Apple M4',
  ...overrides,
});

const run = (overrides = {}) => {
  const rows = SCENARIO_NAMES.map((name) => scenario(name, overrides[name]));
  return makeRunRecord(
    {
      at: '2026-08-08T00:00:00.000Z',
      commit: 'abc123def456',
      buildId: 'build-a',
      branch: 'feature/hitches',
      dirty: true,
      preset: 'insane',
      viewport: '1280x720',
      machine: 'test-machine',
      browserVersion: 'Google Chrome 151.0.7922.76',
      browserFlags: ['--disable-gpu-shader-disk-cache'],
      freshProfile: true,
    },
    rows,
  );
};

describe('frozen hitch suite contract', () => {
  it('pins every scenario, warmup, and the ten-minute soak default', () => {
    expect(SCENARIO_NAMES).toEqual([
      'cold-zone-entry',
      'crowd-influx',
      'cosmetic-churn',
      'sky-crossing',
      'soak',
      'combat-vfx-burst',
    ]);
    expect(SCENARIO_SPECS).toEqual({
      'cold-zone-entry': { mode: 'offline', warmupMs: 3000, measureMs: 12_000 },
      'crowd-influx': { mode: 'online', warmupMs: 3000, measureMs: 18_000 },
      'cosmetic-churn': { mode: 'online', warmupMs: 5000, measureMs: 20_000 },
      'sky-crossing': { mode: 'offline', warmupMs: 3000, measureMs: 18_000 },
      soak: { mode: 'online', warmupMs: 15_000, measureMs: 600_000 },
      'combat-vfx-burst': { mode: 'offline', warmupMs: 3000, measureMs: 18_000 },
    });
    expect(MAX_SOAK_SETTLED_HEAP_RELATIVE_SPREAD).toBe(0.35);
    expect(MIN_BASELINE_PROGRAM_COUNT).toBe(10);
  });

  it('pins fresh headed real-GPU browser state and the fixed deterministic bot roster', () => {
    expect(HITCH_BROWSER_FLAGS).toContain('--disable-gpu-shader-disk-cache');
    expect(HITCH_BROWSER_FLAGS).toContain('--user-data-dir=<fresh-temp>');
    expect(HITCH_BROWSER_FLAGS).toContain('--enable-gpu');
    expect(HITCH_BROWSER_FLAGS).toContain('--window-size=1280,840');
    expect(HITCH_BROWSER_FLAGS.join(' ')).not.toMatch(/swiftshader|software/i);
    expect(HITCH_VIEWPORT).toEqual({ width: 1280, height: 720 });
    const rows = buildHitchFixtureRows();
    expect(rows).toHaveLength(HITCH_ROSTER_SIZE);
    expect([HITCH_ROSTER_SIZE, HITCH_CROWD_SIZE, HITCH_CHURN_SIZE]).toEqual([36, 24, 12]);
    expect(new Set(rows.map((row) => row.username)).size).toBe(HITCH_ROSTER_SIZE);
    expect(new Set(rows.map((row) => row.name)).size).toBe(HITCH_ROSTER_SIZE);
    expect(new Set(rows.map((row) => row.skin)).size).toBe(8);
    expect(new Set(rows.map((row) => row.weaponSkin)).size).toBeGreaterThan(8);
    expect(new Set(rows.map((row) => row.mountItem)).size).toBeGreaterThan(3);
    for (const row of rows) {
      const skin = WEAPON_SKINS[row.weaponSkin];
      expect(skin, `${row.weaponSkin} fixture skin`).toBeDefined();
      expect(skin.weaponType, `${row.weaponSkin} catalog type`).toBe(row.weaponType);
      expect(
        weaponSkinTypeMatches(row.cls, SIM_CLASSES[row.cls].startWeapon, skin.weaponType, 'class'),
        `${row.cls} fixture skin compatibility`,
      ).toBe(true);
    }
    expect(
      rows.filter((row) => row.cls === 'hunter').map((row) => [row.weaponType, row.weaponSkin]),
    ).toEqual([
      ['bow', 'fletcher_s_guild_bow'],
      ['bow', 'winterbite'],
      ['bow', 'encore_bow'],
    ]);
    expect(validateHitchFixtureRows(rows)).toBeGreaterThan(0);
    expect(() => validateHitchFixtureRows(rows.slice(1))).toThrow(/exactly 36/i);
  });

  it('sizes the reset timeout above the worst-case paced retry schedule', () => {
    // Worst single-bot path: the initial issue plus two chat quiet-window
    // retries (2 x HITCH_CROWD_CHAT_RETRY_MS), a lost mount summon's 3 s
    // coordinator hold plus the 1.5 s recast, and 2 s of snapshot and poll
    // latency. The timeout must clear that so pacing can finish its schedule
    // before the phase fails closed.
    expect(HITCH_CROWD_RESET_TIMEOUT_MS).toBe(20_000);
    expect(HITCH_CROWD_RESET_TIMEOUT_MS).toBeGreaterThanOrEqual(
      2 * HITCH_CROWD_CHAT_RETRY_MS + 3_000 + 1_500 + 2_000,
    );
  });

  it('fails closed when a batch does not return the exact expected account IDs', () => {
    expect(() =>
      assertExactFixtureIds([{ account_id: 1 }, { account_id: 2 }], [1, 2], 'batch'),
    ).not.toThrow();
    expect(() => assertExactFixtureIds([{ account_id: 1 }], [1, 2], 'batch')).toThrow(
      /1\/2 expected/i,
    );
    expect(() =>
      assertExactFixtureIds(
        [{ account_id: 1 }, { account_id: 2 }, { account_id: 2 }],
        [1, 2],
        'batch',
      ),
    ).toThrow(/2\/2 expected/i);
    expect(() =>
      assertExactFixtureIds(
        [{ account_id: 1 }, { account_id: 2 }, { account_id: 3 }],
        [1, 2],
        'batch',
      ),
    ).toThrow(/3\/2 expected/i);
    expect(() =>
      assertExactFixtureIds([{ account_id: 1 }, { account_id: 3 }], [1, 2], 'batch'),
    ).toThrow(/2\/2 expected/i);
  });

  it('gives one process exclusive fixture ownership before database work', () => {
    const parent = mkdtempSync(path.join(os.tmpdir(), 'hitch-lock-test-'));
    const lockDir = path.join(parent, 'owner');
    const release = acquireHitchFixtureLock(lockDir);
    try {
      expect(() => acquireHitchFixtureLock(lockDir)).toThrow(/another hitch referee/i);
    } finally {
      release();
      const releaseAgain = acquireHitchFixtureLock(lockDir);
      releaseAgain();
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('seeds all fixture tables atomically and rolls back a cosmetic failure', async () => {
    const rows = buildHitchFixtureRows();
    const makeClient = (failCosmetics = false) => {
      const calls = [];
      const client = {
        calls,
        async query(sql, params = []) {
          calls.push(String(sql).trim().split(/\s+/).slice(0, 4).join(' '));
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
          if (String(sql).includes('INSERT INTO accounts')) {
            return {
              rows: params[0].map((username, index) => ({ id: index + 1, username })),
            };
          }
          if (String(sql).includes('INSERT INTO auth_tokens')) {
            return { rows: params[1].map((account_id) => ({ account_id })) };
          }
          if (String(sql).includes('INSERT INTO characters')) return { rows: [] };
          if (String(sql).includes('SELECT id, account_id, name, class')) {
            return {
              rows: params[1].map((accountId, index) => {
                const source =
                  index < rows.length
                    ? rows[index]
                    : {
                        name: 'HrefCamera',
                        cls: 'mage',
                      };
                return {
                  id: index + 100,
                  account_id: accountId,
                  name: source.name,
                  class: source.cls,
                };
              }),
            };
          }
          if (String(sql).includes('INSERT INTO account_weapon_cosmetics')) {
            if (failCosmetics) throw new Error('cosmetic failure');
            return { rows: params[0].map((account_id) => ({ account_id })) };
          }
          if (String(sql).includes('DELETE FROM auth_tokens')) return { rows: [] };
          throw new Error(`unexpected SQL: ${sql}`);
        },
      };
      return client;
    };

    const client = makeClient();
    const seeded = await seedHitchFixtureWithClient(client, rows, 'Claudemoon', () =>
      'a'.repeat(64),
    );
    expect(seeded.records).toHaveLength(36);
    expect(seeded.camera).toMatchObject({ username: 'hitch_ref_camera', name: 'HrefCamera' });
    expect(client.calls.at(-2)).toMatch(/^INSERT INTO account_weapon_cosmetics/);
    expect(client.calls[0]).toBe('BEGIN');
    expect(client.calls.at(-1)).toBe('COMMIT');
    expect(client.calls).toHaveLength(8);

    const failed = makeClient(true);
    await expect(
      seedHitchFixtureWithClient(failed, rows, 'Claudemoon', () => 'b'.repeat(64)),
    ).rejects.toThrow(/cosmetic failure/);
    expect(failed.calls[0]).toBe('BEGIN');
    expect(failed.calls.at(-1)).toBe('ROLLBACK');
    expect(failed.calls).toHaveLength(8);
    expect(failed.calls).not.toContain('COMMIT');
  });

  it('pins launch forwarding and temporary profile cleanup', async () => {
    const launch = profilerBrowserLaunchOptions({
      browserPath: '/Applications/Test Chrome',
      userDataDir: '/tmp/literal-hitch-profile',
      headless: false,
      width: 1280,
      height: 720,
      extraArgs: ['--disable-gpu-shader-disk-cache'],
    });
    expect(launch.userDataDir).toBe('/tmp/literal-hitch-profile');
    expect(launch.headless).toBe(false);
    expect(launch.args).toContain('--enable-gpu');
    expect(launch.args).not.toContain('--use-angle=swiftshader');
    expect(HITCH_BROWSER_FLAGS.slice(1)).toEqual(
      profilerBrowserLaunchOptions({
        browserPath: '/ignored',
        userDataDir: '/ignored',
        headless: false,
        width: 1280,
        height: 720,
        extraArgs: HITCH_BROWSER_EXTRA_ARGS,
      }).args,
    );

    let actualLaunch;
    const fakePage = {
      setViewport: async () => {},
      on: () => {},
    };
    const profiler = new Profiler({
      userDataDir: '/tmp/literal-hitch-profile',
      width: 1280,
      height: 720,
      extraArgs: ['--disable-gpu-shader-disk-cache'],
      launchBrowser: async (options) => {
        actualLaunch = options;
        return { newPage: async () => fakePage };
      },
    });
    await profiler.launch();
    expect(actualLaunch.userDataDir).toBe('/tmp/literal-hitch-profile');
    expect(actualLaunch.args).toContain('--disable-gpu-shader-disk-cache');

    const profileDir = mkdtempSync(path.join(os.tmpdir(), 'woc-perf-hitch-'));
    await closeHitchBrowser({
      profileDir,
      profiler: { mode: 'offline', browser: { process: () => null }, close: async () => {} },
    });
    expect(existsSync(profileDir)).toBe(false);
  });

  it('rejects browser launch-vector drift between scenarios instead of unioning flags', () => {
    const evidence = {
      browserVersion: 'Chrome 151',
      browserFlags: [...HITCH_BROWSER_FLAGS],
      freshProfile: true,
    };
    expect(browserEvidenceFromScenarios([evidence, { ...evidence }])).toEqual(evidence);
    expect(() =>
      browserEvidenceFromScenarios([
        evidence,
        { ...evidence, browserFlags: HITCH_BROWSER_FLAGS.slice(1) },
      ]),
    ).toThrow(/launch arguments are inconsistent/i);
  });

  it('forces two full GCs with settle waits before reading the used JS heap', async () => {
    const events = [];
    const cdp = {
      send: async (method) => {
        events.push(method);
        if (method === 'Runtime.getHeapUsage') return { usedSize: 128.5 * 2 ** 20 };
        return {};
      },
    };

    await expect(
      readSettledHeapMb(cdp, async (delayMs) => events.push(`wait:${delayMs}`)),
    ).resolves.toBe(128.5);
    expect(events).toEqual([
      'HeapProfiler.collectGarbage',
      'wait:100',
      'HeapProfiler.collectGarbage',
      'wait:100',
      'Runtime.getHeapUsage',
    ]);
    expect(HITCH_SETTLED_HEAP_WAIT_MS).toBe(100);
  });

  it('keeps forced GC outside the measured frame window at both boundaries', async () => {
    const events = [];
    const previousWindow = globalThis.window;
    globalThis.window = {
      __hitchReferee: {
        markWarmup: () => {
          events.push('markWarmup');
          return 15_250;
        },
        stop: () => {
          events.push('stop');
          return {
            frames: [],
            baselineProgramKeys: [],
            observedProgramKeys: [],
            report: { renderer: { contextLost: 0 } },
          };
        },
      },
    };
    const cdp = { detach: async () => events.push('detach') };
    const page = {
      createCDPSession: async () => {
        events.push('attach');
        return cdp;
      },
      evaluate: async (fn) => fn(),
    };
    let settledRead = 0;

    try {
      const raw = await runMeasuredWindow(
        { profiler: { page } },
        { name: 'soak', warmupMs: 15_000, measureMs: 600_000 },
        async () => events.push('action'),
        {
          requireVisible: async () => events.push('visible'),
          startCollector: async () => events.push('startCollector'),
          waitVisible: async (_profiler, ms) => events.push(`waitVisible:${ms}`),
          readSettledHeapMb: async () => {
            settledRead += 1;
            events.push(`settled:${settledRead}`);
            return settledRead === 1 ? 100.25 : 127.75;
          },
        },
      );

      expect(events).toEqual([
        'visible',
        'startCollector',
        'waitVisible:15000',
        'attach',
        'settled:1',
        'markWarmup',
        'waitVisible:600000',
        'action',
        'stop',
        'settled:2',
        'detach',
      ]);
      expect(raw.settledHeap).toEqual({ warmupMb: 100.25, endMb: 127.75, deltaMb: 27.5 });
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  });

  it('captures a program created after the real collector warmup boundary', async () => {
    const raf = [];
    const programs = [{ cacheKey: 'warm-program' }];
    let now = 0;
    const previous = {
      window: globalThis.window,
      performance: globalThis.performance,
      requestAnimationFrame: globalThis.requestAnimationFrame,
    };
    globalThis.window = {
      __game: {
        renderer: {
          webgl: { info: { programs } },
          perfStats: () => ({
            programs: programs.length,
            textures: 2,
            pooledVisuals: 3,
            renderBudget: {
              reason: 'stable',
              recentSubmitStalls: 0,
              lastSubmitStallMs: 0,
            },
          }),
        },
        perf: {
          reset: () => {},
          report: () => ({ renderer: { contextLost: 0 } }),
          hitchReport: () => ({
            heapFloor: { growthMb: 1 },
            heapFloorSeries: [
              { atMs: 0, floorMb: 100 },
              { atMs: 1000, floorMb: 101 },
            ],
          }),
        },
      },
    };
    Object.defineProperty(globalThis, 'performance', {
      value: { now: () => now },
      configurable: true,
    });
    globalThis.requestAnimationFrame = (callback) => raf.push(callback);
    try {
      await startCollector({ evaluate: async (fn, arg) => fn(arg) }, 'collector-test');
      now = 16;
      raf.shift()(now);
      globalThis.window.__hitchReferee.markWarmup();
      programs.push({ cacheKey: 'postwarm-program' });
      now = 76;
      raf.shift()(now);
      const raw = globalThis.window.__hitchReferee.stop();
      expect(raw.heapFloor).toEqual({ growthMb: 1 });
      expect(raw.heapFloorSeries).toEqual([
        { atMs: 0, floorMb: 100 },
        { atMs: 1000, floorMb: 101 },
      ]);
      expect(programKeysCreatedSince(raw.baselineProgramKeys, raw.observedProgramKeys)).toEqual([
        'postwarm-program',
      ]);
    } finally {
      if (previous.window === undefined) delete globalThis.window;
      else globalThis.window = previous.window;
      Object.defineProperty(globalThis, 'performance', {
        value: previous.performance,
        configurable: true,
      });
      if (previous.requestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
      else globalThis.requestAnimationFrame = previous.requestAnimationFrame;
    }
  });

  it('acquires fixture ownership before database seeding and releases it', async () => {
    const events = [];
    const roster = new HitchRoster({
      serverUrl: 'http://localhost:8787',
      databaseUrl: 'postgres://localhost/test',
      fixtureLock: () => {
        events.push('lock');
        return () => events.push('release');
      },
      getServerStatus: async () => {
        events.push('status');
        return { realm: 'Claudemoon', players_online: 0 };
      },
      seed: async () => {
        events.push('seed');
        return { records: [], camera: { token: 'x' }, payloadBytes: 1, cosmeticRows: 0 };
      },
      waitDbQuiet: async () => events.push('quiet'),
      delay: async () => {},
    });
    roster.takeover = async () => events.push('takeover');
    await roster.prepare();
    roster.release();
    expect(events).toEqual(['lock', 'status', 'seed', 'takeover', 'status', 'quiet', 'release']);
  });

  it('arms profiler invulnerability for every roster bot on each world entry', async () => {
    const events = [];
    let session = 0;
    const roster = new HitchRoster({
      serverUrl: 'http://localhost:8787',
      databaseUrl: 'postgres://localhost/test',
      delay: async () => {},
      createBot: (record) => {
        const entry = ++session;
        return {
          ...record,
          connect: async () => events.push(`connect:${entry}:${record.index}`),
          cmd: (message) => {
            events.push(`cmd:${entry}:${record.index}:${message.cmd}`);
            return true;
          },
        };
      },
    });
    roster.records = [
      { index: 0, role: 'crowd' },
      { index: 1, role: 'crowd' },
    ];
    roster.takeover = async () => {};

    await roster.connect('all');
    await roster.connect('all');

    expect(events.filter((event) => event.includes('dev_profiler_invulnerable'))).toEqual([
      'cmd:1:0:dev_profiler_invulnerable',
      'cmd:2:1:dev_profiler_invulnerable',
      'cmd:3:0:dev_profiler_invulnerable',
      'cmd:4:1:dev_profiler_invulnerable',
    ]);
    for (let entry = 1; entry <= 4; entry += 1) {
      expect(events.indexOf(`connect:${entry}:${(entry - 1) % 2}`)).toBeLessThan(
        events.indexOf(`cmd:${entry}:${(entry - 1) % 2}:dev_profiler_invulnerable`),
      );
    }
  });

  it('fails roster connection when profiler invulnerability cannot be sent', async () => {
    const roster = new HitchRoster({
      serverUrl: 'http://localhost:8787',
      databaseUrl: 'postgres://localhost/test',
      delay: async () => {},
      createBot: (record) => ({
        ...record,
        connect: async () => {},
        cmd: () => false,
        logout: async () => {},
      }),
    });
    roster.records = [{ index: 0, role: 'crowd' }];
    roster.takeover = async () => {};

    await expect(roster.connect('all')).rejects.toThrow(
      /crowd bot 0 could not arm profiler invulnerability/,
    );
  });

  it('captures top-level and personal event errors plus every HUD combat signal', async () => {
    let clock = 1_000;
    let socket;
    class FakeWorldSocket extends EventEmitter {
      constructor() {
        super();
        this.readyState = 1;
        queueMicrotask(() => {
          this.emit('open');
          this.emit('message', JSON.stringify({ t: 'hello', pid: 7 }));
          this.emit(
            'message',
            JSON.stringify({
              t: 'snap',
              self: { x: 0, z: 0, f: 0, lv: 20 },
              ents: [{ id: 99, k: 'mob', dead: 0, aggro: 7 }],
            }),
          );
          clock += HITCH_CROWD_COMBAT_QUIET_MS + 1;
          this.emit(
            'message',
            JSON.stringify({
              t: 'events',
              list: [
                { type: 'log', text: 'not an error' },
                { type: 'error', text: "You can't do that while in combat.", pid: 7 },
                { type: 'error', text: 'bags full', pid: 7 },
                { type: 'damage', sourceId: 99, targetId: 7, amount: 0, crit: false },
              ],
            }),
          );
          this.emit('message', JSON.stringify({ t: 'error', error: 'item use rejected' }));
          this.emit('message', JSON.stringify({ t: 'err', text: 'resurrection denied' }));
        });
      }

      send() {}

      close() {}
    }

    const bot = new HitchBot(
      { name: 'hitch-bot', token: 'token', characterId: 1, ip: '127.0.0.2' },
      'ws://localhost:8787/ws',
      () => {
        socket = new FakeWorldSocket();
        return socket;
      },
      () => clock,
    );
    await bot.connect();

    expect(bot.serverErrors).toEqual([
      "You can't do that while in combat.",
      'bags full',
      'item use rejected',
      'resurrection denied',
    ]);
    expect(bot.combatActiveAt(clock)).toBe(true);
    clock += HITCH_CROWD_COMBAT_QUIET_MS + 1;
    expect(bot.combatActiveAt(clock)).toBe(true);

    socket.emit(
      'message',
      JSON.stringify({
        t: 'snap',
        self: { x: 0, z: 0, f: 0, lv: 20 },
        ents: [],
        keep: [99],
      }),
    );
    expect(bot.combatActiveAt(clock)).toBe(true);

    socket.emit(
      'message',
      JSON.stringify({
        t: 'snap',
        self: { x: 0, z: 0, f: 0, lv: 20 },
        ents: [{ id: 99, dead: 1, aggro: 7 }],
      }),
    );
    expect(bot.combatActiveAt(clock)).toBe(false);

    socket.emit(
      'message',
      JSON.stringify({
        t: 'events',
        list: [{ type: 'damage', sourceId: 50, targetId: 51, amount: 1, crit: false }],
      }),
    );
    expect(bot.combatActiveAt(clock)).toBe(false);
    socket.emit(
      'message',
      JSON.stringify({
        t: 'events',
        list: [{ type: 'damage', sourceId: 7, targetId: 51, amount: 1, crit: false }],
      }),
    );
    expect(bot.combatActiveAt(clock)).toBe(true);
    clock += HITCH_CROWD_COMBAT_QUIET_MS + 1;
    socket.emit(
      'message',
      JSON.stringify({
        t: 'events',
        list: [{ type: 'damage', sourceId: 50, targetId: 7, amount: 1, crit: false }],
      }),
    );
    expect(bot.combatActiveAt(clock)).toBe(true);

    clock += HITCH_CROWD_COMBAT_QUIET_MS + 1;
    socket.emit(
      'message',
      JSON.stringify({
        t: 'snap',
        self: { x: 0, z: 0, f: 0, lv: 20 },
        ents: [{ id: 99, dead: 0, aggro: 7 }],
      }),
    );
    expect(bot.combatActiveAt(clock)).toBe(true);
    socket.emit(
      'message',
      JSON.stringify({
        t: 'snap',
        self: { x: 0, z: 0, f: 0, lv: 20 },
        ents: [{ id: 99, dead: 0 }],
      }),
    );
    expect(bot.combatActiveAt(clock)).toBe(false);
  });

  it('teleports the measured player to the named aggro-free influx arena', async () => {
    const teleports = [];
    const profiler = {
      page: { id: 'measured-page' },
      teleport: async (...args) => teleports.push(args),
    };

    await expect(
      stageCrowdInfluxArena(profiler, async (page) => {
        expect(page).toBe(profiler.page);
        return { x: HITCH_CROWD_INFLUX_X, z: HITCH_CROWD_INFLUX_Z };
      }),
    ).resolves.toEqual({ x: HITCH_CROWD_INFLUX_X, z: HITCH_CROWD_INFLUX_Z });
    expect(teleports).toEqual([[HITCH_CROWD_INFLUX_X, HITCH_CROWD_INFLUX_Z, 0]]);

    await expect(
      stageCrowdInfluxArena(profiler, async () => ({
        x: HITCH_CROWD_INFLUX_X + HITCH_CROWD_PARKING_TOLERANCE + 0.01,
        z: HITCH_CROWD_INFLUX_Z,
      })),
    ).rejects.toThrow(/camera did not reach aggro-free arena/);
  });

  it('stages the named aggro-free arena before the real crowd influx path measures', async () => {
    const order = [];
    const teleports = [];
    const inputs = [];
    const clearedIntervals = [];
    let movementTick;
    const reset = {
      bots: 1,
      recovery: { ok: true, phase: 'recovery', bots: 1, failures: [], attempts: 0 },
      neutral: { ok: true, phase: 'neutral', bots: 1, failures: [], attempts: 1 },
      presented: { ok: true, phase: 'presented', bots: 1, failures: [], attempts: 1 },
    };
    const session = {
      profiler: {
        page: {},
        lookSweep: async () => {
          for (let tick = 0; tick < 13; tick += 1) movementTick();
          order.push('lookSweep');
        },
      },
    };
    const roster = {
      quietBarrier: async () => {
        order.push('quiet');
        return { queries: 0 };
      },
    };
    const bot = {
      index: 0,
      teleport: (x, z) => teleports.push({ x, z }),
      input: (move, facing) => inputs.push({ move, facing }),
    };

    const result = await crowdInflux(session, { name: 'crowd-influx' }, roster, [bot], reset, {
      stageArena: async () => {
        order.push('stage');
        return { x: HITCH_CROWD_INFLUX_X, z: HITCH_CROWD_INFLUX_Z };
      },
      delay: async () => order.push('delay'),
      measure: async (_session, _spec, action) => {
        order.push('measure');
        await action();
        return { frames: [] };
      },
      waitForVisible: async () => order.push('visible'),
      cosmetics: async () => ({ players: 1, skins: 4, weaponSkins: 4, mounts: 3 }),
      setInterval: (callback, intervalMs) => {
        expect(intervalMs).toBe(250);
        movementTick = callback;
        return 'crowd-mover';
      },
      clearInterval: (id) => clearedIntervals.push(id),
    });

    expect(order).toEqual(['stage', 'delay', 'quiet', 'measure', 'delay', 'visible', 'lookSweep']);
    expect(teleports).toHaveLength(1);
    expect(inputs.filter(({ move }) => move.f === 1)).toHaveLength(12);
    expect(inputs.filter(({ move }) => Object.keys(move).length === 0)).toHaveLength(2);
    expect(inputs.at(-1)).toEqual({ move: {}, facing: 0 });
    expect(clearedIntervals).toEqual(['crowd-mover', 'crowd-mover']);
    expect(result.validation.reset).toBe(reset);
  });

  it('always tears a scenario down after online success and offline failure', async () => {
    const online = [];
    const resetEvidence = {
      bots: 1,
      recovery: { ok: true, phase: 'recovery', bots: 1, failures: [], attempts: 0 },
      neutral: { ok: true, phase: 'neutral', bots: 1, failures: [], attempts: 1 },
      presented: { ok: true, phase: 'presented', bots: 1, failures: [], attempts: 1 },
    };
    const roster = {
      camera: {},
      seedEvidence: {},
      connect: async () => {
        online.push('connect');
        return ['bot'];
      },
      takeover: async () => online.push('takeover'),
      cameraFixture: () => ({}),
      closeBots: async (bots) => online.push(`closeBots:${bots.length}`),
      drain: async () => online.push('drain'),
    };
    await runHitchScenario(
      {
        name: 'crowd-influx',
        preset: 'insane',
        offlineUrl: 'http://localhost:5173',
        serverUrl: 'http://localhost:8787',
        roster,
      },
      {
        prepareCrowd: async () => {
          online.push('prepareCrowd');
          return resetEvidence;
        },
        openBrowser: async () => {
          online.push('openBrowser');
          return {
            browserVersion: 'Chrome',
            browserFlags: [],
            freshProfile: true,
          };
        },
        closeBrowser: async () => online.push('closeBrowser'),
        crowd: async (_session, _spec, _roster, _bots, reset) => {
          online.push('measure');
          expect(reset).toBe(resetEvidence);
          return { frames: [] };
        },
      },
    );
    expect(online.indexOf('prepareCrowd')).toBeLessThan(online.indexOf('openBrowser'));
    expect(online.indexOf('openBrowser')).toBeLessThan(online.indexOf('measure'));
    expect(online.slice(-4)).toEqual(['closeBrowser', 'closeBots:1', 'takeover', 'drain']);

    const offline = [];
    await expect(
      runHitchScenario(
        {
          name: 'cold-zone-entry',
          preset: 'insane',
          offlineUrl: 'http://localhost:5173',
          serverUrl: 'http://localhost:8787',
        },
        {
          openBrowser: async () => ({}),
          closeBrowser: async () => offline.push('closeBrowser'),
          offline: async () => {
            throw new Error('measurement failed');
          },
        },
      ),
    ).rejects.toThrow(/measurement failed/);
    expect(offline).toEqual(['closeBrowser']);
  });

  it('drives a dirty crowd bot through neutral and presented convergence', async () => {
    const commands = [];
    const timedActions = [];
    let heldForward = false;
    let clock = 0;
    let mountReadyAt = null;
    let summonAttempts = 0;
    const bot = {
      index: 0,
      cls: 'warrior',
      skin: 3,
      weaponType: 'sword',
      weaponSkin: 'cinderbrand_sword',
      mountItem: 'reins_valorsteed',
      selfFrame: {
        x: 0,
        z: 0,
        f: 0.4,
        lv: 20,
        sk: 6,
        wsk: 'old_sword',
        mnt: 'grag_bear',
        ws: 1,
        auras: [{ id: 'battle_stance' }, { id: 'power_word_fortitude' }],
        target: 99,
        auto: true,
        queued: 'heroic_strike',
        cast: 'slam',
        inv: [],
      },
    };
    const replaceFrame = (patch, removed = []) => {
      const next = { ...bot.selfFrame, ...patch };
      for (const key of removed) delete next[key];
      bot.selfFrame = next;
    };
    bot.input = (move, facing) => {
      commands.push({ cmd: 'input', move, facing });
      timedActions.push({ at: clock, kind: 'input', move, facing });
      if (mountReadyAt !== null) {
        mountReadyAt = null;
        replaceFrame({}, ['mcr', 'mck']);
      }
      replaceFrame({ f: facing });
      heldForward = move.f === 1;
      if (move.f === 1) replaceFrame({}, ['cast', 'mcr', 'mck']);
    };
    bot.cmd = (message) => {
      commands.push(message);
      timedActions.push({ at: clock, kind: 'command', payload: message });
      if (message.cmd === 'target') replaceFrame({}, ['target', 'auto']);
      if (message.cmd === 'dev_teleport') replaceFrame({ x: message.x, z: message.z });
      if (message.cmd === 'change_skin') replaceFrame({ sk: message.skin });
      if (message.cmd === 'change_weapon_skin') {
        if (message.skin === null) replaceFrame({}, ['wsk']);
        else replaceFrame({ wsk: message.skin });
      }
      if (message.cmd === 'dev_give') {
        replaceFrame({ inv: [{ itemId: message.item, count: message.count }] });
      }
      if (message.cmd === 'chat' && message.text === '/dev mounts') {
        replaceFrame({ mntRtd: true });
      }
      if (message.cmd === 'mount_toggle') replaceFrame({}, ['mnt']);
      if (message.cmd === 'stow_weapon') replaceFrame({}, ['ws']);
      if (message.cmd === 'cancel_aura') {
        replaceFrame({ auras: bot.selfFrame.auras.filter((aura) => aura.id !== message.aura) });
      }
      if (message.cmd === 'use' && bot.selfFrame.inv.some((slot) => slot.itemId === message.item)) {
        summonAttempts += 1;
        if (summonAttempts > 1) {
          mountReadyAt = clock + 1_500;
          replaceFrame({ mcr: 1.5, mck: message.item.slice('reins_'.length) });
        }
      }
      if (message.cmd === 'chat' && message.text === '/dev combatreset') {
        replaceFrame({}, ['auto', 'queued']);
      }
    };

    const wait = async (ms) => {
      clock += ms;
      if (heldForward) replaceFrame({ x: bot.selfFrame.x + 1 });
      if (mountReadyAt !== null) {
        if (clock >= mountReadyAt) {
          replaceFrame({ mnt: bot.selfFrame.mck }, ['mcr', 'mck']);
          mountReadyAt = null;
        } else {
          replaceFrame({ mcr: (mountReadyAt - clock) / 1_000 });
        }
      }
    };
    const evidence = await prepareCrowdBots([bot], { wait, now: () => clock });

    // Attempt counts pin the paced schedule: recovery holds the dev_give reins
    // fallback until the mount grant's 1 s readback window has passed, and
    // neutral holds its '/dev combatreset' until the 3.5 s whole-lane chat
    // spacing from recovery's '/dev mounts' has elapsed, so both phases poll
    // (200 ms apart) while the ledger keeps the connection under the server's
    // chat ladder instead of re-sending every poll.
    expect(evidence).toEqual({
      bots: 1,
      recovery: { ok: true, phase: 'recovery', bots: 1, failures: [], attempts: 6 },
      neutral: { ok: true, phase: 'neutral', bots: 1, failures: [], attempts: 13 },
      presented: { ok: true, phase: 'presented', bots: 1, failures: [], attempts: 25 },
    });
    expect(commands).toContainEqual({ cmd: 'target', id: null });
    expect(commands).toContainEqual({ cmd: 'mount_toggle' });
    expect(commands).toContainEqual({ cmd: 'dev_give', item: 'reins_valorsteed', count: 1 });
    const useIndexes = commands
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => message.cmd === 'use' && message.item === 'reins_valorsteed')
      .map(({ index }) => index);
    expect(useIndexes).toHaveLength(2);
    const timedUses = timedActions.filter(
      (action) =>
        action.kind === 'command' &&
        action.payload.cmd === 'use' &&
        action.payload.item === 'reins_valorsteed',
    );
    // The lost first summon retries exactly one 3 s coordinator hold later.
    expect(timedUses.map((action) => action.at)).toEqual([4_200, 7_200]);
    expect(
      timedActions.filter((action) => action.at > timedUses[0].at && action.at < timedUses[1].at),
    ).toEqual([]);
    const useIndex = commands.findLastIndex(
      (message) => message.cmd === 'use' && message.item === 'reins_valorsteed',
    );
    expect(commands.slice(useIndex + 1)).toEqual([]);
    // Replay the server's chat ladder (server/game.ts consumeChatToken: burst
    // 5, refill 1/3 token per second) over every chat send the whole reset
    // issued on this connection: the bucket must never run dry, because three
    // consecutive refusals lock chat for 20 s and doom the phase.
    const chatSends = timedActions.filter(
      (action) => action.kind === 'command' && action.payload.cmd === 'chat',
    );
    expect(chatSends.length).toBeGreaterThan(0);
    let chatTokens = 5;
    let lastChatAt = chatSends[0].at;
    for (const send of chatSends) {
      chatTokens = Math.min(5, chatTokens + (send.at - lastChatAt) / 1_000 / 3);
      lastChatAt = send.at;
      expect(chatTokens, `chat ladder tokens at ${send.at}ms`).toBeGreaterThanOrEqual(1);
      chatTokens -= 1;
    }
    expect(bot.selfFrame).toMatchObject({
      lv: 20,
      f: 0,
      sk: 3,
      wsk: 'cinderbrand_sword',
      mnt: 'valorsteed',
      auras: [{ id: 'battle_stance' }],
    });
    expect(Math.abs(bot.selfFrame.x - HITCH_CROWD_PARKING_X)).toBeLessThanOrEqual(
      HITCH_CROWD_PARKING_TOLERANCE,
    );
    expect(Math.abs(bot.selfFrame.z - HITCH_CROWD_PARKING_Z)).toBeLessThanOrEqual(
      HITCH_CROWD_PARKING_TOLERANCE,
    );
  });

  it('fails prepareCrowdBots closed when the runtime observer reports combat', async () => {
    let clock = 0;
    const bot = {
      index: 0,
      cls: 'warrior',
      skin: 3,
      weaponType: 'sword',
      weaponSkin: 'cinderbrand_sword',
      mountItem: 'reins_valorsteed',
      hitchProfilerInvulnerable: true,
      selfFrame: {
        x: HITCH_CROWD_PARKING_X,
        z: HITCH_CROWD_PARKING_Z,
        f: 0,
        lv: 20,
        sk: 0,
        mntRtd: true,
        auras: [{ id: 'battle_stance' }],
        inv: [{ itemId: 'reins_valorsteed', count: 1 }],
      },
      combatActiveAt: () => true,
    };
    bot.input = (_move, facing) => {
      bot.selfFrame = { ...bot.selfFrame, f: facing };
    };
    bot.cmd = (message) => {
      if (message.cmd === 'change_skin') {
        bot.selfFrame = { ...bot.selfFrame, sk: message.skin };
      }
      if (message.cmd === 'change_weapon_skin') {
        bot.selfFrame = { ...bot.selfFrame, wsk: message.skin };
      }
      if (message.cmd === 'use') {
        bot.selfFrame = { ...bot.selfFrame, mnt: 'valorsteed' };
      }
    };

    await expect(
      prepareCrowdBots([bot], {
        wait: async (ms) => {
          clock += ms;
        },
        now: () => clock,
      }),
    ).rejects.toThrow(/crowd reset neutral did not converge: bot 0 remained in combat/);
  });

  it('recovers a dead bot before neutral work and re-arms protection after resurrection', async () => {
    const commands = [];
    let clock = 0;
    let mountGrantAttempts = 0;
    const bot = {
      index: 0,
      cls: 'warrior',
      skin: 3,
      weaponType: 'sword',
      weaponSkin: 'cinderbrand_sword',
      mountItem: 'reins_valorsteed',
      selfFrame: {
        x: 120,
        z: 80,
        f: 1,
        lv: 20,
        dead: 1,
        auras: [{ id: 'battle_stance' }],
      },
      input: (move, facing) => commands.push({ cmd: 'input', move, facing }),
    };
    const replaceFrame = (patch, removed = []) => {
      const next = { ...bot.selfFrame, ...patch };
      for (const key of removed) delete next[key];
      bot.selfFrame = next;
    };
    bot.cmd = (message) => {
      commands.push(message);
      if (message.cmd === 'dev_level') replaceFrame({ lv: message.level });
      if (message.cmd === 'release') replaceFrame({ gh: 1, auras: [] });
      if (message.cmd === 'resurrect_healer') replaceFrame({}, ['dead', 'gh']);
      if (message.cmd === 'dev_give') {
        replaceFrame({ inv: [{ itemId: message.item, count: message.count }] });
      }
      if (message.cmd === 'chat' && message.text === '/dev mounts') {
        mountGrantAttempts += 1;
        if (mountGrantAttempts > 1) {
          replaceFrame({
            mntRtd: true,
            inv: [{ itemId: 'reins_valorsteed', count: 1 }],
          });
        }
      }
    };

    const recovery = await recoverCrowdBots([bot], {
      wait: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    });

    // The lost first '/dev mounts' grant retries only after the 3.5 s chat
    // quiet window (the server ladder refills one token per 3 s), so recovery
    // polls at 200 ms while the ledger holds the resend.
    expect(recovery).toEqual({
      ok: true,
      phase: 'recovery',
      bots: 1,
      failures: [],
      attempts: 23,
    });
    expect(commands.filter((message) => message.cmd === 'dev_profiler_invulnerable')).toHaveLength(
      2,
    );
    expect(commands).toContainEqual({ cmd: 'dev_level', level: 1 });
    expect(commands).toContainEqual({ cmd: 'release' });
    expect(commands).toContainEqual({ cmd: 'resurrect_healer' });
    expect(commands).toContainEqual({ cmd: 'dev_level', level: 20 });
    expect(
      commands.filter((message) => message.cmd === 'chat' && message.text === '/dev mounts'),
    ).toHaveLength(2);
    const restoredLevel = commands.findIndex(
      (message) => message.cmd === 'dev_level' && message.level === 20,
    );
    const firstMountGrant = commands.findIndex(
      (message) => message.cmd === 'chat' && message.text === '/dev mounts',
    );
    const bagCheckFallback = commands.findIndex((message) => message.cmd === 'dev_give');
    const secondMountGrant = commands.findIndex(
      (message, index) =>
        index > firstMountGrant && message.cmd === 'chat' && message.text === '/dev mounts',
    );
    expect(firstMountGrant).toBeGreaterThan(restoredLevel);
    expect(bagCheckFallback).toBeGreaterThan(firstMountGrant);
    expect(secondMountGrant).toBeGreaterThan(bagCheckFallback);
    const neutralStart = commands.findIndex((message) => message.cmd === 'dev_teleport');
    expect(neutralStart).toBe(-1);
    expect(bot.selfFrame).toMatchObject({
      lv: 20,
      auras: [],
      mntRtd: true,
      inv: [{ itemId: 'reins_valorsteed', count: 1 }],
    });
    expect(bot.selfFrame).not.toHaveProperty('dead');
    expect(bot.selfFrame).not.toHaveProperty('gh');
  });

  it('completes life recovery before prepareCrowdBots can begin neutral work', async () => {
    const commands = [];
    let clock = 0;
    const bot = {
      index: 0,
      cls: 'warrior',
      skin: 3,
      weaponType: 'sword',
      weaponSkin: 'cinderbrand_sword',
      mountItem: 'reins_valorsteed',
      selfFrame: { x: 120, z: 80, f: 0, lv: 20, dead: 1, auras: [] },
      input: (move, facing) => commands.push({ cmd: 'input', move, facing }),
    };
    const replaceFrame = (patch, removed = []) => {
      const next = { ...bot.selfFrame, ...patch };
      for (const key of removed) delete next[key];
      bot.selfFrame = next;
    };
    bot.cmd = (message) => {
      commands.push(message);
      if (message.cmd === 'dev_level') replaceFrame({ lv: message.level });
      if (message.cmd === 'release') replaceFrame({ gh: 1 });
      if (message.cmd === 'resurrect_healer') replaceFrame({}, ['dead', 'gh']);
    };

    await expect(
      prepareCrowdBots([bot], {
        wait: async (ms) => {
          clock += ms;
        },
        now: () => clock,
      }),
    ).rejects.toThrow(
      /crowd reset recovery did not converge:.*mount reins reins_valorsteed were not in bags/,
    );

    const resurrection = commands.findIndex((message) => message.cmd === 'resurrect_healer');
    const restoredLevel = commands.findIndex(
      (message, index) =>
        index > resurrection && message.cmd === 'dev_level' && message.level === 20,
    );
    const mountGrant = commands.findIndex((message) => message.cmd === 'dev_give');
    expect(resurrection).toBeGreaterThan(-1);
    expect(restoredLevel).toBeGreaterThan(resurrection);
    expect(mountGrant).toBeGreaterThan(restoredLevel);
    expect(commands.some((message) => message.cmd === 'dev_teleport')).toBe(false);
  });

  it('treats an omitted legacy aura field as an empty aura set', async () => {
    const previous = {
      x: 120,
      z: 80,
      f: 0,
      lv: 20,
      auras: [{ id: 'resurrection_sickness' }],
    };
    const latest = { x: 120, z: 80, f: 0, lv: 20 };
    expect(mergeLegacySelfSnapshot(previous, latest)).toEqual({ ...latest, auras: [] });

    const bot = {
      index: 0,
      cls: 'warrior',
      skin: 3,
      weaponType: 'sword',
      weaponSkin: 'cinderbrand_sword',
      mountItem: 'reins_valorsteed',
      self: {
        ...previous,
        mntRtd: true,
        inv: [{ itemId: 'reins_valorsteed', count: 1 }],
      },
      selfFrame: latest,
      cmd: () => {},
      input: () => {},
    };

    await expect(recoverCrowdBots([bot], { wait: async () => {}, now: () => 0 })).resolves.toEqual({
      ok: true,
      phase: 'recovery',
      bots: 1,
      failures: [],
      attempts: 0,
    });
  });

  it('retains a bounded server error tail and includes it in recovery timeouts', async () => {
    let errors = [];
    for (let index = 0; index < 12; index += 1) {
      errors = appendHitchBotServerError(errors, `error-${index}`);
    }
    expect(errors).toEqual(Array.from({ length: 10 }, (_, index) => `error-${index + 2}`));

    let clock = 0;
    const bot = {
      index: 0,
      cls: 'warrior',
      skin: 3,
      weaponType: 'sword',
      weaponSkin: 'cinderbrand_sword',
      mountItem: 'reins_valorsteed',
      selfFrame: { x: 120, z: 80, f: 0, lv: 1, dead: 1, gh: 1, auras: [] },
      serverErrors: errors,
      cmd: () => {},
      input: () => {},
    };
    await expect(
      recoverCrowdBots([bot], {
        wait: async (ms) => {
          clock += ms;
        },
        now: () => clock,
      }),
    ).rejects.toThrow(/server said: error-2.*error-11/);
  });

  it('includes the server error tail when neutral reset times out', async () => {
    let clock = 0;
    const bot = {
      index: 0,
      cls: 'warrior',
      skin: 3,
      weaponType: 'sword',
      weaponSkin: 'cinderbrand_sword',
      mountItem: 'reins_valorsteed',
      selfFrame: {
        x: 0,
        z: 0,
        f: 0,
        lv: 20,
        mntRtd: true,
        auras: [{ id: 'battle_stance' }],
        inv: [{ itemId: 'reins_valorsteed', count: 1 }],
      },
      serverErrors: ['teleport rejected while dead'],
      cmd: () => {},
      input: () => {},
    };

    await expect(
      prepareCrowdBots([bot], {
        wait: async (ms) => {
          clock += ms;
        },
        now: () => clock,
      }),
    ).rejects.toThrow(/crowd reset neutral did not converge:.*server said: teleport rejected/);
  });

  it('fails before reset when direct grant still leaves mount reins outside bags', async () => {
    const commands = [];
    const bot = {
      index: 0,
      cls: 'warrior',
      skin: 3,
      weaponType: 'sword',
      weaponSkin: 'cinderbrand_sword',
      mountItem: 'reins_valorsteed',
      selfFrame: { lv: 20, inv: [] },
      cmd: (message) => commands.push(message),
      input: () => {},
    };
    let clock = 0;

    await expect(
      prepareCrowdBots([bot], {
        wait: async (ms) => {
          clock += ms;
        },
        now: () => clock,
      }),
    ).rejects.toThrow(
      /crowd reset recovery did not converge:.*mount reins reins_valorsteed were not in bags/,
    );
    expect(commands).toContainEqual({ cmd: 'dev_give', item: 'reins_valorsteed', count: 1 });
    expect(commands.some((message) => message.cmd === 'dev_teleport')).toBe(false);
  });

  it('neutralizes every soak bot before opening the measured page', async () => {
    const events = [];
    const makeBot = (index, mounted) => ({
      index,
      weaponType: index === 0 ? 'sword' : 'staff',
      self: { mnt: mounted },
      cmd: (message) =>
        events.push(`bot${index}:${message.cmd}:${message.skin ?? message.text ?? ''}`),
      input: () => events.push(`bot${index}:stop`),
    });
    const bots = [makeBot(0, true), makeBot(1, false)];
    const roster = {
      camera: {},
      seedEvidence: {},
      connect: async () => bots,
      takeover: async () => events.push('takeover'),
      cameraFixture: () => ({}),
      closeBots: async () => {},
      drain: async () => {},
    };

    await runHitchScenario(
      {
        name: 'soak',
        preset: 'insane',
        offlineUrl: 'http://localhost:5173',
        serverUrl: 'http://localhost:8787',
        roster,
        measureMs: 5_000,
      },
      {
        wait: async () => {},
        openBrowser: async () => {
          events.push('openBrowser');
          return { browserVersion: 'Chrome', browserFlags: [], freshProfile: true };
        },
        closeBrowser: async () => {},
        soak: async () => {
          events.push('measure');
          return { frames: [] };
        },
      },
    );

    const openIndex = events.indexOf('openBrowser');
    expect(openIndex).toBeGreaterThan(0);
    expect(events.slice(0, openIndex)).toEqual([
      'bot0:chat:/dev mounts',
      'bot1:chat:/dev mounts',
      'bot0:stop',
      'bot0:change_skin:0',
      'bot0:change_weapon_skin:',
      'bot0:mount_toggle:',
      'bot1:stop',
      'bot1:change_skin:0',
      'bot1:change_weapon_skin:',
      'takeover',
    ]);
    expect(events.indexOf('measure')).toBeGreaterThan(openIndex);
  });

  it('applies all 460 planned ragged-space cosmetic triplets through the soak command path', () => {
    // Live-fire over the REAL fixture roster and skin lists: the plan's
    // per-type rotations must only ever reference server-valid cosmetics
    // (the bow list is ragged with 3 skins, the other types carry 4).
    // Budget: 60 steps * 12 incoming = 720 applications; unique concrete
    // triplets = sword 60 + mace 120 + bow 60 + dagger 60 + staff 160 = 460
    // (per type: min(bots * 20 rounds, 8 skins * variants * 5 mounts); the
    // full arithmetic is pinned in tests/perf_hitch_soak.test.mjs).
    const rows = buildHitchFixtureRows();
    const bots = rows.map((row) => {
      const bot = {
        index: row.index,
        weaponType: row.weaponType,
        hitchMountItem: null,
        skin: null,
        weaponSkin: null,
        cmd: (message) => {
          if (message.cmd === 'change_skin') bot.skin = message.skin;
          if (message.cmd === 'change_weapon_skin') bot.weaponSkin = message.skin;
        },
      };
      return bot;
    });
    const observed = new Set();
    let positions = 0;
    const plan = buildSoakChurnPlan({
      botCount: rows.length,
      measureMs: 600_000,
      ...soakCosmeticInputs(rows),
    });

    for (const entry of plan.steps.flatMap((step) => step.incoming)) {
      const bot = bots[entry.botIndex];
      applySoakAppearance(bot, entry, () => {
        positions += 1;
      });
      expect(bot.skin).toBe(entry.skin);
      observed.add(`${bot.weaponType}:${bot.skin}:${bot.weaponSkin}:${bot.hitchMountItem}`);
    }

    expect(positions).toBe(720);
    expect(observed.size).toBe(460);
  });

  it('bounds fixture work and releases ownership even when emergency cleanup rejects', async () => {
    let active = 0;
    let peak = 0;
    await runBounded(
      Array.from({ length: 12 }, (_, index) => index),
      3,
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
      },
    );
    expect(peak).toBe(3);

    const events = [];
    const roster = new HitchRoster({
      serverUrl: 'http://localhost:8787',
      databaseUrl: 'postgres://localhost/test',
    });
    roster.activeBots.add({});
    roster.records = [{}];
    roster.camera = {};
    roster.seedEvidence = {};
    roster.releaseFixtureLock = () => events.push('release');
    roster.closeBots = async () => {
      events.push('closeBots');
      throw new Error('logout failed');
    };
    roster.takeover = async () => events.push('takeover');
    roster.drain = async () => {
      events.push('drain');
      throw new Error('drain failed');
    };
    await expect(roster.emergencyCleanup()).rejects.toThrow(/logout failed/);
    expect(events).toEqual(['closeBots', 'takeover', 'drain', 'release']);
  });

  it('plans the frozen CLI behavior and rejects drift', () => {
    expect(buildHitchCliPlan(['run', '--preset', 'insane', '--gate'])).toMatchObject({
      command: 'run',
      preset: 'insane',
      gate: true,
      names: SCENARIO_NAMES,
      soakMs: null,
    });
    expect(
      buildHitchCliPlan(['run', '--preset', 'high', '--scenario', 'soak', '--soak-ms', '5000']),
    ).toMatchObject({
      names: ['soak'],
      soakMs: 5000,
    });
    expect(buildHitchCliPlan(['calibrate'])).toEqual({
      command: 'calibrate',
      preset: 'insane',
      names: SCENARIO_NAMES,
      soakMs: null,
      calibrationRuns: 3,
    });
    expect(() => buildHitchCliPlan(['run', '--preset', 'nope'])).toThrow(/preset/i);
    expect(() =>
      buildHitchCliPlan([
        'run',
        '--preset',
        'insane',
        '--scenario',
        'sky-crossing',
        '--soak-ms',
        '5000',
      ]),
    ).toThrow(/only valid/i);
    expect(() => buildHitchCliPlan(['calibrate', '--preset', 'low'])).toThrow(/unknown option/i);
  });

  it('keeps the entrypoint on the frozen CLI and avoids software rendering flags', () => {
    const source = readFileSync(new URL('../scripts/perf_hitch.mjs', import.meta.url), 'utf8');
    expect(source).toContain("if (command === 'run')");
    expect(source).toContain("else if (command === 'calibrate')");
    expect(source).toContain("else if (command === 'report')");
    expect(source).toContain("command === 'calibrate' ? 75 : 20");
    expect(source).toContain("'scripts/lib/perf_hitch_crowd_reset.mjs'");
    expect(source).not.toMatch(/swiftshader/i);
  });

  it('prints usage instead of a raw stack when the CLI arguments do not parse', () => {
    // The plan is built at module top level, so an unwrapped parse error used
    // to escape the entrypoint's try and print a raw stack with no usage.
    const entry = fileURLToPath(new URL('../scripts/perf_hitch.mjs', import.meta.url));
    let failure = null;
    try {
      execFileSync(process.execPath, [entry, 'bogus'], { encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      failure = error;
    }
    expect(failure?.status).toBe(1);
    expect(failure.stdout).toContain('usage: node scripts/perf_hitch.mjs <run|calibrate|report>');
    expect(failure.stderr).toContain('[hitch] invalid arguments: unknown command: bogus');
    expect(failure.stderr).not.toContain('at buildHitchCliPlan');
  });

  it('keeps page exception stacks separate from console error diagnostics', () => {
    const source = readFileSync(
      new URL('../scripts/lib/perf_hitch_browser.mjs', import.meta.url),
      'utf8',
    );
    expect(source).toContain('error?.stack ?? error');
    expect(source).toContain('consoleErrors.push(message.text().slice(0, 260))');
    expect(source).not.toContain('pageErrors.push(`console:');
  });
});

describe('summarizeScenario', () => {
  it('uses only complete post-warmup frames and preserves the required counters', () => {
    const row = summarizeScenario(rawScenario('crowd-influx'));
    expect(row).toMatchObject({
      name: 'crowd-influx',
      frames: 4,
      postWarmupFrames: 3,
      longFrames: 1,
      worstFrameMs: 60,
      p99FrameMs: 60,
      programCompiles: 1,
      // The duplicate raw baseline key is deduplicated, matching the collector's set.
      baselineProgramCount: 2,
      texturesCreated: 3,
      pooledVisualsCreated: 3,
      submitStallLatched: true,
      submitStallFrames: 2,
      maxSubmitStallMs: 145,
      heapFloorGrowthMb: 4.5,
      settledHeapDeltaMb: 30.25,
      allocationRateMbPerSec: 3.25,
      pageErrorCount: 0,
      tier: 'insane',
      contextLost: 0,
    });
  });

  it('counts every captured page error in the scenario summary', () => {
    const row = summarizeScenario(
      rawScenario('soak', { pageErrors: ['TypeError: first', 'TypeError: second'] }),
    );
    expect(row.pageErrorCount).toBe(2);
  });

  it('keeps pre-settled-heap raw records readable with legacy diagnostics intact', () => {
    const row = summarizeScenario(rawScenario('soak', { settledHeap: undefined }));

    expect(row.settledHeapDeltaMb).toBeNull();
    expect(row.heapFloorGrowthMb).toBe(4.5);
    expect(row.heapSawtooth).toMatchObject({ allocRateMbPerSec: 3.25 });
  });

  it('fails closed with null summaries when evidence is absent', () => {
    const row = summarizeScenario(
      rawScenario('soak', {
        frames: [],
        newProgramKeys: undefined,
        baselineProgramKeys: undefined,
        report: {},
        heapFloor: null,
        heapFloorSeries: null,
        settledHeap: undefined,
      }),
    );
    expect(row.postWarmupFrames).toBe(0);
    expect(row.worstFrameMs).toBeNull();
    expect(row.p99FrameMs).toBeNull();
    expect(row.heapFloorGrowthMb).toBeNull();
    expect(row.settledHeapDeltaMb).toBeNull();
    expect(row.allocationRateMbPerSec).toBeNull();
    expect(row.programCompiles).toBeNull();
    expect(row.baselineProgramCount).toBeNull();
  });

  it('excludes frames that overlap the actual warmup boundary', () => {
    const row = summarizeScenario(
      rawScenario('crowd-influx', {
        warmupBoundaryMs: 3100,
        frames: [
          { atMs: 3120, dtMs: 60 },
          { atMs: 3120, dtMs: 10 },
        ],
      }),
    );
    expect(row.postWarmupFrames).toBe(1);
  });

  it('counts only unique programs first observed after warmup', () => {
    expect(programKeysCreatedSince(['program-a'], ['program-a', 'program-b', 'program-b'])).toEqual(
      ['program-b'],
    );
    expect(programKeysCreatedSince(undefined, ['program-a'])).toBeNull();
  });
});

describe('makeRunRecord', () => {
  it('keeps compact rows and marks invalid renderer or profile evidence', () => {
    const rec = run({
      'cold-zone-entry': { contextLost: 1 },
      soak: { autoGovernor: true },
    });
    expect(rec).toMatchObject({
      kind: 'hitch-run',
      v: 1,
      preset: 'insane',
      viewport: '1280x720',
      flags: {
        contextLost: true,
        tierMismatch: false,
        governorDisabled: false,
        staleProfile: false,
        pageErrors: false,
      },
      overall: { settledHeapDeltaMb: 40, heapFloorGrowthMb: 40, pageErrorCount: 0 },
    });
    expect(rec.scenarios).toHaveLength(6);
  });
});

describe('deriveCalibration', () => {
  it('requires exactly three comparable same-build full-suite records', () => {
    expect(() => deriveCalibration([run(), run()])).toThrow(/exactly three/i);
    expect(() => deriveCalibration([run(), run(), run(), run()])).toThrow(/exactly three/i);
    expect(() =>
      deriveCalibration([run(), run(), { ...run(), buildId: 'different-build' }]),
    ).toThrow(/buildId mismatch/i);
    const drifted = run();
    drifted.scenarios = drifted.scenarios.map((row) =>
      row.name === 'soak' ? { ...row, measureMs: 30_000 } : row,
    );
    expect(() => deriveCalibration([run(), run(), drifted])).toThrow(/duration drifted/i);
    expect(() => deriveCalibration([run(), run(), run({ soak: { autoGovernor: false } })])).toThrow(
      /invalid renderer evidence/i,
    );
  });

  it.each(['commit', 'preset', 'viewport', 'machine', 'browserVersion'])(
    'rejects same-build calibration drift in %s',
    (field) => {
      expect(() =>
        deriveCalibration([run(), run(), { ...run(), [field]: `different-${field}` }]),
      ).toThrow(new RegExp(`${field} mismatch`, 'i'));
    },
  );

  it('rejects calibration browser flag drift and software renderer evidence', () => {
    expect(() =>
      deriveCalibration([run(), run(), { ...run(), browserFlags: ['--different'] }]),
    ).toThrow(/browserFlags mismatch/i);
    expect(() =>
      deriveCalibration([run(), run(), run({ soak: { glRenderer: 'SwiftShader' } })]),
    ).toThrow(/invalid renderer evidence/i);

    const rendererDrift = run();
    rendererDrift.glRenderer = 'Other real GPU';
    rendererDrift.scenarios = rendererDrift.scenarios.map((row) => ({
      ...row,
      glRenderer: 'Other real GPU',
    }));
    expect(() => deriveCalibration([run(), run(), rendererDrift])).toThrow(/glRenderer mismatch/i);
  });

  it('derives stable noise bounds while keeping compile and worst-frame mission targets fixed', () => {
    const a = run({
      'cold-zone-entry': { longFrames: 0, allocationRateMbPerSec: 2.8 },
      'crowd-influx': { longFrames: 5, programCompiles: 4, worstFrameMs: 230 },
      'cosmetic-churn': { longFrames: 3, programCompiles: 2, worstFrameMs: 180 },
      soak: { longFrames: 0, settledHeapDeltaMb: 38, allocationRateMbPerSec: 3.1 },
    });
    const b = run({
      'cold-zone-entry': { longFrames: 1, allocationRateMbPerSec: 3.0 },
      'crowd-influx': { longFrames: 6, programCompiles: 5, worstFrameMs: 250 },
      'cosmetic-churn': { longFrames: 4, programCompiles: 3, worstFrameMs: 210 },
      soak: { longFrames: 0, settledHeapDeltaMb: 42, allocationRateMbPerSec: 3.3 },
    });
    const c = run({
      'cold-zone-entry': { longFrames: 0, allocationRateMbPerSec: 2.9 },
      'crowd-influx': { longFrames: 4, programCompiles: 3, worstFrameMs: 220 },
      'cosmetic-churn': { longFrames: 5, programCompiles: 4, worstFrameMs: 190 },
      soak: { longFrames: 0, settledHeapDeltaMb: 40, allocationRateMbPerSec: 3.2 },
    });
    const { gate, before } = deriveCalibration([a, b, c]);
    expect(before).toBe(c);
    expect(gate).toMatchObject({
      kind: 'hitch-gate',
      v: 1,
      frozen: true,
      calibrationRuns: 3,
      mission: { maxProgramCompiles: 0, maxWorstFrameMs: 100 },
    });
    expect(gate.scenarios['cold-zone-entry'].longFrames).toEqual({
      kind: 'calibrated',
      samples: [0, 1, 0],
      observedRange: 1,
      noiseFloor: 1,
    });
    expect(gate.scenarios['crowd-influx'].longFrames.noiseFloor).toBe(0);
    expect(gate.scenarios['crowd-influx'].programCompiles.target).toBe(0);
    expect(gate.scenarios['crowd-influx'].programCompiles.kind).toBe('mission');
    expect(gate.scenarios['crowd-influx'].worstFrameMs.target).toBe(100);
    expect(gate.scenarios['crowd-influx'].worstFrameMs.kind).toBe('mission');
    expect(gate.scenarios['crowd-influx'].pageErrorCount.target).toBe(0);
    expect(gate.scenarios['crowd-influx'].pageErrorCount.kind).toBe('mission');
    expect(gate.scenarios['crowd-influx'].allocationRateMbPerSec.kind).toBe('calibrated');
    expect(gate.scenarios.soak.settledHeapDeltaMb).toEqual({
      kind: 'calibrated',
      samples: [38, 42, 40],
      observedRange: 4,
      relativeSpread: 0.1,
      bound: 46,
    });
    expect(gate.missionStraddles).toEqual([]);
    expect(gate.scenarios.soak).not.toHaveProperty('heapFloorGrowthMb');
    expect(gate.scenarios.soak.allocationRateMbPerSec.bound).toBe(3.5);
  });

  it.each([['crowd-influx'], ['cosmetic-churn']])(
    'rejects a %s warmup baseline with no first-draw program evidence',
    (name) => {
      // The warmup BASELINE count is the detection proof that the scenario
      // exercises first-draw work: the crowd links hundreds of programs
      // during boot and warmup on any build, so a near-zero baseline means
      // broken instrumentation or a scenario that stopped drawing.
      const zero = run({ [name]: { baselineProgramCount: 0 } });
      expect(() => deriveCalibration([run(), zero, run()])).toThrow(
        new RegExp(`${name}.*baseline program count 0 is below ${MIN_BASELINE_PROGRAM_COUNT}`),
      );
      const below = run({ [name]: { baselineProgramCount: MIN_BASELINE_PROGRAM_COUNT - 1 } });
      expect(() => deriveCalibration([run(), below, run()])).toThrow(/baseline program count/);
      const atFloor = run({ [name]: { baselineProgramCount: MIN_BASELINE_PROGRAM_COUNT } });
      expect(() => deriveCalibration([run(), atFloor, run()])).not.toThrow();
      const missing = run({ [name]: { baselineProgramCount: null } });
      expect(() => deriveCalibration([run(), missing, run()])).toThrow(
        new RegExp(`${name}.*baselineProgramCount missing`),
      );
    },
  );

  it.each([['crowd-influx'], ['cosmetic-churn']])(
    'freezes when %s links zero post-warmup programs on a healthy build',
    (name) => {
      // Once the perf wave drives live links to zero, recalibration must not
      // deadlock: post-warmup compiles are a mission metric only, and the
      // baseline count above carries the detection proof. The zero mission
      // target itself stays fully enforced in every gate compare.
      const records = [
        run({ [name]: { programCompiles: 0 } }),
        run({ [name]: { programCompiles: 0 } }),
        run({ [name]: { programCompiles: 0 } }),
      ];
      const { gate } = deriveCalibration(records);
      expect(gate.scenarios[name].programCompiles).toMatchObject({
        kind: 'mission',
        samples: [0, 0, 0],
        target: 0,
      });
      const regressed = compareRunToGate(run({ [name]: { programCompiles: 1 } }), gate);
      expect(regressed.failures.join('\n')).toContain(`${name}: programCompiles 1 above 0`);
    },
  );

  it.each([['crowd-influx'], ['cosmetic-churn']])(
    'freezes when %s shows zero long frames on a healthy build',
    (name) => {
      // PR 3161 pulled these scenarios to zero or near-zero long frames on a
      // healthy build, so long frames are deliberately not a detection
      // requirement; the warmup baseline count above remains the detection proof.
      const healthy = run({ [name]: { longFrames: 0 } });
      expect(() => deriveCalibration([run(), healthy, run()])).not.toThrow();
    },
  );

  it('rejects a soak with no positive settled-heap delta', () => {
    expect(() =>
      deriveCalibration([
        run({ soak: { settledHeapDeltaMb: 0 } }),
        run({ soak: { settledHeapDeltaMb: 0 } }),
        run({ soak: { settledHeapDeltaMb: 0 } }),
      ]),
    ).toThrow(/soak.*settled heap/i);
    expect(() =>
      deriveCalibration([
        run({ soak: { settledHeapDeltaMb: 40 } }),
        run({ soak: { settledHeapDeltaMb: 0 } }),
        run({ soak: { settledHeapDeltaMb: 42 } }),
      ]),
    ).toThrow(/soak.*settled heap/i);
    expect(() =>
      deriveCalibration([
        run({ soak: { settledHeapDeltaMb: 40 } }),
        run({ soak: { settledHeapDeltaMb: -0.01 } }),
        run({ soak: { settledHeapDeltaMb: 42 } }),
      ]),
    ).toThrow(/soak.*settled heap/i);
  });

  it.each(SCENARIO_NAMES)('rejects page errors in %s before freezing', (name) => {
    expect(() => deriveCalibration([run(), run({ [name]: { pageErrorCount: 1 } }), run()])).toThrow(
      new RegExp(`${name}.*page error`, 'i'),
    );
    expect(() =>
      deriveCalibration([run(), run({ [name]: { pageErrorCount: null } }), run()]),
    ).toThrow(new RegExp(`${name}.*page error evidence`, 'i'));
  });

  it('rejects an unstable settled-heap spread before freezing', () => {
    expect(() =>
      deriveCalibration([
        run({ soak: { settledHeapDeltaMb: 10 } }),
        run({ soak: { settledHeapDeltaMb: 40 } }),
        run({ soak: { settledHeapDeltaMb: 20 } }),
      ]),
    ).toThrow(/soak.*relative spread/i);
  });

  it('accepts exactly 0.35 settled-heap spread and rejects a value just above it', () => {
    expect(() =>
      deriveCalibration([
        run({ soak: { settledHeapDeltaMb: 53 } }),
        run({ soak: { settledHeapDeltaMb: 53 } }),
        run({ soak: { settledHeapDeltaMb: 74 } }),
      ]),
    ).not.toThrow();
    expect(() =>
      deriveCalibration([
        run({ soak: { settledHeapDeltaMb: 53 } }),
        run({ soak: { settledHeapDeltaMb: 53 } }),
        run({ soak: { settledHeapDeltaMb: 74.01 } }),
      ]),
    ).toThrow(/soak.*relative spread/i);
  });
});

describe('calibration verdict flaps', () => {
  it('names every gate metric kind explicitly in the store', () => {
    expect(HITCH_METRIC_KINDS).toEqual({
      longFrames: 'calibrated',
      allocationRateMbPerSec: 'calibrated',
      settledHeapDeltaMb: 'calibrated',
      programCompiles: 'mission',
      worstFrameMs: 'mission',
      pageErrorCount: 'mission',
    });
  });

  it('stamps the named metric kind on every gate comparison row', () => {
    const { gate } = deriveCalibration([run(), run(), run()]);
    const { rows } = compareRunToGate(run(), gate);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(['mission', 'calibrated']).toContain(row.kind);
      expect(row.kind).toBe(HITCH_METRIC_KINDS[row.metric]);
    }
    expect(rows.some((row) => row.kind === 'mission')).toBe(true);
    expect(rows.some((row) => row.kind === 'calibrated')).toBe(true);
  });

  it('freezes through a straddling mission worst-frame verdict and records the straddle', () => {
    const records = [
      run({ 'combat-vfx-burst': { worstFrameMs: 95 } }),
      run({ 'combat-vfx-burst': { worstFrameMs: 110 } }),
      run({ 'combat-vfx-burst': { worstFrameMs: 98 } }),
    ];
    const { gate } = deriveCalibration(records);
    expect(() => assertNoCalibrationFlaps(records, gate)).not.toThrow();
    expect(gate.missionStraddles).toEqual([
      {
        scenario: 'combat-vfx-burst',
        metric: 'worstFrameMs',
        samples: [95, 110, 98],
        target: 100,
      },
    ]);
    // The straddling mission bound stays fully enforced in every gate compare.
    const cmp = compareRunToGate(records[1], gate);
    expect(cmp.ok).toBe(false);
    expect(cmp.failures.join('\n')).toContain('combat-vfx-burst: worstFrameMs 110 above 100');
    const passing = compareRunToGate(records[0], gate, { scenario: 'combat-vfx-burst' });
    expect(passing.failures.join('\n')).not.toContain('combat-vfx-burst: worstFrameMs');
  });

  it('blocks freeze when a calibrated allocation-rate verdict flaps across the runs', () => {
    // Rounding edge: samples within 0.005 of each other derive a rounded bound
    // that splits them, a genuine calibrated flap the freeze must reject.
    const records = [
      run({ 'sky-crossing': { allocationRateMbPerSec: 3.239 } }),
      run({ 'sky-crossing': { allocationRateMbPerSec: 3.242 } }),
      run({ 'sky-crossing': { allocationRateMbPerSec: 3.239 } }),
    ];
    const { gate } = deriveCalibration(records);
    expect(gate.scenarios['sky-crossing'].allocationRateMbPerSec.bound).toBe(3.24);
    expect(() => assertNoCalibrationFlaps(records, gate)).toThrow(
      /sky-crossing:allocationRateMbPerSec.*flapped/i,
    );
  });
});

describe('compareRunToGate', () => {
  const calibration = deriveCalibration([
    run({ 'crowd-influx': { longFrames: 4 }, 'cosmetic-churn': { longFrames: 3 } }),
    run({ 'crowd-influx': { longFrames: 5 }, 'cosmetic-churn': { longFrames: 4 } }),
    run({ 'crowd-influx': { longFrames: 6 }, 'cosmetic-churn': { longFrames: 5 } }),
  ]);

  it('fails today-style compile and long-frame evidence against the mission gate', () => {
    const cmp = compareRunToGate(run(), calibration.gate);
    expect(cmp.ok).toBe(false);
    expect(cmp.failures.join('\n')).toContain('crowd-influx: longFrames 4 above 0');
    expect(cmp.failures.join('\n')).toContain('crowd-influx: programCompiles 3 above 0');
    expect(cmp.failures.join('\n')).toContain('cosmetic-churn: programCompiles 3 above 0');
    expect(cmp.failures.join('\n')).toContain('worstFrameMs 240 above 100');
  });

  it('passes an optimized run exactly at every bound', () => {
    const optimized = run(
      Object.fromEntries(
        SCENARIO_NAMES.map((name) => [
          name,
          {
            longFrames: calibration.gate.scenarios[name].longFrames.noiseFloor,
            programCompiles: 0,
            worstFrameMs: 100,
            settledHeapDeltaMb:
              name === 'soak'
                ? calibration.gate.scenarios.soak.settledHeapDeltaMb.bound
                : scenario(name).settledHeapDeltaMb,
            allocationRateMbPerSec: calibration.gate.scenarios[name].allocationRateMbPerSec.bound,
          },
        ]),
      ),
    );
    const cmp = compareRunToGate(optimized, calibration.gate);
    expect(cmp.ok).toBe(true);
    expect(cmp.failures).toEqual([]);
  });

  it.each(SCENARIO_NAMES)(
    'fails %s independently above every universal per-scenario bound',
    (targetName) => {
      const atBounds = Object.fromEntries(
        SCENARIO_NAMES.map((name) => [
          name,
          {
            longFrames: calibration.gate.scenarios[name].longFrames.noiseFloor,
            programCompiles: 0,
            worstFrameMs: 100,
            settledHeapDeltaMb:
              name === 'soak'
                ? calibration.gate.scenarios.soak.settledHeapDeltaMb.bound
                : scenario(name).settledHeapDeltaMb,
            allocationRateMbPerSec: calibration.gate.scenarios[name].allocationRateMbPerSec.bound,
          },
        ]),
      );
      const worst = structuredClone(atBounds);
      worst[targetName].worstFrameMs = 100.01;
      expect(compareRunToGate(run(worst), calibration.gate).failures.join(' ')).toContain(
        `${targetName}: worstFrameMs`,
      );

      const longFrames = structuredClone(atBounds);
      longFrames[targetName].longFrames += 1;
      expect(compareRunToGate(run(longFrames), calibration.gate).failures.join(' ')).toContain(
        `${targetName}: longFrames`,
      );

      const allocation = structuredClone(atBounds);
      allocation[targetName].allocationRateMbPerSec += 0.01;
      expect(compareRunToGate(run(allocation), calibration.gate).failures.join(' ')).toContain(
        `${targetName}: allocationRateMbPerSec`,
      );
    },
  );

  it('fails closed on missing evidence, invalid profiles, and mismatched machines', () => {
    const missing = { ...run(), scenarios: run().scenarios.filter((s) => s.name !== 'soak') };
    expect(compareRunToGate(missing, calibration.gate).failures.join(' ')).toContain(
      'soak: scenario missing',
    );
    expect(
      compareRunToGate({ ...run(), freshProfile: false }, calibration.gate).failures.join(' '),
    ).toContain('fresh temporary browser profile');
    expect(
      compareRunToGate({ ...run(), machine: 'other-machine' }, calibration.gate).failures.join(' '),
    ).toContain('machine mismatch');
    const governorOff = run({ soak: { autoGovernor: false } });
    expect(compareRunToGate(governorOff, calibration.gate).failures.join(' ')).toContain(
      'adaptive render governor was disabled',
    );
    const software = run({ soak: { glRenderer: 'SwiftShader' } });
    expect(compareRunToGate(software, calibration.gate).failures.join(' ')).toContain(
      'real GPU renderer',
    );
    expect(
      compareRunToGate(
        { ...run(), browserFlags: ['--disable-gpu-shader-disk-cache', '--drift'] },
        calibration.gate,
      ).failures.join(' '),
    ).toContain('browser flags drifted');

    const rendererDrift = run();
    rendererDrift.glRenderer = 'Other real GPU';
    rendererDrift.scenarios = rendererDrift.scenarios.map((row) => ({
      ...row,
      glRenderer: 'Other real GPU',
    }));
    expect(compareRunToGate(rendererDrift, calibration.gate).failures.join(' ')).toContain(
      'GPU renderer drifted',
    );
    expect(
      compareRunToGate(run({ soak: { pageErrorCount: 1 } }), calibration.gate).failures.join(' '),
    ).toContain('soak: pageErrorCount');
  });

  it('fails independently above or without settled heap and allocation bounds', () => {
    const heapBound = calibration.gate.scenarios.soak.settledHeapDeltaMb.bound;
    const allocationBound = calibration.gate.scenarios.soak.allocationRateMbPerSec.bound;
    expect(
      compareRunToGate(
        run({
          soak: {
            settledHeapDeltaMb: heapBound + 0.01,
            allocationRateMbPerSec: allocationBound,
          },
        }),
        calibration.gate,
      ).failures.join(' '),
    ).toContain('settledHeapDeltaMb');
    expect(
      compareRunToGate(
        run({
          soak: {
            settledHeapDeltaMb: heapBound,
            allocationRateMbPerSec: allocationBound + 0.01,
          },
        }),
        calibration.gate,
      ).failures.join(' '),
    ).toContain('allocationRateMbPerSec');
    const coldAllocation =
      calibration.gate.scenarios['cold-zone-entry'].allocationRateMbPerSec.bound;
    expect(
      compareRunToGate(
        run({ 'cold-zone-entry': { allocationRateMbPerSec: coldAllocation + 0.01 } }),
        calibration.gate,
      ).failures.join(' '),
    ).toContain('cold-zone-entry: allocationRateMbPerSec');
    expect(
      compareRunToGate(
        run({ soak: { settledHeapDeltaMb: null, allocationRateMbPerSec: null } }),
        calibration.gate,
      ).failures.join(' '),
    ).toMatch(/settledHeapDeltaMb.*missing.*allocationRateMbPerSec.*missing/);

    const diagnosticOnly = run({
      soak: { settledHeapDeltaMb: heapBound, heapFloorGrowthMb: heapBound * 100 },
    });
    const diagnosticComparison = compareRunToGate(diagnosticOnly, calibration.gate, {
      scenario: 'soak',
    });
    expect(diagnosticComparison.failures.join(' ')).not.toContain('heapFloorGrowthMb');
  });

  it('supports a deliberate single-scenario development run', () => {
    const one = { ...run(), scenarios: [scenario('sky-crossing', { worstFrameMs: 80 })] };
    const cmp = compareRunToGate(one, calibration.gate, { scenario: 'sky-crossing' });
    expect(cmp.rows.every((row) => row.scenario === 'sky-crossing')).toBe(true);
  });
});

describe('format and history helpers', () => {
  it('keeps page-error evidence in every checked-in history record', () => {
    const history = readFileSync('docs/perf/hitch/history.jsonl', 'utf8');
    const { records, skipped } = parseHistoryJsonl(history);
    expect(skipped).toBe(0);
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(typeof record.flags?.pageErrors).toBe('boolean');
      expect(Number.isInteger(record.overall?.pageErrorCount)).toBe(true);
      for (const row of record.scenarios) expect(Number.isInteger(row.pageErrorCount)).toBe(true);
    }
  });

  it('renders a clear gate verdict', () => {
    const { gate } = deriveCalibration([run(), run(), run()]);
    const lines = formatGateComparison(compareRunToGate(run(), gate));
    expect(lines[0]).toContain('hitch gate');
    expect(lines.at(-1)).toContain('FAIL');
  });

  it('skips corrupt JSONL rows and prints one human-readable row per run', () => {
    const rec = run();
    const parsed = parseHistoryJsonl(`${JSON.stringify(rec)}\nnope\n{}\n${JSON.stringify(rec)}\n`);
    expect(parsed.records).toHaveLength(2);
    expect(parsed.skipped).toBe(2);
    const lines = historyTable(parsed.records);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('insane');
    expect(lines[1]).toContain('abc123def456');
    expect(lines[0]).toContain('settled');
    expect(lines[0]).toContain('floorDiag');
    expect(lines[0]).toContain('errors');
  });

  it('removes terminal controls from report notes', () => {
    const lines = historyTable([{ ...run(), note: '\u001b]8;;bad\u0007forged\nrow' }]);
    expect(lines[1]).not.toContain('\u001b');
    expect(lines[1]).not.toContain('\u0007');
    expect(lines[1]).not.toContain('\n');
    expect(lines[1]).toContain('forged row');
  });
});
