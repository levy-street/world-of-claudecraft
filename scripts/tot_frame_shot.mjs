import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5175';
const SHOT_DIR = 'docs/screenshots';
mkdirSync(SHOT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--user-data-dir=/private/tmp/woc-tot-puppeteer',
    '--no-first-run',
    '--window-size=1400,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
await sleep(2500);
// Enter the offline world (class-select flow), then wait for the live game.
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(500);
await page.click('#offline-select .mini-class[data-class="warrior"]');
await sleep(300);
await page.type('#char-name', 'Adventurer');
await sleep(300);
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
await page.waitForFunction(() => !!window.__game?.sim?.player, { timeout: 90000 });
await sleep(1500);
// Reveal the HUD if the intro cinematic is still playing (#ui is display:none then),
// then make sure no game menu is left open over the frames.
await page.evaluate(() => {
  const ui = document.querySelector('#ui');
  if (ui && getComputedStyle(ui).display === 'none') window.__game?.hud?.skipIntro?.();
});
await sleep(800);
await page.evaluate(() => {
  const menu = document.querySelector('#options-menu, #game-menu');
  if (menu && getComputedStyle(menu).display !== 'none') window.__game?.hud?.closeAll?.();
});
await sleep(600);

// Target a nearby mob and force it to aggro the player so the target-of-target
// (the mob's target = the player) shows in the new frame.
const info = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  const mobs = [...sim.entities.values()].filter((e) => e.kind === 'mob' && !e.dead);
  mobs.sort(
    (a, b) =>
      (a.pos.x - p.pos.x) ** 2 +
      (a.pos.z - p.pos.z) ** 2 -
      ((b.pos.x - p.pos.x) ** 2 + (b.pos.z - p.pos.z) ** 2),
  );
  const mob = mobs[0];
  if (!mob) return { ok: false, why: 'no mob' };
  // Pull the mob next to the player, target it, and make it target the player.
  mob.pos = { x: p.pos.x + 3, z: p.pos.z, y: p.pos.y };
  mob.aggroTargetId = p.id;
  mob.inCombat = true;
  sim.targetEntity(mob.id);
  return { ok: true, mob: mob.name, tot: p.name };
});
await sleep(1200);
await page.screenshot({ path: `${SHOT_DIR}/tot-frame.png` });
// A tight crop of the top-left unit-frame cluster so the ToT frame reads clearly.
await page.screenshot({
  path: `${SHOT_DIR}/tot-frame-crop.png`,
  clip: { x: 0, y: 0, width: 360, height: 260 },
});
const totVisible = await page.evaluate(() => {
  const el = document.querySelector('#tot-frame');
  return el ? getComputedStyle(el).display : 'missing';
});
console.log(JSON.stringify({ ...info, totFrameDisplay: totVisible }));
await browser.close();
