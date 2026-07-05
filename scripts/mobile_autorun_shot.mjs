// Screenshot the mobile autorun toggle button in offline mode.
// Needs `npm run dev` on :5173. No server/Postgres required (offline flow).
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.URL || 'http://localhost:5173/';
const OUT = process.env.OUT || '/tmp/woc-autorun';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
const cdp = await page.target().createCDPSession();
await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] });

await page.goto(URL, { waitUntil: 'networkidle2' });
await sleep(800);

// Offline flow: #btn-offline -> pick a class -> name -> start
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Trailblazer', settleMs: 3500 });

async function shot(name) {
  await page.screenshot({ path: `${OUT}-${name}.png` });
  console.log('wrote', `${OUT}-${name}.png`);
}

// Autorun OFF (default)
await shot('off');

// Tap autorun -> ON (gold glow + character starts running)
await page.evaluate(() => document.getElementById('mobile-autorun')?.click());
await sleep(1500);
await shot('on');

await browser.close();
