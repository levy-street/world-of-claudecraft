// Captures screenshots of a pull request in the running client so a reviewer can see what
// the change looks like. Offline only: it drives the local Vite dev client (no server, no
// dev commands) through the shared offline entry flow and writes PNGs into SHOTS_DIR.
//
// Change-aware and visual-only. From the PR diff (DIFF_FILE) it decides WHAT to shoot:
//   specific targets  a bag change -> the inventory window, a zone/map change -> the world
//                      map (see pr_shot_targets.mjs), clipped to that window.
//   generic HUD       a visual change with no specific window (renderer, HUD chrome, CSS)
//                      -> the in-world desktop HUD, plus the mobile HUD when the change
//                      touches the mobile/responsive surface.
//   nothing           a backend/data/i18n-only diff is not visual, so it captures no frames
//                      at all (the comment step then posts no screenshots).
// There is no fixed tour: it never shoots unrelated parts of the game just to have something.
//
// Run locally:  npm run dev   (in another terminal, serves :5173)
//               BROWSER_PATH=/path/to/chrome DIFF_FILE=pr.diff node scripts/pr_screenshots.mjs
// Env:
//   GAME_URL    client URL (default http://localhost:5173)
//   SHOTS_DIR   output directory for PNGs (default pr-shots)
//   DIFF_FILE   unified diff; required for capture (no diff -> nothing is visual -> skip)
//   BROWSER_PATH  Chrome/Edge/Chromium binary (see browser_path.mjs)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { classifyDiff, diffChangedPaths } from './pr_shot_targets.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOTS_DIR ?? 'pr-shots';
const DIFF_FILE = process.env.DIFF_FILE;
fs.mkdirSync(OUT, { recursive: true });

// Classify the diff into a capture plan. With no diff, nothing is treated as visual.
let plan = { specific: [], generic: [], isVisual: false };
if (DIFF_FILE) {
  try {
    const diff = fs.readFileSync(DIFF_FILE, 'utf8');
    // Both diff sides, so a DELETED visual file (whose "+++" side is /dev/null) still counts.
    const files = diffChangedPaths(diff);
    plan = classifyDiff(files);
    const shooting = plan.specific.length
      ? plan.specific.map((t) => t.key).join(', ')
      : plan.generic.join(', ') || '(none, no visual change)';
    console.log(`diff: ${files.length} changed file(s) -> shooting: ${shooting}`);
  } catch (e) {
    console.log(`could not read DIFF_FILE=${DIFF_FILE}: ${e.message}`);
  }
} else {
  console.log('no DIFF_FILE: nothing to classify, capturing nothing.');
}

const errors = [];
const captured = [];

// Nothing visual changed: write an empty manifest and exit clean. No browser launch.
if (!plan.isVisual) {
  fs.writeFileSync(
    `${OUT}/manifest.json`,
    JSON.stringify({ mode: 'no-visual', captured, errors }, null, 2),
  );
  console.log('no visual changes in this diff; captured 0 screenshots.');
  process.exit(0);
}

// Resolve the browser lazily: the no-visual path above never needs one, and browser_path
// throws at import when no binary is present.
const { BROWSER_PATH } = await import('./browser_path.mjs');

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  // Software GL so it runs on a headless CI box with no GPU, matching the other tours.
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});

// One guarded shot: a failure in one frame must not lose the others, so the run always
// keeps whatever it managed to capture. `clip` is an optional CSS selector; when given
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

// Specific window targets: bring each one up in one desktop world and clip to it.
async function shootSpecific(targets) {
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

// Generic HUD frames for a visual change that maps to no specific window: the in-world
// desktop view, and the mobile view when the change touches the mobile/responsive surface.
async function shootGenericHud(frames) {
  let i = 1;
  const next = () => String(i++).padStart(2, '0');

  if (frames.includes('hud-desktop')) {
    const page = await browser.newPage();
    watch(page, 'desktop');
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
    await enterOfflineGame(page, { charClass: 'warrior', charName: 'Thorgar', settleMs: 3000 });
    await shoot(page, `${next()}-hud-desktop`);
    await page.close();
  }

  if (frames.includes('hud-mobile')) {
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
      await shoot(mobile, `${next()}-hud-mobile`);
      await mobile.close();
    } catch (e) {
      errors.push(`MOBILE: ${e.message}`);
    }
  }
}

try {
  if (plan.specific.length) await shootSpecific(plan.specific);
  else await shootGenericHud(plan.generic);
} finally {
  await browser.close();
}

// Record the manifest so the comment step can list what was captured without re-reading.
const mode = plan.specific.length ? 'change-aware' : 'generic-hud';
fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ mode, captured, errors }, null, 2));

if (errors.length) console.log(`notes during capture:\n${errors.join('\n')}`);
console.log(`captured ${captured.length} screenshot(s) into ${OUT}/`);
// Non-zero only if a visual change captured nothing at all, so a partial run still keeps
// its frames while a total capture failure surfaces in the job log.
process.exit(captured.length > 0 ? 0 : 1);
