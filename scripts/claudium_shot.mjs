// Screenshots for the Claudium store window, proving TWO things at once:
//   1. GRACEFUL DEGRADATION: with NO economy service running, the window opens
//      through its real module (Hud.claudiumWindow) and renders a CLEAN disabled
//      state, and the game boots + plays regardless. Offline the window has no
//      economy hooks, so snapshot() resolves to the service-off disabled model,
//      exactly mirroring a dead service.
//   2. THE FUNDED UI RENDERS: we inject deps (via Hud.attachClaudium) returning a
//      balance + skus + a couple store items, re-open, and shoot the funded state.
//
// Modeled on scripts/clock_shot.mjs (offline boot: #btn-offline, #char-name, the
// warrior mini-class, #btn-start-offline; wait for the sim player + a visible UI).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/claudium';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
// #btn-offline is the aria-hidden compat trigger E2E scripts drive directly; it
// opens the offline character panel (show('#offline-select')). It has no
// clickable point, so trigger it via a DOM .click() rather than page.click().
await page.evaluate(() => document.querySelector('#btn-offline').click());
await page.waitForSelector('#offline-select .mini-class[data-class="warrior"]', {
  visible: true,
  timeout: 30000,
});
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Thorgar');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');

// The game must boot with NO economy service: wait for the sim player and a
// visible HUD (proves the offline world came up regardless of the service).
await page.waitForFunction(
  () =>
    window.__game?.sim?.player &&
    getComputedStyle(document.querySelector('#ui')).display !== 'none',
  { timeout: 120000 },
);
await new Promise((r) => setTimeout(r, 800));

const shoot = async (name) => {
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `${OUT}/${name}.png` });
};

// ---- Shot 1: service OFF (the real disabled state). Offline there are no
// economy hooks, so the window's snapshot() returns the disabled model. This is
// the graceful-degradation proof: the store opens and renders cleanly with the
// service dead.
await page.evaluate(() => {
  window.__game.hud.toggleClaudium();
});
await shoot('claudium_service_off');

// Close before re-opening the funded state.
await page.evaluate(() => {
  window.__game.hud.toggleClaudium();
});
await new Promise((r) => setTimeout(r, 200));

// ---- Shot 2: funded state. Inject deps (mirroring a live service) that return a
// balance + the SKU ladder + a couple store items, then re-open. The window
// computes nothing; it renders exactly what these deps return.
await page.evaluate(() => {
  const packs = [
    { sku: 'claudium_500', usd: 4.99, claudium: 500 },
    { sku: 'claudium_1050', usd: 9.99, claudium: 1050 },
    { sku: 'claudium_2200', usd: 19.99, claudium: 2200 },
    { sku: 'claudium_4000', usd: 34.99, claudium: 4000 },
    { sku: 'claudium_6000', usd: 49.99, claudium: 6000 },
    { sku: 'claudium_13000', usd: 99.99, claudium: 13000 },
  ];
  window.__game.hud.attachClaudium({
    balance: async () => 1250,
    storeSnapshot: async () => ({ balance: 1250, storeItems: [] }),
    snapshot: async () => ({
      balance: 1250,
      skus: packs,
      price: { usdPerClaudium: 0.01, wocBaseUnitsPerClaudium: 42 },
      storeItems: [
        { itemId: 'hat_gold', name: 'Gilded Circlet', kind: 'cosmetic', costClaudium: 500 },
        { itemId: 'skin_ember', name: 'Ember Warplate Skin', kind: 'skin', costClaudium: 2000 },
        { itemId: 'trail_frost', name: 'Frostfall Trail', kind: 'item', costClaudium: 750 },
      ],
    }),
    buy: async () => {},
    spend: async () => ({ granted: true, balance: 1250 }),
  });
  window.__game.hud.toggleClaudium();
});
await shoot('claudium_funded');

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console/page errors');
await browser.close();
