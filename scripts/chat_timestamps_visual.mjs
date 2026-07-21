// Visual capture for the chat-timestamps interface option.
// Boots the game offline, seeds a few chat lines, and screenshots:
//   1. the Interface options sub-view (toggle off)
//   2. the chat log with 24-hour timestamps on
//   3. the chat log with 12-hour timestamps on
//   4. the full HUD with timestamps on
// Saves to docs/pr-assets/chat-timestamps/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/pr-assets/chat-timestamps';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await sleep(200);
await page.type('#char-name', 'Timekeeper');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await sleep(2500);

// Seed a realistic mix of chat lines. chatLogFrom is TS-private but reachable
// at runtime; mirrors the channels the event path renders (say/party/whisper).
const seed = () => {
  const hud = window.__game.hud;
  hud.chatLogFrom('Aleph', 'pulling the patrol on 3, stack behind me', '#7fd4ff', '[Party] ', ': ');
  hud.chatLogFrom('Bramble', 'omw, bandaging first', '#ff80ff', '', ' whispers: ');
  hud.chatLogFrom('Cinder', 'anyone selling Webwood Silk?', '#ffc864', '[General] ', ': ');
  hud.chatLogFrom('Drust', 'nice pull!', '#f0ead8', '', ' says: ');
  hud.log('Welcome to Eastbrook Vale.', '#ffd100');
};

// Open Options → Interface and screenshot the new sub-view (timestamps off).
await page.evaluate(() => { const h = window.__game.hud; h.toggleOptionsMenu(); h.optionsView = 'interface'; h.renderOptions(); });
await sleep(300);
const optsEl = await page.$('#options-menu');
await optsEl.screenshot({ path: `${OUT}/01-interface-options.png` });

// Capture the enabled state — toggle On, 24-hour active in the selector.
await page.evaluate(() => {
  const h = window.__game.hud;
  h.chatTimestamps = true; h.chatClock = '24h'; h.renderOptions();
});
await sleep(200);
await (await page.$('#options-menu')).screenshot({ path: `${OUT}/05-interface-on.png` });

// Enable timestamps (24h) via the toggle, then re-seed chat and screenshot.
await page.evaluate(() => {
  const h = window.__game.hud;
  h.chatTimestamps = true; h.chatClock = '24h';
  localStorage.setItem('chatTimestamps', '1'); localStorage.setItem('chatClock', '24h');
  h.closeOptions();
});
await page.evaluate(seed);
await sleep(300);
await page.screenshot({ path: `${OUT}/02-chatlog-24h.png`, clip: { x: 4, y: 660, width: 400, height: 232 } });

// Switch to 12-hour and re-seed.
await page.evaluate(() => {
  const h = window.__game.hud;
  h.chatClock = '12h'; localStorage.setItem('chatClock', '12h');
  document.getElementById('chatlog').innerHTML = '';
});
await page.evaluate(seed);
await sleep(300);
await page.screenshot({ path: `${OUT}/03-chatlog-12h.png`, clip: { x: 4, y: 660, width: 400, height: 232 } });

// Full HUD with timestamps visible.
await page.screenshot({ path: `${OUT}/04-full-hud.png` });

console.log('screenshots written to', OUT);
await browser.close();
