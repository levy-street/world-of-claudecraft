// PR context capture (not a repo test) for the Nythraxis Dread Curse tank-swap
// enforcement fix (src/sim/encounters/nythraxis.ts, nythraxis_dread_curse.ts):
// the debuff at the center of the report has no rendering change (the fix is a
// pure sim/targeting correction), so this documents the mechanic itself rather
// than a before/after visual diff. Single offline client, no boss or second
// player needed: lands the exact aura object castNythraxisDreadCurse applies
// at the swap-trigger stack count (2), then hovers the debuff-bar icon and
// captures the tooltip so reviewers can see the mechanic the enforcement
// protects.
//
// Usage: BROWSER_PATH=/path/to/chrome node scripts/nythraxis_dread_curse_debuff_shot.mjs
// (needs `npm run dev` running on :5173)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/nythraxis-dread-curse-swap';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function applyDreadCurse(page) {
  return page.evaluate(() => {
    const world = window.__game.world;
    const p = world.player;
    p.hp = p.maxHp;
    // The swap-trigger stack (NYTHRAXIS_DREAD_CURSE_TANK_SWAP_STACKS = 2): the
    // exact shape castNythraxisDreadCurse (src/sim/nythraxis_dread_curse.ts)
    // applies on a refresh, so the debuff bar and its tooltip render for real.
    world.applyAura(p, {
      id: 'nythraxis_dread_curse',
      name: 'Dread Curse',
      kind: 'vuln_source',
      remaining: 20,
      duration: 20,
      value: 0.7, // 2 stacks x 0.35 per-stack (normal)
      value2: 0.25, // the max-hp hit fraction (normal)
      stacks: 2,
      sourceId: p.id,
      school: 'shadow',
      encounterOwned: true,
    });
    return (p.auras ?? []).map((a) => ({ id: a.id, stacks: a.stacks }));
  });
}

async function hoverDebuffAndCapture(page, outFile) {
  await page.waitForSelector('#debuff-bar', { visible: true, timeout: 5000 });
  const icon = await page.$('#debuff-bar > *');
  if (!icon) throw new Error('no debuff icon rendered');
  await icon.hover();
  await page.waitForSelector('#tooltip', { visible: true, timeout: 5000 });
  await sleep(200);
  const box = await page.$eval('#tooltip', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  await page.screenshot({
    path: outFile,
    clip: {
      x: Math.max(0, box.x - 8),
      y: Math.max(0, box.y - 8),
      width: box.width + 16,
      height: box.height + 16,
    },
  });
  return page.$eval('#tooltip', (el) => el.textContent ?? '');
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800'],
    defaultViewport: { width: 1280, height: 800 },
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
    await page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });
    await enterOfflineGame(page, { charClass: 'warrior', charName: 'Bastionward' });
    // Dismiss the software-rendering banner (this rig forces swiftshader): it
    // overlays the same top band as the aura bars and swallows the hover below.
    await page.evaluate(() => {
      for (const btn of document.querySelectorAll('button')) {
        if (btn.textContent?.trim() === 'Dismiss') btn.click();
      }
    });
    await sleep(200);

    const applied = await applyDreadCurse(page);
    console.log('applied auras:', applied);

    const text = await hoverDebuffAndCapture(page, `${OUT}/dread-curse-debuff.png`);
    console.log('tooltip text:', text);
    if (!text.includes('Dread Curse'))
      throw new Error(`expected tooltip to name Dread Curse, got: ${text}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
