// Screenshots illustrating four absent content systems, for upstream feature-request issues:
//   day/night cycle, weather, reputation/faction, enchanting/gems & sockets.
// Each PNG shows the CURRENT state (the gap), not a proposed feature.
// Runs the offline flow (no server). Needs `npm run dev`. Writes PNGs to tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const CLASS = process.env.GAME_CLASS ?? 'warrior';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline')?.click());
await wait(200);
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  if (n) { n.value = 'Thorgar'; n.dispatchEvent(new Event('input', { bubbles: true })); }
});
await page.evaluate((c) => document.querySelector(`#offline-select .mini-class[data-class="${c}"]`)?.click(), CLASS);
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
await wait(3000);

// God-mode so camp mobs don't kill the camera during the tour.
await page.evaluate(() => { const p = window.__game.sim.player; p.maxHp = 99999; p.hp = 99999; });
await wait(300);

// 1) DAY/NIGHT: wide scene in the starter vale — lighting is fixed (no time-of-day).
await page.screenshot({ path: 'tmp/cr_daynight_scene.png' });

// 2) REPUTATION/FACTION: target a hostile mob at the starter camp — the target frame shows
// name/level/HP only, no faction standing (hostility is a single boolean today).
try {
  await page.evaluate(() => {
    const sim = window.__game.sim, p = sim.player;
    sim.targetNearestEnemy();
    // Fallback: if no hostile is in range, target the nearest living non-self entity
    // so the target frame is populated for the screenshot.
    if (!p.targetId) {
      let best = null, bd = Infinity;
      for (const e of sim.entities.values()) {
        if (e.id === p.id || e.hp <= 0 || e.kind === 'object') continue;
        const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = e; }
      }
      if (best) sim.targetEntity(best.id);
    }
  });
  await wait(600);
} catch {}
await page.screenshot({ path: 'tmp/cr_faction_target.png' });

// 3) ENCHANTING/GEMS: open the character paperdoll — equipped gear has no enchant lines
// or gem sockets; this is where gear-enhancement would surface.
try {
  await page.evaluate(() => window.__game.hud.toggleChar());
  await wait(700);
} catch {}
await page.screenshot({ path: 'tmp/cr_enchant_char.png' });
try { await page.evaluate(() => window.__game.hud.toggleChar()); } catch {}
await wait(300);

// 4) WEATHER: move north into Mirefen Marsh — sky is clear everywhere, no weather state.
await page.evaluate(() => { window.__game.sim.player.pos.z = 300; });
await wait(1500);
await page.screenshot({ path: 'tmp/cr_weather_scene.png' });

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'OK: no page errors');
await browser.close();
