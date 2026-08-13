// Screenshot harness for issue #2678, live in-world half: the offline
// character-create carousel preview and the in-world character use the same
// VisualDef (both call applyMaterials/tintedFarMaterials with
// def.tintStrength; see src/render/characters/assets.ts + visual.ts), so one
// manifest.ts edit covers both surfaces. This captures the priest's LIVE
// in-world default (skin 0) appearance to prove the same fix carries past the
// create-screen preview, in landscape mobile (the game is landscape-only on
// mobile).
//
//   MODE=after  node scripts/charcreate_tint_wash_inworld_shot.mjs
//   MODE=before node scripts/charcreate_tint_wash_inworld_shot.mjs
//
// Needs `npm run dev` running at GAME_URL (default http://localhost:5173).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as DETECTED } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

// Force a non-software-GL material tier (?gfx=high): swiftshader is mapped to
// the 'low' tier, which routes through Lambert materials plus an unconditional
// low-readability white lift that swamps the class tint delta this shot exists
// to show. Real players hitting this bug are on standard-tier materials.
const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}?gfx=high`;
const MODE = process.env.MODE ?? 'after';
const OUT_DIR = process.env.OUT_DIR ?? 'tmp/charcreate-tint-shots';
fs.mkdirSync(OUT_DIR, { recursive: true });

const BROWSER_PATH = process.env.BROWSER_PATH ?? DETECTED ?? '/usr/bin/chromium';
const viewport = { width: 844, height: 390 }; // landscape mobile

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 600000,
  args: [
    `--window-size=${viewport.width},${viewport.height}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--disable-crash-reporter',
    '--disable-breakpad',
  ],
  defaultViewport: viewport,
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
// domcontentloaded, not networkidle0: an unreachable /api/site-presence
// heartbeat (no game server behind this dev instance) retries frequently
// enough to keep the network non-idle forever and time out the navigation.
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

const client = await page.target().createCDPSession();
await client.send('Emulation.setTouchEmulationEnabled', { enabled: true });

// Generous boot timeout: this shot targets whatever headless box is running
// the capture, which can be shared/loaded well past the harness default.
const booted = await enterOfflineGame(page, {
  charClass: 'priest',
  charName: 'Tintcheck',
  gameBootTimeoutMs: 480000,
  selectorTimeoutMs: 120000,
});
console.log('game booted:', booted);

await page.evaluate(() => document.body.classList.add('mobile-touch'));

// Dismiss the "running without GPU acceleration" banner (expected under
// swiftshader) so it does not cover the character model. #gpu-notice
// (src/ui/gpu_notice_toast.ts) can render a beat after enterOfflineGame's
// settle window, so poll for its dismiss button and confirm the toast
// actually re-hides rather than firing one click on a fixed delay.
for (let attempt = 0; attempt < 10; attempt++) {
  const hidden = await page.evaluate(() => {
    const notice = document.querySelector('#gpu-notice');
    if (!notice || notice.hidden) return true;
    notice.querySelector('.gpu-notice-dismiss')?.click();
    return false;
  });
  if (hidden) break;
  await new Promise((r) => setTimeout(r, 300));
}

await page.screenshot({ path: `${OUT_DIR}/${MODE}-mobile-inworld-priest.png` });
console.log('shot: inworld priest (mobile)');

await browser.close();
console.log('done');
