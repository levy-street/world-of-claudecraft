// The pure halves of the WOC crowd A/B rig (scripts/woc_crowd_ab.mjs): the
// crowd it builds, where it stands, the per-window statistics and the reports.
// The rig measures two different checkouts with ONE script, so the pins that
// matter most here are the ones against the game itself: the worn set must
// dress a WOC body in its class pieces, the two grids must land in the bands
// the scenes are named after under the game's own crowd LOD policy, and the
// GPU chunk rule must match the timer probe's real ring.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AbResult, AbWindow, WindowSample } from '../scripts/lib/woc_crowd_ab_core.mjs';
import {
  AB_BOT_COUNT,
  AB_BUSY_SWAP_MB,
  AB_CLASSES,
  AB_FRAME_DT_CLAMP_MS,
  AB_GPU_TIMER_RING,
  AB_SCENE_BANDS,
  AB_SCHEMA,
  AB_WORN_SET,
  comparisonTables,
  countsDelta,
  crowdGrid,
  crowdOverSolo,
  crowdRoster,
  drawWindowStats,
  evidenceReasons,
  formatSummary,
  frameWindowStats,
  gpuWindowMean,
  hostLoad,
  ledgerDelta,
  longTaskStats,
  median,
  parseVmStat,
  queueKindDelta,
  rafGapStats,
  swapActivity,
} from '../scripts/lib/woc_crowd_ab_core.mjs';
import { WOC_ITEM_DISPLAY } from '../src/render/characters/woc_item_display';
import { WOC_DRESSABLE_EQUIP_SLOTS } from '../src/render/characters/woc_parts_core';
import {
  CHARACTER_LOD_RANGE_SQ,
  characterLodBands,
  FAR_ANIM_RANGE_SCALE_MAX,
} from '../src/render/crowd_lod';
import * as dayNightClock from '../src/render/day_night_clock';
import { DAY_NIGHT_CYCLE_MS } from '../src/render/day_night_core';
import { GPU_TIMER_STAT_WINDOW } from '../src/render/gpu_timer_probe_core';
import { CLASSES } from '../src/sim/content/classes';
import { ITEMS } from '../src/sim/data';

describe('the crowd the rig builds', () => {
  it('cycles every player class the sim knows', () => {
    expect([...AB_CLASSES].sort()).toEqual(Object.keys(CLASSES).sort());
  });

  it('gives every class both body types inside any 18 bots in a row', () => {
    const roster = crowdRoster();
    expect(roster).toHaveLength(AB_BOT_COUNT);
    for (let start = 0; start + 18 <= roster.length; start += 1) {
      const combos = new Set(roster.slice(start, start + 18).map((b) => `${b.cls}:${b.gender}`));
      expect(combos.size).toBe(18);
    }
    expect(roster.filter((bot) => bot.gender === 'female')).toHaveLength(AB_BOT_COUNT / 2);
  });

  it('names every bot with letters only, each name once', () => {
    const names = crowdRoster(200).map((bot) => bot.name);
    expect(new Set(names).size).toBe(200);
    for (const name of names) expect(name).toMatch(/^[A-Za-z]{2,16}$/);
  });

  it('refuses a crowd size it cannot name', () => {
    expect(() => crowdRoster(0)).toThrow(/crowd size/);
    expect(() => crowdRoster(1.5)).toThrow(/crowd size/);
    expect(() => crowdRoster(26 * 26 + 1)).toThrow(/crowd size/);
  });

  it('wears one real armor item in each slot a WOC body dresses, none with a display row', () => {
    expect(Object.keys(AB_WORN_SET).sort()).toEqual([...WOC_DRESSABLE_EQUIP_SLOTS].sort());
    for (const [slot, id] of Object.entries(AB_WORN_SET)) {
      const item = ITEMS[id];
      expect(item, id).toBeDefined();
      expect(item.kind, id).toBe('armor');
      expect(item.slot, id).toBe(slot);
      // The rig's premise: with no display row an item shows the WEARER'S class
      // piece, which is what makes one worn set dress nine classes differently.
      expect(WOC_ITEM_DISPLAY[id], id).toBeUndefined();
    }
  });
});

describe('where the crowd stands', () => {
  const west = { x: -281, z: -18, facing: -Math.PI / 2 };

  it('puts rows ahead of the facing and centres the columns on it', () => {
    const spots = crowdGrid(west, AB_SCENE_BANDS.close);
    expect(spots).toHaveLength(AB_BOT_COUNT);
    // Facing -90 degrees looks down -x: ahead is a smaller x, and the first
    // row is 6 yd out, the last 20.
    expect(spots[0].x).toBeCloseTo(-287, 3);
    expect(spots[39].x).toBeCloseTo(-301, 3);
    // Columns straddle the facing line symmetrically.
    const firstRow = spots.slice(0, 8).map((spot) => spot.lateral);
    expect(firstRow[0]).toBeCloseTo(-firstRow[7], 6);
    expect(firstRow.reduce((sum, lateral) => sum + lateral, 0)).toBeCloseTo(0, 6);
    expect(spots[0].z).not.toBeCloseTo(spots[7].z, 1);
  });

  it('follows the sim compass: facing 0 looks down +z with +x to the right', () => {
    const [left, , , , , , , right] = crowdGrid(
      { x: 0, z: 0, facing: 0 },
      { near: 10, far: 10 },
      8,
    );
    expect(left.z).toBeCloseTo(10, 6);
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeGreaterThan(0);
  });

  it('keeps the close grid articulated and the far grid on far meshes under the game LOD policy', () => {
    // 40 bots in view is the crowd the policy sees; the widest far band any
    // tier can ask for is the hardest case for "every body on its far mesh".
    const bands = characterLodBands(
      AB_BOT_COUNT,
      25 * 25,
      CHARACTER_LOD_RANGE_SQ,
      FAR_ANIM_RANGE_SCALE_MAX,
    );
    for (const spot of crowdGrid(west, AB_SCENE_BANDS.close)) {
      expect(spot.distance ** 2).toBeLessThan(bands.lodRangeSq);
    }
    for (const spot of crowdGrid(west, AB_SCENE_BANDS.far)) {
      expect(spot.distance ** 2).toBeGreaterThan(bands.staticRangeSq);
      // Past the 62 yd proxy-shadow band, inside the 80 yd view range.
      expect(spot.distance).toBeGreaterThanOrEqual(62);
      expect(spot.distance).toBeLessThan(80);
    }
  });

  it('refuses an anchor or a band it cannot place', () => {
    expect(() => crowdGrid({ x: 0, z: 0, facing: Number.NaN }, AB_SCENE_BANDS.close)).toThrow(
      /anchor/,
    );
    expect(() => crowdGrid(west, { near: 20, far: 6 })).toThrow(/band/);
  });
});

describe('what the page half reaches into', () => {
  const page = readFileSync('scripts/lib/woc_crowd_ab_page.mjs', 'utf8');

  it('imports by path only the two dev-served modules it documents, and both exist', () => {
    const imported = [...page.matchAll(/import\('(\/src\/[^']+)'\)/g)].map((match) => match[1]);
    expect([...new Set(imported)].sort()).toEqual([
      '/src/render/day_night_clock.ts',
      '/src/sim/data.ts',
    ]);
    for (const path of imported) expect(() => readFileSync(`.${path}`, 'utf8')).not.toThrow();
  });

  it('freezes the time of day through an override the clock module still honours', () => {
    // The reason the rig pins it at all: the cycle is live and far shorter than
    // the time it takes to measure two arms.
    expect(DAY_NIGHT_CYCLE_MS).toBeLessThan(60 * 60 * 1000);
    try {
      dayNightClock.setDayNightPhaseOverride(0.5);
      expect(dayNightClock.dayNightPhaseOverride()).toBe(0.5);
      expect(dayNightClock.currentDayNightPhase()).toBe(0.5);
      dayNightClock.setLunarPhaseOverride(0.5);
      expect(dayNightClock.currentLunarPhase()).toBe(0.5);
    } finally {
      dayNightClock.setDayNightPhaseOverride(null);
      dayNightClock.setLunarPhaseOverride(null);
    }
    for (const name of [
      'setDayNightPhaseOverride',
      'setLunarPhaseOverride',
      'dayNightPhaseOverride',
      'currentDayNightPhase',
    ]) {
      expect(page).toContain(`clock.${name}(`);
    }
  });

  it('waits on a console line the shader corpus record still prints at each of its ends', () => {
    const entry = readFileSync('scripts/woc_crowd_ab.mjs', 'utf8');
    const line = /const CORPUS_RECORD_LINE = '([^']+)';/.exec(entry)?.[1];
    expect(line).toBe('[shader-warmup] record');
    const warmup = readFileSync('src/game/shader_cache_warmup.ts', 'utf8');
    expect(warmup).toContain("const LOG = '[shader-warmup]';");
    // Done, skipped and failed: every way the record ends starts with the line.
    for (const end of [
      /\{LOG\} recorded /,
      /\{LOG\} recording skipped: /,
      /\{LOG\} recording failed/,
    ]) {
      expect(warmup).toMatch(end);
    }
  });

  it('reads the item table under the name the sim exports it by', () => {
    expect(page).toContain('data.ITEMS');
    expect(ITEMS.cryptbone_helm).toBeDefined();
  });
});

describe('window statistics', () => {
  it('counts slow and hitch frames strictly above their thresholds and sums slow time', () => {
    const stats = frameWindowStats([16.7, 33.4, 33.5, 50, 50.1, 120]);
    expect(stats.rendered).toBe(6);
    // 33.4 and 50 sit ON a threshold and are not over it.
    expect(stats.over33_4).toBe(4);
    expect(stats.over50).toBe(2);
    expect(stats.timeOver33_4Ms).toBeCloseTo(33.5 + 50 + 50.1 + 120, 1);
    expect(stats.maxMs).toBe(120);
    expect(stats.atClamp).toBe(0);
    expect(stats.meanMs).toBeCloseTo((16.7 + 33.4 + 33.5 + 50 + 50.1 + 120) / 6, 2);
  });

  it('says how many frames sat on the game loop clamp', () => {
    expect(frameWindowStats([16, AB_FRAME_DT_CLAMP_MS, AB_FRAME_DT_CLAMP_MS]).atClamp).toBe(2);
    // The clamp this constant mirrors lives in the game loop.
    expect(readFileSync('src/main.ts', 'utf8')).toContain(
      `if (frameDt > ${AB_FRAME_DT_CLAMP_MS / 1000}) frameDt = ${AB_FRAME_DT_CLAMP_MS / 1000};`,
    );
  });

  it('drops non-finite frame samples instead of poisoning the mean', () => {
    const stats = frameWindowStats([10, Number.NaN, 30, Number.POSITIVE_INFINITY]);
    expect(stats.rendered).toBe(2);
    expect(stats.meanMs).toBe(20);
    expect(frameWindowStats([]).rendered).toBe(0);
  });

  it('turns raw animation-frame timestamps into gaps', () => {
    const stats = rafGapStats([0, 16, 32, 132, 148]);
    expect(stats.callbacks).toBe(4);
    expect(stats.maxMs).toBe(100);
    expect(stats.over50).toBe(1);
    expect(rafGapStats([5]).callbacks).toBe(0);
  });

  it('keeps only the long tasks that started inside the window', () => {
    const stats = longTaskStats(
      [
        [90, 80], // started before the window opened: the rig's own spawn task
        [100, 60],
        [500, 150],
        [1100, 70], // started after it closed
      ],
      100,
      1100,
    );
    expect(stats).toEqual({ count: 2, maxMs: 150, totalMs: 210 });
  });

  it('takes the median of the draw samples', () => {
    const samples = [
      { calls: 450, triangles: 100 },
      { calls: 460, triangles: 300 },
      { calls: 452, triangles: 200 },
    ].map((row) => ({ ...row, gpuAvail: false, gpuFrames: 0, gpuAvg: 0 }));
    expect(drawWindowStats(samples)).toEqual({
      samples: 3,
      callsMedian: 452,
      callsMin: 450,
      callsMax: 460,
      trianglesMedian: 200,
    });
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('GPU time per frame from the rolling timer stats', () => {
  const sample = (gpuFrames: number, gpuAvg: number): WindowSample => ({
    gpuAvail: true,
    gpuFrames,
    gpuAvg,
    gpuP95: gpuAvg * 2,
    brackets: { scene: gpuAvg - 1, shadow: 1 },
  });

  it('mirrors the ring the timer probe really keeps', () => {
    expect(AB_GPU_TIMER_RING).toBe(GPU_TIMER_STAT_WINDOW);
  });

  it('uses only samples a whole ring apart, so no frame is counted twice or from before the window', () => {
    // 1 s samples at 60 fps: each rolling stat overlaps the previous one by half.
    const samples = [
      sample(1060, 99), // 60 frames in: its ring still reaches before the window
      sample(1120, 10),
      sample(1180, 99), // overlaps the chunk above
      sample(1240, 20),
      sample(1300, 99),
      sample(1360, 30),
    ];
    const gpu = gpuWindowMean(samples, 1000);
    expect(gpu.basis).toBe('chunks');
    expect(gpu.chunks).toBe(3);
    expect(gpu.meanMs).toBe(20);
    expect(gpu.brackets).toEqual({ scene: 19, shadow: 1 });
    expect(gpu.framesResolved).toBe(360);
  });

  it('falls back to the last rolling sample, and says so, when no whole ring fits', () => {
    const gpu = gpuWindowMean([sample(1030, 7), sample(1060, 9)], 1000);
    expect(gpu.basis).toBe('rolling');
    expect(gpu.chunks).toBe(0);
    expect(gpu.meanMs).toBe(9);
  });

  it('reports no GPU time when the extension is missing', () => {
    const off = [{ gpuAvail: false, gpuFrames: 0, gpuAvg: 0 }];
    expect(gpuWindowMean(off, 0)).toEqual({
      available: false,
      meanMs: null,
      chunks: 0,
      basis: 'none',
    });
    expect(gpuWindowMean([], 0).available).toBe(false);
  });
});

describe('counter and ledger deltas', () => {
  it('subtracts lifetime event counters per kind', () => {
    expect(
      countsDelta(
        { 'live-program': 2, 'gate-timeout': 0 },
        { 'live-program': 5, 'gate-timeout': 0, arrival: 1 },
      ),
    ).toEqual({ 'live-program': 3, 'gate-timeout': 0, arrival: 1 });
  });

  it('names the queue kinds that ran between two reads, most units first', () => {
    expect(
      queueKindDelta(
        { 'reveal-gate': { units: 40, emaMs: 1.2 }, portrait: { units: 9, emaMs: 3 } },
        {
          'reveal-gate': { units: 40, emaMs: 1.2 },
          portrait: { units: 12, emaMs: 3.456 },
          'woc-head-mount': { units: 40, emaMs: 0.4 },
        },
      ),
    ).toEqual([
      { kind: 'woc-head-mount', units: 40, emaMs: 0.4 },
      { kind: 'portrait', units: 3, emaMs: 3.46 },
    ]);
    // A first read that never happened counts everything; no table, no rows.
    expect(queueKindDelta(null, { portrait: { units: 2, emaMs: 1 } })).toHaveLength(1);
    expect(queueKindDelta(null, null)).toEqual([]);
  });

  it('keeps the ledger kinds that built inside the window, heaviest first', () => {
    const rows = ledgerDelta(
      {
        'view:rig': { count: 2, totalMs: 10, maxMs: 9 },
        'view:self': { count: 1, totalMs: 4, maxMs: 4 },
      },
      {
        'view:rig': { count: 42, totalMs: 170, maxMs: 15.7 },
        'view:self': { count: 1, totalMs: 4, maxMs: 4 },
        'view:woc-head-merge': { count: 40, totalMs: 18, maxMs: 6.7 },
      },
    );
    expect(rows).toEqual([
      { kind: 'view:rig', count: 40, totalMs: 160, meanMs: 4, lifetimeMaxMs: 15.7 },
      { kind: 'view:woc-head-merge', count: 40, totalMs: 18, meanMs: 0.45, lifetimeMaxMs: 6.7 },
    ]);
  });
});

function abWindow(scene: string, over: Partial<AbWindow> = {}): AbWindow {
  return {
    scene,
    cpuThrottle: 1,
    frames: frameWindowStats([16.7, 16.7, 60]),
    raf: rafGapStats([0, 16, 80]),
    longTasks: { count: 1, maxMs: 62, totalMs: 62 },
    gpu: { available: true, meanMs: 1.5, chunks: 7, basis: 'chunks' },
    draws: {
      samples: 15,
      callsMedian: 452,
      callsMin: 450,
      callsMax: 455,
      trianglesMedian: 1_445_000,
    },
    programs: { start: 296, end: 302, delta: 6 },
    events: { counts: { 'live-program': 0, 'gate-timeout': 0 } },
    ledger: [],
    rigOverheadMs: 2.5,
    bodies: null,
    arrival: null,
    ...over,
  };
}

function abResult(
  label: string,
  over: { rate?: number; windows?: AbWindow[]; evidence?: boolean } = {},
): AbResult {
  const rate = over.rate ?? 1;
  return {
    schema: AB_SCHEMA,
    provenance: {
      label,
      note: '',
      startedAtUtc: '2026-10-05T02:00:00.000Z',
      arm: {
        url: 'http://127.0.0.1:5302',
        servedDir: '/checkout',
        servedDirSource: 'working directory of the process listening on the port',
        gitShaShort: '03802a2e0890',
        branch: 'detached',
        dirty: false,
        servedDirty: false,
        build: 'dev',
        pageBuildId: '03802a2e0890',
      },
      browser: { version: 'Chrome/154.0.0.0', headless: over.evidence !== true },
      webgl: { renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro)', gpuTimer: true },
      flags: { query: '?gfx=low&governor=0&gputimer=1&fpscap=60', gfx: 'low' },
      viewport: { width: 1920, height: 953, dpr: 1, drawingBuffer: { width: 1920, height: 953 } },
      pacing: {
        mode: 'headed',
        cadence: { verdict: 'paced', refreshHz: 120, intent: 60 },
        rafMedianMs: 8.3,
      },
      cpuThrottle: { rate, note: rate > 1 ? 'main thread only' : 'none' },
      host: {
        cpu: 'Apple M4 Pro',
        logicalCpus: 14,
        loadStart: hostLoad(2, 14),
        loadEnd: hostLoad(2, 14),
      },
      evidence:
        over.evidence === true
          ? { performanceEvidence: true, reasons: [] }
          : {
              performanceEvidence: false,
              reasons: ['headless browser: frames are paced by a timer'],
            },
    },
    crowd: null,
    windows: over.windows ?? [abWindow('SOLO'), abWindow('CLOSE')],
    health: { pageErrors: [], consoleErrors: [], webglMessages: [], failedAssets: [] },
    warnings: [],
  };
}

describe('what the crowd adds over the empty scene', () => {
  it('subtracts the SOLO window of the same run, in total and per body', () => {
    const solo = abWindow('SOLO', {
      draws: {
        samples: 15,
        callsMedian: 212,
        callsMin: 212,
        callsMax: 212,
        trianglesMedian: 925_000,
      },
      gpu: { available: true, meanMs: 0.7, chunks: 7, basis: 'chunks' },
    });
    const close = abWindow('CLOSE');
    expect(crowdOverSolo([solo, close], 40)).toEqual([
      {
        scene: 'CLOSE',
        calls: 240,
        callsPerBody: 6,
        triangles: 520_000,
        trianglesPerBody: 13_000,
        gpuMs: 0.8,
        gpuMsPerBody: 0.02,
      },
    ]);
  });

  it('has nothing to say without a SOLO window, and no GPU share without a timer', () => {
    expect(crowdOverSolo([abWindow('CLOSE')], 40)).toEqual([]);
    const blind = { available: false, meanMs: null, chunks: 0, basis: 'none' as const };
    const [row] = crowdOverSolo(
      [abWindow('SOLO', { gpu: blind }), abWindow('FAR', { gpu: blind })],
      40,
    );
    expect(row.scene).toBe('FAR');
    expect(row.gpuMs).toBeNull();
  });
});

describe('what counts as evidence', () => {
  it('calls a host busy above half a core of load per logical core, and unknown without a reading', () => {
    expect(hostLoad(7, 14).busy).toBe(false);
    expect(hostLoad(7.1, 14).busy).toBe(true);
    // os.loadavg() is all zeros on Windows: unknown, never "quiet".
    expect(hostLoad(0, 14).busy).toBeNull();
  });

  it('reads how much the host swapped during a run off two vm_stat reads', () => {
    const read = (swapins: number, swapouts: number) =>
      parseVmStat(
        [
          'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
          'Pages free:                                 920.',
          'Pageouts:                               3293867.',
          `Swapins:                              ${swapins}.`,
          `Swapouts:                             ${swapouts}.`,
        ].join('\n'),
      );
    expect(read(100, 200)).toEqual({ pageSize: 16384, swapins: 100, swapouts: 200 });
    // 3,000 pages in plus 2,000 out at 16 KiB a page: 78 MB, past the bar.
    expect(swapActivity(read(1000, 1000), read(4000, 3000))).toEqual({ swappedMb: 78, busy: true });
    expect(swapActivity(read(1000, 1000), read(1100, 1000))).toEqual({ swappedMb: 2, busy: false });
    expect(AB_BUSY_SWAP_MB).toBe(64);
    // No vm_stat (another OS): unknown, never "quiet".
    expect(swapActivity(null, read(1, 1))).toEqual({ swappedMb: null, busy: null });
    expect(swapActivity(parseVmStat('nothing here'), read(1, 1)).busy).toBeNull();
  });

  it('names every reason a run is not evidence, and none for a clean headed run', () => {
    const clean = {
      headless: false,
      busyStart: false,
      busyEnd: false,
      softwareGl: false,
      smoke: false,
      hiddenWindows: 0,
    };
    expect(evidenceReasons(clean)).toEqual([]);
    expect(evidenceReasons({ ...clean, headless: true })).toHaveLength(1);
    expect(evidenceReasons({ ...clean, busyEnd: true })[0]).toMatch(/busy/);
    expect(evidenceReasons({ ...clean, softwareGl: true })[0]).toMatch(/software/);
    expect(evidenceReasons({ ...clean, hiddenWindows: 2 })[0]).toMatch(/2 window/);
    expect(evidenceReasons({ ...clean, smoke: true })[0]).toMatch(/smoke/);
    expect(evidenceReasons({ ...clean, swapping: true })[0]).toMatch(/short of memory/);
    expect(evidenceReasons({ ...clean, swapping: null })).toEqual([]);
    // An unknown load is not a reason by itself.
    expect(evidenceReasons({ ...clean, busyStart: null, busyEnd: null })).toEqual([]);
  });
});

describe('the reports', () => {
  it('opens the summary with the evidence verdict and its reasons', () => {
    const smoke = formatSummary(abResult('pr-head'));
    expect(smoke.split('\n')[1]).toBe('STATUS: NOT performance evidence. Reasons:');
    expect(smoke).toContain('  - headless browser: frames are paced by a timer');
    const real = formatSummary(abResult('pr-head', { evidence: true }));
    expect(real.split('\n')[1]).toMatch(/^STATUS: performance evidence/);
    expect(real).not.toContain('NOT performance evidence');
  });

  it('labels a throttled run a proxy in the summary and on every row', () => {
    const throttled = [
      abWindow('SOLO', { cpuThrottle: 4 }),
      abWindow('ARRIVAL', { cpuThrottle: 4 }),
    ];
    const text = formatSummary(abResult('pr-head', { rate: 4, windows: throttled }));
    expect(text).toContain("PROXY RUN: the page's main thread is slowed 4x");
    expect(text).toContain('never a measurement of one');
    expect(text).toMatch(/^SOLO x4 /m);
    expect(text).toMatch(/^ARRIVAL x4 /m);
    expect(formatSummary(abResult('pr-head'))).not.toContain('PROXY RUN');
  });

  it('marks a GPU figure that fell back to the rolling stat', () => {
    const rolling = abWindow('SOLO', {
      gpu: { available: true, meanMs: 0.87, chunks: 0, basis: 'rolling' },
    });
    expect(formatSummary(abResult('pr-head', { windows: [rolling] }))).toMatch(/^SOLO\s+0\.87~/m);
    const blind = abWindow('SOLO', {
      gpu: { available: false, meanMs: null, chunks: 0, basis: 'none' },
    });
    expect(formatSummary(abResult('pr-head', { windows: [blind] }))).toMatch(/^SOLO\s+n\/a/m);
  });

  const arrival = (allDrawnAfterMs: number | null, allViewsAfterMs: number | null = 300) =>
    abWindow('ARRIVAL', {
      arrival: {
        expected: 40,
        firstDrawnAfterMs: 60,
        halfDrawnAfterMs: 800,
        allDrawnAfterMs,
        allViewsAfterMs,
        lastChangeMs: allDrawnAfterMs === null ? null : 1900,
        spawnTaskMs: 12,
        assetRequests: 38,
        assetBytes: 8_600_000,
        characterAssetRequests: 37,
        characterAssetBytes: 8_300_000,
      },
    });
  const transit = (allOnFarMeshAfterMs: number | null) =>
    abWindow('TRANSIT', {
      transit: {
        expected: 40,
        firstOnFarMeshAfterMs: 50,
        halfOnFarMeshAfterMs: 400,
        allOnFarMeshAfterMs,
        moveTaskMs: 3,
      },
    });

  it('tells a body that has a view from a body that is drawn, and a goal that was not reached', () => {
    const done = formatSummary(abResult('pr-head', { windows: [arrival(1440)] }));
    expect(done).toContain(
      'ARRIVAL: all 40 bodies had a view (nameplate, click target) after 0.30 s and were drawn after 1.44 s',
    );
    expect(done).toContain('the drawn set last changed at 1.90 s');
    const late = formatSummary(abResult('pr-head', { windows: [arrival(null, null)] }));
    expect(late).toContain('after not reached and were drawn after not reached');
    expect(late).toContain('the drawn set was still changing when the window closed');
    const far = formatSummary(abResult('pr-head', { windows: [transit(820)] }));
    expect(far).toContain('TRANSIT: all 40 bodies stood on their far mesh after 0.82 s');
  });

  it('lists the busiest queue kinds of each window', () => {
    const busy = abWindow('ARRIVAL', {
      queueWork: [
        { kind: 'woc-head-mount', units: 40, emaMs: 0.4 },
        { kind: 'reveal-gate', units: 12, emaMs: 1.1 },
      ],
    });
    const text = formatSummary(abResult('pr-head', { windows: [abWindow('SOLO'), busy] }));
    expect(text).toMatch(/^ {2}SOLO {5}none$/m);
    expect(text).toMatch(/^ {2}ARRIVAL {2}woc-head-mount x40, reveal-gate x12$/m);
  });

  it('says how long each settle waited and names one that never found quiet', () => {
    const result = abResult('pr-head');
    result.settles = {
      entry: { waitedMs: 20_100, quiet: true },
      far: { waitedMs: 90_400, quiet: false },
    };
    expect(formatSummary(result)).toContain(
      'settles  entry 20 s, far 90 s (NOT quiet when it ran out)',
    );
    expect(formatSummary(abResult('pr-head'))).not.toContain('settles  ');
  });

  it('states the time of day the run was frozen at, or that it was not', () => {
    const pinned = abResult('pr-head');
    pinned.provenance.dayNight = { pinnedPhase: 0.5 };
    expect(formatSummary(pinned)).toContain('daylight frozen at phase 0.5 (0.5 is noon)');
    const live = abResult('pr-head');
    live.provenance.dayNight = { pinnedPhase: null };
    expect(formatSummary(live)).toContain('daylight NOT pinned: the live 45 minute cycle');
  });

  it('lists what makes a run invalid after its warnings', () => {
    const result = abResult('pr-head');
    result.warnings = ['CLOSE: 39 of 40 bodies articulated'];
    result.failures = ['CLOSE: 39 of 40 bodies drawn'];
    const lines = formatSummary(result).trimEnd().split('\n');
    expect(lines.slice(-2)).toEqual([
      'WARNING  CLOSE: 39 of 40 bodies articulated',
      'FAILURE  CLOSE: 39 of 40 bodies drawn',
    ]);
  });

  it('puts arms side by side in file order, joins repeats, and keeps presets and throttles apart', () => {
    const release = abWindow('CLOSE', {
      draws: {
        samples: 15,
        callsMedian: 739,
        callsMin: 739,
        callsMax: 739,
        trianglesMedian: 1_515_000,
      },
    });
    const table = comparisonTables([
      abResult('release', { windows: [release, arrival(610)] }),
      abResult('pr-head', { windows: [abWindow('CLOSE'), arrival(1440)] }),
      abResult('pr-head', { windows: [abWindow('CLOSE'), arrival(null)] }),
      abResult('pr-head', { rate: 4, windows: [arrival(9000)] }),
    ]);
    expect(table).toContain('Arms, in column order: release / pr-head.');
    expect(table).toContain(
      '| low | no throttle | CLOSE | 1.50 / 1.50 and 1.50 | 739 / 452 and 452 |',
    );
    // The throttled run has no CLOSE window and no release arm: no invented row.
    expect(table).not.toContain('| low | CPU x4 (proxy) | CLOSE');
    expect(table).toMatch(/\| low \| no throttle \| release \|.*\| 0\.61 s \|/);
    expect(table).toMatch(/\| low \| no throttle \| pr-head \|.*\| 1\.44 s and not reached \|/);
    expect(table).toMatch(/\| low \| CPU x4 \(proxy\) \| pr-head \|.*\| 9\.00 s \|/);
    // Every run carries its own provenance line, evidence verdict included.
    expect(table.match(/NOT evidence: headless browser/g)).toHaveLength(4);
    // No TRANSIT window was run: no table is invented for it.
    expect(table).not.toContain('TRANSIT');
    // The arrival row tells a body with a view from a body that is drawn.
    expect(table).toContain('| All bodies had a view after | All bodies drawn after |');
    expect(table).toMatch(
      /\| low \| no throttle \| release \| 31\.13 \(60\.0\) \|.*\| 0\.30 s \| 0\.61 s \|/,
    );
  });

  it('orders rows by preset, the unthrottled run before its proxies, whatever the file order', () => {
    const medium = abResult('pr-head');
    medium.provenance.flags = { ...medium.provenance.flags, gfx: 'medium' };
    const table = comparisonTables([abResult('pr-head', { rate: 4 }), medium, abResult('pr-head')]);
    const rows = table.split('\n').filter((line) => / \| SOLO \| /.test(line));
    expect(rows.map((row) => row.split(' | ').slice(0, 2).join(' | '))).toEqual([
      '| low | no throttle',
      '| low | CPU x4 (proxy)',
      '| medium | no throttle',
    ]);
  });

  it('adds the transit table only when a run measured the move to the far band', () => {
    const table = comparisonTables([
      abResult('release', { windows: [transit(350)] }),
      abResult('pr-head', { windows: [transit(null)] }),
    ]);
    expect(table).toContain('| TRANSIT, arm |');
    expect(table).toContain('All bodies on their far mesh after');
    expect(table).toMatch(/\| low \| no throttle \| release \|.*\| 0\.35 s \|/);
    expect(table).toMatch(/\| low \| no throttle \| pr-head \|.*\| not reached \|/);
    expect(table).not.toContain('| ARRIVAL, arm |');
  });
});
