// Warlock pet E2E: Summon Imp auto-firebolts a wolf while the player idles;
// Summon Voidwalker (lvl 10) charges in, melees, and taunts like a hunter pet.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

let fail = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
  if (!cond) fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/project stats|404|Failed to load resource/i.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 30000 });
await page.click('#btn-offline');
await sleep(200);
await page.type('#char-name', 'Warlockname');
await page.click('#offline-select .mini-class[data-class="warlock"]');
await page.click('#btn-start-offline');
await sleep(1500);

// ---- Summon Imp unlocks at level 5 ----
await page.evaluate(() => { window.__game.sim.setPlayerLevel(5); });
const known = await page.evaluate(() => window.__game.sim.known.map((k) => k.def.id));
check('Summon Imp in warlock kit at lvl 5', known.includes('summon_imp'), known.join(','));

// summon the imp (3s cast) and confirm the pet appears
await page.evaluate(() => { window.__game.sim.player.resource = window.__game.sim.player.maxResource; });
let imp = null;
for (let i = 0; i < 40 && !imp; i++) {
  imp = await page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    if (!p.castingAbility && p.gcdRemaining <= 0 && !sim.petOf(p.id)) sim.castAbility('summon_imp');
    const pet = sim.petOf(p.id);
    return pet ? { id: pet.id, templateId: pet.templateId, hp: pet.hp } : null;
  });
  if (!imp) await sleep(400);
}
check('Summon Imp conjures a pet', !!imp && imp.templateId === 'warlock_imp', imp ? imp.templateId : 'none');

// pull a BEEFED wolf, then IDLE the player — only the imp fights. The imp should heel
// right at your side and Firebolt your target, so the wolf bleeds while you do nothing.
const wolfId = await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player;
  let wolf = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.templateId === 'forest_wolf' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; wolf = e; }
    }
  }
  wolf.maxHp = 4000; wolf.hp = 4000; // survive so the imp keeps firing at your side
  p.pos.x = wolf.pos.x + 10; p.pos.z = wolf.pos.z;
  p.resource = p.maxResource;
  sim.targetEntity(wolf.id);
  p.facing = Math.atan2(wolf.pos.x - p.pos.x, wolf.pos.z - p.pos.z);
  window.__game.input.camYaw = p.facing;
  sim.castAbility('shadow_bolt'); // one pull so the imp starts assisting
  return wolf.id;
});
await sleep(800);
const hpAtPull = await page.evaluate((id) => window.__game.sim.entities.get(id).hp, wolfId);

// player idles; wait until the imp is both DAMAGING the wolf and HEELED to your side.
let impEngaged = false, wolfHp = hpAtPull, impDist = 99;
for (let i = 0; i < 80; i++) {
  const s = await page.evaluate((id) => {
    const sim = window.__game.sim;
    const p = sim.player;
    p.hp = p.maxHp; p.autoAttack = false; // bystander
    const w = sim.entities.get(id);
    const pet = sim.petOf(p.id);
    return {
      whp: w ? w.hp : 0, wdead: !w || w.dead,
      petTarget: pet ? pet.aggroTargetId : null,
      petDist: pet ? Math.hypot(pet.pos.x - p.pos.x, pet.pos.z - p.pos.z) : 99,
    };
  }, wolfId);
  if (s.petTarget === wolfId) impEngaged = true;
  wolfHp = s.whp; impDist = s.petDist;
  if ((hpAtPull - wolfHp >= 10) && impDist <= 5) break; // damaging AND heeled close
  await sleep(500);
}
check('imp assists the owner (targets the wolf)', impEngaged);
check('imp auto-firebolts: wolf HP drops while player idles', hpAtPull - wolfHp >= 1, `pull=${Math.round(hpAtPull)} -> ${Math.round(wolfHp)}`);
check('imp heels close to the player (stands at your side)', impDist <= 5, `dist=${impDist.toFixed(1)}yd`);
await page.screenshot({ path: 'tmp/wl1_imp_firebolt.png' });

// ---- Summon Voidwalker at level 10 ----
await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(10);
  // shake aggro and move somewhere quiet before re-summoning
  const p = sim.player;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.aggroTargetId === p.id) { e.aiState = 'evade'; e.aggroTargetId = null; }
  }
  p.hp = p.maxHp; p.resource = p.maxResource;
});
const known10 = await page.evaluate(() => window.__game.sim.known.map((k) => k.def.id));
check('Summon Voidwalker known at lvl 10', known10.includes('summon_voidwalker'));

let vw = null;
for (let i = 0; i < 50 && !vw; i++) {
  vw = await page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    const pet = sim.petOf(p.id);
    if ((!pet || pet.templateId !== 'warlock_voidwalker') && !p.castingAbility && p.gcdRemaining <= 0) {
      sim.castAbility('summon_voidwalker');
    }
    const now = sim.petOf(p.id);
    return now && now.templateId === 'warlock_voidwalker' ? { id: now.id, maxHp: now.maxHp } : null;
  });
  if (!vw) await sleep(400);
}
check('Summon Voidwalker conjures the tank demon', !!vw, vw ? `maxHp=${vw.maxHp}` : 'none');

// engage a fresh wolf: the voidwalker should run in, melee, and Growl (taunt)
const wolf2 = await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player;
  let wolf = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.templateId === 'forest_wolf' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; wolf = e; }
    }
  }
  wolf.maxHp = 4000; wolf.hp = 4000; // survive long enough to observe the tank loop
  p.pos.x = wolf.pos.x + 8; p.pos.z = wolf.pos.z;
  p.resource = p.maxResource;
  sim.targetEntity(wolf.id);
  p.autoAttack = true; // wand the wolf so the pet reliably assists
  p.facing = Math.atan2(wolf.pos.x - p.pos.x, wolf.pos.z - p.pos.z);
  window.__game.input.camYaw = p.facing;
  sim.castAbility('shadow_bolt');
  return wolf.id;
});
let taunted = false, vwThreat = false;
for (let i = 0; i < 80 && !(taunted && vwThreat); i++) {
  const s = await page.evaluate((ids) => {
    const sim = window.__game.sim;
    const p = sim.player;
    p.hp = p.maxHp;
    const w = sim.entities.get(ids.wolf);
    if (w && !w.dead) { sim.targetEntity(w.id); p.autoAttack = true; }
    const pet = sim.petOf(p.id);
    return {
      forced: w ? w.forcedTargetId : null,
      wAggro: w ? w.aggroTargetId : null,
      petTarget: pet ? pet.aggroTargetId : null,
      petThreat: w && pet ? (w.threat.get(pet.id) ?? 0) : 0,
      petId: pet ? pet.id : null,
    };
  }, { wolf: wolf2 });
  if (s.petId && s.forced === s.petId) taunted = true;
  if (s.petThreat > 0) vwThreat = true;
  await sleep(500);
}
check('voidwalker builds its own threat', vwThreat);
check('voidwalker taunts (Growl): wolf forced onto the pet', taunted);
await page.screenshot({ path: 'tmp/wl2_voidwalker_tank.png' });

check('no page/console errors', errors.length === 0, errors.slice(0, 5).join(' || '));
console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
