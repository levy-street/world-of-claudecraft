// Mobile screenshot helper for the Touch Look Speed accessibility slider.
// Usage: node scripts/mobile_touch_look_speed_shot.mjs   (needs `npm run dev` on :5173)
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173/';
const OUT = process.env.OUT_DIR ?? '/tmp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage();
// Landscape phone with a coarse pointer so body.mobile-touch + isPhoneTouchDevice() activate.
await page.emulate({
  viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
});
// isPhoneTouchDevice() reads matchMedia(pointer: coarse) — headless Chromium reports
// fine, so force coarse pointer to mirror a real phone.
const client = await page.target().createCDPSession();
await client.send('Emulation.setEmulatedMedia', {
  features: [{ name: 'pointer', value: 'coarse' }],
});
page.on('console', (m) => {
  if (m.type() === 'error') console.log('PAGE ERR', m.text());
});

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await sleep(500);
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Thumbwar', settleMs: 6000 });

// Open the Esc options menu and jump straight to the Graphics view.
await page.evaluate(() => {
  const hud = window.__game.hud;
  hud.toggleOptionsMenu();
  hud.optionsView = 'graphics';
  hud.renderOptions();
});
await sleep(400);
const def = `${OUT}/mobile-touch-look-speed-default.png`;
await page.screenshot({ path: def });
console.log('wrote', def);

// Drag the slider to its max (180%) to show the readout updating.
await page.evaluate(() => {
  const sliders = [...document.querySelectorAll('#options-menu .set-slider')];
  const row = sliders
    .map((s) => s.closest('.set-row'))
    .find((r) => /Touch Look Speed/.test(r?.textContent ?? ''));
  const slider = row?.querySelector('.set-slider');
  if (slider) {
    slider.value = slider.max;
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
await sleep(300);
const max = `${OUT}/mobile-touch-look-speed-max.png`;
await page.screenshot({ path: max });
console.log('wrote', max);

await browser.close();
