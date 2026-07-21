// Screenshot the Rally commander affix (Rallying Banner) in the offline client.
// Boots the game, repurposes nearby mobs as an Ironvein Foreman and his sapper
// crew, fires the periodic rally, and captures the boss in-world + target frame
// + the combat log line. A mob ally-buff has no player-facing debuff icon
// (mirrors the Rampage shot, PR #540), so the proof is the world scene, the
// elite target frame, and the empowered allies' attack power in the console.
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
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Brannok');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  p.gm = true; // survive the live hostile loop; aura application still works

  // Collect the three nearest mobs: one becomes the Foreman, two his sappers.
  const mobs = [...sim.entities.values()]
    .filter((e) => e.kind === 'mob' && !e.dead)
    .sort((a, b) => Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) - Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z));

  const foreman = mobs[0];
  foreman.templateId = 'ironvein_foreman';
  foreman.name = 'Ironvein Foreman';
  foreman.level = 16;
  foreman.hostile = true;
  foreman.inCombat = true;
  foreman.aggroTargetId = p.id;
  foreman.pos.x = p.pos.x + 4; foreman.pos.z = p.pos.z + 5;

  const sappers = mobs.slice(1, 3);
  sappers.forEach((s, i) => {
    s.templateId = 'ironvein_sapper';
    s.name = 'Ironvein Sapper';
    s.level = 16;
    s.hostile = true;
    s.inCombat = true;
    s.pos.x = p.pos.x + (i === 0 ? 2 : 6); s.pos.z = p.pos.z + 6;
  });

  // Aim the camera at the Foreman so the elite target frame is shown.
  sim.targetEntity(foreman.id);
  p.facing = Math.atan2(foreman.pos.x - p.pos.x, foreman.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  if (g.input.camDist !== undefined) g.input.camDist = 12;

  const apBefore = sappers.map((s) => sim.effectiveAttackPower(s));
  // Fire the rally immediately rather than waiting the 12s telegraph.
  foreman.rallyTimer = 0.001;
  sim.updateBossMechanics(foreman);
  const apAfter = sappers.map((s) => sim.effectiveAttackPower(s));
  const banner = sappers[0]?.auras.find((a) => a.name === 'Rallying Banner');

  return {
    apBefore, apAfter,
    hasBanner: !!banner, bannerValue: banner?.value, bannerRemaining: banner?.remaining,
    foremanBuffed: foreman.auras.some((a) => a.name === 'Rallying Banner'),
  };
});
console.log('rally result:', JSON.stringify(result));

// Open the combat-log tab to surface the "unleashes Rallying Banner!" line.
await page.evaluate(() => {
  const tab = document.querySelector('.chat-tab[data-log-tab="combat"]');
  if (tab) tab.click();
});
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: 'tmp/rally_scene.png' });

// Crop the boss/elite target frame (top-left of the HUD).
const tf = await page.evaluate(() => {
  const el = document.querySelector('#target-frame');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
if (tf && tf.w > 0) {
  const pad = 14;
  await page.screenshot({
    path: 'tmp/rally_frame.png',
    clip: {
      x: Math.max(0, tf.x - pad), y: Math.max(0, tf.y - pad),
      width: tf.w + pad * 2, height: tf.h + pad * 2,
    },
  });
}

// Crop the combat log (bottom-left chat region).
await page.screenshot({
  path: 'tmp/rally_log.png',
  clip: { x: 0, y: 640, width: 560, height: 240 },
});

console.log('saved tmp/rally_scene.png, rally_frame.png, rally_log.png');
await browser.close();
