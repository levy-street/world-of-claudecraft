// Verifies other players SEE your swings/spells: B records renderer events
// while A fights a wolf next to them.
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const uniq = Date.now().toString(36).slice(-5);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
const USER = 'cvis' + alpha, PASS = 'secret123';
const NAME_A = `Cba${alpha}`, NAME_B = `Cbb${alpha}`;
const errors = [];

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  protocolTimeout: 60000,
  args: ['--window-size=1280,760', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 760 },
});

async function enter(page, charName, cls, fresh) {
  page.on('pageerror', (e) => errors.push(`[${charName}] ` + e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate((u, p, fresh) => {
    document.querySelector('#btn-online').click();
    document.querySelector('#login-user').value = u;
    document.querySelector('#login-pass').value = p;
    document.querySelector(fresh ? '#btn-register' : '#btn-login').click();
  }, USER, PASS, fresh);
  await new Promise((r) => setTimeout(r, 1200));
  await page.evaluate((name, cls) => {
    document.querySelector('#new-char-name').value = name;
    document.querySelector(`#charselect-panel .mini-class[data-class="${cls}"]`).click();
    document.querySelector('#btn-create-char').click();
  }, charName, cls);
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate((name) => {
    const rows = [...document.querySelectorAll('.char-row')];
    const row = rows.find((r) => r.querySelector('.char-name').textContent === name);
    row.querySelector('.enter-world-btn').click();
  }, charName);
  await page.waitForFunction(() => window.__game?.online?.connected, { timeout: 15000 });
  await page.bringToFront();
  await new Promise((r) => setTimeout(r, 800));
}

const pageA = await browser.newPage();
await enter(pageA, NAME_A, 'warrior', true);
console.log('A in world');
const pageB = await browser.newPage();
await enter(pageB, NAME_B, 'mage', false);
console.log('B in world');

// B records every event its renderer is asked to visualize + attack anims
await pageB.bringToFront();
await pageB.evaluate(() => {
  const r = window.__game.renderer;
  window.__seen = { events: [], attacks: [] };
  const orig = r.handleEvent.bind(r);
  r.handleEvent = (ev) => { window.__seen.events.push(ev.type + ':' + (ev.school ?? '')); orig(ev); };
  const origAtk = r.triggerAttack.bind(r);
  r.triggerAttack = (id) => { window.__seen.attacks.push(id); origAtk(id); };
});

// A: teleport-ish — walk is slow; use the wolf nearest spawn. Find wolf, walk to it via sim facing + forward input is complex online.
// Instead: target nearest wolf and use Charge (warrior, learnLevel 4 — not known at 1).
// Plan B: spawn-adjacent wolves are ~50yd north. Just walk A forward toward a wolf for a few seconds.
const apid = await pageA.evaluate(() => window.__game.online.playerId);
await pageA.bringToFront();
const wolf = await pageA.evaluate(() => {
  const g = window.__game;
  const p = g.world.player.pos;
  const w = [...g.world.entities.values()].filter((e) => e.kind === 'mob' && !e.dead)
    .sort((a, b) =>
      Math.hypot(a.pos.x - p.x, a.pos.z - p.z) - Math.hypot(b.pos.x - p.x, b.pos.z - p.z),
    )[0];
  return w ? { id: w.id, x: w.pos.x, z: w.pos.z } : null;
});
console.log('nearest mob to A:', wolf);

// drive A toward the wolf with real inputs
for (let i = 0; i < 60; i++) {
  const done = await pageA.evaluate((wolf) => {
    const g = window.__game;
    const p = g.world.player;
    const dx = wolf.x - p.pos.x, dz = wolf.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 4) { g.world.moveInput.forward = false; return true; }
    g.online.setMouselookFacing(Math.atan2(dx, dz));
    g.world.moveInput.forward = true;
    return false;
  }, wolf);
  if (done) break;
  await new Promise((r) => setTimeout(r, 250));
}
// B follows A so it stays in event radius (teleport B's interest doesn't matter — B just needs to be within 90yd of the fight; spawn is ~55yd from wolves, fine)

await pageA.evaluate((id) => {
  const g = window.__game;
  g.world.targetEntity(id);
  g.world.startAutoAttack();
}, wolf.id);
console.log('A attacking');
// rAF only runs in the foregrounded tab — B must be visible to drain events
await pageB.bringToFront();
// keep A square to the (circling) mob so his swings connect, and walk B
// into spell range for a fireball
for (let i = 0; i < 28; i++) {
  await pageA.evaluate((id) => {
    const g = window.__game;
    const m = g.world.entities.get(id);
    const p = g.world.player;
    if (m) g.online.setMouselookFacing(Math.atan2(m.pos.x - p.pos.x, m.pos.z - p.pos.z));
  }, wolf.id);
  await pageB.evaluate((id) => {
    const g = window.__game;
    const m = g.world.entities.get(id);
    const p = g.world.player;
    if (!m) return;
    const d = Math.hypot(m.pos.x - p.pos.x, m.pos.z - p.pos.z);
    g.online.setMouselookFacing(Math.atan2(m.pos.x - p.pos.x, m.pos.z - p.pos.z));
    g.world.moveInput.forward = d > 22;
    if (d <= 25) {
      g.world.targetEntity(id);
      g.world.castAbility('fireball');
    }
  }, wolf.id);
  await new Promise((r) => setTimeout(r, 250));
}

const seen = await pageB.evaluate(() => window.__seen);
const dmgEvents = seen.events.filter((e) => e.startsWith('damage'));
const fxEvents = seen.events.filter((e) => e.startsWith('spellfx'));
console.log('B saw damage events:', dmgEvents.length, '| attack anims for ids:', [...new Set(seen.attacks)]);
console.log('B saw A swing:', seen.attacks.includes(apid) ? 'OK' : 'FAIL');
console.log('B spellfx events:', fxEvents.length);
const sawFire = seen.events.some((e) => e === 'spellfx:fire');
console.log('B saw fire projectile fx:', sawFire ? 'OK' : 'FAIL');
console.log(errors.length ? 'ERRORS: ' + errors.join('; ') : 'no page errors');
await browser.close();
process.exit(seen.attacks.includes(apid) && sawFire ? 0 : 1);
