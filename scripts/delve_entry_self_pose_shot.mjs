// Delve-entry self pose shot: register online, teleport to the Collapsed
// Reliquary door, press Delve on the board, then shoot the frame ~2.5 s later
// and print the gap between the authoritative player pose and the renderer's
// DISPLAY pose. Before the fix the display pose is still walking across the
// map from the door (the "sent flying" report); after it, the two coincide.
// Needs vite (GAME_URL) proxied to a server started with ALLOW_DEV_COMMANDS=1.
//   GAME_URL=http://localhost:5183 OUT=tmp/after.png node scripts/delve_entry_self_pose_shot.mjs
// TRACE=1 also prints the wire/self-pose state around the click and a per-frame
// sample of the renderer's self-pose (active flag, handoff offset, positions).

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT ?? 'tmp/delve_entry_self_pose.png';
const DOOR = { x: -136, z: 112 };

const uniq = Date.now().toString(36).slice(-5);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
const CHAR = `Dlv${alpha}`;
const PASS = 'hunter22';
const USER = `delve_${uniq}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 60000,
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(
  "localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1, graphicsDefaultApplied: true }));",
);
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('#btn-online', { timeout: 30000 });
await sleep(1000);
await page.evaluate(() => document.querySelector('#btn-online')?.click());
await page.waitForSelector('#login-user', { timeout: 45000 });
await sleep(1500);
// Current auth UI: one #login-panel toggling login/register via #btn-auth-toggle,
// submitted through #btn-login (same recipe as social_landscape_online_shot.mjs).
let filled = false;
for (let attempt = 0; attempt < 6 && !filled; attempt++) {
  filled = await page.evaluate(
    (u, p, mail) => {
      const form = document.querySelector('#login-panel');
      const userEl = document.querySelector('#login-user');
      const passEl = document.querySelector('#login-pass');
      const toggle = document.querySelector('#btn-auth-toggle');
      const submit = document.querySelector('#btn-login');
      if (!form || !userEl || !passEl || !toggle || !submit) return false;
      if (form.dataset.authMode !== 'register') toggle.click();
      const emailEl = document.querySelector('#login-email');
      userEl.value = u;
      passEl.value = p;
      if (emailEl) emailEl.value = mail;
      submit.click();
      return true;
    },
    USER,
    PASS,
    `${USER}@example.com`,
  );
  if (!filled) await sleep(400);
}
if (!filled) throw new Error('login form never stabilized');
await page.waitForSelector('#realm-list .realm-row', { timeout: 15000 });
await page.evaluate(() => document.querySelector('#realm-list .realm-row')?.click());
await page.waitForFunction(
  () =>
    !document.querySelector('#charcreate-panel')?.hasAttribute('hidden') ||
    !document.querySelector('#charselect-panel')?.hasAttribute('hidden'),
  { timeout: 15000, polling: 200 },
);
const onCreatePanel = await page.evaluate(
  () => !document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
);
if (!onCreatePanel) {
  await page.evaluate(() => document.querySelector('#btn-new-character')?.click());
  await page.waitForFunction(
    () => !document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
    { timeout: 10000, polling: 200 },
  );
}
await page.evaluate((name) => {
  document.querySelector('#new-char-name').value = name;
  document.querySelector('#charcreate-panel .mini-class[data-class="warrior"]')?.click();
  document.querySelector('#btn-create-char').click();
}, CHAR);
await page.waitForFunction(
  () => !document.querySelector('#charselect-panel')?.hasAttribute('hidden'),
  { timeout: 10000, polling: 200 },
);
await sleep(700);
await page.evaluate((name) => {
  const rows = [...document.querySelectorAll('#char-list .char-row')];
  const row =
    rows.find((r) => r.querySelector('.char-name')?.textContent?.trim() === name) ?? rows[0];
  row?.querySelector('.enter-world-btn')?.click();
}, CHAR);
await page.waitForFunction(() => window.__game?.world?.entities?.size >= 1, {
  timeout: 30000,
  polling: 500,
});
await page.evaluate(
  (x, z) => {
    window.__game.online.cmd({ cmd: 'dev_level', level: 7 });
    window.__game.online.cmd({ cmd: 'dev_teleport', x, z });
  },
  DOOR.x,
  DOOR.z,
);
await sleep(2500);
// Let the loading curtain settle after the teleport.
for (let i = 0; i < 20; i++) {
  const hidden = await page.evaluate(
    () => !document.getElementById('loading-screen')?.classList.contains('visible'),
  );
  if (hidden) break;
  await sleep(500);
}
await sleep(1500);
await page.evaluate(() => document.getElementById('tutorial-greeting')?.remove());
// Walk a step with the real bound key, as a player arriving at the board does:
// the self predictor only takes the pose once an intent frame has flowed.
await page.keyboard.down('KeyW');
await sleep(300);
if (process.env.TRACE) {
  console.log(
    'holding W',
    JSON.stringify(
      await page.evaluate(() => {
        const g = window.__game;
        const sr = g.renderer.selfRender;
        const o = g.online;
        return {
          active: sr.active,
          rAX: o.reconAuthoritativeX,
          ovA: o.reconOverrideActive,
          ackCt: o.reconAckClientTick,
          mi: o.moveInput.forward,
          spect: o.spectating,
          px: +g.world.player.pos.x.toFixed(1),
          dx: +sr.position.x.toFixed(1),
          climbing: g.world.player.climbing,
        };
      }),
    ),
  );
}
await sleep(300);
await page.keyboard.up('KeyW');
await sleep(800);
const board = await page.evaluate(() => {
  const w = window.__game.world;
  const halven = [...w.entities.values()].find((e) => e.templateId === 'brother_halven');
  if (!halven) return 'brother_halven not in snapshot';
  window.__game.hud.openDelveBoard(halven.id);
  const btn = document.querySelector('[data-delve-enter]');
  return btn && !btn.disabled ? 'ok' : 'no enter button';
});
console.log('board:', board);
const stateAt = () =>
  page.evaluate(() => {
    const g = window.__game;
    const sr = g.renderer.selfRender;
    const p = g.world.player.pos;
    return {
      wire: g.online.movementWireVersion,
      active: sr.active,
      ready: sr.ready,
      off: +Math.hypot(sr.offset.x, sr.offset.y, sr.offset.z).toFixed(2),
      px: +p.x.toFixed(0),
      dx: +sr.position.x.toFixed(0),
      curtain: !!document.getElementById('loading-screen')?.classList.contains('visible'),
    };
  });
if (process.env.TRACE) {
  console.log('pre-click', JSON.stringify(await stateAt()));
  // Per-frame trace, read after the fact: a rAF hook sampling the self-pose state.
  await page.evaluate(() => {
    const g = window.__game;
    window.__trace = [];
    const t0 = performance.now();
    const tick = () => {
      const sr = g.renderer.selfRender;
      const p = g.world.player.pos;
      window.__trace.push([
        Math.round(performance.now() - t0),
        sr.active ? 1 : 0,
        sr.ready ? 1 : 0,
        +Math.hypot(sr.offset.x, sr.offset.y, sr.offset.z).toFixed(1),
        Math.round(p.x),
        Math.round(sr.position.x),
        g.online.reconOverrideEpoch,
        g.online.reconOverrideActive ? 1 : 0,
      ]);
      if (window.__trace.length < 400) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
await page.evaluate(() => document.querySelector('[data-delve-enter]')?.click());
if (process.env.TRACE) {
  for (let i = 0; i < 25; i++) {
    await sleep(100);
    console.log(`+${(i + 1) * 100}ms`, JSON.stringify(await stateAt()));
  }
}
await sleep(2500);
if (process.env.TRACE) {
  const tr = await page.evaluate(() => window.__trace);
  console.log('frames', tr.length);
  let last = '';
  for (const row of tr) {
    const key = row.slice(1).join(',');
    if (key !== last) console.log('F', JSON.stringify(row));
    last = key;
  }
}
const probeAt = () =>
  page.evaluate(() => {
    const g = window.__game;
    const p = g.world.player.pos;
    const d = g.renderer.selfRenderPosition;
    return {
      player: { x: +p.x.toFixed(1), z: +p.z.toFixed(1) },
      display: { x: +d.x.toFixed(1), z: +d.z.toFixed(1) },
      gap: +Math.hypot(p.x - d.x, p.z - d.z).toFixed(1),
      delveId: g.world.delveRun?.delveId ?? null,
    };
  });
const first = await probeAt();
console.log('t+2.5s', JSON.stringify(first));
await sleep(2000);
const probe = await page.evaluate(() => {
  const g = window.__game;
  const p = g.world.player.pos;
  const d = g.renderer.selfRenderPosition;
  return {
    player: { x: +p.x.toFixed(1), z: +p.z.toFixed(1) },
    display: { x: +d.x.toFixed(1), z: +d.z.toFixed(1) },
    gap: +Math.hypot(p.x - d.x, p.z - d.z).toFixed(1),
    delveId: g.world.delveRun?.delveId ?? null,
  };
});
console.log('t+4.5s', JSON.stringify(probe));
await page.screenshot({ path: OUT });
console.log('wrote', OUT);
await browser.close();
