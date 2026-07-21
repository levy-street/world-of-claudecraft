// Screenshot the Devour Magic affix in the offline client. Boots the game,
// repurposes a nearby mob as Grubjaw the Glutton, grants the player a couple of
// real enhancement buffs, captures the buff bar, then drives Grubjaw's on-hit
// purge to devour a buff and captures the bar again (one fewer buff = proof).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5174';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Brannok');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

const bufBox = () => page.evaluate(() => {
  const bar = document.querySelector('#buff-bar');
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
const cropBar = async (file) => {
  const box = await bufBox();
  if (!box) return;
  const pad = 18;
  await page.screenshot({ path: file, clip: {
    x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
    width: box.w + pad * 2, height: box.h + pad * 2,
  } });
};

// Reskin nearest mob as Grubjaw, give the player two enhancement buffs.
const setup = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  p.gm = true; // survive the live loop without wiping pushed auras via recalc

  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  mob.templateId = 'grubjaw';
  mob.name = 'Grubjaw the Glutton';
  mob.level = 12;
  mob.hostile = true;
  mob.hp = mob.maxHp;
  mob.pos.x = p.pos.x + 2; mob.pos.z = p.pos.z;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;

  const buff = (id, name, kind, value) => p.auras.push({
    id, name, kind, remaining: 300, duration: 300, value, sourceId: p.id, school: 'arcane',
  });
  p.auras = p.auras.filter((a) => a.kind.startsWith('buff_') === false || a.value < 0);
  buff('pwf', 'Power Word: Fortitude', 'buff_sta', 18);
  buff('bshout', 'Battle Shout', 'buff_ap', 40);
  return { buffNames: p.auras.filter((a) => a.kind.startsWith('buff_')).map((a) => a.name) };
});
console.log('before:', JSON.stringify(setup));
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'tmp/devour_scene.png' });
await cropBar('tmp/devour_before.png');

// Force the purge to land and devour one buff.
const result = await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player;
  const mob = sim.getEntity ? sim.getEntity(p.targetId) : [...sim.entities.values()].find((e) => e.id === p.targetId);
  sim.rng.chance = () => true;
  const before = p.auras.filter((a) => a.kind.startsWith('buff_') && a.value > 0).length;
  // Swing until exactly one buff has been devoured, then stop.
  for (let i = 0; i < 30; i++) {
    sim.mobSwing(mob, p);
    if (p.auras.filter((a) => a.kind.startsWith('buff_') && a.value > 0).length < before) break;
  }
  return { remaining: p.auras.filter((a) => a.kind.startsWith('buff_') && a.value > 0).map((a) => a.name) };
});
console.log('after :', JSON.stringify(result));
await new Promise((r) => setTimeout(r, 400));
await cropBar('tmp/devour_after.png');

console.log('saved tmp/devour_scene.png, devour_before.png, devour_after.png');
await browser.close();
