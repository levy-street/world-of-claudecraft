// Visual capture for the chat-input placeholder autosize fix (#1232).
// Boots offline, opens the chat bar, and screenshots the bottom-left corner:
//   01-placeholder : freshly opened, empty, showing the long default hint
//                    (before the fix the second wrapped line is clipped)
//   02-typed       : a short typed message (single line again)
//   03-long        : a long message wrapped onto several lines, grown upward
// Saves to docs/pr-assets/chat-input-placeholder/. Label with SHOT_LABEL=before|after.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const LABEL = process.env.SHOT_LABEL ?? 'after';
const OUT = 'docs/pr-assets/chat-input-placeholder';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CLIP = { x: 0, y: 560, width: 460, height: 340 };

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.getElementById('btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Scribe');
await page.evaluate(() => {
  document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
  document.getElementById('btn-start-offline').click();
});
await page.waitForFunction(() => window.__game && window.__game.hud, { timeout: 30000 });
await sleep(800);

// Seed a few chat lines so the box has visible content behind the input.
await page.evaluate(() => {
  const hud = window.__game.hud;
  hud.log('Welcome to Eastbrook Vale.', '#ffd100');
  hud.log('You gain 12 experience.', '#7fd4ff');
});

// Open the chat bar with the long default hint (the same path Enter uses),
// pinning the placeholder to the full slash-command hint from the catalog so
// the wrapped-hint case is exercised regardless of the active tab.
await page.evaluate(() => {
  const el = document.getElementById('chat-input');
  el.placeholder =
    'Say something... (/s say, /w name whisper, /r reply, /p party, /gu guild, /o officer, /general general, /help)';
  el.style.display = 'block';
  el.value = '';
  el.dispatchEvent(new Event('focus'));
  el.focus();
  el.dispatchEvent(new Event('input'));
});
await sleep(250);
await page.screenshot({ path: `${OUT}/01-placeholder-${LABEL}.png`, clip: CLIP });

const measure = () =>
  page.evaluate(() => {
    const el = document.getElementById('chat-input');
    const rect = el.getBoundingClientRect();
    return { height: Math.round(rect.height), scrollHeight: el.scrollHeight };
  });
console.log(`[${LABEL}] empty+placeholder:`, JSON.stringify(await measure()));

// A short typed message: back to a single line.
await page.evaluate(() => {
  const el = document.getElementById('chat-input');
  el.value = 'inv please';
  el.dispatchEvent(new Event('input'));
});
await sleep(200);
await page.screenshot({ path: `${OUT}/02-typed-${LABEL}.png`, clip: CLIP });
console.log(`[${LABEL}] short typed:`, JSON.stringify(await measure()));

// A long message to confirm upward growth is unchanged.
await page.evaluate(() => {
  const el = document.getElementById('chat-input');
  el.value =
    'Looking for a healer and a tank for Shadowfen Hollow, we have three DPS ready and saved to the heroic lockout, ping me here or whisper.';
  el.dispatchEvent(new Event('input'));
});
await sleep(250);
await page.screenshot({ path: `${OUT}/03-long-${LABEL}.png`, clip: CLIP });
console.log(`[${LABEL}] long typed:`, JSON.stringify(await measure()));

console.log('screenshots written to', OUT);
await browser.close();
