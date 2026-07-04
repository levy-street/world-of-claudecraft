// Menagerie QA board: line every Tripo-bodied template up IN THE REAL GAME
// beside stock references and photograph the four states that matter (idle,
// chase/walk, melee, death). Needs `npm run dev` on :5173.
//   BROWSER_PATH=... node scripts/tripo_menagerie_qa.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'tmp/menagerie';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One live template per generated body, plus stock references at the ends.
const LINE = [
  'forest_wolf', // STOCK ref
  'duskmane_stalker', // cat body (known broken, regen queued)
  'blackriver_skulker',
  'palewidow_weaver',
  'tombrobber_scavenger',
  'guildless_cutthroat',
  'broken_legion_deserter',
  'vale_bandit', // STOCK ref
  'forsaken_judge',
  'hollow_revenant',
  'frostpine_headhunter',
  'sellsword_ogre',
  'ironhold_digger',
  'duststorm_elemental',
  'granite_churn_elemental',
  'thornpeak_ogre', // STOCK ref
];
const BOARD = { x: -40, z: 1105 }; // flat Ossara ground, off-road

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 120000,
  args: [
    '--no-sandbox',
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 120)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Menagerie');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud && window.__game?.renderer, { timeout: 90000 });
await sleep(2500);

// Build the board: teleport the player, then pull one live instance of each
// template into a line and freeze it (idle, no aggro).
await page.evaluate(
  ([LINE, BOARD]) => {
    const g = window.__game;
    const w = g.world;
    const p = w.player;
    const meta = w.players.get(w.playerId);
    g.online?.cmd; // offline only
    // player level + position
    w.setPlayerLevel(40);
    p.pos = w.groundPos(BOARD.x + 26, BOARD.z - 9);
    p.prevPos = { ...p.pos };
    p.hp = p.maxHp;
    w.rebucket(p);
    const picked = new Map();
    for (const e of w.entities.values()) {
      if (e.kind !== 'mob' || e.dead || e.ownerId !== null) continue;
      if (!LINE.includes(e.templateId) || picked.has(e.templateId)) continue;
      picked.set(e.templateId, e);
    }
    let i = 0;
    for (const tid of LINE) {
      const e = picked.get(tid);
      if (!e) {
        i++;
        continue;
      }
      e.pos = w.groundPos(BOARD.x + i * 3.5, BOARD.z);
      e.prevPos = { ...e.pos };
      // pin the board position as HOME so the leash/evade logic keeps them here
      e.spawnPos = { ...e.pos };
      e.leashAnchor = null;
      e.facing = Math.PI; // face south toward the camera/player
      e.aiState = 'idle';
      e.aggroTargetId = null;
      e.inCombat = false;
      e.hp = e.maxHp;
      w.rebucket(e);
      i++;
    }
    window.__board = [...picked.values()].map((e) => e.id);
    return picked.size;
  },
  [LINE, BOARD],
);
await sleep(1200);
await page.screenshot({ path: `${OUT}/1_idle_lineup.png` });

// WALK: send the player far south; aggro every board mob so they chase.
await page.evaluate((BOARD) => {
  const g = window.__game;
  const w = g.world;
  const p = w.player;
  p.pos = w.groundPos(BOARD.x + 26, BOARD.z - 22);
  p.prevPos = { ...p.pos };
  w.rebucket(p);
  for (const id of window.__board) {
    const e = w.entities.get(id);
    if (!e || e.dead) continue;
    e.aiState = 'chase';
    e.aggroTargetId = w.playerId;
    e.inCombat = true;
  }
}, BOARD);
await sleep(1800);
await page.screenshot({ path: `${OUT}/2_walk_chase.png` });
await sleep(1200);
await page.screenshot({ path: `${OUT}/3_walk_chase_b.png` });

// MELEE: let them reach the player (god HP) and swing.
await page.evaluate(() => {
  const w = window.__game.world;
  const p = w.player;
  p.maxHp = 999999;
  p.hp = 999999;
});
await sleep(3500);
await page.screenshot({ path: `${OUT}/4_melee.png` });

// DEATH: kill the whole line, catch mid-death and corpses.
await page.evaluate(() => {
  const w = window.__game.world;
  for (const id of window.__board) {
    const e = w.entities.get(id);
    if (e && !e.dead) w.dealDamage(w.player, e, 9999999, false, 'physical', null, 'hit');
  }
});
await sleep(700);
await page.screenshot({ path: `${OUT}/5_death_mid.png` });
await sleep(1800);
await page.screenshot({ path: `${OUT}/6_death_settled.png` });

await browser.close();
console.log('menagerie done -> tmp/menagerie/');
