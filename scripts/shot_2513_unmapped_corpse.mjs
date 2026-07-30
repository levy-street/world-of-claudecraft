// Visual capture for #2513: the corpse loot popup on a template whose every
// component family is unmapped (fen_troll: claw, tusk). Before the fix the popup
// carried a full Harvest picker whose every submit the sim refused after
// spending the corpse's single-use claim; after it, the popup is loot only.
//
// Staging note: fen_troll lives in mirefen_marsh, not the starting zone, so this
// forces `templateId` on a corpse in the loaded zone rather than teleporting.
// That is the honest minimum, because `templateId` is exactly the input under
// test: everything downstream (corpseLootAvailability, corpseHarvestView, the
// loot window controller) is the real shipped code reading the real content
// table. Pass SHOT_OUT to name the file.
//
// Usage (with `npm run dev` on GAME_URL):
//   GAME_URL=http://localhost:5199 SHOT_OUT=after node scripts/shot_2513_unmapped_corpse.mjs

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
const OUT = process.env.SHOT_OUT ?? 'after';
const MOBILE = process.env.SHOT_MOBILE === '1';
// SHOT_TEMPLATE lets the same rig capture the control case (a MIXED template,
// whose picker this change must not move).
const TEMPLATE = process.env.SHOT_TEMPLATE ?? 'fen_troll';
const TEMPLATE_NAME = process.env.SHOT_TEMPLATE_NAME ?? 'Mirefen Troll';
const BOOT_VIEW = { width: 1600, height: 900, deviceScaleFactor: 2 };
const SHOT_VIEW = MOBILE ? { width: 844, height: 390, deviceScaleFactor: 2 } : BOOT_VIEW;
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: [
    `--window-size=${BOOT_VIEW.width},${BOOT_VIEW.height}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: BOOT_VIEW,
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(900);
await page.evaluate(() => {
  const cn = document.querySelector('#char-name');
  cn.value = 'Harvestwyn';
  cn.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#offline-select .mini-class[data-class="hunter"]')?.click();
});
await sleep(200);
await page.evaluate(() => document.querySelector('#btn-start-offline').click());

let booted = false;
for (let i = 0; i < 150; i++) {
  await sleep(600);
  try {
    const ok = await page.evaluate(() => !!window.__game && window.__game.sim.entities.size > 0);
    if (ok) {
      booted = true;
      break;
    }
  } catch {
    /* context torn down during boot navigation; keep polling */
  }
}
if (!booted) {
  console.log('world never booted');
  await browser.close();
  process.exit(1);
}

// Dismiss whatever intro chrome is up. The keybind/camera confirm dialog is the
// one that matters: it renders OVER the loot window, so a shot taken with it open
// is a shot of the dialog.
for (let i = 0; i < 6; i++) {
  const clicked = await page.evaluate(() => {
    const hit = [...document.querySelectorAll('button, .tut-skip, a')].find(
      (el) =>
        el.offsetParent !== null &&
        /skip tutorial|^\s*confirm\s*$|^\s*continue\s*$|^\s*got it\s*$|^\s*close\s*$/i.test(
          el.textContent || '',
        ),
    );
    if (hit) {
      hit.click();
      return hit.textContent?.trim() ?? '?';
    }
    return null;
  });
  if (!clicked) break;
  console.log('dismissed:', clicked);
  await sleep(350);
}
// The camera-mode prompt (src/ui/camera_prompt.ts) is a modal backdrop whose
// Confirm sits inside it; dismiss it by its own root so a label click cannot
// land on the radio's body instead of the button.
await page.evaluate(() => {
  const dialog = document.querySelector('.camera-prompt-dialog');
  const confirm = dialog
    ? [...dialog.querySelectorAll('button')].find((b) => /confirm/i.test(b.textContent || ''))
    : null;
  if (confirm) confirm.click();
  document.querySelector('.camera-prompt-backdrop')?.remove();
});
await page.keyboard.press('Escape');
await sleep(500);

await page.evaluate(
  ([tpl, name, mobile]) => {
    window.__shotTemplate = tpl;
    window.__shotTemplateName = name;
    window.__shotMobile = mobile;
  },
  [TEMPLATE, TEMPLATE_NAME, MOBILE],
);
const staged = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  const mob = [...sim.entities.values()].find((e) => e.kind === 'mob' && !e.dead);
  if (!mob) return { error: 'no live mob found in loaded zone' };
  // The one forced input: the template whose componentTags all miss the yield
  // table. Everything the popup reads flows from here.
  mob.templateId = window.__shotTemplate;
  mob.name = window.__shotTemplateName;
  mob.tappedById = p.id;
  mob.dead = true;
  mob.hp = 0;
  mob.aiState = 'dead';
  mob.corpseTimer = 9999;
  mob.lootable = true;
  mob.harvestClaimedBy = null;
  // Copper at 100% is what fen_troll really drops, and it is the reason the
  // popup must still open: only the Harvest section goes away.
  mob.loot = { copper: 50, items: [] };
  p.pos.x = mob.pos.x + 1.5;
  p.pos.z = mob.pos.z - 4;
  p.prevPos = { ...p.pos };
  p.facing = 0;
  g.input.camYaw = 0;
  g.input.camPitch = 0.55;
  g.input.camDist = 6;
  if (window.__shotMobile) document.body.classList.add('mobile-touch');
  g.hud.openLoot(mob.id, 900, 500);
  const el = document.getElementById('loot-window');
  return {
    id: mob.id,
    templateId: mob.templateId,
    popupOpen: el?.style.display === 'block',
    harvestSection: !!el?.querySelector('.corpse-harvest'),
    checkboxes: el?.querySelectorAll('.corpse-harvest-check').length ?? 0,
  };
});
console.log('staged:', JSON.stringify(staged));
if (staged.error) {
  await browser.close();
  process.exit(1);
}
await sleep(700);

// The camera-mode prompt can arrive AFTER staging (it is triggered by the first
// camera input, and staging moves the camera), so clear it here, immediately
// before the shot, and re-open the popup underneath it.
for (let i = 0; i < 5; i++) {
  const cleared = await page.evaluate(() => {
    // The swiftshader GPU notice is banner chrome, not a modal, but at a
    // phone-sized viewport it lands on top of the popup, so it goes too.
    document.querySelector('.gpu-notice')?.remove();
    document.querySelector('.gpu-notice-message')?.closest('div')?.remove();
    const backdrop = document.querySelector('.camera-prompt-backdrop');
    if (!backdrop) return false;
    const confirm = [...backdrop.querySelectorAll('button')].find((b) =>
      /confirm/i.test(b.textContent || ''),
    );
    confirm?.click();
    backdrop.remove();
    return true;
  });
  if (!cleared) break;
  console.log('cleared camera prompt');
  await sleep(300);
}
if (MOBILE) {
  await page.setViewport(SHOT_VIEW);
  await sleep(600);
}
await page.evaluate(() => {
  const g = window.__game;
  const mob = [...g.sim.entities.values()].find((e) => e.templateId === window.__shotTemplate);
  if (mob) g.hud.openLoot(mob.id, window.__shotMobile ? 420 : 900, window.__shotMobile ? 195 : 500);
});
await sleep(500);

const clip = await page.evaluate(() => {
  const el = document.getElementById('loot-window');
  const r = el.getBoundingClientRect();
  const pad = 18;
  return {
    x: Math.max(0, r.x - pad),
    y: Math.max(0, r.y - pad),
    width: r.width + pad * 2,
    height: r.height + pad * 2,
  };
});
await page.evaluate(() => {
  for (const sel of ['.gpu-notice', '.camera-prompt-backdrop']) {
    document.querySelector(sel)?.remove();
  }
  const msg = document.querySelector('.gpu-notice-message');
  msg?.closest('div')?.remove();
});
await sleep(300);
// Fail loudly rather than shipping a shot of a dialog: the popup's own centre
// must be the topmost element under the cursor.
const covered = await page.evaluate(() => {
  const el = document.getElementById('loot-window');
  const r = el.getBoundingClientRect();
  const top = document.elementFromPoint(r.x + r.width / 2, r.y + 12);
  return el.contains(top) ? null : top?.className || top?.tagName || 'unknown';
});
if (covered) {
  console.log(`ABORT: something is covering the loot window: ${covered}`);
  await browser.close();
  process.exit(1);
}
await page.screenshot({ path: `tmp/unmapped-corpse-${OUT}${MOBILE ? '-mobile' : ''}.png`, clip });
console.log(`wrote tmp/unmapped-corpse-${OUT}${MOBILE ? '-mobile' : ''}.png`);

await browser.close();
