// Delve crypt E2E: register online, teleport to Brother Halven at the
// collapsed_reliquary door, open the delve board, enter on normal tier,
// and assert the player is inside the delve instance.
// Needs npm run dev (:5173) + npm run server (:8787) with ALLOW_DEV_COMMANDS=1.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const DOOR_X = -10;
const DOOR_Z = -8;
const DELVE_X_MIN = 3600;

const uniq = Date.now().toString(36).slice(-5);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
const CHAR = `Dlv${alpha}`;
const PASS = 'hunter22';
const USER = `delve_${uniq}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp', { recursive: true });

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`OK   ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}${extra ? ` ${extra}` : ''}`);
  }
}

const errors = [];
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 60000,
  args: ['--window-size=1280,760', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 760 },
});

const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`);
});

console.log('registering and entering world...');
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await sleep(800);
await page.evaluate(
  (u, p) => {
    document.querySelector('#btn-online').click();
    document.querySelector('#login-user').value = u;
    document.querySelector('#login-pass').value = p;
    document.querySelector('#btn-register').click();
  },
  USER,
  PASS,
);
await page.waitForFunction(
  () => document.querySelector('#charselect-panel')?.style.display === 'block',
  { timeout: 8000, polling: 200 },
);
await page.evaluate((name) => {
  document.querySelector('#new-char-name').value = name;
  document.querySelector('#charselect-panel .mini-class[data-class="warrior"]').click();
  document.querySelector('#btn-create-char').click();
}, CHAR);
await sleep(700);
await page.evaluate((name) => {
  [...document.querySelectorAll('.char-row')]
    .find((r) => r.querySelector('.char-name')?.textContent === name)
    ?.querySelector('button')
    ?.click();
}, CHAR);
await page.waitForFunction(() => window.__game?.world?.entities?.size > 5, {
  timeout: 20000,
  polling: 500,
});
check('entered world', true);

console.log('teleporting to Brother Halven / delve door...');
await page.evaluate(
  (x, z) => {
    window.__game.online.cmd({ cmd: 'dev_level', level: 7 });
    window.__game.online.cmd({ cmd: 'dev_teleport', x, z });
  },
  DOOR_X,
  DOOR_Z,
);
await sleep(900);

const board = await page.evaluate(() => {
  const w = window.__game.world;
  const halven = [...w.entities.values()].find((e) => e.templateId === 'brother_halven');
  if (!halven) return { ok: false, reason: 'brother_halven not in snapshot' };
  window.__game.hud.openDelveBoard(halven.id);
  const open = document.querySelector('#delve-board')?.style.display === 'block';
  const enterBtn = document.querySelector('[data-delve-enter]');
  return { ok: open && !!enterBtn && !enterBtn.disabled, reason: open ? '' : 'board hidden' };
});
check('delve board opened', board.ok, board.reason);

console.log('entering collapsed_reliquary (normal)...');
await page.evaluate(() => {
  document.querySelector('[data-delve-enter]')?.click();
});

let probe = null;
let inDelve = false;
for (let i = 0; i < 24 && !inDelve; i++) {
  await sleep(500);
  probe = await page.evaluate((_minX) => {
    const w = window.__game.world;
    const drun = w.delveRun;
    const x = w.player?.pos?.x ?? 0;
    const mobs = [...w.entities.values()].filter((e) => e.kind === 'mob' && !e.dead).length;
    return {
      drun,
      x: Math.round(x),
      mobs,
      delveId: drun?.delveId ?? null,
    };
  }, DELVE_X_MIN);
  inDelve = probe.delveId === 'collapsed_reliquary' || probe.x >= DELVE_X_MIN;
}

check(
  'player in delve (drun or x band)',
  inDelve,
  JSON.stringify({ delveId: probe?.delveId, x: probe?.x }),
);
check('delve mobs spawned', (probe?.mobs ?? 0) > 0, `mobs=${probe?.mobs ?? 0}`);

await page.screenshot({ path: 'tmp/delve_crypt.png' });
check('no page errors', errors.length === 0, errors.slice(0, 3).join('; '));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
