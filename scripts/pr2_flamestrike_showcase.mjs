// Showcase shots for the redesigned Flamestrike (instant aimed burst + AoE
// impact ring): (1) the action-bar icon with its tooltip open, (2) the blast
// landing on a wolf with the school-colored AoE ring flashed on the terrain,
// (3) the pre-cast ground-targeting reticle following the terrain cursor.
// Asserts each scene before shooting. Needs `npm run dev` (GAME_URL, default
// :5173). Shots land in tmp/pr2_flamestrike_*.png.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const userDataDir = '/tmp/woc-pr2-flamestrike-showcase-profile';
fs.rmSync(userDataDir, { recursive: true, force: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: [
    `--user-data-dir=${userDataDir}`,
    '--disable-crash-reporter',
    '--disable-crashpad',
    '--crash-dumps-dir=/tmp/woc-pr2-flamestrike-crash-dumps',
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => {
  pageErrors.push(e.message);
  console.log('PAGEERROR:', e.message);
});
await page.bringToFront();
const jsClick = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await jsClick('#btn-offline');
await sleep(400);
await page.waitForSelector('#char-name', { timeout: 30000 });
await page.type('#char-name', 'Pyra');
await jsClick('#offline-select .mini-class[data-class="mage"]');
await sleep(300);
await jsClick('#btn-start-offline');
await page.bringToFront();
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000 });
await sleep(1500);

const fails = [];
const scenes = {};

// Level up, dismiss the tutorial, find the Flamestrike hotbar slot.
const setup = await page.evaluate(() => {
  const g = window.__game;
  g.sim.setPlayerLevel(20);
  document.querySelector('#tutorial-hint .btn, #tutorial-hint button')?.click();
  const actions = g.hud.hotbarActions ?? [];
  let slot = -1;
  for (let i = 0; i < actions.length; i++) {
    if (actions[i] && actions[i].type === 'ability' && actions[i].id === 'flamestrike') {
      slot = i + 1; // barSlot is 1-based over hotbarActions
      break;
    }
  }
  if (slot < 0 && actions.length >= 11) {
    // the leveled-up bar is full; place Flamestrike like a spellbook drag would
    actions[10] = { type: 'ability', id: 'flamestrike' };
    slot = 11;
  }
  return { slot, actionCount: actions.length };
});
console.log('setup:', JSON.stringify(setup));
if (setup.slot < 0) fails.push(`flamestrike not on the action bar (${JSON.stringify(setup)})`);

// Scene 1: hover the Flamestrike button so the real tooltip opens over the bar.
if (setup.slot >= 0) {
  const sel = `button[data-hotbar-slot="${setup.slot}"]`;
  await page.waitForSelector(sel, { timeout: 10000 });
  const box = await (await page.$(sel)).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(500);
  const tip = await page.evaluate(() => {
    const t = document.querySelector('#tooltip');
    const visible = t && t.offsetParent !== null && t.textContent.length > 0;
    return { visible: !!visible, text: t ? t.textContent.slice(0, 160) : '' };
  });
  console.log('scene1 tooltip:', JSON.stringify(tip));
  scenes.scene1 = tip;
  if (!tip.visible || !tip.text.includes('Flamestrike')) {
    fails.push(`tooltip not showing Flamestrike (${JSON.stringify(tip)})`);
  }
  await page.screenshot({ path: 'tmp/pr2_flamestrike_icon_tooltip.png' });
  await page.mouse.move(400, 300);
  await sleep(400);
}

// Scene 2: walk into range of a wolf and detonate the burst at its feet;
// shoot while the AoE ring (0.7s) and fire splash are both alive.
const cast = await page.evaluate(() => {
  const sim = window.__game.sim;
  const me = sim.player;
  let best = Infinity;
  let mob = null;
  for (const e of sim.entities.values()) {
    if (e.id === me.id || e.dead || !e.hostile) continue;
    const d = Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z);
    if (d < best) {
      best = d;
      mob = e;
    }
  }
  if (!mob) return { fail: 'no wolf' };
  const d = Math.hypot(mob.pos.x - me.pos.x, mob.pos.z - me.pos.z);
  if (d > 14) {
    const t = (d - 14) / d;
    me.pos.x += (mob.pos.x - me.pos.x) * t;
    me.pos.z += (mob.pos.z - me.pos.z) * t;
    me.prevPos = { ...me.pos };
    me.facing = Math.atan2(mob.pos.x - me.pos.x, mob.pos.z - me.pos.z);
  }
  sim.targetEntity(mob.id);
  me.resource = me.maxResource;
  me.gcdRemaining = 0;
  const hp0 = mob.hp;
  sim.castAbilityAt('flamestrike', { x: mob.pos.x, z: mob.pos.z });
  return { hp0, mobId: mob.id, fired: me.gcdRemaining > 0 };
});
console.log('scene2 cast:', JSON.stringify(cast));
if (cast.fail || !cast.fired) fails.push(`burst cast did not fire (${JSON.stringify(cast)})`);
await sleep(150); // ring at peak brightness, splash particles mid-air
await page.screenshot({ path: 'tmp/pr2_flamestrike_burst_ring.png' });
const after = await page.evaluate(
  (c) => {
    const sim = window.__game.sim;
    const mob = sim.entities.get(c.mobId);
    const zones = (sim.groundAoEs ?? []).filter((z) => (z.ability ?? z.name) === 'Flamestrike');
    return { damaged: mob ? mob.hp < c.hp0 : true, lingering: zones.length };
  },
  { mobId: cast.mobId, hp0: cast.hp0 },
);
console.log('scene2 after:', JSON.stringify(after));
scenes.scene2 = { cast, after };
if (!after.damaged) fails.push('wolf took no burst damage');
if (after.lingering > 0) fails.push('a lingering Flamestrike zone exists (should be none)');

// Scene 3: enter the real HUD aiming state, move the cursor over terrain, verify
// the persistent reticle mesh, then click to commit the cast through IWorld.
if (setup.slot >= 0) {
  const aimSetup = await page.evaluate(() => {
    const g = window.__game;
    const sim = g.sim;
    const me = sim.player;
    let best = Infinity;
    let mob = null;
    for (const e of sim.entities.values()) {
      if (e.id === me.id || e.dead || !e.hostile) continue;
      const d = Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z);
      if (d < best) {
        best = d;
        mob = e;
      }
    }
    if (!mob) return { fail: 'no wolf' };
    const d = Math.hypot(mob.pos.x - me.pos.x, mob.pos.z - me.pos.z);
    if (d > 14) {
      const t = (d - 14) / d;
      me.pos.x += (mob.pos.x - me.pos.x) * t;
      me.pos.z += (mob.pos.z - me.pos.z) * t;
      me.prevPos = { ...me.pos };
      me.facing = Math.atan2(mob.pos.x - me.pos.x, mob.pos.z - me.pos.z);
    }
    sim.targetEntity(mob.id);
    me.resource = me.maxResource;
    me.gcdRemaining = 0;
    me.cooldowns.set('flamestrike', 0);
    const screen = g.renderer.worldToScreen(mob.pos.x, me.pos.y, mob.pos.z);
    return { mobId: mob.id, hp0: mob.hp, screen };
  });
  console.log('scene3 setup:', JSON.stringify(aimSetup));
  if (aimSetup.fail) fails.push(`reticle setup failed (${JSON.stringify(aimSetup)})`);
  if (!aimSetup.fail) {
    const sel = `button[data-hotbar-slot="${setup.slot}"]`;
    await page.click(sel);
    await page.mouse.move(aimSetup.screen.x, aimSetup.screen.y);
    await sleep(250);
    const aimState = await page.evaluate(() => {
      const g = window.__game;
      const reticle = g.renderer.groundAimReticle;
      return {
        active: g.hud.isGroundAimActive(),
        visible: !!reticle?.ring?.visible,
        opacity: reticle?.mat?.opacity ?? 0,
        scale: reticle?.ring?.scale?.x ?? 0,
      };
    });
    console.log('scene3 reticle:', JSON.stringify(aimState));
    scenes.scene3 = { setup: aimSetup, reticle: aimState };
    if (!aimState.active) fails.push('ground aiming state is not active');
    if (!aimState.visible) fails.push('ground aiming reticle mesh is not visible');
    await page.screenshot({ path: 'tmp/pr2_flamestrike_aiming_reticle.png' });
    await page.mouse.click(aimSetup.screen.x, aimSetup.screen.y);
    await sleep(150);
    await page.screenshot({ path: 'tmp/pr2_flamestrike_reticle_commit_burst.png' });
    const committed = await page.evaluate((c) => {
      const sim = window.__game.sim;
      const mob = sim.entities.get(c.mobId);
      const zones = (sim.groundAoEs ?? []).filter((z) => (z.ability ?? z.name) === 'Flamestrike');
      return {
        active: window.__game.hud.isGroundAimActive(),
        damaged: mob ? mob.hp < c.hp0 : true,
        lingering: zones.length,
      };
    }, aimSetup);
    console.log('scene3 committed:', JSON.stringify(committed));
    scenes.scene3.committed = committed;
    if (committed.active) fails.push('ground aiming state stayed active after commit');
    if (!committed.damaged) fails.push('wolf took no reticle-committed burst damage');
    if (committed.lingering > 0) fails.push('reticle commit created a lingering Flamestrike zone');
  }
}

await browser.close();
for (const f of fails) console.error('FAIL:', f);
if (pageErrors.length) console.error('PAGE ERRORS:', pageErrors);
if (fails.length || pageErrors.length) process.exit(1);
console.log('SCENES:', JSON.stringify(scenes));
console.log(
  'PASS: icon+tooltip and burst+ring scenes verified; shots in tmp/pr2_flamestrike_*.png',
);
