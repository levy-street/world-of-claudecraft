// Mobile screenshot for the Nameplates ("Names") touch-tray button.
// Drives the offline world in a phone-emulated viewport (no server/Postgres),
// opens the "More" tray, and captures the tray with the new toggle, then the
// toggled-off state. Requires `npm run dev` on :5173.
//
// Usage: node scripts/mobile_nameplates_shot.mjs
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = 'http://localhost:5173/';
const OUT = 'tmp/shots';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
  // Satisfy PHONE_TOUCH_QUERY (coarse pointer) so body.mobile-touch turns on.
  const client = await page.target().createCDPSession();
  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'pointer', value: 'coarse' }],
  });

  await page.goto(URL, { waitUntil: 'networkidle2' });

  // Offline flow: Play Offline, name, pick class, Start.
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'Thorgar', settleMs: 2500 });

  // Let the world spawn + render a few frames.
  await page.waitForSelector('#mobile-controls', { timeout: 15000 });

  // Open the "More" tray.
  await page.evaluate(() => document.querySelector('#mobile-more')?.click());
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `${OUT}/mobile-nameplates-tray.png` });
  console.log('saved mobile-nameplates-tray.png');

  // Tap the Names button to toggle nameplates OFF (button loses its gold glow),
  // which also closes the tray — reopen to show the un-glowed state.
  await page.evaluate(() => document.querySelector('#mobile-nameplates')?.click());
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => document.querySelector('#mobile-more')?.click());
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `${OUT}/mobile-nameplates-off.png` });
  console.log('saved mobile-nameplates-off.png');
} finally {
  await browser.close();
}
