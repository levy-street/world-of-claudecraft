// Screenshots for the Bridgemere toll-chest relocation (Toll and Tangle): the
// first Sunken Toll-Chest used to be authored at the centre of a moat pool,
// 3.1yd under the water plane, so nothing showed above the surface and the
// objective stuck at 2 of 3. Boots the offline world once, teleports beside
// the moat's east pool, and pins one free-cam framing over the pool from its
// east bank: BEFORE shows open water where the chest sits, AFTER shows the
// chest on the bank. Run against a base worktree for BEFORE and the branch
// for AFTER (GAME_URL selects the Vite server). Needs `npm run dev` running;
// browser via scripts/browser_path.mjs.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT_DIR ?? '/tmp/toll_chest_shots';
const TAG = process.env.SHOT_TAG ?? 'after';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
// Standing capture rule: seed the LOWEST graphics preset before the app boots.
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
});
await page.goto(URL, { waitUntil: 'load', timeout: 45000 });
const booted = await enterOfflineGame(page, {
  charName: 'Tollcheck',
  settleMs: 3000,
  gameBootTimeoutMs: 120000,
});
if (!booted) {
  await browser.close();
  throw new Error('could not boot the offline world');
}

// Free-cam shot: teleport the player near the camera (drives zone features,
// entity interest, and streaming), then pin the exact pose via editorCam.
async function shot(name, cam, target, settleMs = 12000) {
  await page.evaluate(() => {
    const skip = [...document.querySelectorAll('button')].find((b) =>
      (b.textContent || '').includes('Skip Tutorial'),
    );
    skip?.click();
  });
  await page.evaluate(
    async (c, t) => {
      const g = window.__game;
      const p = g.sim.player;
      p.maxHp = 99999;
      p.hp = 99999;
      // The east pool sits inside a willow-sprite camp: silence every mob so
      // the frame is the bank, not a fight.
      for (const e of g.sim.entities.values()) {
        if (e.kind !== 'mob') continue;
        e.dead = true;
        e.hp = 0;
        e.aiState = 'dead';
        e.respawnTimer = 9999;
        e.corpseTimer = 9999;
        e.inCombat = false;
      }
      // The real teleport (the ore-vein target's idiom): it settles y and
      // rebuckets, which a bare pos write does not.
      g.sim.chat(`/dev tp ${c.x} ${c.z}`);
      await new Promise((r) => setTimeout(r, 4000));
      const gy = g.sim.groundPos(t.x, t.z).y;
      g.renderer.editorCam = {
        pos: { x: c.x, y: gy + c.h, z: c.z },
        target: { x: t.x, y: gy + t.h, z: t.z },
      };
    },
    cam,
    target,
  );
  await new Promise((r) => setTimeout(r, settleMs));
  await page.evaluate(() => {
    document.querySelector('#gpu-notice')?.remove();
    document.getElementById('tutorial-greeting')?.remove();
    for (const label of ['Confirm', 'Dismiss']) {
      const btn = [...document.querySelectorAll('button')].find(
        (b) => b.textContent.trim() === label && b.getBoundingClientRect().width > 0,
      );
      btn?.click();
    }
  });
  await new Promise((r) => setTimeout(r, 400));
  const file = `${OUT}/${TAG}-${name}.png`;
  await page.screenshot({ path: file });
  console.log('wrote', file);
}

// The moat's east pool (-324,361 r11) from its east bank, looking west across
// the water: the old chest spot is the pool centre, the new one is the bank
// in the foreground at (-310,360).
await shot('east-pool', { x: -296, z: 348, h: 14 }, { x: -318, z: 361, h: 0 });

await browser.close();
console.log('done');
