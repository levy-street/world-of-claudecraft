// Screenshot tour of The Drowned Temple: boots offline, levels up, walks the
// Glimmermere moongate site (portal + Ondrel + the drowned shore), then steps
// through the gate to tour the flooded temple, the choir-sanctum and Ysolei's
// altar. Saves tmp/temple_*.png. Needs `npm run dev` running and a browser
// (set BROWSER_PATH or rely on scripts/browser_path.mjs autodetect).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=' + (process.env.GFX_TIER ?? 'high');
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name) => page.screenshot({ path: `tmp/temple_${name}.png` });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await sleep(200);
await page.click('.class-card[data-class="warrior"]');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000 });
await sleep(2500);

// god-mode so the elite drowned don't end the tour early
await page.evaluate(() => {
  const g = window.__game;
  g.sim.setPlayerLevel(18);
  const p = g.sim.player;
  p.maxHp = 999999; p.hp = 999999;
});

const tp = async (x, z, facing = 0) => {
  await page.evaluate(({ x, z, facing }) => {
    const g = window.__game;
    const p = g.sim.player;
    if (p.dead) g.sim.releaseSpirit();
    p.maxHp = 999999; p.hp = 999999;
    const pos = g.sim.groundPos(x, z);
    p.pos = pos; p.prevPos = { ...pos };
    p.facing = facing; p.prevFacing = facing;
    g.input.camYaw = facing;
  }, { x, z, facing });
  await sleep(900);
};

// 1) the Glimmermere shore: the moongate portal, Ondrel, the drowned camp
await tp(-70, 802, 0);
await shot('01_glimmermere_shore');
await tp(-66, 800, -2.4); // look back at Ondrel + the gate
await shot('02_moongate');
const site = await page.evaluate(() => {
  const g = window.__game;
  const ents = [...g.sim.entities.values()];
  return {
    ondrel: ents.find((e) => e.templateId === 'tidewatcher_ondrel')?.name ?? null,
    door: ents.some((e) => e.templateId === 'dungeon_door' && e.dungeonId === 'drowned_temple'),
    waders: ents.filter((e) => e.templateId === 'glimmermere_wader' && !e.dead).length,
    votaries: ents.filter((e) => e.templateId === 'drowned_votary' && !e.dead).length,
  };
});
console.log('moongate site:', JSON.stringify(site));

// 2) a brawl with the drowned on the shore
await page.evaluate(() => {
  const g = window.__game, sim = g.sim, p = sim.player;
  let m = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if ((e.templateId === 'glimmermere_wader' || e.templateId === 'drowned_votary') && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; m = e; }
    }
  }
  if (m) {
    p.pos.x = m.pos.x - 3; p.pos.z = m.pos.z;
    p.facing = Math.atan2(m.pos.x - p.pos.x, m.pos.z - p.pos.z);
    g.input.camYaw = p.facing;
    sim.targetEntity(m.id); sim.startAutoAttack();
  }
});
await sleep(2200);
await shot('03_shore_combat');

// 3) Sethrael the Palecoil, the rare moon-serpent
await tp(-96, 814, -1.2);
await shot('04_sethrael');

// 4) step through the moongate into the temple antechamber
const entry = await page.evaluate(() => {
  const g = window.__game;
  if (g.sim.player.dead) g.sim.releaseSpirit();
  const pos = g.sim.groundPos(-70, 792);
  g.sim.player.pos = pos; g.sim.player.prevPos = { ...pos };
  g.sim.enterDungeon('drowned_temple');
  return g.sim.player.pos.x;
});
await sleep(1300);
console.log('temple entry x:', Math.round(entry), entry > 600 ? 'OK' : 'FAIL');
await shot('05_antechamber');

// 5) the chamber-waist arch into the moon-sanctum
await page.evaluate(() => {
  const g = window.__game, p = g.sim.player;
  p.maxHp = 999999; p.hp = 999999;
  p.pos.z += 66; p.prevPos = { ...p.pos };
});
await sleep(900);
await shot('06_sanctum_arch');

// 6) Ysolei coiled on the great altar
await page.evaluate(() => {
  const g = window.__game, p = g.sim.player;
  p.maxHp = 999999; p.hp = 999999;
  p.pos.z += 44; p.prevPos = { ...p.pos };
});
await sleep(900);
await shot('07_ysolei_altar');
const boss = await page.evaluate(() => {
  const g = window.__game;
  const k = [...g.sim.entities.values()].find((e) => e.templateId === 'ysolei');
  return k ? { hp: k.maxHp, level: k.level, name: k.name } : null;
});
console.log('Ysolei present:', JSON.stringify(boss), boss ? 'OK' : 'FAIL');

// 7) the world map — the moongate + Glimmermere now sit on the Thornpeak map
await page.evaluate(() => window.__game.sim.leaveDungeon());
await sleep(500);
await tp(-70, 770, 0);
await page.keyboard.press('m');
await sleep(500);
await shot('08_map');
await page.keyboard.press('m');

console.log(errors.length ? 'PAGE ERRORS:\n' + errors.slice(0, 8).join('\n') : 'no page errors');
await browser.close();
