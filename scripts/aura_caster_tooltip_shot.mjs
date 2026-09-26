// Visual proof for the "See who buffs" player feature request: an aura's tooltip can
// now name who applied it (the showAuraCaster setting, off by default). Needs
// `npm run dev` already running. Screenshots land in tmp/.
//
// Scenario: the local player wears a paladin blessing applied by a THIRD PARTY
// (a synthetic "Furyogen" entity injected into sim.entities, cloned from the
// player's own entity shape so it satisfies whatever per-frame systems expect
// of a player-kind entity), so the caster line reads a real name rather than
// the player's own. Applied through the real sim.applyAura path (private in
// TypeScript, unenforced at runtime), the same engine code a real cast runs,
// rather than a raw push onto the auras array.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT_PREFIX = process.env.OUT_PREFIX ?? 'tmp/aura-caster';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

// This capture is about tooltip TEXT content, not graphics-tier rendering (the
// low-tier buff-icon cap is an orthogonal, already-covered concern; see
// buff_priority_and_stormsurge_shot.mjs), so it boots at the default preset
// rather than seeding the lowest one.
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 45000 });
await enterOfflineGame(page, { charClass: 'mage', charName: 'Candy' });
await page.evaluate(() => document.querySelector('.tut-skip')?.click());
await sleep(300);
// Dismiss the swiftshader "running without GPU acceleration" advisory
// (gpu_notice_toast.ts): headless capture always trips it, and it otherwise
// overlaps the buff tooltip in the crop below.
await page.evaluate(() => document.querySelector('.gpu-notice-dismiss')?.click());
await sleep(150);

async function screenshotSelector(selector, path, pad = { x: 20, top: 10, bottom: 30 }) {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, selector);
  if (!box) {
    console.log(`MISSING selector for screenshot: ${selector}`);
    return;
  }
  await page.screenshot({
    path,
    clip: {
      x: Math.max(0, box.x - pad.x),
      y: Math.max(0, box.y - pad.top),
      width: box.width + pad.x * 2,
      height: Math.max(box.height, 40) + pad.top + pad.bottom,
    },
  });
}

// Dismiss a tutorial NPC greeting if one popped, so it never overlaps a shot.
await page.evaluate(() => {
  document
    .querySelector('#tutorial-greeting [data-close], #tutorial-greeting [data-skip]')
    ?.click();
});
await sleep(150);

// Stage a paladin blessing applied by a THIRD PARTY (a synthetic entity, not
// the local player), so the caster line reads a real name. The caster is a
// clone of the player's OWN entity shape (pos/hp/stats/etc. all present),
// just a different id/name: an ad hoc {kind:'player', id, name} stub is
// missing fields other per-frame HUD systems iterate over every player-kind
// entity for (nameplates, threat, minimap) and throws mid-frame, which
// silently freezes the buff bar's repaint for the rest of the session.
const staged = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const me = sim.entities.get(g.world.playerId);
  const CASTER_ID = 999001;
  sim.entities.set(CASTER_ID, { ...me, id: CASTER_ID, name: 'Furyogen' });
  me.auras.length = 0;
  sim.applyAura(me, {
    id: 'blessing_of_might',
    name: 'Blessing of Might',
    kind: 'buff_ap',
    remaining: 1800,
    duration: 1800,
    value: 120,
    sourceId: CASTER_ID,
    school: 'holy',
  });
  return { auraCount: me.auras.length, casterId: CASTER_ID };
});
console.log('staged', staged);
await sleep(2000);

// Find the staged buff's node (its .dur reads "30m" for the staged 1800s
// remaining) rather than assume DOM order.
async function hoverBlessingNode() {
  const center = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('#buff-bar .buff')];
    const node = nodes.find((n) => n.querySelector('.dur')?.textContent === '30m');
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!center) {
    const dump = await page.evaluate(() =>
      [...document.querySelectorAll('#buff-bar .buff')].map((n) => ({
        dur: n.querySelector('.dur')?.textContent,
        cls: n.className,
      })),
    );
    console.log('buff-bar dump at failure', dump);
    throw new Error('Blessing of Might node not found in #buff-bar');
  }
  await page.mouse.move(center.x, center.y);
}

// --- BEFORE: showAuraCaster is off by default, so the tooltip carries no
// caster line at all. -------------------------------------------------------
await hoverBlessingNode();
await sleep(200);
await screenshotSelector('#tooltip', `${OUT_PREFIX}-before-tooltip.png`, {
  x: 10,
  top: 10,
  bottom: 10,
});
const beforeHtml = await page.evaluate(() => document.querySelector('#tooltip')?.innerHTML ?? '');
console.log('beforeHtml', beforeHtml);

// Move away so the next hover fires a fresh mouseenter (a still-hovered element
// never re-shows).
await page.mouse.move(200, 700);
await sleep(150);

// --- Turn the setting on via the real Options > Interface UI (mirrors
// scripts/buff_priority_and_stormsurge_shot.mjs's settings-menu recipe). -----
const toggled = await page.evaluate(() => {
  const hud = window.__game?.hud;
  if (!hud) return false;
  const win = document.querySelector('#options-menu');
  if (win && getComputedStyle(win).display !== 'none') hud.toggleOptionsMenu();
  hud.toggleOptionsMenu();
  document.querySelector('#options-menu .opt-btn[data-menu-action="interface"]')?.click();
  // showAuraCaster lives in the 'frames' tab (INTERFACE_TAB_ORDER index 1),
  // beside alwaysShowAllBuffs.
  const framesTab = document.querySelectorAll('#options-menu .opt-tab')[1];
  framesTab?.click();
  const toggle = document.querySelector('#options-menu [data-setting-key="showAuraCaster"]');
  toggle?.scrollIntoView({ block: 'center' });
  return !!toggle;
});
console.log('optionsToggleFound', toggled);
await sleep(200);
await screenshotSelector('#options-menu', `${OUT_PREFIX}-settings-full.png`, {
  x: 20,
  top: 20,
  bottom: 20,
});
const clicked = await page.evaluate(() => {
  const toggle = document.querySelector('#options-menu [data-setting-key="showAuraCaster"]');
  toggle?.click();
  return toggle?.getAttribute('aria-pressed') ?? toggle?.getAttribute('aria-checked') ?? null;
});
console.log('clicked, state=', clicked);
await sleep(200);
// Close the options menu so it does not overlap the buff bar in the AFTER shot.
await page.evaluate(() => window.__game?.hud?.toggleOptionsMenu());
await sleep(150);

// --- AFTER: the same tooltip now carries the "Cast by Furyogen" line. ------
await hoverBlessingNode();
await sleep(200);
await screenshotSelector('#tooltip', `${OUT_PREFIX}-after-tooltip.png`, {
  x: 10,
  top: 10,
  bottom: 10,
});
const afterHtml = await page.evaluate(() => document.querySelector('#tooltip')?.innerHTML ?? '');
console.log('afterHtml', afterHtml);

await browser.close();
