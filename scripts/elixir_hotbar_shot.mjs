// Screenshot rig for elixir placement on the action bar.
// Boots the offline world, gives the player a healing potion and an Elixir of
// the Bear, opens the bags, then drags each bag row onto an action-bar slot
// with the REAL HTML5 drag events the HUD listens for (bag row dragstart ->
// action button dragover/drop) so the capture exercises the placement gate
// (isHotbarItemId) rather than writing hotbarActions directly. On the base
// branch the elixir drag is refused and slot 6 stays empty; on this branch it
// lands beside the potion.
// Needs a dev server (default :5173, override GAME_URL). Seeds the lowest
// graphics preset per the capture rule.
//   SHOT_DIR=tmp SHOT_TAG=after GAME_URL=http://localhost:5199 node scripts/elixir_hotbar_shot.mjs

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { dismissEntryOverlays, enterOfflineGame } from './enter_offline_game.mjs';

const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=low`;
const OUT = process.env.SHOT_DIR ?? 'tmp';
const TAG = process.env.SHOT_TAG ?? 'after';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const POTION = 'healing_potion';
const ELIXIR = 'elixir_of_the_bear';

async function sweepOverlays(page, passes = 8) {
  for (let i = 0; i < passes; i++) {
    await dismissEntryOverlays(page);
    await page
      .evaluate(() => {
        const visible = (el) => !!el && getComputedStyle(el).display !== 'none' && !el.hidden;
        const greeting = document.getElementById('tutorial-greeting');
        if (visible(greeting)) greeting.querySelector('[data-close], [data-skip]')?.click();
        for (const id of ['gpu-notice', 'perf-nudge']) {
          const notice = document.getElementById(id);
          if (!visible(notice)) continue;
          notice.querySelector('button')?.click();
          notice.hidden = true;
          notice.style.display = 'none';
        }
        const banner = document.querySelector('#banner');
        if (banner) banner.style.opacity = '0';
      })
      .catch(() => {});
    await sleep(250);
  }
}

// Drag a bag row for `itemId` onto 1-based action-bar `slot` with a shared
// DataTransfer, exactly the event sequence the browser fires for a mouse drag.
const DRAG_TO_SLOT = (itemId, slot) => {
  const row = document.querySelector('#bags .bag-item[data-coach-item="' + itemId + '"]');
  const btn = document.querySelector('.action-btn[data-hotbar-slot="' + slot + '"]');
  if (!row || !btn) return { ok: false, row: !!row, btn: !!btn };
  const dt = new DataTransfer();
  const ev = (type, target) => {
    const e = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
    target.dispatchEvent(e);
    return e;
  };
  ev('dragstart', row);
  const over = ev('dragover', btn);
  const drop = ev('drop', btn);
  ev('dragend', row);
  const placed = window.__game?.hud?.hotbarActions?.[slot - 1] ?? null;
  return {
    ok: true,
    overAccepted: over.defaultPrevented,
    dropAccepted: drop.defaultPrevented,
    placed,
  };
};

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function shoot(label, viewport, mobile) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  if (mobile) {
    const cdp = await page.target().createCDPSession();
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'pointer', value: 'coarse' },
        { name: 'hover', value: 'none' },
      ],
    });
  }
  await page.evaluateOnNewDocument(
    'localStorage.setItem("woc_settings", JSON.stringify({ graphicsPreset: 1, graphicsDefaultApplied: true }))',
  );
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'Elixirtester' });
  await sweepOverlays(page);
  await page.evaluate(
    `(() => { const sim = window.__game.sim; sim.addItem('${POTION}', 5); sim.addItem('${ELIXIR}', 5); window.__game.hud.toggleBags(); })()`,
  );
  await sleep(600);
  await sweepOverlays(page, 3);
  const potion = await page.evaluate(DRAG_TO_SLOT, POTION, 5);
  const elixir = await page.evaluate(DRAG_TO_SLOT, ELIXIR, 6);
  console.log(label, 'potion', JSON.stringify(potion));
  console.log(label, 'elixir', JSON.stringify(elixir));
  // The touch bags window covers the whole ring, so close it before the
  // mobile frame; desktop keeps it open to show the drag source.
  if (mobile) await page.evaluate(() => window.__game.hud.toggleBags());
  await sleep(800);
  // Hover the elixir slot so the tooltip shows what landed (or the empty seat).
  const target = await page.evaluate(() => {
    const btn = document.querySelector('.action-btn[data-hotbar-slot="6"]');
    const r = btn?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  if (target) await page.mouse.move(target.x, target.y);
  await sleep(500);
  const file = `${OUT}/${TAG}-${label}.png`;
  await page.screenshot({ path: file });
  console.log('wrote', file);
  await page.close();
}

await shoot('desktop', { width: 1600, height: 900 }, false);
await shoot('mobile', { width: 932, height: 430, isMobile: true, hasTouch: true }, true);
await browser.close();
