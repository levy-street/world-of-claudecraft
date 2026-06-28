// Steady-state CPU/GPU frame profiler (headed, real GPU).
//
// Boots one tier, runs a sustained forward tour in the open world, then dumps
// where the frame time goes: the main-loop buckets (sim.tick / renderer.sync /
// hud.update), the renderer's internal phase split (entities / world /
// nameplates / submit), and the foliage draw/triangle breakdown. Use it to pick
// what to optimize, then re-run to confirm the win.
//
//   npm run dev   # other terminal
//   BENCH_TIERS=high node scripts/fps_profile.mjs
//
// Env: BENCH_TIER (default auto), BENCH_W/H, BENCH_DPR (1|2), BENCH_RUN_MS.
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const BASE_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const TIER = process.env.BENCH_TIER ?? 'auto';
const W = Number(process.env.BENCH_W ?? 1920);
const H = Number(process.env.BENCH_H ?? 1080);
const DPR = Number(process.env.BENCH_DPR ?? 1);
const RUN_MS = Number(process.env.BENCH_RUN_MS ?? 6000);
const KLASS = process.env.BENCH_CLASS ?? 'warrior';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Profile: tier=${TIER} ${W}x${H} dpr=${DPR} run=${RUN_MS}ms (HEADED, vsync OFF)`);
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
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR });
  const url = TIER === 'auto' ? `${BASE_URL}/?perf` : `${BASE_URL}/?perf&gfx=${TIER}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#char-name', { timeout: 60000 });
  await page.$eval('#char-name', (el) => {
    el.value = 'ProfileRun';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.$eval(`#offline-select .mini-class[data-class="${KLASS}"]`, (el) => el.click());
  await page.$eval('#btn-start-offline', (el) => el.click());
  await page.waitForFunction(
    () => Boolean(window.__game?.sim?.player && window.__game?.perf?.report),
    { timeout: 120000 },
  );
  await sleep(800);

  // Steady open-world run away from the cold-streaming teleport spike.
  await page.evaluate(() => {
    const p = window.__game.sim.player;
    p.pos.x = 0;
    p.pos.z = 30;
    p.facing = Math.PI;
    window.__game.input.camYaw = Math.PI;
  });
  await sleep(800);
  await page.evaluate(() => window.__game.perf.reset());
  // BENCH_MOVE=0 holds still (clean steady-state GPU cost, no streaming stalls);
  // default runs forward (real travel, includes streaming pressure).
  if (process.env.BENCH_MOVE !== '0') {
    await page.evaluate(() =>
      window.__game.input.setTouchMove({
        forward: true,
        back: false,
        strafeLeft: false,
        strafeRight: false,
      }),
    );
    await sleep(RUN_MS);
    await page.evaluate(() => window.__game.input.clearTouchMove());
  } else {
    await sleep(RUN_MS);
  }

  const r = await page.evaluate(() => window.__game.perf.report());
  await browser.close();

  const top = (obj, n = 12) =>
    Object.entries(obj ?? {})
      .map(([k, v]) => [k, typeof v === 'object' ? (v.avg ?? v.p95 ?? 0) : v])
      .sort((a, b) => b[1] - a[1])
      .slice(0, n);

  const rr = r.renderer ?? {};
  console.log(
    `\nfps=${r.fps} 10s=${r.windows?.last10s?.fps}  frameP95=${r.frameMs?.p95}ms p99=${r.frameMs?.p99}ms`,
  );
  console.log(
    `tier=${rr.tier} scale=${rr.effectiveRenderScale} calls=${rr.calls} tris=${rr.triangles} programs=${rr.programs} views=${rr.views}`,
  );
  console.log('\nmainMs (avg, top):');
  for (const [k, v] of top(r.mainMs))
    console.log(`  ${String(k).padEnd(22)} ${Number(v).toFixed(2)}ms`);
  console.log('\nrenderer.phaseMs (avg):');
  for (const [k, v] of top(rr.phaseMs))
    console.log(
      `  ${String(k).padEnd(22)} ${typeof v === 'object' ? Number(v.avg ?? 0).toFixed(2) : Number(v).toFixed(2)}ms`,
    );
  const f = rr.foliage ?? {};
  console.log('\nfoliage:');
  console.log(
    `  grassVisibleTufts=${f.grassVisibleTufts} modelVisibleDraws=${f.modelVisibleDraws} modelVisibleTriangles=${f.modelVisibleTriangles}`,
  );
  console.log(`  modelVisibleByLod=${JSON.stringify(f.modelVisibleByLod)}`);
  const rb = rr.renderBudget ?? {};
  console.log(
    `\nrenderBudget: mode=${rb.mode} reason=${rb.reason} pressure=${rb.pressure} frameMsEma=${rb.frameMsEma} levels=${JSON.stringify(rb.levels)}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
