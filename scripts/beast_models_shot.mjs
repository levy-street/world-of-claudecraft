// Proof shots for fix/beast-model-mismatch: every beast that used to fall back
// to the wolf model now renders its own creature. Boots the offline client,
// repurposes nearby mobs into the fixed beasts, and screenshots a group row
// plus one tight portrait per beast so the new models are clearly visible.
//
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes PNGs to tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// templateId -> expected model. Order = left→right in the group row.
const BEASTS = [
  { id: 'glade_fox', label: 'Glade Fox', model: 'fox.glb' },
  { id: 'thornpelt_badger', label: 'Thornpelt Badger', model: 'fox.glb (small)' },
  { id: 'spotted_fawn', label: 'Spotted Fawn', model: 'stag.glb' },
  { id: 'grovetusk_boar', label: 'Grovetusk Boar', model: 'wild_boar.glb' },
  { id: 'bog_bloat', label: 'Bog Bloat', model: 'frog.glb' },
];

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1600,1000',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`);
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(200);
await page.type('#char-name', 'Beastward');
await page.click('#offline-select .mini-class[data-class="hunter"]');
await page.click('#btn-start-offline');
await sleep(3000);

// God-mode + tag a stable pool of nearby mobs (one per beast) we can re-drive.
await page.evaluate((BEASTS) => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  p.gm = true;
  p.maxHp = 99999;
  p.hp = 99999;
  p.maxMp = 99999;
  p.mp = 99999;
  p.facing = 0;
  g.input.camYaw = 0;
  g.input.camPitch = 0.18;

  const pool = [...sim.entities.values()]
    .filter((e) => e.kind === 'mob' && !e.dead)
    .sort(
      (a, b) =>
        Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) -
        Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z),
    )
    .slice(0, BEASTS.length);
  // remember the entity ids so every later step drives the same beasts
  window.__beastIds = pool.map((e) => e.id);
  for (let i = 0; i < pool.length; i++) {
    const e = pool[i];
    const b = BEASTS[i];
    e.templateId = b.id;
    e.name = b.label;
    e.hostile = false;
    e.dead = false;
  }
}, BEASTS);

// --- group row: line them up left→right a few yards ahead --------------------
await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player;
  const ids = window.__beastIds;
  const n = ids.length;
  ids.forEach((id, i) => {
    const e = sim.entities.get(id);
    if (!e) return;
    e.pos.x = p.pos.x + (i - (n - 1) / 2) * 2.3;
    e.pos.z = p.pos.z + 7 + (i % 2) * 1.4;
    e.prevPos = { ...e.pos };
    e.facing = Math.PI;
    e.scale = 1.4;
    e.spawnPos = { ...e.pos };
    e.wanderTarget = null;
    e.wanderTimer = 999;
  });
});
await sleep(2500);
await page.screenshot({ path: 'tmp/beasts_row.png' });

// --- tight portrait per beast ------------------------------------------------
const placed = [];
for (let i = 0; i < BEASTS.length; i++) {
  const b = BEASTS[i];
  const ok = await page.evaluate((idx) => {
    const sim = window.__game.sim;
    const g = window.__game;
    const p = sim.player;
    const ids = window.__beastIds;
    // park everyone far away, then bring beast idx in close & centered.
    ids.forEach((id, j) => {
      const e = sim.entities.get(id);
      if (!e) return;
      if (j === idx) {
        // off to the right of the player so the avatar doesn't occlude it,
        // scaled up and held still for a clean portrait.
        e.pos.x = p.pos.x + 3.2;
        e.pos.z = p.pos.z + 5;
        e.prevPos = { ...e.pos };
        e.facing = Math.PI * 0.5; // side-on profile
        e.scale = 1.6;
        e.spawnPos = { ...e.pos };
        e.wanderTarget = null;
        e.wanderTimer = 999;
      } else {
        e.pos.x = p.pos.x + 300;
        e.pos.z = p.pos.z + 300;
        e.prevPos = { ...e.pos };
        e.spawnPos = { ...e.pos };
        e.wanderTarget = null;
      }
    });
    g.input.camYaw = 0;
    g.input.camPitch = 0.04;
    g.input.camDist = 9;
    const e = sim.entities.get(ids[idx]);
    return e ? { tid: e.templateId, name: e.name } : null;
  }, i);
  await sleep(1400);
  const path = `tmp/beast_${b.id}.png`;
  await page.screenshot({ path });
  placed.push({ ...b, rendered: ok });
  console.log(`shot ${b.label.padEnd(20)} -> ${b.model.padEnd(22)} ${path}`);
}

if (errors.length) console.log(`PAGE ERRORS:\n${errors.join('\n')}`);
console.log('done -> tmp/beasts_row.png + tmp/beast_<id>.png');
await browser.close();
