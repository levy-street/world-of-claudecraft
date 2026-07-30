// Screenshot harness for the char skin picker (character window) and the
// cosmetic skin-roll event overlay, used to prove
// src/ui/char_skin_window.ts (extracted from hud.ts in PR #1942) renders and
// behaves identically to the pre-extraction hud.ts implementation.
//
//   MODE=after DEVICE=desktop node scripts/char_skin_shot.mjs
//   MODE=after DEVICE=mobile  node scripts/char_skin_shot.mjs
//   MODE=before DEVICE=desktop node scripts/char_skin_shot.mjs
//
// Needs `npm run dev` running at GAME_URL (default http://localhost:5173).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as DETECTED } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const MODE = process.env.MODE ?? 'after';
const DEVICE = process.env.DEVICE ?? 'desktop';
const OUT_DIR = process.env.OUT_DIR ?? 'tmp/skin-shots';
fs.mkdirSync(OUT_DIR, { recursive: true });

const BROWSER_PATH = process.env.BROWSER_PATH ?? DETECTED ?? '/usr/bin/chromium';

const desktop = { width: 1600, height: 900 };
const mobile = { width: 844, height: 390 }; // landscape (game is landscape-only on mobile)

const viewport = DEVICE === 'mobile' ? mobile : desktop;

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    `--window-size=${viewport.width},${viewport.height}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: viewport,
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });

if (DEVICE === 'mobile') {
  const client = await page.target().createCDPSession();
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true });
}

const jsClick = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`missing ${s}`);
    el.click();
  }, sel);

await new Promise((r) => setTimeout(r, 400));
await jsClick('#btn-offline');
await page.waitForSelector('#offline-select .mini-class[data-class="warrior"]', {
  visible: true,
  timeout: 15000,
});
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  if (n) {
    n.value = 'Skinwalker';
    n.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
await jsClick('#offline-select .mini-class[data-class="warrior"]');
await jsClick('#btn-start-offline');
await page
  .waitForSelector('#mobile-preflight-continue', { visible: true, timeout: 5000 })
  .catch(() => {});
await page.evaluate(() => document.querySelector('#mobile-preflight-continue')?.click());
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 90000 });
await new Promise((r) => setTimeout(r, 2000));

if (DEVICE === 'mobile') {
  await page.evaluate(() => document.body.classList.add('mobile-touch'));
}

// Dismiss the new-adventurer tutorial overlay so it does not intercept input.
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /skip tutorial/i.test(b.textContent || ''),
  );
  btn?.click();
});
await new Promise((r) => setTimeout(r, 300));

// Grant a couple of mech chroma cosmetics so the skin picker has several
// selectable swatches beyond the base class chromas (matches what a player who
// has rolled skin events would see). Retried once: under heavy machine load the
// execution context can be torn down transiently right after world entry.
async function grantMechChromas() {
  await page.evaluate(() => {
    const sim = window.__game.sim;
    sim.accountCosmetics.mechChromaIds = Array.from(
      new Set([
        ...sim.accountCosmetics.mechChromaIds,
        'amber_crimson',
        'crimson_amber',
        'cyan_magenta',
      ]),
    );
  });
}
try {
  await grantMechChromas();
} catch (e) {
  console.log('retrying grantMechChromas after:', e.message);
  await new Promise((r) => setTimeout(r, 1000));
  await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 20000 });
  await grantMechChromas();
}

async function shot(name, clipSel) {
  await new Promise((r) => setTimeout(r, 250));
  if (clipSel) {
    let box = null;
    for (let i = 0; i < 8; i++) {
      box = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      }, clipSel);
      if (box && box.w > 0 && box.h > 0) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    if (box && box.w > 0 && box.h > 0) {
      const pad = 12;
      await page.screenshot({
        path: `${OUT_DIR}/${MODE}-${DEVICE}-${name}.png`,
        clip: {
          x: Math.max(0, box.x - pad),
          y: Math.max(0, box.y - pad),
          width: box.w + pad * 2,
          height: box.h + pad * 2,
        },
      });
      console.log('shot:', name, JSON.stringify(box));
      return;
    }
  }
  await page.screenshot({ path: `${OUT_DIR}/${MODE}-${DEVICE}-${name}.png` });
  console.log('shot (fullpage):', name);
}

// --- Char skin picker (character window) ---
// The minimap button (#mm-char) is a more reliable open trigger than the KeyC
// keybind under headless automation (the canvas may not hold input focus).
let charOpen = false;
for (let i = 0; i < 4 && !charOpen; i++) {
  charOpen = await page.evaluate(
    () => (document.querySelector('#char-window')?.style.display ?? '') === 'block',
  );
  if (charOpen) break;
  await page.evaluate(() => document.querySelector('#mm-char')?.click());
  await new Promise((r) => setTimeout(r, 500));
}
console.log('char window open:', charOpen);
await new Promise((r) => setTimeout(r, 1200));
await shot('char-window-skin-picker', '#char-window');

// Select a couple of different skin swatches so multiple options are visibly
// exercised (selection state, not just presence).
const swatchCount = await page.evaluate(
  () => document.querySelectorAll('#char-skin-row .skin-swatch').length,
);
console.log('skin swatch count:', swatchCount);
if (swatchCount > 1) {
  await page.evaluate(() => {
    const row = document.querySelectorAll('#char-skin-row .skin-swatch');
    row[1]?.click();
  });
  await new Promise((r) => setTimeout(r, 900));
  await shot('char-window-skin-picker-option2', '#char-window');
}
if (swatchCount > 2) {
  await page.evaluate(() => {
    const row = document.querySelectorAll('#char-skin-row .skin-swatch');
    row[2]?.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  await shot('char-window-skin-picker-option3', '#char-window');
}

// close char window before opening the skin event overlay
await page.evaluate(() => document.querySelector('#mm-char')?.click());
await new Promise((r) => setTimeout(r, 300));

// --- Skin event overlay (cosmetic skin-roll reward) ---
await page.evaluate(() => {
  window.__game.hud.openSkinEvent('rare');
});
await new Promise((r) => setTimeout(r, 900)); // let the wheel animation land
await shot('skin-event-overlay-rare', '#skin-event');

await page.evaluate(() => {
  window.__game.hud.closeSkinEvent();
});
await new Promise((r) => setTimeout(r, 300));

await page.evaluate(() => {
  window.__game.hud.openSkinEvent('epic');
});
await new Promise((r) => setTimeout(r, 900));
await shot('skin-event-overlay-epic', '#skin-event');

await browser.close();
console.log('done:', MODE, DEVICE);
