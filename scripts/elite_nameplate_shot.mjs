// Visual capture for the elite/boss nameplate "dragon frame" feature.
// Boots the offline game, stages three live mobs in front of the camera —
// a normal mob, an elite (gold bar frame), and a boss (red bar frame) — and
// screenshots the nameplates so the classic-style framing is visible.
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
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Adventurer');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

// Re-skin the three nearest living mobs as normal / elite / boss, line them up
// abreast just in front of the player, and face the camera at them.
const staged = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  const mobs = [...sim.entities.values()]
    .filter((e) => e.templateId && !e.dead && e.kind === 'mob' && e.ownerId == null)
    .sort((a, b) => Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) - Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z))
    .slice(0, 3);
  const skins = [
    { tpl: 'forest_wolf', name: 'Forest Wolf', level: 6 },
    { tpl: 'crypt_shambler', name: 'Crypt Shambler', level: 8 },   // elite -> gold frame
    { tpl: 'morthen', name: 'Morthen the Gravecaller', level: 10 }, // boss -> red frame
  ];
  // move everyone to verified-empty open terrain so nothing clutters the shot
  p.pos.x = -200; p.pos.z = 0;
  mobs.forEach((e, i) => {
    const s = skins[i] ?? skins[0];
    e.templateId = s.tpl;
    e.name = s.name;
    e.level = s.level;
    e.hp = e.maxHp = 800;
    e.pos.x = p.pos.x + (i - 1) * 9;
    e.pos.z = p.pos.z + 9;
    e.dead = false;
  });
  p.facing = 0; // look +z toward the line-up
  g.input.camYaw = 0;
  g.input.camPitch = 0.42; // look down so each bar floats above its mob against the sky
  g.input.camDist = 13;    // frame all three abreast
  window.__npMobIds = mobs.map((e) => e.id);
  return mobs.map((e) => ({ name: e.name, tpl: e.templateId, lvl: e.level }));
});
console.log('staged:', JSON.stringify(staged));

await new Promise((r) => setTimeout(r, 1200));
// re-assert pose right before the shot: pin HP full and freeze positions so no
// drift / fall-damage / combat text sneaks into the frame
await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  (window.__npMobIds || []).forEach((id, i) => {
    const e = g.sim.entities.get(id);
    if (!e) return;
    e.hp = e.maxHp; e.dead = false; e.inCombat = false;
    e.pos.x = p.pos.x + (i - 1) * 9; e.pos.z = p.pos.z + 9;
  });
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'tmp/elite_nameplates.png' });
console.log('saved tmp/elite_nameplates.png');
// tight crop on the nameplate row for a readable close-up of the frames
await page.screenshot({ path: 'tmp/elite_nameplates_crop.png', clip: { x: 470, y: 250, width: 700, height: 200 } });
console.log('saved tmp/elite_nameplates_crop.png');

await browser.close();
