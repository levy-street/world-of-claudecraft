// Screenshots of the social systems + the Hollow Crypt through real clients.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const uniq = Date.now().toString(36).slice(-5);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  protocolTimeout: 60000,
  args: ['--window-size=1280,760', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 760 },
});

async function login(page, charName, cls, fresh) {
  page.on('pageerror', (e) => errors.push(`[${charName}] ` + e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(700);
  await page.evaluate((u, p, fresh) => {
    document.querySelector('#btn-online').click();
    document.querySelector('#login-user').value = u;
    document.querySelector('#login-pass').value = p;
    document.querySelector(fresh ? '#btn-register' : '#btn-login').click();
  }, `socv_${uniq}`, 'hunter22', fresh);
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
console.log('logging in...');
await login(pageA, `Pal${alpha}`, 'paladin', true);

// class select screenshot from a third fresh page (before B logs in)
const pageC = await browser.newPage();
await pageC.goto(URL, { waitUntil: 'domcontentloaded' });
await sleep(600);
await pageC.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await pageC.screenshot({ path: 'tmp/s0_classes.png' });
await pageC.close();

await login(pageB, `Pri${alpha}`, 'priest', false);
console.log('both in world');

// party up via console commands (UI context menu verified separately)
const bPid = await pageB.evaluate(() => window.__game.world.playerId);
await pageA.evaluate((pid) => window.__game.world.partyInvite(pid), bPid);
await sleep(600);
await pageB.evaluate(() => window.__game.world.partyAccept());
await sleep(1000);

// trade
await pageA.evaluate((pid) => {
  window.__game.online.cmd({ cmd: 'dev_give', item: 'wolf_fang', count: 3 });
  window.__game.world.tradeRequest(pid);
}, bPid);
await sleep(600);
await pageB.evaluate(() => window.__game.world.tradeAccept());
await sleep(800);
await pageA.bringToFront();
await pageA.evaluate(() => {
  // add a fang + 25 copper to the offer through the HUD path
  window.__game.hud.addItemToTrade('wolf_fang');
});
await sleep(800);
await pageA.screenshot({ path: 'tmp/s1_trade_party.png' });
const partyVisible = await pageA.evaluate(() => document.querySelectorAll('.party-frame').length);
console.log('party frames rendered:', partyVisible >= 1 ? 'OK' : 'FAIL');
const tradeVisible = await pageA.evaluate(() => document.querySelector('#trade-window')?.style.display === 'block');
console.log('trade window rendered:', tradeVisible ? 'OK' : 'FAIL');
await pageA.evaluate(() => window.__game.world.tradeCancel());

// the crypt: level up, teleport to door, enter, walk in, screenshot
await sleep(400);
for (const pg of [pageA, pageB]) {
  await pg.evaluate(() => {
    window.__game.online.cmd({ cmd: 'dev_level', level: 10 });
    window.__game.online.cmd({ cmd: 'dev_teleport', x: 80, z: 86 });
  });
}
await sleep(500);
await pageA.bringToFront();
await pageA.screenshot({ path: 'tmp/s2_chapel_door.png' });
for (const pg of [pageA, pageB]) {
  await pg.evaluate(() => window.__game.world.enterCrypt());
  await sleep(400);
}
await sleep(1000);
// walk forward toward the first pack
await pageA.bringToFront();
await pageA.keyboard.down('w');
await sleep(2200);
await pageA.keyboard.up('w');
await sleep(600);
await pageA.screenshot({ path: 'tmp/s3_crypt.png' });
const inCrypt = await pageA.evaluate(() => window.__game.world.player.pos.x > 600);
console.log('inside the crypt:', inCrypt ? 'OK' : 'FAIL');
// target an elite for the gold frame
await pageA.evaluate(() => {
  const w = window.__game.world;
  const elite = [...w.entities.values()].find((e) => e.kind === 'mob' && !e.dead);
  if (elite) w.targetEntity(elite.id);
});
await sleep(500);
await pageA.screenshot({ path: 'tmp/s4_elite_target.png' });

console.log(errors.length ? 'PAGE ERRORS:\n' + errors.slice(0, 8).join('\n') : 'no page errors');
await browser.close();
