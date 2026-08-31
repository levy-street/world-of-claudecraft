// The farm GPU-preparation tour: the acceptance instrument for the farm_patches
// prepared producer (src/render/CLAUDE.md, "GPU work: every new producer is a
// client of the scheduler": the count of `live-program` events on an offline
// tour of the touched content is the bar of a render PR).
//
// Boots the offline world with ?perf, stands the player in the middle of the
// Eastbrook patch, walks the viewer's own beds through every visual state the
// renderer can rebuild (plant x4, the growth ladder, the two wet-band flips),
// places and consumes a feast, and after every step reads
// window.__game.renderer.perfStats().gpuPrep.events: `live-program` is a
// shader program the driver minted INSIDE a live frame (live_program_watch.ts),
// exactly what a cold farm material link looks like. Two legs on ONE build:
//   control    ?perf&farmPrep=0   the pre-gate module (bare scene.add, no
//                                 program anchors; farm_patches_core.ts
//                                 farmPrewarmDisabled)
//   prepared   ?perf              the gated, anchored producer
// The bar: the control leg's farm-attributable count is NON-ZERO (the defect is
// real and this harness sees it), the prepared leg's is ZERO, and BOTH legs
// have to clear the coverage bar first (four beds planted and attached, a feast
// placed and eaten), because a zero from a tour that rebuilt nothing is not
// evidence. Attribution is by step: the player stands still, hostiles are
// shoved away, and the baseline is read only after the arrival settled, so a
// delta during a farm step is the farm's (the recorded program names are the
// second signal). Each leg gets its own browser profile: the offline client
// saves its character, and a shared profile has the second leg resume the
// first leg's already-planted farm.
//
// Usage (needs `npm run dev`; GAME_URL= for another port):
//   node scripts/farm_gpu_tour.mjs [--leg control|prepared|both]
//   FARM_TOUR_GPU=1        headed Chrome on the real GPU instead of SwiftShader
//   FARM_TOUR_OUT=<dir>    where the per-leg JSON lands (default tmp/)
// Exit 1 when a leg misses its bar, so a CI or a reviewer can run it as a check.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const BASE_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const GPU = process.env.FARM_TOUR_GPU === '1';
const OUT_DIR = process.env.FARM_TOUR_OUT ?? 'tmp';
const STEP_SETTLE_MS = Number(process.env.FARM_TOUR_SETTLE_MS ?? 2000);
const ARRIVAL_SETTLE_MS = Number(process.env.FARM_TOUR_ARRIVAL_MS ?? 8000);
const BOOT_TIMEOUT_MS = Number(process.env.FARM_TOUR_BOOT_TIMEOUT_MS ?? 120000);
const NAV_TIMEOUT_MS = Number(process.env.FARM_TOUR_NAV_TIMEOUT_MS ?? 30000);

// The middle of patch_eastbrook (src/sim/content/farm_patches.ts): every bed
// sits 3.54 yd away, inside plantCrop's INTERACT_RANGE of 5.
const STAND = { x: -21.5, z: -81.5 };
const PLANTS = [
  ['bed_eastbrook_1', 'vale_wheat'],
  ['bed_eastbrook_2', 'brook_carrot'],
  ['bed_eastbrook_3', 'vale_wheat'],
  ['bed_eastbrook_4', 'brook_carrot'],
];
const BEDS = PLANTS.map(([bed]) => bed);
const GROW_MS = 100_000;
const MINUTE_MS = 60_000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function legsFromArgs(argv) {
  const at = argv.indexOf('--leg');
  const value = at >= 0 ? argv[at + 1] : 'both';
  if (value === 'control' || value === 'prepared') return [value];
  if (value === 'both' || value === undefined) return ['control', 'prepared'];
  throw new Error(`unknown --leg ${value} (control | prepared | both)`);
}

function legUrl(leg) {
  return `${BASE_URL}/?perf${leg === 'control' ? '&farmPrep=0' : ''}`;
}

/** Runs IN THE PAGE: the readouts every step records. The farm state travels
 *  WITH the counts on purpose: a zero live-program count only means the
 *  prepared producer works if the tour actually rebuilt farm surfaces, so
 *  every step carries the proof that it did (the plots the sim holds, the
 *  growth fraction each one is parked at, and the groups the renderer really
 *  attached). runLeg refuses a leg whose coverage never moved. */
function snapshotInPage() {
  const renderer = window.__game?.renderer;
  const stats = renderer?.perfStats?.();
  const events = stats?.gpuPrep?.events;
  const budget = stats?.gpuPrep?.budget;
  const info = renderer?.webgl?.info;
  const sim = window.__game?.sim;
  const plots = sim?.players?.get?.(sim?.playerId)?.farmPlots;
  const nowMs = sim?.farmNowMs?.();
  const fractions = [];
  if (plots?.forEach && typeof nowMs === 'number') {
    plots.forEach((plot, bedId) => {
      const span = plot.readyAtMs - plot.plantedAtMs;
      fractions.push(
        `${bedId}=${span > 0 ? Math.round(((nowMs - plot.plantedAtMs) / span) * 100) / 100 : '?'}`,
      );
    });
  }
  const groups = renderer?.scene?.children ?? [];
  const named = (prefix) =>
    groups.filter((c) => typeof c.name === 'string' && c.name.startsWith(prefix));
  // A bite does NOT despawn the table (a feast serves several); what it moves
  // is the per-player eaten ledger, so that is the proof the bite landed.
  let feastEaten = 0;
  sim?.feasts?.forEach?.((state) => {
    feastEaten = Math.max(feastEaten, state?.eatenBy?.size ?? 0);
  });
  return {
    livePrograms: events?.counts?.['live-program'] ?? -1,
    liveKeys: (events?.events ?? [])
      .filter((e) => e.kind === 'live-program')
      .map((e) => `${e.key}@${Math.round(e.atMs)}`),
    attachWatchdogs: events?.counts?.['attach-watchdog'] ?? -1,
    gateTimeouts: events?.counts?.['gate-timeout'] ?? -1,
    programs: info?.programs?.length ?? -1,
    farmKinds: (budget?.kinds ?? []).filter(
      (k) => typeof k.kind === 'string' && (k.kind.startsWith('farm-') || k.kind === 'live-gate'),
    ),
    plotCount: plots?.size ?? -1,
    plotFractions: fractions.sort(),
    feastStates: sim?.feasts?.size ?? -1,
    plotGroups: named('farmPlot:').length,
    plotGroupsVisible: named('farmPlot:').filter((g) => g.visible).length,
    feastGroups: named('farmFeast:').length,
    feastGroupsVisible: named('farmFeast:').filter((g) => g.visible).length,
    feastEaten,
  };
}

async function waitGameActive(page) {
  await page.waitForFunction(
    () => {
      const loading = document.querySelector('#loading-screen');
      const ui = document.querySelector('#ui');
      return (
        document.body.classList.contains('game-active') &&
        !!ui &&
        getComputedStyle(ui).display !== 'none' &&
        !!loading &&
        !loading.classList.contains('visible')
      );
    },
    { timeout: BOOT_TIMEOUT_MS, polling: 200 },
  );
}

async function dismissOverlays(page, rounds) {
  for (let i = 0; i < rounds; i++) {
    await page.evaluate(() => {
      document.querySelector('.camera-prompt-confirm')?.click();
      document.querySelector('.tut-skip')?.click();
      document.querySelector('.gpu-notice-dismiss')?.click();
      document.querySelector('#gpu-notice')?.remove();
    });
    await wait(400);
  }
}

/** Stand at the patch with the tier-1 kit, hostiles shoved out of reach. */
async function stage(page) {
  const staged = await page.evaluate((stand) => {
    const sim = window.__game?.sim;
    const player = sim?.player;
    if (!sim || !player?.pos) return { ok: false, reason: 'offline world is unavailable' };
    player.pos.x = stand.x;
    player.pos.z = stand.z;
    sim.addItem?.('garden_hoe', 1);
    sim.addItem?.('vale_wheat_seed', 4);
    sim.addItem?.('brook_carrot_seed', 4);
    sim.addItem?.('harvest_feast', 1);
    const ents = sim.entities?.values?.();
    if (ents) {
      for (const e of ents) {
        if (!e?.hostile || !e.pos) continue;
        const dx = e.pos.x - player.pos.x;
        const dz = e.pos.z - player.pos.z;
        if (dx * dx + dz * dz < 60 * 60) {
          e.pos.x += 500;
          e.pos.z += 500;
        }
      }
    }
    return { ok: true };
  }, STAND);
  if (!staged.ok) throw new Error(staged.reason);
}

/** Plant one bed through the real verb (a cast), polling for its plot row. */
async function plant(page, bedId, cropId) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.evaluate((bed, crop) => window.__game?.sim?.plantCrop?.(bed, crop), bedId, cropId);
    for (let i = 0; i < 12; i++) {
      const planted = await page.evaluate((bed) => {
        const sim = window.__game?.sim;
        return !!sim?.players?.get?.(sim?.playerId)?.farmPlots?.get?.(bed);
      }, bedId);
      if (planted) return true;
      await wait(400);
    }
  }
  return false;
}

/** Direct PlotState writes (the offline shot idiom): park every bed at the
 *  given elapsed fraction of a GROW_MS cycle, planted `agoMs` ago at most as
 *  far back as the fraction demands, so the stage AND the wet band are both
 *  under the tour's control. */
async function parkAll(page, elapsedMs, plantedAgoMs = elapsedMs) {
  await page.evaluate(
    (beds, elapsed, ago, grow) => {
      const sim = window.__game?.sim;
      const plots = sim?.players?.get?.(sim?.playerId)?.farmPlots;
      const now = sim?.farmNowMs?.();
      if (!plots?.get || typeof now !== 'number') return;
      for (const bedId of beds) {
        const p = plots.get(bedId);
        if (!p) continue;
        p.plantedAtMs = now - Math.max(elapsed, ago);
        // readyAtMs keeps the growth fraction the step asked for, whatever
        // the wet band pushed plantedAtMs back to.
        p.readyAtMs = now - elapsed + grow;
      }
    },
    BEDS,
    elapsedMs,
    plantedAgoMs,
    GROW_MS,
  );
}

async function parkLadder(page) {
  await page.evaluate(
    (beds, grow) => {
      const sim = window.__game?.sim;
      const plots = sim?.players?.get?.(sim?.playerId)?.farmPlots;
      const now = sim?.farmNowMs?.();
      if (!plots?.get || typeof now !== 'number') return;
      const fractions = [0.05, 0.4, 0.75, 2];
      beds.forEach((bedId, i) => {
        const p = plots.get(bedId);
        if (!p) return;
        p.plantedAtMs = now - fractions[i] * grow;
        p.readyAtMs = p.plantedAtMs + grow;
      });
    },
    BEDS,
    GROW_MS,
  );
}

function steps() {
  const list = [];
  for (const [bedId, cropId] of PLANTS) {
    list.push({
      name: `plant ${bedId} (${cropId})`,
      act: async (page) => {
        if (!(await plant(page, bedId, cropId))) throw new Error(`${bedId} never planted`);
      },
    });
  }
  list.push({
    name: 'ladder: sprout / stage2 / stage3 / ready across the four beds',
    act: parkLadder,
  });
  list.push({ name: 'all beds to stage2 (40%)', act: (page) => parkAll(page, 0.4 * GROW_MS) });
  list.push({ name: 'all beds to stage3 (75%)', act: (page) => parkAll(page, 0.75 * GROW_MS) });
  list.push({ name: 'all beds to ready (200%)', act: (page) => parkAll(page, 2 * GROW_MS) });
  list.push({
    name: 'wet band 2 -> 1 (planted 11 min ago, still ready)',
    act: (page) => parkAll(page, 2 * GROW_MS, 11 * MINUTE_MS),
  });
  list.push({
    name: 'wet band 1 -> 0 (planted 61 min ago, still ready)',
    act: (page) => parkAll(page, 2 * GROW_MS, 61 * MINUTE_MS),
  });
  list.push({
    name: 'place the harvest feast',
    act: async (page) => {
      await page.evaluate(() => window.__game?.sim?.placeFeast?.());
    },
  });
  list.push({
    name: 'take the placer bite',
    act: async (page) => {
      await page.evaluate(() => {
        const sim = window.__game?.sim;
        const feastId = sim?.feasts ? [...sim.feasts.keys()][0] : undefined;
        if (feastId !== undefined) sim?.consumeFeast?.(feastId);
      });
    },
  });
  list.push({ name: 'idle (a quiet window after the last farm change)', act: async () => {} });
  return list;
}

async function runLeg(browser, leg, charName) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(`console: ${msg.text()}`);
  });
  const url = legUrl(leg);
  console.log(`[${leg}] ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  const booted = await enterOfflineGame(page, {
    charClass: 'warrior',
    charName,
    settleMs: 0,
    dismissMobilePreflight: false,
    gameBootTimeoutMs: BOOT_TIMEOUT_MS,
  });
  if (!booted) throw new Error(`[${leg}] the world never booted`);
  await waitGameActive(page);
  await dismissOverlays(page, 4);
  const support = await page.evaluate(() => {
    const renderer = window.__game?.renderer;
    return {
      asyncCompileSupported: renderer?.asyncCompileSupported === true,
      farmPrepDisabled: new URLSearchParams(location.search).get('farmPrep') === '0',
      anchorsStaged: !!renderer?.scene?.children?.some?.((c) => c.name === 'farmProgramAnchors'),
      tier: renderer?.perfStats?.()?.tier ?? null,
    };
  });
  console.log(`[${leg}] support ${JSON.stringify(support)}`);
  await stage(page);
  // The arrival links the town and its reveal gates settle; none of that is
  // the farm's, so the baseline is read only after it all quietened.
  await wait(ARRIVAL_SETTLE_MS);
  await dismissOverlays(page, 3);
  let previous = await page.evaluate(snapshotInPage);
  const baseline = previous;
  const records = [{ name: 'baseline (settled at the beds)', delta: 0, newKeys: [], ...previous }];
  for (const step of steps()) {
    await step.act(page);
    await wait(STEP_SETTLE_MS);
    const now = await page.evaluate(snapshotInPage);
    const newKeys = now.liveKeys.filter((key) => !previous.liveKeys.includes(key));
    records.push({
      name: step.name,
      delta: now.livePrograms - previous.livePrograms,
      newKeys,
      ...now,
    });
    previous = now;
  }
  const last = previous;
  const farmLivePrograms = last.livePrograms - baseline.livePrograms;
  // What the tour actually exercised, over every step: the high-water marks
  // are the coverage a zero count has to be read against.
  const peak = (field) => records.reduce((max, r) => Math.max(max, r[field]), 0);
  const coverage = {
    maxPlots: peak('plotCount'),
    maxPlotGroups: peak('plotGroups'),
    plotFractionsSeen: [...new Set(records.flatMap((r) => r.plotFractions))].sort(),
    maxFeastStates: peak('feastStates'),
    maxFeastGroups: peak('feastGroups'),
    feastConsumed: peak('feastEaten') > 0,
  };
  await page.close();
  return {
    leg,
    url,
    charName,
    support,
    baseline: { livePrograms: baseline.livePrograms, programs: baseline.programs },
    farmLivePrograms,
    programsLinkedAcrossTour: last.programs - baseline.programs,
    attachWatchdogs: last.attachWatchdogs - baseline.attachWatchdogs,
    gateTimeouts: last.gateTimeouts - baseline.gateTimeouts,
    farmKinds: last.farmKinds,
    coverage,
    steps: records.map((r) => ({
      name: r.name,
      livePrograms: r.livePrograms,
      delta: r.delta,
      newKeys: r.newKeys,
      programs: r.programs,
      plots: r.plotCount,
      plotGroups: r.plotGroups,
      plotFractions: r.plotFractions,
      feasts: r.feastGroups,
    })),
    pageErrors,
  };
}

function printLeg(result) {
  console.log(`\n== ${result.leg} leg ==`);
  console.log(
    `${'step'.padEnd(58)} ${'live-program'.padStart(12)} ${'delta'.padStart(6)} ${'programs'.padStart(9)} ${'plots'.padStart(6)} ${'groups'.padStart(7)} ${'feasts'.padStart(7)}  new keys`,
  );
  for (const step of result.steps) {
    console.log(
      `${step.name.padEnd(58)} ${String(step.livePrograms).padStart(12)} ${String(step.delta).padStart(6)} ${String(step.programs).padStart(9)} ${String(step.plots).padStart(6)} ${String(step.plotGroups).padStart(7)} ${String(step.feasts).padStart(7)}  ${step.newKeys.join(', ')}`,
    );
  }
  console.log(
    `farm-attributable live-program events: ${result.farmLivePrograms}; programs linked across the tour: ${result.programsLinkedAcrossTour}; attach watchdogs: ${result.attachWatchdogs}; gate timeouts: ${result.gateTimeouts}`,
  );
  console.log(
    `coverage: plots ${result.coverage.maxPlots} (groups ${result.coverage.maxPlotGroups}), growth fractions seen ${result.coverage.plotFractionsSeen.length}, feast states ${result.coverage.maxFeastStates}, feast groups ${result.coverage.maxFeastGroups}, consumed ${result.coverage.feastConsumed}`,
  );
  if (result.farmKinds.length > 0) {
    console.log(
      `budget kinds: ${result.farmKinds.map((k) => `${k.kind}=${k.samples}x${k.emaMs}ms`).join(', ')}`,
    );
  }
  if (result.pageErrors.length > 0) console.log(`page errors: ${result.pageErrors.length}`);
}

function verdict(result) {
  // The coverage bar comes FIRST, both legs: a leg that never rebuilt a farm
  // surface proves nothing, least of all a zero. Four beds planted, the four
  // groups attached, a feast placed and eaten.
  const c = result.coverage;
  if (c.maxPlots < BEDS.length || c.maxPlotGroups < BEDS.length) {
    return {
      ok: false,
      why: `the tour never exercised the beds (plots ${c.maxPlots}, attached groups ${c.maxPlotGroups} of ${BEDS.length}): the count below is not evidence`,
    };
  }
  if (c.maxFeastGroups < 1 || !c.feastConsumed) {
    return {
      ok: false,
      why: `the tour never placed and ate a feast (groups ${c.maxFeastGroups}, consumed ${c.feastConsumed}): the count below is not evidence`,
    };
  }
  if (result.leg === 'control') {
    return result.farmLivePrograms > 0
      ? { ok: true, why: 'control leg links farm programs in live frames, as the defect predicts' }
      : {
          ok: false,
          why: 'control leg saw ZERO farm live programs: the harness is not seeing the defect',
        };
  }
  if (!result.support.asyncCompileSupported) {
    return {
      ok: false,
      why: 'prepared leg ran without KHR_parallel_shader_compile, so the gate was never installed (try FARM_TOUR_GPU=1)',
    };
  }
  return result.farmLivePrograms === 0
    ? { ok: true, why: 'prepared leg links zero farm programs in live frames' }
    : {
        ok: false,
        why: `prepared leg linked ${result.farmLivePrograms} farm program(s) in live frames`,
      };
}

const legs = legsFromArgs(process.argv.slice(2));
fs.mkdirSync(OUT_DIR, { recursive: true });
// One browser and one throwaway profile PER LEG. The offline client saves its
// character to localStorage, so a shared profile makes the second leg resume
// the first leg's farm (the pre-game skips the class picker, and the beds it
// would plant are already planted): the legs have to be independent for their
// counts to be comparable. Names carry the repo's base-36 alpha suffix for the
// same reason, letters only per the classic naming rule.
const alpha = Number(Date.now().toString().slice(-9))
  .toString(36)
  .replace(/[^a-z]/g, '')
  .padEnd(3, 'x')
  .slice(0, 4);
const results = [];
let failed = false;
for (const leg of legs) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `farm-tour-${leg}-`));
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: GPU ? false : 'new',
    userDataDir: profile,
    args: GPU
      ? ['--window-size=1600,900', '--ignore-gpu-blocklist', '--enable-gpu']
      : ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const charName = `Farm${leg === 'control' ? 'Ctl' : 'Prep'}${alpha}`;
    const result = await runLeg(browser, leg, charName);
    const bar = verdict(result);
    result.verdict = bar;
    results.push(result);
    printLeg(result);
    console.log(`${bar.ok ? 'PASS' : 'FAIL'}: ${bar.why}`);
    if (!bar.ok) failed = true;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const out = path.join(OUT_DIR, `farm-gpu-tour-${leg}-${stamp}.json`);
    fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`wrote ${out}`);
  } finally {
    await browser.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);
