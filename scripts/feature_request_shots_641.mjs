// Screenshots illustrating four absent systems, for upstream feature-request issues
// #641-644: Battlegrounds (objective team PvP), Dungeon Finder queue, in-game macros,
// and a Hunter pet stable.
// Each PNG shows the CURRENT state (the gap / the machinery it would build on), not
// a proposed feature. Runs the offline flow (no login). Works against either
// `npm run dev` (:5173) or the server-served client (:8787). Writes PNGs to tmp/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const CLASS = process.env.GAME_CLASS ?? 'hunter';
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
  if (n) { n.value = 'Brackus'; n.dispatchEvent(new Event('input', { bubbles: true })); }
});
await page.evaluate((c) => document.querySelector(`#offline-select .mini-class[data-class="${c}"]`)?.click(), CLASS);
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
await wait(3000);

// God-mode so camp mobs don't kill the camera during the tour.
await page.evaluate(() => { const p = window.__game.sim.player; p.maxHp = 99999; p.hp = 99999; });
await wait(300);

const closeAll = () => page.evaluate(() => {
  const h = window.__game.hud;
  for (const m of ['toggleArena', 'toggleSocial', 'toggleSpellbook', 'toggleChar', 'toggleBags'])
    try { /* no-op: opened explicitly below */ } catch {}
});

// 1) #641 BATTLEGROUNDS: open the Ashen Coliseum arena panel — the ceiling of PvP
// today is 1v1/2v2 ranked Elo + free duels. There is no objective team battleground.
try {
  await page.evaluate(() => window.__game.hud.toggleArena());
  await wait(700);
} catch {}
await page.screenshot({ path: 'tmp/fr641_battlegrounds_arena.png' });
try { await page.evaluate(() => window.__game.hud.toggleArena()); } catch {}
await wait(300);

// 2) #642 DUNGEON FINDER: open the Social panel — the only grouping aids today are the
// manual /invite party flow and the opt-in `lfg` chat channel. No automated queue.
try {
  await page.evaluate(() => window.__game.hud.toggleSocial());
  await wait(700);
} catch {}
await page.screenshot({ path: 'tmp/fr642_dungeonfinder_social.png' });
try { await page.evaluate(() => window.__game.hud.toggleSocial()); } catch {}
await wait(300);

// 3) #643 MACROS: open the spellbook — every ability/command is a single manual action;
// there is no way to compose a named sequence and bind it to a hotbar slot.
try {
  await page.evaluate(() => window.__game.hud.toggleSpellbook());
  await wait(700);
} catch {}
await page.screenshot({ path: 'tmp/fr643_macros_spellbook.png' });
try { await page.evaluate(() => window.__game.hud.toggleSpellbook()); } catch {}
await wait(300);

// 4) #644 HUNTER PET STABLE: summon a single tamed beast. The pet bar shows one active
// pet — taming another would replace it; there is nowhere to store inactive pets.
try {
  await page.evaluate(() => {
    const sim = window.__game.sim;
    sim.summonPet(sim.player, 'forest_wolf');
  });
  await wait(1200);
} catch (e) { errors.push('summonPet failed: ' + e); }
await page.screenshot({ path: 'tmp/fr644_pet_stable.png' });

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'OK: no page errors');
await browser.close();
