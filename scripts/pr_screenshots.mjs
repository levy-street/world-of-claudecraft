// Captures screenshots of a pull request in the running client so a reviewer can see what
// the change looks like. Offline only: it drives the local Vite dev client (no server, no
// dev commands) through the shared offline entry flow and writes PNGs into SHOTS_DIR.
//
// Two modes:
//   change-aware  When DIFF_FILE points at a unified diff, it maps the changed paths to the
//                 screens they imply (see pr_shot_targets.mjs) and shoots exactly those:
//                 a bag change -> the inventory window, a zone/map change -> the world map.
//   fixed tour    With no diff (or no matched targets), it falls back to a consistent
//                 baseline: character select, desktop HUD, mobile HUD.
//
// Run locally:  npm run dev   (in another terminal, serves :5173)
//               BROWSER_PATH=/path/to/chrome DIFF_FILE=pr.diff node scripts/pr_screenshots.mjs
// Env:
//   GAME_URL    client URL (default http://localhost:5173)
//   SHOTS_DIR   output directory for PNGs (default pr-shots)
//   DIFF_FILE   optional unified diff; enables change-aware capture
//   BROWSER_PATH  Chrome/Edge/Chromium binary (see browser_path.mjs)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { resolveTargets } from './pr_shot_targets.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOTS_DIR ?? 'pr-shots';
const DIFF_FILE = process.env.DIFF_FILE;
fs.mkdirSync(OUT, { recursive: true });

// Resolve change-aware targets from the diff, when one is provided.
let targets = [];
if (DIFF_FILE) {
  try {
    const diff = fs.readFileSync(DIFF_FILE, 'utf8');
    const files = [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)]
      .map((m) => m[1])
      .filter((p) => p !== '/dev/null');
    targets = resolveTargets(files);
    console.log(
      `diff: ${files.length} changed file(s) -> targets: ${targets.map((t) => t.key).join(', ') || '(none, using fixed tour)'}`,
    );
  } catch (e) {
    console.log(`could not read DIFF_FILE=${DIFF_FILE}: ${e.message}`);
  }
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  // Software GL so it runs on a headless CI box with no GPU, matching the other tours.
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});

const errors = [];
const captured = [];

// One guarded shot: a failure in one frame must not lose the others, so the run always
// uploads whatever it managed to capture. `clip` is an optional CSS selector; when given
// and found, the shot is cropped to that element (plus a small margin) instead of full frame.
async function shoot(page, name, clip) {
  try {
    await new Promise((r) => setTimeout(r, 300));
    const file = `${OUT}/${name}.png`;
    let region;
    if (clip) {
      region = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }, clip);
    }
    if (region && region.width > 0 && region.height > 0) {
      const m = 12;
      await page.screenshot({
        path: file,
        clip: {
          x: Math.max(0, region.x - m),
          y: Math.max(0, region.y - m),
          width: region.width + m * 2,
          height: region.height + m * 2,
        },
      });
    } else {
      if (clip) errors.push(`SHOT ${name}: clip '${clip}' not found, captured full frame`);
      await page.screenshot({ path: file });
    }
    captured.push(`${name}.png`);
    console.log('shot:', file);
  } catch (e) {
    errors.push(`SHOT ${name}: ${e.message}`);
  }
}

function watch(page, tag) {
  page.on('pageerror', (e) => errors.push(`PAGEERROR(${tag}): ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`CONSOLE(${tag}): ${m.text()}`);
  });
}

async function changeAwareTour() {
  const page = await browser.newPage();
  watch(page, 'desktop');
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'Thorgar', settleMs: 3000 });
  let i = 1;
  for (const t of targets) {
    const idx = String(i).padStart(2, '0');
    try {
      const region = await t.capture(page);
      await shoot(page, `${idx}-${t.key}`, region?.clip);
    } catch (e) {
      errors.push(`TARGET ${t.key}: ${e.message}`);
    }
    i++;
  }
  await page.close();
}

async function fixedTour() {
  // 1) Character-select landing (desktop): open the offline select so the class cards show.
  const page = await browser.newPage();
  watch(page, 'desktop');
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(() => document.querySelector('#btn-offline')?.click());
  await page
    .waitForSelector('#offline-select .mini-class', { visible: true, timeout: 15000 })
    .catch(() => {});
  await shoot(page, '01-character-select');

  // 2) Desktop HUD in-world.
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'Thorgar', settleMs: 3000 });
  await shoot(page, '02-hud-desktop');
  await page.close();

  // 3) Mobile-viewport HUD (iPhone-class touch viewport).
  try {
    const mobile = await browser.newPage();
    watch(mobile, 'mobile');
    await mobile.emulate({
      viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    await mobile.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
    await mobile.evaluate(() => document.body.classList.add('mobile-touch'));
    await enterOfflineGame(mobile, { charClass: 'mage', charName: 'Aldwin', settleMs: 3000 });
    await shoot(mobile, '03-hud-mobile');
    await mobile.close();
  } catch (e) {
    errors.push(`MOBILE: ${e.message}`);
  }
}

try {
  if (targets.length) await changeAwareTour();
  else await fixedTour();
} finally {
  await browser.close();
}

// Record the manifest so the comment step can list what was captured without re-reading.
fs.writeFileSync(
  `${OUT}/manifest.json`,
  JSON.stringify({ mode: targets.length ? 'change-aware' : 'fixed', captured, errors }, null, 2),
);

if (errors.length) console.log(`notes during capture:\n${errors.join('\n')}`);
console.log(`captured ${captured.length} screenshot(s) into ${OUT}/`);
// Non-zero only if we got nothing at all, so a partial run still uploads its frames.
process.exit(captured.length > 0 ? 0 : 1);
