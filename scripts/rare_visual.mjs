// Screenshots of the new rare spawn (Captain Verlan) for the PR.
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
await page.type('#char-name', 'Thorgar');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 3000));

// Find Captain Verlan, stand beside him, god-mode the camera, and target him so
// the elite nameplate + name show. Bump our level so the nameplate isn't red-capped.
const found = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  const v = [...sim.entities.values()].find((e) => e.templateId === 'captain_verlan' && !e.dead);
  if (!v) return false;
  p.maxHp = 999999; p.hp = 999999;
  p.pos.x = v.pos.x + 4; p.pos.z = v.pos.z + 4;
  p.pos.y = v.pos.y;
  p.facing = Math.atan2(v.pos.x - p.pos.x, v.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  sim.targetEntity(v.id);
  return { name: v.name, level: v.level, hp: v.maxHp };
});
console.log('verlan:', JSON.stringify(found));
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: 'tmp/verlan_01_nameplate.png' });

// Engage for a combat shot (god-moded so he can't win).
await page.evaluate(() => { window.__game.sim.startAutoAttack(); });
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: 'tmp/verlan_02_combat.png' });

console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 15).join('\n') : 'no page errors');
await browser.close();
