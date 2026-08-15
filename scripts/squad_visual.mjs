// Drives several real browser clients through Thornhollow Fields, the 5v5 capture-the-
// flag battleground: queue, a dev force-start (so a screenshot run needs fewer
// than ten browsers), then a rune grab, a deliberate flag pickup, and a capture.
// Screenshots land in tmp/. Run the game server first (serves the built client
// on :8787) with ALLOW_DEV_COMMANDS=1 (dev only; the force-start is env-gated):
//   ALLOW_DEV_COMMANDS=1 npm run server
//   GAME_URL=http://localhost:8787 node scripts/squad_visual.mjs
// Ported from Dubtribe11's PR #589 driver onto the current login flow and the
// re-cut's deliberate flag action (bgFlagAction; walk-over never picks up).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:8787';
const N = Number(process.env.BG_CLIENTS ?? 6);
fs.mkdirSync('tmp', { recursive: true });
const uniq = Date.now().toString(36).slice(-5);
// character names must be letters only: fold the timestamp's digits to letters
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  protocolTimeout: 90000,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--window-size=1280,760',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1280, height: 760 },
});

async function login(page, charName, cls) {
  page.on('pageerror', (e) => errors.push(`[${charName}] ${e.message}`));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(600);
  await page.evaluate(
    (u, p) => {
      document.querySelector('#btn-online').click();
      document.querySelector('#login-user').value = u;
      document.querySelector('#login-pass').value = p;
      document.querySelector('#btn-register').click();
    },
    `sq_${charName}_${uniq}`,
    'hunter22',
  );
  await page.waitForFunction(
    () => document.querySelector('#charselect-panel')?.style.display === 'block',
    { timeout: 10000, polling: 200 },
  );
  await page.evaluate(
    (name, cls) => {
      document.querySelector('#new-char-name').value = name;
      document.querySelector(`#charselect-panel .mini-class[data-class="${cls}"]`).click();
      document.querySelector('#btn-create-char').click();
    },
    charName,
    cls,
  );
  await sleep(700);
  await page.evaluate((name) => {
    const rows = [...document.querySelectorAll('.char-row')];
    rows
      .find((r) => r.querySelector('.char-name')?.textContent === name)
      ?.querySelector('.enter-world-btn')
      ?.click();
  }, charName);
  await page.waitForFunction(() => window.__game?.world?.entities?.size > 5, {
    timeout: 25000,
    polling: 500,
  });
}

const names = ['Ravven', 'Bryn', 'Cael', 'Dax', 'Eira', 'Finn', 'Gust', 'Hale', 'Ivo', 'Jor'];
const classes = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'mage',
  'priest',
  'shaman',
  'warlock',
  'druid',
  'warrior',
];
const pages = [];
console.log(`logging in ${N} champions...`);
for (let i = 0; i < N; i++) {
  const pg = await browser.newPage();
  try {
    await login(pg, names[i] + alpha, classes[i % classes.length]);
    pages.push(pg);
  } catch (e) {
    console.log(`client ${i} (${names[i]}) failed to enter: ${e.message.slice(0, 60)}`);
  }
}
console.log(`${pages.length} in world`);
const hero = pages[0];

// sturdy fighters so the demo is not over in one hit
for (const pg of pages)
  await pg.evaluate(() => window.__game.online.cmd({ cmd: 'dev_level', level: 14 }));
await sleep(800);

// --- 1. the Thornhollow Fields panel: standing, queue button, all-time board ---
await hero.bringToFront();
await hero.evaluate(() => window.__game.hud.toggleBattleground());
await sleep(700);
await hero.screenshot({ path: 'tmp/squad1_panel.png' });
console.log(
  'panel rendered:',
  (await hero.evaluate(() => document.querySelector('#arena-window')?.style.display === 'block'))
    ? 'OK'
    : 'FAIL',
);
await hero.evaluate(() => window.__game.hud.toggleBattleground());

// --- 2. queue everyone, then dev force-start the match ---
for (const pg of pages) await pg.evaluate(() => window.__game.world.bgQueueJoin());
await sleep(600);
await hero.evaluate(() => window.__game.online.cmd({ cmd: 'dev_bg_start' }));
await hero.waitForFunction(() => window.__game.world.bgInfo?.match != null, {
  timeout: 12000,
  polling: 200,
});
console.log(
  'match started; my team:',
  await hero.evaluate(() => window.__game.world.bgInfo.match.myTeam),
);

const flagPos = async (pg, team) =>
  pg.evaluate((tm) => {
    const colors = [0xd1413a, 0x3a78d1];
    const f = [...window.__game.world.entities.values()].find(
      (e) => e.templateId === 'bg_flag' && e.color === colors[tm],
    );
    return f ? { x: f.pos.x, z: f.pos.z } : null;
  }, team);
const myTeam = await hero.evaluate(() => window.__game.world.bgInfo.match.myTeam);
const foeTeam = myTeam === 0 ? 1 : 0;

// establishing shot: float the hero up its own field chamber and pull the camera up/back
let myFlag = await flagPos(hero, myTeam);
if (myFlag) {
  const center = { x: myFlag.x, z: myFlag.z + (myTeam === 0 ? 30 : -30) };
  await hero.evaluate(
    (c) => window.__game.online.cmd({ cmd: 'dev_teleport', x: c.x, z: c.z }),
    center,
  );
}
await hero.evaluate(() => {
  window.__game.input.camDist = 22;
  window.__game.input.camPitch = 0.78;
});
await sleep(3500); // let the battleground build + everyone settle
await hero.bringToFront();
await hero.screenshot({ path: 'tmp/squad2_field.png' });
console.log(
  'on the battleground:',
  (await hero.evaluate(() => window.__game.world.player.pos.x > 15000)) ? 'OK' : 'FAIL',
);

// the fight only goes live after the form-up: runes and flags are inert until then
await hero
  .waitForFunction(() => window.__game.world.bgInfo?.match?.state === 'active', {
    timeout: 16000,
    polling: 200,
  })
  .catch(() => {});
console.log(
  'battle live:',
  (await hero.evaluate(() => window.__game.world.bgInfo?.match?.state)) === 'active'
    ? 'OK'
    : 'still counting',
);

// --- 3. sprint rune ---
const rune = await hero.evaluate(() => {
  const r = [...window.__game.world.entities.values()].find((e) => e.templateId === 'bg_rune');
  return r ? { x: r.pos.x, z: r.pos.z } : null;
});
if (rune) {
  await hero.evaluate(
    (r) => window.__game.online.cmd({ cmd: 'dev_teleport', x: r.x, z: r.z + 1 }),
    rune,
  );
  await hero.evaluate(() => {
    window.__game.input.camDist = 10;
    window.__game.input.camPitch = 0.35;
  });
  await sleep(1400);
  await hero.screenshot({ path: 'tmp/squad3_rune.png' });
  console.log(
    'grabbed sprint rune:',
    (await hero.evaluate(() =>
      window.__game.world.player.auras?.some((a) => a.id === 'bg_sprint_rune'),
    ))
      ? 'OK'
      : '(maybe)',
  );
}

// --- 4. the DELIBERATE flag pickup, then run it home for the capture ---
const enemyFlag = await flagPos(hero, foeTeam);
if (enemyFlag) {
  await hero.evaluate(
    (f) => window.__game.online.cmd({ cmd: 'dev_teleport', x: f.x, z: f.z }),
    enemyFlag,
  );
  await sleep(900);
  // walk-over never picks up: the press is the pickup (bg_flag over the wire)
  await hero.evaluate(() => window.__game.world.bgFlagAction());
  await sleep(900);
  await hero.evaluate(() => {
    window.__game.input.camDist = 11;
    window.__game.input.camPitch = 0.4;
  });
  await sleep(400);
  await hero.screenshot({ path: 'tmp/squad4_carry.png' });
  console.log(
    'carrying enemy flag:',
    (await hero.evaluate(
      () =>
        window.__game.world.bgInfo.match.players.find((p) => p.pid === window.__game.world.playerId)
          ?.carrying,
    ))
      ? 'OK'
      : 'FAIL',
  );
  myFlag = await flagPos(hero, myTeam);
  if (myFlag) {
    await hero.evaluate(
      (f) => window.__game.online.cmd({ cmd: 'dev_teleport', x: f.x, z: f.z }),
      myFlag,
    );
    await sleep(1400);
    await hero.bringToFront();
    await hero.screenshot({ path: 'tmp/squad5_capture.png' });
    console.log(
      'score after capture:',
      await hero.evaluate(() => window.__game.world.bgInfo.match.scores.join(':')),
    );
  }
}

console.log(errors.length ? `PAGE ERRORS:\n${errors.slice(0, 6).join('\n')}` : 'no page errors');
await browser.close();
