// Hunter pet control E2E: tame, pet command bar (Attack/Follow/Stay via the UI),
// out-of-combat regen, death -> Revive Pet. Drives the real client + the pet bar.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
let fail = 0;
const check = (n, c, extra = '') => { console.log(`${c ? 'OK  ' : 'FAIL'} ${n}${extra ? ' | ' + extra : ''}`); if (!c) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/project stats|404|Failed to load resource/i.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 30000 });
await page.click('#btn-offline');
await sleep(200);
await page.type('#char-name', 'Houndmaster');
await page.click('#offline-select .mini-class[data-class="hunter"]');
await page.click('#btn-start-offline');
await sleep(1500);

// level 12 so Tame (10), Revive (10) and Mend (12) are all known
await page.evaluate(() => window.__game.sim.setPlayerLevel(12));

// tame the nearest forest wolf
const petId = await page.evaluate(async () => {
  const sim = window.__game.sim, p = sim.player;
  let wolf = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.templateId === 'forest_wolf' && !e.dead && e.ownerId === null) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; wolf = e; }
    }
  }
  p.pos.x = wolf.pos.x + 6; p.pos.z = wolf.pos.z;
  p.facing = Math.atan2(wolf.pos.x - p.pos.x, wolf.pos.z - p.pos.z);
  window.__game.input.camYaw = p.facing;
  sim.targetEntity(wolf.id);
  sim.castAbility('tame_beast');
  return wolf.id;
});
let tamed = false;
for (let i = 0; i < 30 && !tamed; i++) { await sleep(400); tamed = await page.evaluate((id) => window.__game.sim.entities.get(id)?.ownerId === window.__game.sim.playerId, petId); }
check('tame beast creates an owned pet', tamed);

// the pet command bar appears with Attack/Follow/Stay
const bar1 = await page.evaluate(() => {
  const bar = document.querySelector('#pet-bar');
  const vis = bar && getComputedStyle(bar).display !== 'none';
  const shown = (cmd) => { const b = bar?.querySelector(`.pet-btn[data-cmd="${cmd}"]`); return b && getComputedStyle(b).display !== 'none'; };
  return { vis: !!vis, attack: shown('attack'), follow: shown('follow'), stay: shown('stay'), revive: shown('revive') };
});
check('pet bar is visible', bar1.vis);
check('pet bar shows Attack/Follow/Stay (not Revive) while alive', bar1.attack && bar1.follow && bar1.stay && !bar1.revive, JSON.stringify(bar1));

// STAY via the UI button: move the owner, the pet holds position
await page.click('#pet-bar .pet-btn[data-cmd="stay"]');
const stayPos = await page.evaluate((id) => { const e = window.__game.sim.entities.get(id); return { x: e.pos.x, z: e.pos.z }; }, petId);
await page.evaluate(() => { const p = window.__game.sim.player; p.pos.x += 20; });
await sleep(3500);
const stayD = await page.evaluate((a) => { const e = window.__game.sim.entities.get(a.id); return Math.hypot(e.pos.x - a.x, e.pos.z - a.z); }, { id: petId, ...stayPos });
check('Stay: the pet holds position when you walk off', stayD < 3, `moved ${stayD.toFixed(1)}yd`);

// FOLLOW via the UI button: the pet returns to your side
await page.click('#pet-bar .pet-btn[data-cmd="follow"]');
await sleep(8000);
const followD = await page.evaluate((id) => { const sim = window.__game.sim, e = sim.entities.get(id), p = sim.player; return Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z); }, petId);
check('Follow: the pet returns to your side', followD < 8, `dist ${followD.toFixed(1)}yd`);

// out-of-combat regen
await page.evaluate((id) => { window.__game.sim.entities.get(id).hp = 1; }, petId);
await sleep(4000);
const regenHp = await page.evaluate((id) => window.__game.sim.entities.get(id).hp, petId);
check('the pet heals out of combat', regenHp > 1, `hp ${Math.round(regenHp)}`);

// ATTACK via the UI: send the pet at a beefed boar
const boarId = await page.evaluate((id) => {
  const sim = window.__game.sim, p = sim.player;
  let boar = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.templateId === 'wild_boar' && !e.dead && e.ownerId === null) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; boar = e; }
    }
  }
  boar.maxHp = 5000; boar.hp = 5000;
  p.pos.x = boar.pos.x + 6; p.pos.z = boar.pos.z;
  const pet = sim.entities.get(id); pet.pos.x = p.pos.x + 1; pet.pos.z = p.pos.z;
  sim.targetEntity(boar.id);
  return boar.id;
}, petId);
await page.click('#pet-bar .pet-btn[data-cmd="attack"]');
let onBoar = false;
for (let i = 0; i < 30 && !onBoar; i++) { await sleep(400); onBoar = await page.evaluate((ids) => window.__game.sim.entities.get(ids.pet).aggroTargetId === ids.boar, { pet: petId, boar: boarId }); }
check('Attack: the pet engages the target you sent it at', onBoar);

// frame + screenshot: pet at your side with the bar up
await page.evaluate((id) => {
  const g = window.__game, sim = g.sim, p = sim.player, pet = sim.entities.get(id);
  sim.petCommand('follow');
  pet.pos.x = p.pos.x + Math.cos(p.facing) * 2.4 - Math.sin(p.facing) * 1.2;
  pet.pos.z = p.pos.z - Math.sin(p.facing) * 2.4 - Math.cos(p.facing) * 1.2;
  pet.pos.y = p.pos.y; pet.prevPos = { ...pet.pos };
  g.input.camPitch = 0.5; g.input.camDist = 9;
}, petId);
await sleep(900);
await page.screenshot({ path: 'tmp/hp1_pet_bar.png' });

// DEATH -> the bar swaps to Revive; revive via the UI button
await page.evaluate((id) => { const sim = window.__game.sim, e = sim.entities.get(id); sim.dealDamage(null, e, e.hp, false, 'physical', 'test', 'hit'); }, petId);
await sleep(600);
const deadBar = await page.evaluate(() => {
  const bar = document.querySelector('#pet-bar');
  const shown = (cmd) => { const b = bar?.querySelector(`.pet-btn[data-cmd="${cmd}"]`); return b && getComputedStyle(b).display !== 'none'; };
  return { vis: getComputedStyle(bar).display !== 'none', revive: shown('revive'), attack: shown('attack') };
});
check('when the pet dies the bar offers Revive', deadBar.vis && deadBar.revive && !deadBar.attack, JSON.stringify(deadBar));
await page.screenshot({ path: 'tmp/hp2_revive.png' });

await page.click('#pet-bar .pet-btn[data-cmd="revive"]');
let revived = false;
for (let i = 0; i < 30 && !revived; i++) { await sleep(400); revived = await page.evaluate((id) => { const e = window.__game.sim.entities.get(id); return e && !e.dead && e.ownerId === window.__game.sim.playerId; }, petId); }
check('Revive Pet brings the same pet back to life', revived);

check('no page/console errors', errors.length === 0, errors.slice(0, 4).join(' || '));
console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
