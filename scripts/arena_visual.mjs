// Drives two real browser clients through the Ashen Coliseum 1v1 arena:
// queue -> matchmake -> countdown on the sands -> fight -> ranked result.
// Screenshots land in tmp/. Run the game server first (serves the built client
// on :8787), then: GAME_URL=http://localhost:8787 node scripts/arena_visual.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:8787';
fs.mkdirSync('tmp', { recursive: true });
const uniq = Date.now().toString(36).slice(-5);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  protocolTimeout: 60000,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,760', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 760 },
});

async function login(page, charName, cls) {
  page.on('pageerror', (e) => errors.push(`[${charName}] ` + e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(700);
  await page.evaluate((u, p) => {
    document.querySelector('#btn-online').click();
    document.querySelector('#login-user').value = u;
    document.querySelector('#login-pass').value = p;
    document.querySelector('#btn-register').click();
  }, `arena_${charName}_${uniq}`, 'hunter22');
  await page.waitForFunction(() => document.querySelector('#charselect-panel')?.style.display === 'block', { timeout: 8000, polling: 200 });
  await page.evaluate((name, cls) => {
    document.querySelector('#new-char-name').value = name;
    document.querySelector(`#charselect-panel .mini-class[data-class="${cls}"]`).click();
    document.querySelector('#btn-create-char').click();
  }, charName, cls);
  await sleep(700);
  await page.evaluate((name) => {
    const rows = [...document.querySelectorAll('.char-row')];
    rows.find((r) => r.querySelector('.char-name')?.textContent === name)?.querySelector('.enter-world-btn')?.click();
  }, charName);
  await page.waitForFunction(() => window.__game?.world?.entities?.size > 5, { timeout: 20000, polling: 500 });
}

const pageA = await browser.newPage();
const pageB = await browser.newPage();
console.log('logging in two champions...');
await login(pageA, `Brawn${alpha}`, 'warrior');
await login(pageB, `Crush${alpha}`, 'warrior');
console.log('both in world');

// Give A a clear edge so the bout resolves quickly and decisively for the shot:
// max level + an epic greatblade (carried into the arena via equipment).
await pageA.evaluate(() => {
  window.__game.online.cmd({ cmd: 'dev_level', level: 20 });
  window.__game.online.cmd({ cmd: 'dev_give', item: 'wyrmfang_greatblade', count: 1 });
});
await sleep(500);
await pageA.evaluate(() => window.__game.world.equipItem('wyrmfang_greatblade'));
await pageB.evaluate(() => window.__game.online.cmd({ cmd: 'dev_level', level: 10 }));
await sleep(800);

// --- 1. the arena panel: rating, queue button, live ladder ---
await pageA.bringToFront();
await pageA.evaluate(() => window.__game.hud.toggleArena());
await sleep(800);
await pageA.screenshot({ path: 'tmp/arena1_panel.png' });
const panelOpen = await pageA.evaluate(() => document.querySelector('#arena-window')?.style.display === 'block');
console.log('arena panel rendered:', panelOpen ? 'OK' : 'FAIL');
await pageA.evaluate(() => window.__game.hud.toggleArena()); // close before queueing

// --- 2. both queue; matchmaking pairs them and teleports to the sands ---
console.log('queueing both...');
await pageA.evaluate(() => window.__game.world.arenaQueueJoin());
await pageB.evaluate(() => window.__game.world.arenaQueueJoin());
await pageA.waitForFunction(() => window.__game.world.arenaInfo?.match != null, { timeout: 15000, polling: 200 });
const matched = await pageA.evaluate(() => window.__game.world.arenaInfo.match.oppName);
console.log('matched against:', matched);
// pull the camera back so the establishing shot frames the whole pit, and give
// the interior a moment to build
await pageA.evaluate(() => { window.__game.input.camDist = 19; window.__game.input.camPitch = 0.62; });
await sleep(3000);
await pageA.bringToFront();
await pageA.screenshot({ path: 'tmp/arena2_countdown.png' });
const onSands = await pageA.evaluate(() => window.__game.world.player.pos.x > 2800);
console.log('on the arena sands:', onSands ? 'OK' : 'FAIL');

// --- 3. fight: bring the two together and let them trade blows ---
await pageA.waitForFunction(() => window.__game.world.arenaInfo?.match?.state === 'active', { timeout: 12000, polling: 200 });
console.log('bout is live');
const bPos = await pageB.evaluate(() => ({ x: window.__game.world.player.pos.x, z: window.__game.world.player.pos.z }));
// teleport A right beside B inside the pit (both stay on the arena sands)
await pageA.evaluate((p) => window.__game.online.cmd({ cmd: 'dev_teleport', x: p.x + 3, z: p.z }), bPos);
await sleep(500);
const swing = async () => {
  for (const pg of [pageA, pageB]) {
    await pg.evaluate(() => {
      const w = window.__game.world;
      const opp = [...w.entities.values()].find((e) => e.kind === 'player' && e.id !== w.playerId);
      if (opp) { w.targetEntity(opp.id); w.startAutoAttack(); }
    });
  }
};
await swing();
await pageA.evaluate(() => { window.__game.input.camDist = 9; window.__game.input.camPitch = 0.3; });
await sleep(1600);
await pageA.bringToFront();
await pageA.screenshot({ path: 'tmp/arena3_fight.png' });

// --- 4. wait for the ranked result, keeping both swinging ---
let result = null;
let sawResultBanner = false;
for (let i = 0; i < 90 && !result; i++) {
  result = await pageA.evaluate(() => {
    const a = window.__game.world.arenaInfo;
    return a && a.match === null && a.wins + a.losses > 0
      ? { rating: a.rating, wins: a.wins, losses: a.losses }
      : null;
  });
  if (result) {
    // snap the result banner the instant the bout ends, before it fades
    await pageA.bringToFront();
    await pageA.screenshot({ path: 'tmp/arena4_result.png' });
    sawResultBanner = true;
    break;
  }
  await swing();
  await sleep(800);
}
console.log('result for A:', JSON.stringify(result));
if (!sawResultBanner) await pageA.screenshot({ path: 'tmp/arena4_result.png' });

// --- 5. reopen the panel: ratings + W/L have moved ---
await sleep(600);
await pageA.evaluate(() => window.__game.hud.toggleArena());
await sleep(1200);
await pageA.screenshot({ path: 'tmp/arena5_ladder.png' });

console.log(errors.length ? 'PAGE ERRORS:\n' + errors.slice(0, 8).join('\n') : 'no page errors');
await browser.close();
