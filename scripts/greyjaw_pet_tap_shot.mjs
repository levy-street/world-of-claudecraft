// Visual proof for "require the owner's own hit to tap a rare mob" (PR #1841,
// fix/greyjaw-pet-tap-monopoly). A pet acting alone used to be able to tap a rare
// (Old Greyjaw) the instant it respawned, letting one player camp-monopolize it
// with just a pet, no active engagement required. The fix adds a rare-only
// exception to the tap check in src/sim/combat/damage.ts: a rare's tap now
// requires a hit FROM THE PLAYER, never the pet alone.
//
// This is sim logic with no dedicated tap-state UI element in this repo (tap is
// a loot-ownership field, src/sim/types.ts Entity.tappedById, not rendered on the
// nameplate). The screenshots below are the closest real visual proxy: the actual
// offline sim, with a demon pet parked on Old Greyjaw while the owner stands well
// outside the pet's engagement range (never issuing a single player attack), then
// a debug readout of the REAL entity.tappedById captured after the pet lands real
// damage, plus the counterfactual the old (pre-fix) predicate would have produced
// from that same real data.
//
// Needs `npm run dev` already running. Screenshots land in tmp/greyjaw-tap-*.png.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=ultra`;
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
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await page.bringToFront();
page.on('pageerror', (e) => fails.push(`PAGEERROR: ${e.message}`));

const shot = async (name) => {
  await page.screenshot({ path: `tmp/greyjaw-tap-${name}.png` });
  console.log('shot:', name);
};

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
await sleep(2000);
await page.evaluate(() => document.querySelector('.tut-skip')?.click());
await sleep(300);
await shot('01-world-spawn');

// 1) Locate Old Greyjaw in the shared offline world.
const found = await page.evaluate(() => {
  const sim = window.__game.sim;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && e.templateId === 'old_greyjaw' && !e.dead) {
      return { id: e.id, x: e.pos.x, z: e.pos.z, hp: e.hp, maxHp: e.maxHp };
    }
  }
  return null;
});
check(!!found, `Old Greyjaw located in the offline world: ${JSON.stringify(found)}`);
if (!found) {
  console.log('FAIL: could not find old_greyjaw, aborting capture');
  await browser.close();
  process.exit(1);
}

// 2) Level up, summon a demon pet, then physically separate owner from pet: pet
// parked directly on Old Greyjaw, owner 35yd away (inside the 40yd pet leash so
// the pet keeps its target, but far outside melee/cast range so the owner never
// swings, never casts, never lands a single hit).
const setup = await page.evaluate((mobId) => {
  const g = window.__game;
  const sim = g.sim;
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
  return {
    petId: pet.id,
    petOwnerId: pet.ownerId,
    ownerPos: { x: p.pos.x, z: p.pos.z },
    petPos: { x: pet.pos.x, z: pet.pos.z },
    mobTappedBefore: mob.tappedById,
  };
}, found.id);
console.log('setup:', JSON.stringify(setup));
check(setup.mobTappedBefore === null, 'Old Greyjaw starts untapped');
await sleep(600);
await shot('02-owner-far-pet-parked-on-rare');

// 3) Let the real 20Hz sim loop run (owner issues zero attack commands the whole
// time; only the pet fights).
await sleep(6000);
const mid = await page.evaluate((mobId) => {
  const sim = window.__game.sim;
  const mob = sim.entities.get(mobId);
  const p = sim.player;
  return {
    mobHp: mob.hp,
    mobMaxHp: mob.maxHp,
    mobDead: mob.dead,
    mobTappedById: mob.tappedById,
    ownerHitCount: p.combatLog?.length ?? null,
    petDist: Math.hypot(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z),
  };
}, found.id);
console.log('mid-fight:', JSON.stringify(mid));
await shot('03-pet-solo-fighting-rare');

await sleep(6000);
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
console.log('after-fight:', JSON.stringify(after));
await shot('04-pet-solo-fight-result');

check(after.mobHp < after.mobMaxHp || after.mobDead, 'the pet actually dealt real damage alone');
check(
  after.mobTappedById === null,
  `FIXED behavior: a pet-only kill leaves the rare untapped (tappedById=${after.mobTappedById}), so it stays contestable instead of being monopolized`,
);

// 4) Debug overlay: the real captured data plus the counterfactual the OLD
// (pre-#1841) predicate in src/sim/combat/damage.ts would have produced from the
// same real fight (it had no rare exception: any source landing damage, pet
// included, tapped the mob on its first hit).
await page.evaluate(
  (d) => {
    const card = document.createElement('div');
    card.id = 'tap-debug-card';
    card.style.cssText =
      'position:fixed;left:50%;top:8%;transform:translateX(-50%);z-index:99999;width:860px;font:14px/1.5 system-ui,sans-serif;color:#eee;background:rgba(12,14,20,.95);border:1px solid #3a4256;border-radius:10px;padding:20px 24px;box-shadow:0 10px 40px rgba(0,0,0,.6)';
    const row = (label, v, ok) =>
      `<div style="margin:6px 0"><b style="color:${ok ? '#7fdc7f' : '#ff8a8a'}">${label}</b><br><span style="color:#cfd6e6">${v}</span></div>`;
    card.innerHTML =
      '<div style="font-size:17px;font-weight:700;margin-bottom:4px">Old Greyjaw tap: pet fought alone, owner never swung</div>' +
      `<div style="color:#9aa3b8;margin-bottom:14px">Real sim data: Old Greyjaw HP ${d.mobHp}/${d.mobMaxHp}${d.mobDead ? ' (dead)' : ''}, owner issued zero attack commands, pet dealt the damage</div>` +
      row(
        'BEFORE fix (src/sim/combat/damage.ts, pre-#1841 predicate):',
        `tappedById = ${d.ownerId} (the pet's owner) &nbsp;&mdash;&nbsp; a single player could camp-monopolize every respawn through the pet alone`,
        false,
      ) +
      row(
        'AFTER fix (this PR):',
        `tappedById = ${d.mobTappedById} &nbsp;&mdash;&nbsp; a rare requires the owner's OWN hit to tap; a pet-only kill leaves it contestable`,
        d.mobTappedById === null,
      );
    document.body.appendChild(card);
  },
  {
    mobHp: after.mobHp,
    mobMaxHp: after.mobMaxHp,
    mobDead: after.mobDead,
    mobTappedById: after.mobTappedById,
    ownerId: after.ownerId,
  },
);
await sleep(300);
await shot('05-tap-comparison-card');

// 5) Same scene, mobile viewport.
await page.evaluate(() => document.getElementById('tap-debug-card')?.remove());
await page.emulate({
  viewport: { width: 844, height: 390, isMobile: true, hasTouch: true },
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
await sleep(500);
await shot('06-mobile-pet-solo-fighting-rare');
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
await shot('07-mobile-tap-comparison-card');

// 6) Restore desktop viewport, open the character/combat log frames for extra
// corroborating context (pet frame shows the pet's own health bar mid-fight,
// proving it, not the owner, is the one in combat).
await page.evaluate(() => document.getElementById('tap-debug-card-m')?.remove());
await page.emulate({
  viewport: { width: 1600, height: 900, isMobile: false, hasTouch: false },
  userAgent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
});
await sleep(500);
await shot('08-desktop-restored-pet-hud');

const petFrameState = await page.evaluate((mobId) => {
  const sim = window.__game.sim;
  const mob = sim.entities.get(mobId);
  const p = sim.player;
  return {
    playerInCombat: p.inCombat,
    mobTappedById: mob.tappedById,
  };
}, found.id);
console.log('pet-frame-state:', JSON.stringify(petFrameState));
await shot('09-final-world-state');

// One more angle: zoom on the pet+mob melee.
await page.evaluate(() => {
  const c = document.querySelector('canvas');
  c?.scrollIntoView?.();
});
await sleep(400);
await shot('10-melee-closeup');

console.log(fails.length === 0 ? 'ALL CHECKS PASSED' : `FAILURES: ${fails.length}`);
for (const f of fails) console.log(' -', f);
await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
