// Two-client defense-event E2E over real WebSockets: both players hold the
// Thornfen palisade and BOTH earn the quest credit (the multiplayer-fairness
// property the defense system exists for). Needs the game server up on :8787
// with ALLOW_DEV_COMMANDS=1 (dev only).
//   node scripts/valdris_mp_events_e2e.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:8787';
// letters-only (classic name rule): base-36 timestamp mapped onto a-z
const UNIQ =
  process.env.VLD_UNIQ ??
  Date.now()
    .toString(36)
    .replace(/[0-9]/g, (d) => 'qwertyuiop'[Number(d)])
    .slice(-6);
fs.mkdirSync('tmp/valdris-smoke', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (c, m) => {
  console.log(`${c ? 'OK  ' : 'FAIL'}  ${m}`);
  if (!c) fails.push(m);
};
const PASS = 'hunter22';
const QUEST = 'q_thornfen_palisade_defense';
const SITE = { x: 25, z: 2305, npc: 'quartermaster_senna' };

const launch = () =>
  puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    protocolTimeout: 180000,
    args: [
      '--no-sandbox',
      '--window-size=1280,760',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
    defaultViewport: { width: 1280, height: 760 },
  });
// two heavy software-GL worlds in one browser process crash screenshots:
// give each client its own browser
const browserA = await launch();
const browserB = await launch();

async function enter(page, charName) {
  page.on('pageerror', (e) => fails.push(`[${charName}] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[console ${charName}]`, m.text().slice(0, 160));
  });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(700);
  await page.evaluate(() => document.querySelector('#btn-online').click());
  await sleep(400);
  // login first (reruns reuse the account); fall back to register mode
  await page.type('#login-user', `vld_${charName}`);
  await page.type('#login-pass', PASS);
  await page.evaluate(() => document.querySelector('#btn-login').click());
  await sleep(1500);
  const authed = await page.evaluate(
    () =>
      !document.querySelector('#realm-panel')?.hasAttribute('hidden') ||
      !document.querySelector('#charselect-panel')?.hasAttribute('hidden') ||
      !document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
  );
  if (!authed) {
    await page.evaluate(() => document.querySelector('#btn-auth-toggle').click());
    await sleep(300);
    await page.type('#login-email', `vld${charName}@example.test`.toLowerCase());
    await page.evaluate(() => document.querySelector('#btn-login').click());
  }
  // panels toggle via the `hidden` attribute now; post-auth lands on the realm
  // list first (classic flow), then roster or create
  try {
    await page.waitForFunction(
      () =>
        ['#charselect-panel', '#charcreate-panel', '#realm-panel'].some((id) => {
          const el = document.querySelector(id);
          return el && !el.hasAttribute('hidden');
        }),
      { timeout: 12000, polling: 200 },
    );
    const onRealms = await page.evaluate(
      () => !document.querySelector('#realm-panel')?.hasAttribute('hidden'),
    );
    if (onRealms) {
      await page.waitForFunction(
        () => document.querySelectorAll('#realm-list button, #realm-list .realm-row').length > 0,
        { timeout: 8000, polling: 200 },
      );
      await page.evaluate(() => {
        const row = document.querySelector('#realm-list button, #realm-list .realm-row');
        row.click();
      });
    }
    await page.waitForFunction(
      () =>
        ['#charselect-panel', '#charcreate-panel'].some((id) => {
          const el = document.querySelector(id);
          return el && !el.hasAttribute('hidden');
        }),
      { timeout: 12000, polling: 200 },
    );
  } catch (e) {
    const state = await page.evaluate(() => {
      const vis = [...document.querySelectorAll('section, div[id$="-panel"], form')]
        .filter((el) => el.id && !el.hasAttribute('hidden') && el.offsetParent !== null)
        .map((el) => el.id)
        .slice(0, 12);
      const errs = [...document.querySelectorAll('[id*="error"]')]
        .map((el) => `${el.id}=${(el.textContent ?? '').trim()}`)
        .filter((t) => !t.endsWith('='))
        .slice(0, 6);
      return JSON.stringify({
        vis,
        errs,
        authMode: document.querySelector('#login-form')?.dataset?.authMode,
      });
    });
    throw new Error(`charselect never opened for ${charName}: ${state}`);
  }
  // open the create panel from the roster if we are not already on it
  await page.evaluate(() => {
    if (document.querySelector('#charcreate-panel')?.hasAttribute('hidden')) {
      document.querySelector('#btn-new-character')?.click();
    }
  });
  await sleep(500);
  await page.type('#new-char-name', charName);
  await page.evaluate(() => {
    document
      .querySelector(
        '#charcreate-panel .mini-class[data-class="warrior"], .mini-class[data-class="warrior"]',
      )
      ?.click();
    document.querySelector('#btn-create-char').click();
  });
  await sleep(1200);
  await page.waitForFunction(
    (name) =>
      [...document.querySelectorAll('#char-list .char-row')].some(
        (r) => r.querySelector('.char-name')?.textContent === name,
      ),
    { timeout: 10000, polling: 250 },
    charName,
  );
  await page.evaluate((name) => {
    const row = [...document.querySelectorAll('#char-list .char-row')].find(
      (r) => r.querySelector('.char-name')?.textContent === name,
    );
    row?.click();
    row?.querySelector('.enter-world-btn')?.click();
  }, charName);
  try {
    await page.waitForFunction(() => window.__game?.world?.entities?.size > 5, {
      timeout: 90000,
      polling: 500,
    });
  } catch (e) {
    try {
      await page.screenshot({ path: `tmp/valdris-smoke/enter_fail_${charName}.png` });
    } catch {}
    const st = await page.evaluate(() => {
      const vis = [...document.querySelectorAll('[id]')]
        .filter(
          (el) => (el.id.endsWith('-panel') || el.id === 'char-list') && !el.hasAttribute('hidden'),
        )
        .map((el) => el.id);
      const rows = [...document.querySelectorAll('#char-list .char-row .char-name')].map(
        (n) => n.textContent,
      );
      const err = document.querySelector('#charselect-error')?.textContent ?? '';
      return JSON.stringify({ vis, rows, err, hasGame: !!window.__game });
    });
    throw new Error(`never entered world: ${st}`);
  }
  await sleep(500);
}

async function prep(page) {
  await page.evaluate((site) => {
    const o = window.__game.online;
    o.cmd({ cmd: 'dev_level', level: 40 });
    o.cmd({ cmd: 'dev_teleport', x: site.x - 3, z: site.z - 4 });
  }, SITE);
  await sleep(1200);
  await page.evaluate((quest) => {
    const w = window.__game.world;
    const senna = [...w.entities.values()].find((e) => e.templateId === 'quartermaster_senna');
    window.__game.online.cmd({ cmd: 'accept', quest });
    return senna?.id;
  }, QUEST);
  await sleep(900);
  return page.evaluate((quest) => window.__game.world.questState?.(quest), QUEST);
}

const a = await browserA.newPage();
const b = await browserB.newPage();
await enter(a, `Aeg${UNIQ}`);
await enter(b, `Lum${UNIQ}`);

const stA = await prep(a);
const stB = await prep(b);
check(stA === 'active', `client A holds the quest (${stA})`);
check(stB === 'active', `client B holds the quest (${stB})`);

// A talks to Senna (target + interact over the wire) to arm the event; both
// stand inside the radius. Senna is also the quest giver, so the first
// interact after accepting is plain gossip; the DEFENSE hook consumes it.
await a.evaluate(() => {
  const w = window.__game.world;
  const senna = [...w.entities.values()].find((e) => e.templateId === 'quartermaster_senna');
  window.__game.online.cmd({ cmd: 'target', id: senna.id });
});
await sleep(400);
await a.evaluate(() => window.__game.online.cmd({ cmd: 'interact' }));
await sleep(1200);

// Fight loop: both clients target and burn whatever hostile wave mobs appear
// near the site until both quest logs read ready (or timeout).
const deadline = Date.now() + 150000;
let ready = { a: false, b: false };
while (Date.now() < deadline && !(ready.a && ready.b)) {
  for (const page of [a, b]) {
    await page.evaluate((site) => {
      const g = window.__game;
      const w = g.world;
      const me = w.entities.get(w.playerId);
      if (!me || me.hp <= 0) return;
      let best = null;
      let bd = 1e9;
      for (const e of w.entities.values()) {
        if (e.kind !== 'mob' || e.dead || !e.hostile) continue;
        const d = Math.hypot(e.pos.x - site.x, e.pos.z - site.z);
        if (d > 45) continue;
        const dm = Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z);
        if (dm < bd) {
          bd = dm;
          best = e;
        }
      }
      if (best) {
        g.online.cmd({ cmd: 'target', id: best.id });
        g.online.cmd({ cmd: 'attack' });
        if (bd > 4) g.online.cmd({ cmd: 'dev_teleport', x: best.pos.x + 1.5, z: best.pos.z });
      }
    }, SITE);
  }
  await sleep(1500);
  ready = {
    a: (await a.evaluate((q) => window.__game.world.questState?.(q), QUEST)) === 'ready',
    b: (await b.evaluate((q) => window.__game.world.questState?.(q), QUEST)) === 'ready',
  };
}
check(ready.a, 'client A completed the defend objective (quest ready)');
check(ready.b, 'client B completed the defend objective (quest ready, shared credit)');

await a.screenshot({ path: 'tmp/valdris-smoke/7_mp_defense_a.png' });
await b.screenshot({ path: 'tmp/valdris-smoke/7_mp_defense_b.png' });

await browserA.close();
await browserB.close();
if (fails.length) {
  console.error(`\n${fails.length} FAILURES:\n${fails.join('\n')}`);
  process.exit(1);
}
console.log('\nTwo-client defense E2E passed. Screenshots in tmp/valdris-smoke/.');
