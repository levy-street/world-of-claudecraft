// Two-client defense-event E2E over real WebSockets: both players hold the
// Thornfen palisade and BOTH earn the quest credit (the multiplayer-fairness
// property the defense system exists for). Needs the game server up on :8787
// with ALLOW_DEV_COMMANDS=1 (dev only).
//   node scripts/valdris_mp_events_e2e.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:8787';
const UNIQ = process.env.VLD_UNIQ ?? `${Date.now() % 100000}`;
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

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 120000,
  args: [
    '--no-sandbox',
    '--window-size=1280,760',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1280, height: 760 },
});

async function enter(page, charName) {
  page.on('pageerror', (e) => fails.push(`[${charName}] ${e.message}`));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(700);
  await page.evaluate(
    (u, p) => {
      document.querySelector('#btn-online').click();
      document.querySelector('#login-user').value = u;
      document.querySelector('#login-pass').value = p;
      document.querySelector('#btn-register').click();
    },
    `vld_${charName}`,
    PASS,
  );
  await page.waitForFunction(
    () => document.querySelector('#charselect-panel')?.style.display === 'block',
    { timeout: 9000, polling: 200 },
  );
  await page.evaluate((name) => {
    document.querySelector('#new-char-name').value = name;
    document.querySelector('#charselect-panel .mini-class[data-class="warrior"]').click();
    document.querySelector('#btn-create-char').click();
  }, charName);
  await sleep(700);
  await page.evaluate((name) => {
    [...document.querySelectorAll('.char-row')]
      .find((r) => r.querySelector('.char-name')?.textContent === name)
      ?.querySelector('.enter-world-btn')
      ?.click();
  }, charName);
  await page.waitForFunction(() => window.__game?.world?.entities?.size > 5, {
    timeout: 20000,
    polling: 500,
  });
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
    window.__game.online.cmd({ cmd: 'acceptQuest', questId: quest, npcId: senna?.id });
    return senna?.id;
  }, QUEST);
  await sleep(900);
  return page.evaluate((quest) => window.__game.world.questState?.(quest), QUEST);
}

const a = await browser.newPage();
const b = await browser.newPage();
await enter(a, `Aeg${UNIQ}`);
await enter(b, `Lum${UNIQ}`);

const stA = await prep(a);
const stB = await prep(b);
check(stA === 'active', `client A holds the quest (${stA})`);
check(stB === 'active', `client B holds the quest (${stB})`);

// A talks to Senna to arm the event; both stand inside the radius.
await a.evaluate(() => {
  const w = window.__game.world;
  const senna = [...w.entities.values()].find((e) => e.templateId === 'quartermaster_senna');
  window.__game.online.cmd({ cmd: 'talkToNpc', npcId: senna.id });
});
await sleep(1000);

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
        g.online.cmd({ cmd: 'startAutoAttack' });
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

await browser.close();
if (fails.length) {
  console.error(`\n${fails.length} FAILURES:\n${fails.join('\n')}`);
  process.exit(1);
}
console.log('\nTwo-client defense E2E passed. Screenshots in tmp/valdris-smoke/.');
