// Before/after capture for the clickable LFM group link (PR screenshots).
// Real offline client, not a fixture: the local player leads a Hollow Crypt
// listing, posts it to General through the Groups window's own advert command,
// and an item link is posted beside it for color comparison. Shoots the chat
// panel, then really clicks the group link (when this build has one) and shoots
// the Groups window it lands on.
//
// Requires `npm run dev`. Usage:
//   GAME_URL=http://127.0.0.1:5173 OUT=tmp/lfm-shots PREFIX=after node scripts/lfm_chat_link_shot.mjs
// Seeds the LOWEST graphics preset before boot (the standing capture rule).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const url = process.env.GAME_URL ?? 'http://127.0.0.1:5173';
const out = process.env.OUT ?? 'tmp/lfm-shots';
const prefix = process.env.PREFIX ?? 'after';
fs.mkdirSync(out, { recursive: true });

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  // In-game mobile is landscape-only on the web client.
  { name: 'mobile', width: 844, height: 390, mobile: true },
];

async function clipOf(page, selector, pad = 6) {
  const box = await page.evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null; const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
  );
  if (!box || box.width === 0) return null;
  return {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  };
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  // A persistent profile keeps the dev server's module cache between runs.
  userDataDir: process.env.PROFILE_DIR ?? 'tmp/lfm-shot-profile',
  protocolTimeout: 900000,
  args: ['--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
      } catch {}
    });
    await page.setViewport({
      width: vp.width,
      height: vp.height,
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
      deviceScaleFactor: 1,
    });
    // A cold Vite dev server can abort the first navigation while it re-optimizes.
    for (let attempt = 0; ; attempt++) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
        break;
      } catch (error) {
        if (attempt >= 3) throw error;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    // The landing keeps Play busy until the game modules load (minutes on a cold
    // dev server), so wait for it before entering.
    await page.waitForFunction(
      `!document.querySelector('#btn-offline')?.hasAttribute('data-landing-booting')`,
      { timeout: 300000 },
    );
    await enterOfflineGame(page, {
      charClass: 'warrior',
      charName: 'Thalwyn',
      settleMs: 4000,
      selectorTimeoutMs: 600000,
      gameBootTimeoutMs: 600000,
    });
    // Stage: a level 8 tank (inside the Hollow Crypt band) leading a listing.
    // The level-up deed lines are cleared from the log so the shot shows only
    // the two General lines: real item links, then the advert's group link.
    await page.evaluate(`(() => {
      const sim = window.__game.sim;
      sim.setPlayerLevel(8, sim.playerId);
      sim.dungeonFinderSetRoles(['tank']);
      sim.dungeonFinderListingCreate('hollow_crypt_normal', ['learning']);
    })()`);
    await new Promise((r) => setTimeout(r, 1500));
    await page.evaluate(`document.querySelector('#chatlog').replaceChildren()`);
    await page.evaluate(`(() => {
      const sim = window.__game.sim;
      sim.chat('/general WTS [[i:conchplate_sabatons]] [[i:hammer_of_the_open_lock]]');
    })()`);
    await new Promise((r) => setTimeout(r, 600));
    await page.evaluate(`(() => {
      const sim = window.__game.sim;
      sim.dungeonFinderExpeditionConfigure({ kind: 'advertise', target: 'general' });
    })()`);
    await new Promise((r) => setTimeout(r, 1200));
    const chatClip = await clipOf(page, '#chatlog-frame');
    if (chatClip)
      await page.screenshot({ path: `${out}/${prefix}-chat-${vp.name}.png`, clip: chatClip });
    // Really click the link (the bound handler, not a debug hook).
    const link = await page.$('#chatlog .chat-group-link');
    if (link) {
      await page.evaluate(`document.querySelector('#chatlog .chat-group-link').click()`);
      await new Promise((r) => setTimeout(r, 400));
      const winClip = await clipOf(page, '#dungeon-finder-window', 0);
      if (winClip)
        await page.screenshot({ path: `${out}/${prefix}-groups-${vp.name}.png`, clip: winClip });
    }
    console.log(
      `${prefix} ${vp.name}: link=${Boolean(link)} errors=${errors.length ? errors.join(' | ') : 'none'}`,
    );
    await page.close();
  }
} finally {
  await browser.close();
}
