// Real-GPU FPS benchmark across graphics tiers (low/medium/high/ultra).
//
// Boots the offline world HEADED (so you can watch it and so the real GPU is
// used, not swiftshader) with vsync + the browser frame-rate limiter DISABLED,
// so perf.report().fps reflects true GPU throughput instead of the display
// refresh. Runs a fixed movement tour (town -> open-world run -> cross-zone ->
// camera spin) per tier and prints a comparison table plus a JSON dump.
//
//   npm run dev            # in another terminal (Vite on :5173)
//   node scripts/fps_tier_bench.mjs
//
// Env:
//   BENCH_TIERS=low,medium,high,ultra   tiers to sweep (default all four)
//   BENCH_W=1920 BENCH_H=1080           viewport (default 1920x1080)
//   BENCH_CLASS=warrior                 offline class
//   BENCH_RUN_MS=6000                   sustained-run sample window per phase
//   GAME_URL=http://localhost:5173
//   BROWSER_PATH=/opt/google/chrome/chrome
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const BASE_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const TIERS = (process.env.BENCH_TIERS ?? 'low,medium,high,ultra').split(',').map((s) => s.trim()).filter(Boolean);
const W = Number(process.env.BENCH_W ?? 1920);
const H = Number(process.env.BENCH_H ?? 1080);
const KLASS = process.env.BENCH_CLASS ?? 'warrior';
const RUN_MS = Number(process.env.BENCH_RUN_MS ?? 6000);
const SETTLE_MS = Number(process.env.BENCH_SETTLE_MS ?? 700);
const BOOT_TIMEOUT_MS = Number(process.env.BENCH_BOOT_TIMEOUT_MS ?? 120000);
const OUT = process.env.BENCH_OUT ?? path.join('tmp', `fps-tier-bench-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A couple of long open-world straightaways from the starting area. Offline we
// can set the player position directly (no dev commands); the renderer reacts.
const WAYPOINTS = {
  townSquare: { x: 0, z: -14, facing: 0 },
  // north out of the start zone into open biome (foliage/grass heavy)
  openField: { x: 0, z: 60, facing: Math.PI },
  // a long push toward a zone boundary to force streaming + biome change
  farRun: { x: 40, z: 220, facing: Math.PI },
};

async function bootOffline(page, tier) {
  // tier 'auto' boots with no ?gfx override so the new FPS-first auto-detection
  // (gfx_autodetect) and the one-time migration to the Auto preset both run.
  const url = tier === 'auto' ? `${BASE_URL}/?perf` : `${BASE_URL}/?perf&gfx=${tier}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Start screen -> offline -> pick class -> start.
  await page.waitForSelector('#char-name', { timeout: 60000 });
  await page.$eval('#char-name', (el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, `Bench${tier[0].toUpperCase()}${tier.slice(1)}`);
  await page.$eval(`#offline-select .mini-class[data-class="${KLASS}"]`, (el) => el.click());
  await page.$eval('#btn-start-offline', (el) => el.click());
  await page.waitForFunction(
    () => Boolean(window.__game?.sim?.player && window.__game?.perf?.report),
    { timeout: BOOT_TIMEOUT_MS },
  );
  await sleep(SETTLE_MS);
}

async function teleport(page, wp) {
  await page.evaluate((wp) => {
    const g = window.__game;
    const p = g.sim.player;
    p.pos.x = wp.x;
    p.pos.z = wp.z;
    p.facing = wp.facing;
    g.input.camYaw = wp.facing;
  }, wp);
}

async function runForward(page, ms) {
  await page.evaluate(() => window.__game.input.setTouchMove({ forward: true, back: false, strafeLeft: false, strafeRight: false }));
  await sleep(ms);
  await page.evaluate(() => window.__game.input.clearTouchMove());
}

async function spinCamera(page, ms) {
  await page.evaluate(() => {
    window.__game.input.setTouchLook(true);
    window.__game.input.setTouchLookVector({ x: 0.9, y: -0.05 });
  });
  await sleep(ms);
  await page.evaluate(() => {
    window.__game.input.setTouchLookVector({ x: 0, y: 0 });
    window.__game.input.setTouchLook(false);
  });
}

async function resetPerf(page) {
  await page.evaluate(() => window.__game.perf.reset());
}

function pick(report) {
  const r = report ?? {};
  const w10 = r.windows?.last10s ?? {};
  const renderer = r.renderer ?? {};
  const foliage = renderer.foliage ?? {};
  return {
    fps: r.fps ?? 0,
    fps10s: w10.fps ?? 0,
    frameP50: r.frameMs?.p50 ?? 0,
    frameP95: r.frameMs?.p95 ?? 0,
    frameP99: r.frameMs?.p99 ?? 0,
    frameMax: r.frameMs?.max ?? 0,
    long50: r.frameMs?.long50 ?? 0,
    tier: renderer.tier ?? '',
    renderScale: renderer.effectiveRenderScale ?? 0,
    calls: renderer.calls ?? 0,
    triangles: renderer.triangles ?? 0,
    programs: renderer.programs ?? 0,
    views: renderer.views ?? 0,
    grassTufts: foliage.grassVisibleTufts ?? 0,
    autoGovernor: renderer.autoGovernor ?? false,
  };
}

async function sampleWindow(page, label, ms) {
  await resetPerf(page);
  await sleep(ms);
  const report = await page.evaluate(() => window.__game.perf.report());
  return { label, ...pick(report) };
}

async function benchTier(browser, tier) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
  const phases = [];
  try {
    await bootOffline(page, tier);

    // Phase: town (NPCs + props + nameplates), camera still.
    await teleport(page, WAYPOINTS.townSquare);
    await sleep(SETTLE_MS);
    phases.push(await sampleWindow(page, 'town-idle', RUN_MS));

    // Phase: sustained run through the open field (grass/foliage streaming).
    await teleport(page, WAYPOINTS.openField);
    await sleep(SETTLE_MS);
    await resetPerf(page);
    await runForward(page, RUN_MS);
    phases.push({ label: 'open-run', ...pick(await page.evaluate(() => window.__game.perf.report())) });

    // Phase: long push toward a zone boundary while running.
    await teleport(page, WAYPOINTS.farRun);
    await sleep(SETTLE_MS);
    await resetPerf(page);
    await runForward(page, RUN_MS);
    phases.push({ label: 'far-run', ...pick(await page.evaluate(() => window.__game.perf.report())) });

    // Phase: camera spin in the open field (worst-case visible set churn).
    await teleport(page, WAYPOINTS.openField);
    await sleep(SETTLE_MS);
    await resetPerf(page);
    await spinCamera(page, RUN_MS);
    phases.push({ label: 'cam-spin', ...pick(await page.evaluate(() => window.__game.perf.report())) });
  } catch (err) {
    pageErrors.push(`FATAL: ${String(err).slice(0, 300)}`);
  } finally {
    await page.close();
  }
  return { tier, phases, pageErrors };
}

function fmt(n, w = 7) {
  return String(typeof n === 'number' ? Math.round(n * 10) / 10 : n).padStart(w);
}

async function main() {
  console.log(`FPS tier bench: tiers=[${TIERS.join(', ')}] viewport=${W}x${H} run=${RUN_MS}ms`);
  console.log(`Browser: ${BROWSER_PATH} (HEADED, vsync OFF)`);
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: false,
    args: [
      `--window-size=${W},${H + 120}`,
      '--ignore-gpu-blocklist',
      '--enable-gpu',
      '--disable-gpu-vsync',
      '--disable-frame-rate-limit',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const results = [];
  try {
    for (const tier of TIERS) {
      console.log(`\n=== Tier: ${tier} ===`);
      const r = await benchTier(browser, tier);
      results.push(r);
      for (const p of r.phases) {
        console.log(`  ${p.label.padEnd(10)} fps=${fmt(p.fps)} p95=${fmt(p.frameP95)}ms p99=${fmt(p.frameP99)}ms calls=${fmt(p.calls)} tris=${fmt(p.triangles, 9)} grass=${fmt(p.grassTufts)} scale=${fmt(p.renderScale, 5)} gov=${p.autoGovernor}`);
      }
      if (r.pageErrors.length) console.log(`  pageErrors: ${r.pageErrors.length} (first: ${r.pageErrors[0]})`);
    }
  } finally {
    await browser.close();
  }

  // Comparison table: worst-case (min fps / max p95) across phases per tier.
  console.log('\n========== SUMMARY (worst phase per tier) ==========');
  console.log('tier     minFps  maxP95  maxP99  maxCalls   maxTris  worstPhase');
  for (const r of results) {
    if (!r.phases.length) { console.log(`${r.tier.padEnd(8)}  (no phases - errors)`); continue; }
    let worst = r.phases[0];
    for (const p of r.phases) if (p.fps < worst.fps) worst = p;
    const maxP95 = Math.max(...r.phases.map((p) => p.frameP95));
    const maxP99 = Math.max(...r.phases.map((p) => p.frameP99));
    const maxCalls = Math.max(...r.phases.map((p) => p.calls));
    const maxTris = Math.max(...r.phases.map((p) => p.triangles));
    console.log(`${r.tier.padEnd(8)} ${fmt(worst.fps)} ${fmt(maxP95)} ${fmt(maxP99)} ${fmt(maxCalls)} ${fmt(maxTris, 9)}  ${worst.label}`);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ viewport: { W, H }, runMs: RUN_MS, tiers: TIERS, results }, null, 2));
  console.log(`\nWrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
