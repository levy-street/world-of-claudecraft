// Visual capture for the chat-input reposition + autosize fix.
// Boots offline, opens the chat bar, and screenshots the bottom-left corner so
// the chat input is shown relative to the chat box (tabs + log frame).
//   01-empty   : freshly opened, single line, sitting ABOVE the tab strip
//   02-long    : a long message wrapped onto several lines, grown upward
// Saves to docs/pr-assets/chat-input-reposition/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const LABEL = process.env.SHOT_LABEL ?? 'after';
const OUT = 'docs/pr-assets/chat-input-reposition';
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
// #btn-offline is a hidden E2E compat trigger; drive the flow via JS clicks so
// off-screen / aria-hidden elements still fire their handlers.
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
  hud.log('Aleph: pulling on 3, stack behind me.', '#f0ead8');
  hud.log('Loot: [Webwood Silk] x2.', '#ffc864');
});

// Open the chat bar (the same path the Enter keybind uses).
const openChat = async () => {
  await page.evaluate(() => {
    const el = document.getElementById('chat-input');
    el.style.display = 'block';
    el.dispatchEvent(new Event('focus'));
    el.focus();
  });
  await sleep(250);
};

await openChat();
await page.evaluate(() => {
  const el = document.getElementById('chat-input');
  el.value = '';
  el.dispatchEvent(new Event('input'));
});
await sleep(200);
await page.screenshot({ path: `${OUT}/01-empty-${LABEL}.png`, clip: CLIP });

// Type a long message to exercise the upward autosize growth.
await page.evaluate(() => {
  const el = document.getElementById('chat-input');
  el.value = 'Looking for a healer and a tank for Shadowfen Hollow, we have three DPS ready and saved to the heroic lockout, ping me here or whisper.';
  el.dispatchEvent(new Event('input'));
});
await sleep(250);
await page.screenshot({ path: `${OUT}/02-long-${LABEL}.png`, clip: CLIP });

// Report measured geometry so the fix is provable, not just visual.
const geom = await page.evaluate(() => {
  const input = document.getElementById('chat-input').getBoundingClientRect();
  const wrap = document.getElementById('chatlog-wrap').getBoundingClientRect();
  return {
    inputBottom: Math.round(input.bottom), inputTop: Math.round(input.top),
    inputHeight: Math.round(input.height), boxTop: Math.round(wrap.top),
    overlap: Math.round(input.bottom - wrap.top),
  };
});
console.log(`[${LABEL}] geometry:`, JSON.stringify(geom));
console.log(`[${LABEL}] input.bottom=${geom.inputBottom} box.top=${geom.boxTop} -> overlap=${geom.overlap}px (<=0 means clear)`);
console.log('screenshots written to', OUT);
await browser.close();
