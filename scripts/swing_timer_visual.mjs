// Visual check for the melee swing-timer bar (#swingbar).
// Boots the offline game, engages auto-attack on a wolf, and captures the
// swing bar at a few fill levels. Saves screenshots to tmp/ for the PR.
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
await page.type('#char-name', 'Swingblade');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

// teleport beside the nearest wolf, target + face it, start auto-attack
const fight = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  let wolf = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.templateId === 'forest_wolf' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; wolf = e; }
    }
  }
  p.pos.x = wolf.pos.x + 2; p.pos.z = wolf.pos.z;
  p.facing = Math.atan2(wolf.pos.x - p.pos.x, wolf.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  sim.targetEntity(wolf.id);
  sim.startAutoAttack();
  // keep the wolf alive so the bar keeps cycling for the screenshots
  wolf.maxHp = 100000; wolf.hp = 100000; wolf.hostile = false;
  return { wolfId: wolf.id };
});
console.log('fight setup:', JSON.stringify(fight));

// Keep the player attacking and grab the swing bar at three fill points.
async function keepSwinging() {
  await page.evaluate((id) => {
    const g = window.__game;
    const p = g.sim.player;
    const w = g.sim.entities.get(id);
    w.hp = w.maxHp; // never let it die
    if (p.targetId !== id) g.sim.targetEntity(id);
    p.facing = Math.atan2(w.pos.x - p.pos.x, w.pos.z - p.pos.z);
    if (!p.autoAttack) g.sim.startAutoAttack();
  }, fight.wolfId);
}

const swingState = () =>
  page.evaluate(() => {
    const p = window.__game.sim.player;
    const bar = document.querySelector('#swingbar');
    return {
      swingTimer: +p.swingTimer.toFixed(2),
      auto: p.autoAttack,
      barShown: bar && bar.style.display === 'block',
      fill: bar?.querySelector('.fill')?.style.width,
      label: bar?.querySelector('.label')?.textContent,
    };
  });

for (let i = 0; i < 6; i++) {
  await keepSwinging();
  await new Promise((r) => setTimeout(r, 350));
  const s = await swingState();
  console.log(`frame ${i}:`, JSON.stringify(s));
  if (s.barShown) {
    await page.screenshot({ path: `tmp/swing_${i}_${(s.fill || '0').replace('%', '')}.png` });
  }
}

// A clean, cropped shot of the bar region for the PR.
await keepSwinging();
await new Promise((r) => setTimeout(r, 250));
await page.screenshot({ path: 'tmp/swing_full.png' });
await page.screenshot({
  path: 'tmp/swing_crop.png',
  clip: { x: 600, y: 560, width: 400, height: 200 },
});
console.log('saved tmp/swing_*.png');

await browser.close();
