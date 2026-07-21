// Captures the threat-aware nameplate feature offline: a nearby mob's nameplate
// HP bar tints red once it is aggroed on the local player.
// Needs the dev client running:  npm run dev   (default :5173)
//   GAME_URL=http://localhost:5173 node scripts/threat_nameplate_shot.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  protocolTimeout: 60000,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,760',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 760 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await sleep(800);
await page.evaluate(() => {
  document.querySelector('#btn-offline').click();
  document.querySelector('#char-name').value = 'Thorgar';
  document.querySelector('#char-name').dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
  document.querySelector('#btn-start-offline').click();
});
await sleep(1200);
await page.evaluate(() => document.querySelector('#mobile-preflight-continue')?.click());
await page.waitForFunction(() => window.__game?.sim?.entities?.size > 3, { timeout: 20000, polling: 300 });
await sleep(800);

// Plant a mob 7yd directly in front of the player and target it so the camera
// frames it and the selection ring shows (proves threat tint is distinct).
const placed = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.entities.get(sim.playerId);
  const mob = [...sim.entities.values()].find((e) => e.kind === 'mob' && !e.dead);
  if (!mob || !p) return false;
  const dx = Math.sin(p.facing), dz = Math.cos(p.facing);
  mob.pos = { x: p.pos.x + dx * 7, y: p.pos.y, z: p.pos.z + dz * 7 };
  mob.aggroTargetId = null;
  sim.targetEntity ? sim.targetEntity(mob.id) : (p.targetId = mob.id);
  window.__mobId = mob.id;
  return true;
});
console.log('mob placed:', placed);
// zoom the camera in so the nameplate reads clearly
await page.evaluate(() => { const i = window.__game.input; if (i) i.camDist = 6; });
await sleep(900);

// clip tightly around the mob's nameplate so before/after are directly comparable
const clipFor = () => page.evaluate(() => {
  const np = document.querySelector('.nameplate.np-threat') ||
    [...document.querySelectorAll('.nameplate')].find((n) => n.querySelector('.np-hpbar'));
  if (!np) return null;
  const r = np.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  return { x: Math.max(0, cx - 160), y: Math.max(0, r.top - 20), width: 320, height: 90 };
});

let clip = await clipFor();
await page.screenshot({ path: 'tmp/threat-before.png', clip: clip ?? undefined });
console.log('before shot (mob idle)', clip);

// Now the mob aggroes on the player → nameplate should turn red.
await page.evaluate(() => {
  const sim = window.__game.sim;
  const mob = sim.entities.get(window.__mobId);
  mob.aggroTargetId = sim.playerId;
});
await sleep(700);
clip = await clipFor();
await page.screenshot({ path: 'tmp/threat-after.png', clip: clip ?? undefined });
console.log('after shot (mob aggroed)', clip);

const cls = await page.evaluate(() => {
  // confirm the renderer toggled the class on the mob's nameplate
  return document.querySelector('.nameplate.np-threat') ? 'np-threat present' : 'np-threat MISSING';
});
console.log('DOM check:', cls);

await browser.close();
