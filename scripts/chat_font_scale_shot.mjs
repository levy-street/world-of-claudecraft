// Evidence rig for the Chat Text Size ceiling raise (1.4 -> 2.5). Boots the offline
// client on the lowest graphics preset with chatFontScale seeded to a value, logs a
// few chat lines, and shoots the full HUD (4K desktop), the chat frame alone, the
// Esc -> Interface -> Chat tab, and the mobile landscape HUD. Run once per value
// (CHAT_SCALE=1.4 is the old ceiling, 2.5 the new one) with a Vite dev server up.
//   GAME_URL=http://localhost:5199 CHAT_SCALE=2.5 OUT=tmp/shots TAG=after \
//     node scripts/chat_font_scale_shot.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const SCALE = Number(process.env.CHAT_SCALE ?? '2.5');
const OUT = process.env.OUT ?? 'tmp/chat-font-scale';
const TAG = process.env.TAG ?? `x${SCALE}`;
const MOBILE = process.env.MOBILE === '1';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const vw = MOBILE ? 932 : 3840;
const vh = MOBILE ? 430 : 2160;
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    `--window-size=${vw},${vh}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: { width: vw, height: vh, isMobile: MOBILE, hasTouch: MOBILE },
});
const page = await browser.newPage();
if (MOBILE) {
  await page.setUserAgent(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  );
}
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

// Standing capture rule: lowest graphics preset; plus the chat scale under test.
await page.evaluateOnNewDocument(`(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1, graphicsDefaultApplied: true, chatFontScale: ${SCALE} }));
  } catch {}
})()`);

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Readable' });
await sleep(1500);

const applied = await page.evaluate(() => {
  const g = window.__game;
  const hud = g?.hud;
  const lines = [
    ['[General] Thrainn: anyone up for Abandoned Crypt? need a healer', '#ffc0c0'],
    ['[Party] Maelis: on my way, pulling the pack by the gate first', '#aaaaff'],
    ['[Guild] Vorn: welcome to the guild, Readable!', '#40ff40'],
    ['You receive loot: Sturdy Iron Boots.', '#ffff00'],
    ['Your Heroic Strike hits Ashwood Wolf for 118.', '#ffffff'],
  ];
  for (const [t, c] of lines) hud?.log?.(t, c);
  const pane = document.querySelector('.chat-pane.active') ?? document.querySelector('.chat-pane');
  return {
    setting: g?.settings?.get?.('chatFontScale'),
    cssVar: getComputedStyle(document.documentElement).getPropertyValue('--chat-font-scale').trim(),
    fontPx: pane ? getComputedStyle(pane).fontSize : null,
  };
});
console.log('applied', JSON.stringify(applied));
await sleep(800);

if (MOBILE) {
  // Clear the arrival dialog and the software-GPU toast, then open the touch
  // layout's chat panel the way a thumb does (it listens for pointerdown).
  await page.evaluate(() => {
    document.getElementById('quest-dialog')?.querySelector('button')?.click();
    document.querySelector('.gpu-notice-toast, #gpu-notice')?.remove();
    document
      .getElementById('mobile-chat')
      ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  });
  await sleep(800);
  await page.screenshot({ path: `${OUT}/${TAG}-mobile.png` });
} else {
  await page.screenshot({ path: `${OUT}/${TAG}-desktop-4k.png` });
  const chat = await page.$('#chatlog-wrap');
  if (chat) await chat.screenshot({ path: `${OUT}/${TAG}-chat-frame.png` });

  // Esc -> Interface (4th row) -> Chat (3rd tab, INTERFACE_TAB_ORDER).
  await page.evaluate(() => {
    document.getElementById('tutorial-greeting')?.remove();
    window.__game?.hud?.toggleOptionsMenu?.();
  });
  await sleep(400);
  await page.evaluate(() => document.querySelectorAll('#options-menu .opt-btn')[3]?.click());
  await sleep(400);
  await page.evaluate(() => document.querySelectorAll('#options-menu .opt-tab')[2]?.click());
  await sleep(600);
  const menu = await page.$('#options-menu');
  if (menu) await menu.screenshot({ path: `${OUT}/${TAG}-options-chat-tab.png` });
}
await browser.close();
console.log('done', TAG);
