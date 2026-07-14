// Capture the on-back sheathe pose for the weapon families the Season 1 Armory
// added (mace, wand, bow/crossbow), which the sheathe grip table did not cover
// until back_grips.ts learned them. Boots the offline game, equips/skins one
// weapon per family, presses the sheathe key, and shoots the character from
// behind. Needs `npm run dev`.
//
//   OUT=tmp/sheathe_before node scripts/sheathe_family_shots.mjs

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT ?? 'tmp/sheathe_shots';
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1280,800', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message));

// Pre-set the first-run flags the real client honors, so no prompt owns the frame.
await page.evaluateOnNewDocument(() => {
  try {
    window.localStorage.setItem('woc.cameraModePrompt.shown', '1');
  } catch {
    /* private mode: the prompt is dismissed below instead */
  }
});
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
// The start screen's offline controls are a compat surface (aria-hidden), so
// drive them through the DOM like the other browser scripts do.
await page.evaluate(() => document.querySelector('#btn-offline').click());
await wait(400);
await page.type('#char-name', 'Sheathe');
await page.evaluate(() => {
  document.querySelector('#offline-select .mini-class[data-class="mage"]').click();
  document.querySelector('#btn-start-offline').click();
});
await page.waitForFunction(() => !!window.__game?.world?.player, { timeout: 90000 });
await wait(2500); // let the rig, its props, and the spawn cinematic settle

// Stage the shot: dismiss the tutorial, level up so weapons are equippable, and
// pull the camera in behind the character (the on-back pose is what we are here for).
// Clear the first-run prompts (tutorial, camera choice) and the HUD chrome, so the
// frame is just the character's back, which is the whole subject of these shots.
await page.evaluate(() => {
  document.querySelector('.camera-prompt-confirm')?.click();
  for (const b of document.querySelectorAll('button')) {
    if (/skip tutorial/i.test(b.textContent ?? '')) b.click();
  }
});
await wait(700);
await page.evaluate(() => {
  const g = window.__game;
  g.sim.setPlayerLevel?.(30);
  g.input.camDist = 6.5;
  g.input.camPitch = 0.32;
  g.input.camYaw = g.sim.player.facing;
});
await wait(800);

// One weapon per family under test. `item` drives the held model (a real equip);
// `skin` drives the Armory cosmetic straight on the entity, which is the same
// render path the store uses (the purchase gate is the server's, not the rig's).
/** Park the camera close behind the character (the spawn cinematic and the follow
 *  camera both drift it, so re-park before every shot). */
async function park(pg) {
  await pg.evaluate(() => {
    const g = window.__game;
    g.input.camDist = 6.5;
    g.input.camPitch = 0.32;
    g.input.camYaw = g.sim.player.facing;
  });
  await wait(1400);
}

const CASES = [
  { name: 'wand', item: 'drowned_tide_scepter', skin: null },
  { name: 'mace-skin', item: null, skin: 'tempered_flanged_mace' },
  { name: 'bow-skin', item: null, skin: 'fletcher_s_guild_bow' },
];

for (const c of CASES) {
  const applied = await page.evaluate(
    (cse) => {
      const g = window.__game;
      const sim = g.sim;
      const p = sim.player;
      // Draw first, so every case starts from the same state.
      if (p.weaponStowed) g.world.toggleWeaponStow();
      if (cse.item) {
        sim.addItem(cse.item, 1, p.id);
        try {
          g.world.equipItem(cse.item);
        } catch {
          /* class-locked: the held model still comes from the entity below */
        }
        p.mainhandItemId = cse.item;
      }
      p.weaponSkinId = cse.skin;
      return { mainhand: p.mainhandItemId, skin: p.weaponSkinId };
    },
    { item: c.item, skin: c.skin },
  );
  await park(page);
  await page.screenshot({ path: `${OUT}/${c.name}-drawn.png` });

  // Sheathe (the sim owns the toggle; the renderer follows the weaponStowed bit).
  await page.evaluate(() => window.__game.world.toggleWeaponStow());
  await wait(1800); // the gesture defers the re-parent to its midpoint
  await park(page);
  await page.screenshot({ path: `${OUT}/${c.name}-sheathed.png` });
  console.log(`${c.name}: ${JSON.stringify(applied)}`);
}

await browser.close();
console.log(`wrote ${OUT}/`);
