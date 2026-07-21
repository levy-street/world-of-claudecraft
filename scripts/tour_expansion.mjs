// Expansion verification tour: boots offline, levels up, walks the new zones
// and dungeons, opens every icon-bearing window, and saves screenshots to
// tmp/exp_*.png for visual inspection.
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
const shot = (name) => page.screenshot({ path: `tmp/exp_${name}.png` });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(200);
await page.type('#char-name', 'ShamanName');
await page.click('#offline-select .mini-class[data-class="shaman"]'); // the user plays with lightning bolt
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000 });
await sleep(2500);

const tp = async (x, z, facing = 0) => {
  await page.evaluate(({ x, z, facing }) => {
    const g = window.__game;
    const p = g.sim.player;
    const pos = g.sim.groundPos(x, z);
    p.pos = pos; p.prevPos = { ...pos };
    p.facing = facing; p.prevFacing = facing;
    g.input.camYaw = facing;
  }, { x, z, facing });
  await sleep(900);
};

// 1) levels + new spell ranks: level 6 -> check lightning bolt rank, then 20
const ranksAt = async (lvl) => page.evaluate((lvl) => {
  const g = window.__game;
  g.sim.setPlayerLevel(lvl);
  return g.sim.known.map((k) => `${k.def.id}:r${k.rank}`).join(' ');
}, lvl);
console.log('kit @6 :', await ranksAt(6));
console.log('kit @14:', await ranksAt(14));
console.log('kit @20:', await ranksAt(20));
await sleep(400);

// 2) icon-bearing UI: action bar + spellbook + bags + character
await page.evaluate(() => {
  const g = window.__game;
  for (const it of ['baked_bread', 'spring_water', 'eastbrook_arming_sword', 'mistcallers_edge', 'wyrmfang_greatblade', 'trail_hardtack']) {
    g.sim.addItem(it, 1);
  }
});
await page.keyboard.press('p'); // spellbook
await sleep(400);
await shot('01_spellbook_icons');
await page.keyboard.press('p');
await page.keyboard.press('b'); // bags
await page.keyboard.press('c'); // character
await sleep(400);
await shot('02_bags_char_icons');
await page.keyboard.press('b');
await page.keyboard.press('c');

// 3) eat + drink at the same time
await page.evaluate(() => {
  const g = window.__game;
  g.sim.player.hp = 50;
  g.sim.player.resource = 20;
  g.sim.useItem('baked_bread');
  g.sim.useItem('spring_water');
});
await sleep(1200);
const consume = await page.evaluate(() => {
  const p = window.__game.sim.player;
  return { eating: !!p.eating, drinking: !!p.drinking };
});
console.log('eat+drink simultaneously:', JSON.stringify(consume), consume.eating && consume.drinking ? 'OK' : 'FAIL');
await shot('03_eating_and_drinking');

// 4) smith vendor in Eastbrook
await tp(7, 14, Math.PI);
const smith = await page.evaluate(() => {
  const g = window.__game;
  const npc = [...g.sim.entities.values()].find((e) => e.templateId === 'smith_haldren');
  if (!npc) return null;
  g.hud.openVendor(npc.id);
  return npc.vendorItems;
});
console.log('smith_haldren vendor:', smith ? `${smith.length} items OK` : 'MISSING');
await sleep(400);
await shot('04_smith_vendor');
await page.keyboard.press('Escape');

// 5) the causeway north: zone transition into Mirefen Marsh
await tp(0, 175, 0);
await sleep(300);
await tp(0, 210, 0);
await sleep(1200);
await shot('05_entering_mirefen');

// 6) Fenbridge hub
await tp(0, 295, 0.5);
await shot('06_fenbridge_hub');
const fenNpcs = await page.evaluate(() => {
  const g = window.__game;
  return [...g.sim.entities.values()].filter((e) => e.kind === 'npc' && e.pos.z > 280 && e.pos.z < 320).map((e) => e.name);
});
console.log('fenbridge npcs:', JSON.stringify(fenNpcs));

// 7) marsh wilds + a camp
await tp(-40, 230, Math.PI / 2);
await shot('07_prowler_reeds');

// 8) Sunken Bastion door + inside
await tp(45, 511, 0);
await sleep(600);
await shot('08_bastion_door');
const inBastion = await page.evaluate(() => {
  const g = window.__game;
  if (g.sim.player.dead) g.sim.releaseSpirit();
  const pos = g.sim.groundPos(45, 511);
  g.sim.player.pos = pos; g.sim.player.prevPos = { ...pos };
  g.sim.enterDungeon('sunken_bastion');
  return g.sim.player.pos.x;
});
await sleep(1200);
console.log('bastion entry x:', Math.round(inBastion), inBastion > 600 ? 'OK' : 'FAIL');
await shot('09_inside_bastion');
await page.evaluate(() => window.__game.sim.leaveDungeon());
await sleep(600);

// 9) Highwatch hub (peaks)
await tp(0, 650, 0.4);
await shot('10_highwatch_hub');

// 10) ogre war-camp + elemental crags
await tp(-90, 700, -1);
await shot('11_ogre_foothills');
await tp(110, 760, 1.2);
await shot('12_stormcrag');

// 11) Sanctum approach + the final dungeon
await tp(0, 862, 0);
await shot('13_sanctum_approach');
const inSanctum = await page.evaluate(() => {
  const g = window.__game;
  // the approach is patrolled by level-19 revenants; revive if they got us
  if (g.sim.player.dead) g.sim.releaseSpirit();
  const pos = g.sim.groundPos(0, 876);
  g.sim.player.pos = pos; g.sim.player.prevPos = { ...pos };
  g.sim.enterDungeon('gravewyrm_sanctum');
  return g.sim.player.pos.x;
});
await sleep(1200);
console.log('sanctum entry x:', Math.round(inSanctum), inSanctum > 600 ? 'OK' : 'FAIL');
await shot('14_inside_sanctum');
// walk to Korzul's chamber
await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  p.pos.z += 125;
  p.prevPos = { ...p.pos };
});
await sleep(900);
await shot('15_korzul_chamber');
const korzul = await page.evaluate(() => {
  const g = window.__game;
  const k = [...g.sim.entities.values()].find((e) => e.templateId === 'korzul_the_gravewyrm');
  return k ? { hp: k.maxHp, level: k.level } : null;
});
console.log('korzul present:', JSON.stringify(korzul), korzul ? 'OK' : 'FAIL');
await page.evaluate(() => window.__game.sim.leaveDungeon());
await sleep(500);

// 12) world map of each zone
await page.keyboard.press('m');
await sleep(400);
await shot('16_map_thornpeak');
await page.keyboard.press('m');

console.log(errors.length ? 'PAGE ERRORS:\n' + errors.slice(0, 8).join('\n') : 'no page errors');
await browser.close();
