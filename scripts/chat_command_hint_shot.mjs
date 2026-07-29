// Visual capture for the "!" community-commands chat hint (issue #1230).
// Boots offline (desktop, then a mobile-viewport pass) and screenshots the chat
// input showing the real, live-translated placeholder (via
// hud.applyChatInputPresentation(), the same call the in-game "open chat" path
// makes) so the "! for community commands" hint is visible verbatim.
// Saves to docs/pr-assets/chat-command-hint/. Label with SHOT_LABEL=before|after.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const LABEL = process.env.SHOT_LABEL ?? 'after';
const OUT = 'docs/pr-assets/chat-command-hint';
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});

async function openChatAndShoot(page, mobile, file) {
  // The start screen can still be mid-transition under heavy machine load even
  // after enterOfflineGame resolves; wait for the in-world chrome to actually be
  // live so the clip below is not taken against a stale pre-game frame.
  await page.waitForFunction(
    () => Boolean(window.__game?.sim?.player) && document.getElementById('ui'),
    { timeout: 120000 },
  );
  await page.evaluate((isMobile) => {
    document.querySelector('#gpu-notice')?.remove();
    const el = document.getElementById('chat-input');
    if (!el) throw new Error('#chat-input missing');
    if (isMobile) {
      // Mirrors main.ts's ensureMobileComposerInPanel + the mobile-chat-open class
      // the real "open chat" path sets: on the touch HUD the composer lives INSIDE
      // the chat panel, not as the desktop absolute bar.
      const wrap = document.getElementById('chatlog-wrap');
      if (wrap && el.parentElement !== wrap) wrap.insertBefore(el, wrap.firstChild);
      document.body.classList.add('mobile-chat-open');
    }
    // Same call openChat() makes: the placeholder shown is the real
    // t('hud.core.chatPlaceholder') / t('hudChrome.mobile.chatPlaceholder')
    // value, not a hardcoded stand-in.
    window.__game?.hud?.applyChatInputPresentation?.();
    el.style.display = 'block';
    el.value = '';
    el.focus();
  }, Boolean(mobile));
  // Poll instead of a fixed sleep: under heavy machine load a fixed wait either
  // races the layout (empty clip) or wastes time. Requires a real laid-out box
  // AND a non-empty placeholder, so a mid-transition frame cannot pass.
  let region = null;
  let placeholder = '';
  for (let i = 0; i < 40; i++) {
    await wait(500);
    const state = await page.evaluate(() => {
      const el = document.getElementById('chat-input');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        display: getComputedStyle(el).display,
        placeholder: el.placeholder,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      };
    });
    if (state && state.display !== 'none' && state.rect.width > 0 && state.placeholder) {
      region = state.rect;
      placeholder = state.placeholder;
      break;
    }
  }
  if (!region) throw new Error('#chat-input never laid out with a placeholder');
  console.log(`  placeholder: "${placeholder}"`);
  console.log(`  region: ${JSON.stringify(region)}`);
  const m = 12;
  await page.screenshot({
    path: file,
    clip: {
      x: Math.max(0, region.x - m),
      y: Math.max(0, region.y - m),
      width: region.width + m * 2,
      height: region.height + m * 2,
    },
  });
  console.log('shot:', file);
}

// Desktop pass.
{
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR(desktop):', e.message));
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
  const booted = await enterOfflineGame(page, {
    charClass: 'warrior',
    charName: 'Thorgar',
    settleMs: 5000,
    gameBootTimeoutMs: 180000,
  });
  if (!booted) throw new Error('desktop world entry did not boot in time');
  await openChatAndShoot(page, false, `${OUT}/01-desktop-${LABEL}.png`);
  await page.close();
}

// Mobile pass (landscape, the web client's only in-game mobile orientation).
{
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR(mobile):', e.message));
  await page.emulate({
    viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
  await page.evaluate(() => document.body.classList.add('mobile-touch'));
  const booted = await enterOfflineGame(page, {
    charClass: 'warrior',
    charName: 'Thorgar',
    settleMs: 5000,
    gameBootTimeoutMs: 180000,
  });
  if (!booted) throw new Error('mobile world entry did not boot in time');
  await openChatAndShoot(page, true, `${OUT}/02-mobile-${LABEL}.png`);
  await page.close();
}

console.log('screenshots written to', OUT);
await browser.close();
