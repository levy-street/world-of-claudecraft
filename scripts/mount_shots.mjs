// Proof shots for feature/woc-holder-mounts: one in-world screenshot per $WOC
// holder travel mount, captioned with its tier, supply share, and speed. Boots
// the offline client, GM-mounts a level-20 warrior on each steed in turn (the
// renderer attaches the procedural mount + lifts the rider), and captures it.
//
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes PNGs to
// docs/screenshots/mounts/.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/mounts';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mirrors src/sim/content/mounts.ts (kept here so the page needs no app import).
const MOUNTS = [
  { tier: 1, id: 'ashmane', name: 'Ashmane Courser', share: 0.1, threshold: 1_000_000, speed: 60 },
  { tier: 2, id: 'emberhoof', name: 'Emberhoof Charger', share: 1, threshold: 10_000_000, speed: 100 },
  { tier: 3, id: 'bronzeflank', name: 'Bronzeflank Destrier', share: 2, threshold: 20_000_000, speed: 100 },
  { tier: 4, id: 'silvermane', name: 'Silvermane Stallion', share: 3, threshold: 30_000_000, speed: 100 },
  { tier: 5, id: 'stormhoof', name: 'Stormhoof Charger', share: 4, threshold: 40_000_000, speed: 100 },
  { tier: 6, id: 'goldcrest', name: 'Goldcrest Warhorse', share: 5, threshold: 50_000_000, speed: 100 },
  { tier: 7, id: 'verdant', name: 'Verdant Wildhart', share: 6, threshold: 60_000_000, speed: 100 },
  { tier: 8, id: 'voidstrider', name: 'Voidstrider', share: 7, threshold: 70_000_000, speed: 100 },
  { tier: 9, id: 'celestial', name: 'Celestial Charger', share: 8, threshold: 80_000_000, speed: 100 },
  { tier: 10, id: 'worldbearer', name: "Worldbearer's Behemoth", share: 9, threshold: 90_000_000, speed: 100 },
  { tier: 11, id: 'sovereign', name: 'Sovereign Dreadsteed', share: 10, threshold: 100_000_000, speed: 100 },
];

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=900,760', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 900, height: 760 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

// `domcontentloaded` (not networkidle0): offline play needs no game server, and
// the homepage's /api/stats fetch 502s without one, which would stall networkidle.
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('#btn-offline', { timeout: 15000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(200);
await page.type('#char-name', 'Rider');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await sleep(2800);

// Level-20 GM warrior, eligible for every rung; pacify the whole roster so a
// stray aggro can't enter combat and dismount us mid-shoot. Face a fixed heading
// and frame a 3/4 hero angle. Hide the HUD so the steed reads cleanly.
await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  g.sim.setPlayerLevel(20, p.id);
  p.gm = true; p.maxHp = 99999; p.hp = 99999;
  p.mountTier = 11;
  p.facing = 0; p.prevFacing = 0;
  // Teleport out of cluttered Eastbrook town to the open Brightwood Glade so the
  // steed reads against grass, not stalls and campfires. groundPos pins feet to
  // the terrain exactly (no fall-settle needed).
  const gp = g.sim.groundPos(38, 138);
  p.pos = { ...gp }; p.prevPos = { ...gp };
  for (const e of g.sim.entities.values()) {
    if (e.kind === 'mob') { e.hostile = false; e.aggroTargetId = null; e.targetId = null; e.aiState = 'idle'; }
  }
  g.input.camYaw = p.facing + 0.9;
  g.input.camPitch = 0.16;
  g.input.camDist = 5.6;
  // Hide the whole HUD (the #ui wrapper) + floating nameplates; the canvas and
  // our caption sit outside #ui and stay visible.
  for (const sel of ['#ui', '#nameplates']) {
    const el = document.querySelector(sel);
    if (el) el.style.display = 'none';
  }
  const cap = document.createElement('div');
  cap.id = '__mountcap';
  cap.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);text-align:center;z-index:99999;'
    + 'font-family:Georgia,serif;color:#f6ecd2;pointer-events:none;padding:12px 26px;border-radius:12px;'
    + 'background:rgba(12,14,20,0.62);box-shadow:0 4px 18px rgba(0,0,0,0.5);backdrop-filter:blur(2px);'
    + 'border:1px solid rgba(216,178,74,0.4)';
  document.body.appendChild(cap);
});
await sleep(700);

for (const m of MOUNTS) {
  await page.evaluate((m) => {
    const g = window.__game;
    const p = g.sim.player;
    p.inCombat = false;
    p.mountId = m.id; // renderer attaches the steed + lifts the rider next frame
    const fmt = (n) => n.toLocaleString('en-US');
    document.getElementById('__mountcap').innerHTML =
      `<div style="font-size:26px;font-weight:700">Tier ${m.tier} · ${m.name}</div>`
      + `<div style="font-size:15px;color:#cdbf98;margin-top:5px">`
      + `${m.share}% of supply · ${fmt(m.threshold)} $WOC · +${m.speed}% speed</div>`;
  }, m);
  await sleep(650); // a few render frames: attach, gait, settle
  const num = String(m.tier).padStart(2, '0');
  await page.screenshot({ path: `${OUT}/${num}-${m.id}.png` });
  console.log(`shot tier ${m.tier}: ${m.name} -> ${OUT}/${num}-${m.id}.png`);
}

await browser.close();
console.log(`done -> ${OUT}/ (${MOUNTS.length} mounts)`);
