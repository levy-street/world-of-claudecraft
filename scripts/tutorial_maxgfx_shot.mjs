// New-Adventurer tutorial screenshots at the max graphics preset (Advanced,
// tier 5) so the PR screenshots show the shipped visual ceiling, not the
// medium default. Otherwise identical to tutorial_shot.mjs: offline flow, no
// server, needs `npm run dev`. Writes PNGs to tmp/.
//
// Uses a worktree-local Chrome profile dir (not the OS tmp dir) since /tmp is
// a size-constrained tmpfs shared across concurrent sessions on this host.

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const profileDir = path.resolve('tmp/chrome-profile-maxgfx');
fs.mkdirSync(profileDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  userDataDir: profileDir,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 960 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

// Force the max graphics preset (5 = Advanced) + every advanced-only knob on,
// before the app boots and reads woc_settings.
await page.evaluateOnNewDocument(() => {
  localStorage.setItem(
    'woc_settings',
    JSON.stringify({
      graphicsPreset: 5,
      terrainDetail: 1,
      foliageDensity: 1,
      effectsQuality: 1,
      shadowQuality: 1,
      renderScale: 1,
      browserEffects: 1, // Full
    }),
  );
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await tap('#btn-offline');
await wait(200);
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  if (n) {
    n.value = 'Rook';
    n.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
await tap('#offline-select .mini-class[data-class="warrior"]');
await tap('#btn-start-offline');
await wait(14000);

const shot = async (name) => {
  await wait(600); // let the HUD frame loop repaint the panel + arrow
  await page.screenshot({ path: `tmp/tutorial_maxgfx_${name}.png` });
  console.log('shot', name);
};

// Step 1 - move: fresh spawn, player still at the start point.
await page.evaluate(() => {
  const { sim } = window.__game;
  sim.player.pos.x = 2;
  sim.player.pos.z = -2;
});
await shot('1_move');

const giverPos = await page.evaluate(() => {
  const { sim } = window.__game;
  for (const e of sim.entities.values()) {
    if (e.kind === 'npc' && e.templateId === 'marshal_redbrook') return { x: e.pos.x, z: e.pos.z };
  }
  return null;
});

// Step 2 - seek: walk a few yards from spawn (still far from the marshal).
await page.evaluate(() => {
  const { sim } = window.__game;
  sim.player.pos.x = 16;
  sim.player.pos.z = -12;
});
await shot('2_seek');

// Step 3 - talk: stand right next to Marshal Redbrook.
await page.evaluate((g) => {
  const { sim } = window.__game;
  sim.player.pos.x = g.x + 2;
  sim.player.pos.z = g.z + 1;
}, giverPos);
await shot('3_talk');

// Step 4 - slay: quest accepted, mid-hunt (3 of 8 wolves down).
await page.evaluate(() => {
  const { sim } = window.__game;
  sim.acceptQuest('q_wolves');
  const qp = sim.questLog.get('q_wolves');
  if (qp) qp.counts[0] = 3;
  sim.player.pos.x = 20;
  sim.player.pos.z = -60;
});
await shot('4_slay');

// Step 5 - return: objectives complete, head back to the marshal.
await page.evaluate((g) => {
  const { sim } = window.__game;
  const qp = sim.questLog.get('q_wolves');
  if (qp) {
    qp.counts[0] = 8;
    qp.state = 'ready';
  }
  sim.player.pos.x = g.x + 2;
  sim.player.pos.z = g.z + 1;
}, giverPos);
await shot('5_return');

// Closing card - quest turned in, the new "Where to next" tips.
await page.evaluate(() => {
  const { sim } = window.__game;
  sim.questLog.delete('q_wolves');
  sim.questsDone.add('q_wolves');
});
await shot('6_done');

if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
await browser.close();
console.log('done');
