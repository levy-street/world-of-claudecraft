// Two-browser multiplayer E2E: register an account, create two characters,
// log both into the world via the real UI, verify they see each other, chat,
// and screenshot both perspectives.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const uniq = Date.now().toString(36).slice(-5);
// character names must be letters only and are globally unique
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
const NAME_A = `Ald${alpha}`;
const NAME_B = `Bea${alpha}`;
const errors = [];

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  protocolTimeout: 60000,
  args: ['--window-size=1280,760', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 760 },
});

async function loginAndEnter(page, username, password, charName, cls, fresh) {
  page.on('pageerror', (e) => errors.push(`[${charName}] ` + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${charName}] console: ` + m.text()); });
  page.on('dialog', (d) => { errors.push(`[${charName}] dialog: ` + d.message()); void d.dismiss(); });
  const step = (s) => console.log(`  [${charName}] ${s}`);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 800));
  step('loaded');
  // evaluate-based DOM interaction (page.click can stall on this page under swiftshader)
  await page.evaluate((u, p, fresh) => {
    document.querySelector('#btn-online').click();
    document.querySelector('#login-user').value = u;
    document.querySelector('#login-pass').value = p;
    document.querySelector(fresh ? '#btn-register' : '#btn-login').click();
  }, username, password, fresh);
  await page.waitForFunction(
    () => document.querySelector('#charselect-panel')?.style.display === 'block',
    { timeout: 8000, polling: 200 },
  );
  step('char select');
  await page.evaluate((name, cls) => {
    document.querySelector('#new-char-name').value = name;
    document.querySelector(`#charselect-panel .mini-class[data-class="${cls}"]`).click();
    document.querySelector('#btn-create-char').click();
  }, charName, cls);
  await new Promise((r) => setTimeout(r, 700));
  step('character created');
  const entered = await page.evaluate((name) => {
    const rows = [...document.querySelectorAll('.char-row')];
    const row = rows.find((r) => r.querySelector('.char-name')?.textContent === name);
    if (!row) return false;
    row.querySelector('.enter-world-btn').click();
    return true;
  }, charName);
  if (!entered) throw new Error(`could not enter world as ${charName}`);
  step('entering world...');
  await page.waitForFunction(() => {
    const g = window.__game;
    return g && g.world && g.world.entities.size > 5;
  }, { timeout: 20000, polling: 500 });
  step('in world');
}

const pageA = await browser.newPage();
const pageB = await browser.newPage();

console.log('logging in A...');
await loginAndEnter(pageA, `duo_${uniq}`, 'hunter22', NAME_A, 'warrior', true);
console.log('logging in B (same account, second character)...');
await loginAndEnter(pageB, `duo_${uniq}`, 'hunter22', NAME_B, 'mage', false);

await new Promise((r) => setTimeout(r, 1500));

// each should see the other player entity
const aSees = await pageA.evaluate(() => {
  const w = window.__game.world;
  return [...w.entities.values()].filter((e) => e.kind === 'player').map((e) => e.name);
});
const bSees = await pageB.evaluate(() => {
  const w = window.__game.world;
  return [...w.entities.values()].filter((e) => e.kind === 'player').map((e) => e.name);
});
console.log('A sees players:', JSON.stringify(aSees), aSees.includes(NAME_B) ? 'OK' : 'FAIL');
console.log('B sees players:', JSON.stringify(bSees), bSees.includes(NAME_A) ? 'OK' : 'FAIL');

// A runs forward; B should observe A's position change
// B drains snapshots on rAF, which only runs foregrounded — so foreground B
// around each position read, and A while it moves.
await pageB.bringToFront();
await new Promise((r) => setTimeout(r, 400));
const before = await pageB.evaluate((name) => {
  const w = window.__game.world;
  const a = [...w.entities.values()].find((e) => e.name === name);
  return a ? { x: a.pos.x, z: a.pos.z } : null;
}, NAME_A);
// rAF (and therefore the input mirror) only runs in the foreground tab.
// Settle after the foreground switch: the blur from the previous switch can
// otherwise land after keydown, and the game clears held keys on blur.
await pageA.bringToFront();
await new Promise((r) => setTimeout(r, 400));
await pageA.keyboard.down('w');
await new Promise((r) => setTimeout(r, 2500));
await pageA.keyboard.up('w');
await pageB.bringToFront();
await new Promise((r) => setTimeout(r, 500));
const after = await pageB.evaluate((name) => {
  const w = window.__game.world;
  const a = [...w.entities.values()].find((e) => e.name === name);
  return a ? { x: a.pos.x, z: a.pos.z } : null;
}, NAME_A);
const moved = before && after ? Math.hypot(after.x - before.x, after.z - before.z) : 0;
console.log('B watched A move:', moved > 4 ? `OK (${moved.toFixed(1)} yd)` : `FAIL (${moved.toFixed(1)})`);

// chat from A (through the real chat input flow), read on B
await pageA.bringToFront();
await new Promise((r) => setTimeout(r, 600));
await pageA.evaluate(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter' }));
  const input = document.querySelector('#chat-input');
  input.value = 'For Eastbrook!';
  input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true }));
});
// Allow WebSocket frame to flush before bringing B to front
await new Promise((r) => setTimeout(r, 800));
// B's HUD drains network events on rAF, which only runs while foregrounded
await pageB.bringToFront();
await new Promise((r) => setTimeout(r, 1200));
const bGotChat = await pageB.evaluate(() =>
  [...document.querySelectorAll('#chatlog div, #combatlog div')].some((d) => d.textContent.includes('For Eastbrook!')),
);
console.log('chat A -> B:', bGotChat ? 'OK' : 'FAIL');

// point B's camera at A and screenshot both perspectives
await pageA.bringToFront();
await new Promise((r) => setTimeout(r, 600));
await pageA.screenshot({ path: 'tmp/mp_view_A.png' });
await pageB.bringToFront();
await pageB.evaluate((name) => {
  const w = window.__game.world;
  const a = [...w.entities.values()].find((e) => e.name === name);
  if (a) window.__game.input.camYaw = Math.atan2(a.pos.x - w.player.pos.x, a.pos.z - w.player.pos.z);
}, NAME_A);
await new Promise((r) => setTimeout(r, 800));
await pageB.screenshot({ path: 'tmp/mp_view_B.png' });

console.log(errors.length ? 'PAGE ERRORS:\n' + errors.slice(0, 10).join('\n') : 'no page errors');
await browser.close();
