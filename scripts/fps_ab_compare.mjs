// One-off FPS A/B: PBE deploy vs local dev build, same locations, same
// settings (ultra preset seeded pre-boot + ?gfx=ultra), same settle, same
// camera. Each location samples ~8s stationary and ~8s with a continuous
// camera orbit (the movement case), via an in-page rAF delta collector.
// Targets run sequentially in separate browser launches so they never
// contend for the GPU. Usage: node scripts/fps_ab_compare.mjs
// Env: AB_OUT (default tmp/fps-ab.json), AB_ONLY (comma-separated location
// names), AB_TARGETS (comma-separated labels among pbe2,local)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const TARGETS = [
  { label: 'pbe2', url: 'https://pbe2.worldofclaudecraft.com' },
  { label: 'local', url: 'http://localhost:5173' },
].filter((t) => !process.env.AB_TARGETS || process.env.AB_TARGETS.split(',').includes(t.label));

// Spread of render loads: open meadow (grass carpet), dirt road (parallax),
// town street (structures + surface detail), peaks boulders (scree + cliff),
// plus the user-style close-grass framing.
const LOCATIONS = [
  { name: 'meadow', x: 15, z: 45, yaw: 1.0, pitch: 0.35, dist: 9 },
  { name: 'path', x: 40, z: 9.5, yaw: 1.41, pitch: 0.4, dist: 8 },
  { name: 'town_street', x: 13, z: 15, yaw: 2.45, pitch: -0.2, dist: 12 },
  { name: 'peaks_boulders', x: 30, z: 700, yaw: 0.5, pitch: 0.3, dist: 8 },
  { name: 'grass_close', x: 15, z: 45, yaw: 1.0, pitch: 0.55, dist: 6 },
].filter((l) => !process.env.AB_ONLY || process.env.AB_ONLY.split(',').includes(l.name));

const SETTLE_MS = 10000;
const SAMPLE_MS = 8000;
const ORBIT_RATE = 0.9; // rad/s camera yaw spin for the movement case

const LAUNCH_ARGS = [
  '--window-size=1600,900',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
  '--use-gl=angle',
  '--use-angle=gl',
  '--enable-webgl',
  '--no-sandbox',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stats(deltas) {
  // drop the first 20 frames: rAF warmup + camera snap
  const d = deltas.slice(20).sort((a, b) => a - b);
  if (!d.length) return null;
  const sum = d.reduce((a, b) => a + b, 0);
  const avgMs = sum / d.length;
  const p = (q) => d[Math.min(d.length - 1, Math.floor(d.length * q))];
  return {
    frames: d.length,
    avgFps: 1000 / avgMs,
    p95ms: p(0.95),
    onePctLowFps: 1000 / p(0.99),
    worstMs: d[d.length - 1],
  };
}

async function measure(page, spin) {
  return await page.evaluate(
    async (ms, rate) => {
      return await new Promise((resolve) => {
        const deltas = [];
        const g = window.__game;
        let last = performance.now();
        const t0 = last;
        const step = (t) => {
          const dt = t - last;
          deltas.push(dt);
          last = t;
          if (rate > 0 && g?.input) g.input.camYaw += (dt / 1000) * rate;
          if (t - t0 < ms) requestAnimationFrame(step);
          else resolve(deltas);
        };
        requestAnimationFrame(step);
      });
    },
    SAMPLE_MS,
    spin ? ORBIT_RATE : 0,
  );
}

const results = [];
for (const target of TARGETS) {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: LAUNCH_ARGS,
    defaultViewport: { width: 1600, height: 900 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem(
      'woc_settings',
      JSON.stringify({
        graphicsPreset: 5,
        terrainDetail: 1,
        foliageDensity: 1,
        effectsQuality: 1,
        shadowQuality: 1,
        renderScale: 1,
        browserEffects: 1,
      }),
    );
  });
  try {
    await page.goto(`${target.url}/?gfx=ultra`, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });
    // The PBE domain fronts the client with a landing page: click its PLAY
    // button (in-page click, works headless) and wait for the client's
    // pre-game hook to appear before running the shared entry flow.
    const hasEntry = await page
      .waitForSelector('#btn-offline', { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (!hasEntry) {
      // #btn-play is the hero button; the nav bar also has a "Play" button
      // that only switches tabs, so target by id, in-page click.
      await page.evaluate(() => document.querySelector('#btn-play')?.click());
      await page.waitForSelector('#btn-offline', { timeout: 60000 });
      await page.evaluate(() => {
        localStorage.setItem(
          'woc_settings',
          JSON.stringify({
            graphicsPreset: 5,
            terrainDetail: 1,
            foliageDensity: 1,
            effectsQuality: 1,
            shadowQuality: 1,
            renderScale: 1,
            browserEffects: 1,
          }),
        );
      });
    }
    await enterOfflineGame(page, {
      charClass: 'warrior',
      charName: 'FpsProbe',
      settleMs: 2500,
      gameBootTimeoutMs: 120000,
    });
    await page.waitForFunction(() => Boolean(window.__game?.sim?.player), { timeout: 120000 });
  } catch (e) {
    await page.screenshot({ path: `tmp/fps-ab-entry-fail-${target.label}.png` }).catch(() => {});
    results.push({ target: target.label, error: `entry failed: ${e.message}` });
    await browser.close();
    continue;
  }

  for (const loc of LOCATIONS) {
    await page.evaluate((p) => {
      const g = window.__game;
      g.sim.player.gm = true;
      g.sim.player.hp = g.sim.player.maxHp;
      g.sim.player.pos.x = p.x;
      g.sim.player.pos.z = p.z;
      g.sim.player.facing = p.yaw;
      g.input.camYaw = p.yaw;
      g.input.camPitch = p.pitch;
      g.input.camDist = p.dist;
      if (g.renderer) g.renderer.camDist = p.dist;
    }, loc);
    await sleep(SETTLE_MS);
    const still = stats(await measure(page, false));
    const orbit = stats(await measure(page, true));
    results.push({ target: target.label, location: loc.name, still, orbit });
    console.log(
      `${target.label.padEnd(6)} ${loc.name.padEnd(15)} still ${still?.avgFps.toFixed(1)}fps ` +
        `(1%low ${still?.onePctLowFps.toFixed(1)}) | orbit ${orbit?.avgFps.toFixed(1)}fps ` +
        `(1%low ${orbit?.onePctLowFps.toFixed(1)}, worst ${orbit?.worstMs.toFixed(0)}ms)`,
    );
  }
  if (errors.length) results.push({ target: target.label, pageErrors: errors.slice(0, 5) });
  await browser.close();
}

const out = process.env.AB_OUT ?? 'tmp/fps-ab.json';
fs.mkdirSync('tmp', { recursive: true });
fs.writeFileSync(out, JSON.stringify(results, null, 2));
console.log(`\nwritten ${out}`);
