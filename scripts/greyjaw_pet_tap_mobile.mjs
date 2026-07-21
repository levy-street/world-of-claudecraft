// Mobile-only leg of the greyjaw pet-tap capture (see greyjaw_pet_tap_shot.mjs).
// Split out to keep browser memory footprint minimal on a loaded machine.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=ultra`;
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=844,390',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--user-data-dir=/tmp/claude-1000/-home-jegoh-Documents-repo-world-of-claudecraft/64492f84-8206-4e66-9910-ffeea2f82760/scratchpad/chromium-profile',
    '--disable-crash-reporter',
    '--disable-breakpad',
  ],
  env: {
    ...process.env,
    HOME: '/tmp/claude-1000/-home-jegoh-Documents-repo-world-of-claudecraft/64492f84-8206-4e66-9910-ffeea2f82760/scratchpad/chromium-home',
  },
  defaultViewport: { width: 844, height: 390, isMobile: true, hasTouch: true },
});
const page = await browser.newPage();
await page.bringToFront();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 90000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.evaluate(() => {
  const card =
    document.querySelector('#offline-select .mini-class[data-class="warlock"]') ||
    document.querySelector('.class-card[data-class="warlock"]');
  card?.click();
});
await sleep(150);
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  if (n) n.value = 'Greyjawtap';
});
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
await page.waitForFunction(() => window.__game?.sim?.entities?.size > 5, {
  timeout: 60000,
  polling: 250,
});
await sleep(1500);
await page.evaluate(() => document.querySelector('.tut-skip')?.click());
await sleep(300);

const found = await page.evaluate(() => {
  const sim = window.__game.sim;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && e.templateId === 'old_greyjaw' && !e.dead) return { id: e.id };
  }
  return null;
});
if (!found) {
  console.log('FAIL: old_greyjaw not found');
  await browser.close();
  process.exit(1);
}

await page.evaluate((mobId) => {
  const sim = window.__game.sim;
  const p = sim.player;
  const mob = sim.entities.get(mobId);
  sim.setPlayerLevel(30);
  p.pos.x = mob.pos.x + 35;
  p.pos.z = mob.pos.z;
  const pet = sim.createDemonPet(p, 'pyre_colossus', false);
  pet.pos.x = mob.pos.x + 2;
  pet.pos.z = mob.pos.z;
  pet.aggroTargetId = mob.id;
  pet.aiState = 'idle';
}, found.id);
await sleep(7000);

const after = await page.evaluate((mobId) => {
  const sim = window.__game.sim;
  const mob = sim.entities.get(mobId);
  const p = sim.player;
  return {
    mobHp: mob.hp,
    mobMaxHp: mob.maxHp,
    mobDead: mob.dead,
    mobTappedById: mob.tappedById,
    ownerId: p.id,
  };
}, found.id);
console.log('mobile after:', JSON.stringify(after));

await page.screenshot({ path: 'tmp/greyjaw-tap-07-mobile-pet-solo-fight-scene.png' });
console.log('shot: 07-mobile-pet-solo-fight-scene');

await page.evaluate(
  (d) => {
    const card = document.createElement('div');
    card.id = 'tap-debug-card-m';
    card.style.cssText =
      'position:fixed;left:50%;top:4%;transform:translateX(-50%);z-index:99999;width:96vw;max-width:760px;font:12px/1.4 system-ui,sans-serif;color:#eee;background:rgba(12,14,20,.95);border:1px solid #3a4256;border-radius:8px;padding:12px 14px;box-shadow:0 10px 40px rgba(0,0,0,.6)';
    card.innerHTML =
      '<div style="font-size:14px;font-weight:700;margin-bottom:4px">Old Greyjaw tap (pet solo)</div>' +
      `<div style="color:${d.mobTappedById === null ? '#7fdc7f' : '#ff8a8a'}">AFTER fix: tappedById = ${d.mobTappedById} (untapped, still contestable)</div>` +
      `<div style="color:#9aa3b8">BEFORE fix would have been: tappedById = ${d.ownerId} (monopolized by the pet's owner)</div>`;
    document.body.appendChild(card);
  },
  { mobTappedById: after.mobTappedById, ownerId: after.ownerId },
);
await sleep(300);
await page.screenshot({ path: 'tmp/greyjaw-tap-07b-mobile-tap-comparison-card.png' });
console.log('shot: 07b-mobile-tap-comparison-card');

await browser.close();
process.exit(0);
