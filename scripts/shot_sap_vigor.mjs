// Screenshot the Sap Vigor affix (Sapping Bite) in the offline client.
// Boots a rogue, repurposes a nearby mob as Mirejaw the Ravenous, forces its
// on-hit Sapping Bite onto the player, and captures the drained energy bar on
// the player unit frame plus the combat log line (the affix has no debuff icon
// — the proof is the resource bar dropping).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
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
await new Promise((r) => setTimeout(r, 400));
await page.type('#char-name', 'Skezzik');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

// Repurpose the nearest mob as Mirejaw the Ravenous and drain our energy.
const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  p.maxHp = 100000; p.hp = 100000;
  p.resource = p.maxResource; // full energy bar

  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  mob.templateId = 'mirejaw_the_ravenous';
  mob.name = 'Mirejaw the Ravenous';
  mob.level = 10;
  mob.hostile = true;
  mob.hp = mob.maxHp;
  mob.pos.x = p.pos.x + 2; mob.pos.z = p.pos.z;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;

  sim.rng.chance = () => true; // force the Sapping Bite proc
  const before = p.resource;
  for (let i = 0; i < 10 && p.resource >= before; i++) { p.hp = 100000; sim.mobSwing(mob, p); }
  return { resourceType: p.resourceType, before, after: p.resource, maxResource: p.maxResource };
});
console.log('sap vigor result:', JSON.stringify(result));

await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'tmp/sap_vigor_scene.png' });

// Crop the player unit frame — the energy bar shows the drain.
const box = await page.evaluate(() => {
  const el = document.querySelector('#player-frame');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
if (box) {
  const pad = 16;
  await page.screenshot({
    path: 'tmp/sap_vigor_frame.png',
    clip: {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: box.w + pad * 2, height: box.h + pad * 2,
    },
  });
}

// Open the combat log to surface the "Sapping Bite" line.
await page.evaluate(() => {
  const tab = document.querySelector('.chat-tab[data-log-tab="combat"]');
  if (tab) tab.click();
});
await new Promise((r) => setTimeout(r, 400));
const logBox = await page.evaluate(() => {
  const el = document.querySelector('#combatlog');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: Math.max(r.width, 380), h: Math.max(r.height, 160) };
});
if (logBox) {
  await page.screenshot({
    path: 'tmp/sap_vigor_log.png',
    clip: {
      x: Math.max(0, logBox.x), y: Math.max(0, logBox.y - 10),
      width: logBox.w, height: logBox.h + 20,
    },
  });
}

console.log('saved tmp/sap_vigor_scene.png, sap_vigor_frame.png, sap_vigor_log.png');
await browser.close();
