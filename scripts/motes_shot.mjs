// Ambient motes: capture the drifting airborne specks in each biome.
// Needs `npm run dev` (:5173). Writes PNGs into tmp/.
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
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Drift');
await page.click('#offline-select .mini-class[data-class="mage"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 3000));

await page.evaluate(() => { const p = window.__game.sim.player; p.maxHp = p.hp = 99999; });

// god-mode + teleport, low afternoon-ish camera angle so motes catch the light
const tp = async (x, z, yaw = 0) => {
  await page.evaluate((x, z, yaw) => {
    const g = window.__game;
    const p = g.sim.player;
    if (p.dead) g.sim.releaseSpirit();
    p.maxHp = p.hp = 99999;
    p.pos.x = x; p.pos.z = z; p.facing = yaw;
    g.input.camYaw = yaw;
  }, x, z, yaw);
  // let the mote field reseed + animate a few seconds for a lively frame
  await new Promise((r) => setTimeout(r, 2500));
};

// vale meadow (gold pollen), marsh (green spores), peaks (pale snow dust)
await tp(150, 210, 0.5);
await page.screenshot({ path: 'tmp/motes_vale.png' });
await tp(60, 360, 0.5);
await page.screenshot({ path: 'tmp/motes_marsh.png' });
await tp(40, 720, 0.5);
await page.screenshot({ path: 'tmp/motes_peaks.png' });

// confirm the field is actually populated + hidden indoors
const stats = await page.evaluate(() => {
  const g = window.__game;
  const pts = g.renderer.motes.group.children[0];
  const overworld = { visible: g.renderer.motes.group.visible, count: pts.geometry.attributes.position.count };
  // jump into a dungeon strip (past DUNGEON_X_THRESHOLD) and re-sync
  g.sim.player.pos.x = 100000; g.sim.player.pos.z = 0;
  return overworld;
});
await new Promise((r) => setTimeout(r, 600));
const indoors = await page.evaluate(() => window.__game.renderer.motes.group.visible);

console.log('overworld motes:', JSON.stringify(stats), '| visible indoors:', indoors);
console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 15).join('\n') : 'no page errors');
await browser.close();
