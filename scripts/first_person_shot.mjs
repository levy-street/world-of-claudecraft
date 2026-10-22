// Screenshot rig for the opt-in first-person camera (firstPersonMode).
//
// Boots an offline character at the LOWEST graphics preset (the standing
// capture rule), zooms all the way in, and shoots the same spot four ways:
// the shipped third-person camera for reference (mode 0), first person with
// the body below the head (mode 1, looking ahead and looking down at the
// body), and first person with no body (mode 2). The mode is switched
// through the renderer's own rig (window.__game.renderer.firstPerson), the
// same object the options row drives through camera_view_settings.ts.
//
// Needs `npm run dev` (override the URL with GAME_URL). Writes to
// docs/screenshots/first-person-view/ (override with SHOTS_DIR).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/first-person-view';
const CLASS = process.env.SHOT_CLASS ?? 'warrior';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    // A root container (CI, cloud sessions) cannot start the sandbox.
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
  ],
  defaultViewport: { width: 1600, height: 900 },
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
    } catch {
      /* ignore */
    }
  });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
  const booted = await enterOfflineGame(page, {
    charClass: CLASS,
    charName: 'Watcher',
    settleMs: 6000,
    gameBootTimeoutMs: 90000,
    selectorTimeoutMs: 60000,
  });
  if (!booted) throw new Error('offline world did not boot');

  // Headless paints only when asked; each paint runs the game loop once.
  const frames = async (n) => {
    for (let i = 0; i < n; i++) {
      await page.screenshot({ path: path.join(OUT, '_frame.png') });
      await sleep(60);
    }
  };
  const pose = async (mode, dist, pitch) => {
    await page.evaluate(
      (m, d, p) => {
        const g = window.__game;
        g.renderer.firstPerson.setMode(m);
        g.input.camDist = d;
        g.input.camPitch = p;
      },
      mode,
      dist,
      pitch,
    );
    // Let the spring arm and the zoom settle before the keeper frame.
    await frames(12);
  };
  const shot = async (name) => {
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log('wrote', path.join(OUT, `${name}.png`));
  };

  await frames(20);
  await pose(0, 3, 0.32);
  await shot('mode0-off-third-person');
  await pose(1, 3, 0.32);
  await shot('mode1-body-ahead');
  await pose(1, 3, 1.25);
  await shot('mode1-body-looking-down');
  await pose(2, 3, 0.32);
  await shot('mode2-no-body-ahead');
  await pose(2, 3, 1.25);
  await shot('mode2-no-body-looking-down');
  fs.rmSync(path.join(OUT, '_frame.png'), { force: true });
} finally {
  await browser.close();
}
