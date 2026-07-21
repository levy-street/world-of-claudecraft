// Screenshot the new Artisan Row profession props (offline client, max
// graphics). Boots the game, teleports the player to Smith Haldren's stall in
// Eastbrook Vale, and captures the surrounding cluster of ten new decorative
// crafting/gathering props.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
fs.mkdirSync('docs/screenshots/artisan-row', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
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
page.on('pageerror', (e) => console.log('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await enterOfflineGame(page, { charName: 'Artisan' });
await page.waitForFunction(() => !!window.__game && !!window.__game.sim, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));

// Dismiss any overlays that must never appear in a captured screenshot:
// camera-mode prompt, quest tutorial banner, low-perf warning banner.
await page.evaluate(() => {
  document.querySelector('#camera-mode-confirm, #camera-choice-confirm')?.click();
});
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  btns.find((b) => /skip tutorial/i.test(b.textContent ?? ''))?.click();
  btns.find((b) => /dismiss/i.test(b.textContent ?? ''))?.click();
});

await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  // Stand back from Smith Haldren's stall (9.5, 17.5) so the arc of new props
  // (radius ~5-9 around it) reads in one frame.
  p.pos.x = 9.5;
  p.pos.z = 20;
  p.prevPos = { ...p.pos };
  p.facing = Math.PI; // face north across the row
});
// Let the world settle at the new position (props are baked at build time,
// already in the scene; this just waits for terrain/prop LOD + shadows).
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => {
  document.querySelector('#camera-mode-confirm, #camera-choice-confirm')?.click();
  const btns = [...document.querySelectorAll('button')];
  btns.find((b) => /^confirm$/i.test(b.textContent ?? ''))?.click();
  btns.find((b) => /skip tutorial/i.test(b.textContent ?? ''))?.click();
  btns.find((b) => /dismiss/i.test(b.textContent ?? ''))?.click();
});
await new Promise((r) => setTimeout(r, 300));

await page.screenshot({ path: 'docs/screenshots/artisan-row/after-desktop-overview.png' });

// Close-up waypoints: each stands just outside a prop pair/trio, facing back
// toward it, so every one of the ten props gets a legible, unobstructed shot
// for the PR body (the wide overview above only proves the whole row reads
// at a glance; these prove each individual model).
const waypoints = [
  // engineering_workbench (2,20) + herbalism_drying_rack (1,16)
  { name: 'engineering-herbalism', x: 4, z: 21, facing: 0.4 },
  // alchemy_cauldron (5,23) + cooking_spit (9,25)
  { name: 'alchemy-cooking', x: 7, z: 28, facing: Math.PI },
  // leatherworking_rack (13,24) + tailoring_loom (16.5,21)
  { name: 'leatherworking-tailoring', x: 15, z: 27, facing: Math.PI },
  // inscription_lectern (17.5,17) + enchanting_altar (16,13): stand further
  // back than the first attempt (17,19) so the house at (10,12) doesn't clip
  // the frame and the altar isn't cropped by the minimap.
  { name: 'inscription-enchanting', x: 16.5, z: 22, facing: Math.PI },
  // jewelcrafting_bench (15,9): too far from mining_ore_cart (3,12) to frame
  // together without a mostly-empty gap, so these are two separate shots.
  { name: 'jewelcrafting', x: 15, z: 13, facing: Math.PI },
  { name: 'mining-ore-cart', x: 3, z: 16, facing: Math.PI },
];

for (const wp of waypoints) {
  await page.evaluate(({ x, z, facing }) => {
    const p = window.__game.sim.player;
    p.pos.x = x;
    p.pos.z = z;
    p.prevPos = { ...p.pos };
    p.facing = facing;
  }, wp);
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: `docs/screenshots/artisan-row/after-desktop-${wp.name}.png` });
}

await browser.close();
console.log('done');
