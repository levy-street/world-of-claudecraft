// Visual capture for the voice-NPC draft panel (docs/prd/woc/voice-npc.md):
// boots the offline client, mounts the WIP VoiceNpcPanel with the game's own
// module (dynamic import through the vite dev server) over a stubbed
// /api/voice-npc fetch (the panel normally mounts online-only; no game server
// runs here), opens it via its real launcher button, and screenshots the panel
// including the quote/burn price display.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
const OUT_DIR = 'docs/screenshots/voice-npc';
fs.mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('#btn-offline', { timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(900);
await page.evaluate(() => {
  const cn = document.querySelector('#char-name');
  cn.value = 'Echowyn';
  cn.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#offline-select .mini-class[data-class="warrior"]')?.click();
});
await sleep(200);
await page.evaluate(() => document.querySelector('#btn-start-offline').click());

await page.waitForFunction(
  () =>
    !!window.__game?.sim?.player &&
    getComputedStyle(document.querySelector('#ui')).display !== 'none',
  { timeout: 120000, polling: 600 },
);

await page.evaluate(() => {
  const skip = [...document.querySelectorAll('button, .tut-skip, a')].find((el) =>
    /skip tutorial/i.test(el.textContent || ''),
  );
  if (skip) skip.click();
});
await sleep(400);

// Stub the panel's network surface, then mount + open it exactly the way
// main.ts does online (mount() -> launcher click -> open() reads /info).
const mounted = await page.evaluate(async () => {
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/voice-npc/info')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ enabled: true, priceWoc: 25000, mint: 'WoCMint1111', decimals: 6 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    if (url.includes('/api/voice-npc/')) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'offline shot stub' }), { status: 503 }),
      );
    }
    return realFetch(input, init);
  };
  const mod = await import('/src/ui/voice_npc_panel.ts');
  const panel = new mod.VoiceNpcPanel({ token: 'shot-stub-token', base: '' });
  panel.mount();
  document.getElementById('voice-npc-launcher')?.click();
  return true;
});
console.log('panel mounted:', mounted);
await sleep(800);

const priceText = await page.evaluate(
  () => document.querySelector('#voice-npc-panel')?.textContent ?? '',
);
if (!/25[,.\s]?000|25000/.test(priceText)) {
  console.log('WARNING: price display not found in panel text:', priceText.slice(0, 200));
}

await page.screenshot({ path: `${OUT_DIR}/voice-npc-panel.png` });
const clip = await page.evaluate(() => {
  const el = document.getElementById('voice-npc-panel');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const pad = 24;
  return {
    x: Math.max(0, r.x - pad),
    y: Math.max(0, r.y - pad),
    width: r.width + pad * 2,
    height: r.height + pad * 2,
  };
});
if (clip) await page.screenshot({ path: `${OUT_DIR}/voice-npc-panel-crop.png`, clip });
console.log(`screenshots written to ${OUT_DIR}/voice-npc-panel.png (+ crop)`);

await browser.close();
