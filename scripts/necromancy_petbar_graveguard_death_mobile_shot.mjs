// Mobile companion to necromancy_petbar_graveguard_death_shot.mjs: boots
// straight into a mobile (landscape, the only in-game orientation) viewport
// rather than switching mid-session, since this client's responsive layer
// tears the HUD down back to the marketing shell on a live viewport flip.
//
// Needs `npm run dev` already running (GAME_URL defaults to :5173).

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'}  ${msg}`);
  if (!cond) fails.push(msg);
};

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
await page.bringToFront();
page.on('pageerror', (e) => fails.push(`PAGEERROR: ${e.message}`));

await page.emulate({
  viewport: { width: 844, height: 390, isMobile: true, hasTouch: true },
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {
    /* ignore */
  }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 90000 });
const booted = await enterOfflineGame(page, { charClass: 'warlock', charName: 'Graveguardtestm' });
check(booted, 'offline world booted (mobile)');
if (!booted) {
  await browser.close();
  process.exit(1);
}
await page.evaluate(() => document.querySelector('#gpu-notice')?.remove());
await sleep(300);

const setup = await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player;
  sim.setPlayerLevel(20);
  sim.setSpec('demonology');
  const graveguard = sim.createDemonPet(p, 'graveguard', false);
  const warrior = sim.createDemonPet(p, 'necromancy_skeletal_warrior', false);
  graveguard.pos.x = p.pos.x + 2;
  graveguard.pos.z = p.pos.z;
  warrior.pos.x = p.pos.x - 2;
  warrior.pos.z = p.pos.z;
  let target = null;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && e.hostile && !e.dead && e.ownerId === null) {
      target = e;
      break;
    }
  }
  if (target) {
    target.pos.x = p.pos.x;
    target.pos.z = p.pos.z + 8;
    sim.targetEntity(target.id);
    p.facing = 0;
  }
  return { graveguardId: graveguard.id, warriorId: warrior.id, spec: sim.talentSpec };
});
check(setup.spec === 'demonology', `Necromancy (Demonology) spec active: ${setup.spec}`);
await sleep(600);
await page.screenshot({ path: 'tmp/necro-petbar-mobile-01-both-alive.png' });

const killed = await page.evaluate((graveguardId) => {
  const sim = window.__game.sim;
  const graveguard = sim.entities.get(graveguardId);
  sim.dealDamage(sim.player, graveguard, graveguard.hp + 1000, false, 'shadow', 'Test Kill', 'hit');
  return { dead: graveguard.dead, primaryPet: sim.petOf(sim.playerId) };
}, setup.graveguardId);
check(killed.dead === true, 'Graveguard is dead (mobile)');
check(killed.primaryPet === null, 'primary-pet resolver sees nothing (mobile)');
await sleep(700);
await page.screenshot({ path: 'tmp/necro-petbar-mobile-02-after-graveguard-death.png' });

const attackClicked = await page.evaluate(() => {
  const btn = document.querySelector('[data-focus-key="pet_attack"]');
  if (!btn) return false;
  btn.click();
  return true;
});
check(attackClicked, 'Attack button exists and was tapped (mobile)');
await sleep(600);
const after = await page.evaluate((warriorId) => {
  const sim = window.__game.sim;
  const warrior = sim.entities.get(warriorId);
  return {
    warriorInCombat: warrior?.inCombat ?? null,
    barDisplay: document.getElementById('petbar')?.style.display ?? null,
  };
}, setup.warriorId);
check(after.warriorInCombat === true, 'surviving Skeletal Warrior engaged from mobile Attack tap');
check(after.barDisplay !== 'none', 'pet bar stays visible on mobile');
await page.screenshot({ path: 'tmp/necro-petbar-mobile-03-after-attack.png' });

console.log(fails.length === 0 ? 'ALL CHECKS PASSED' : `FAILURES: ${fails.length}`);
for (const f of fails) console.log(' -', f);
await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
