// Talent-moment VFX previews for PR #1614: trigger each of the four new
// spellfx moments (procSurge, wardBloom, echoBurst, detonate) on a live
// offline client and capture a rapid burst of frames while the particles and
// light pulse are mid-flight. Writes docs/screenshots/fx-<moment>-<n>.png.
//
// Reuses the boot/row/target idioms from scripts/row_shots_matrix.mjs (which
// itself encodes the playtest gotchas). Run with `npm run dev` up.
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const SHOT_DIR = 'docs/screenshots';
const PROFILE = `/private/tmp/woc-fx-previews-${process.pid}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(SHOT_DIR, { recursive: true });
mkdirSync(PROFILE, { recursive: true });

async function boot(page, cls, name) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForSelector('#btn-offline', { timeout: 120000 });
  // #btn-offline exists BEFORE main.ts hydrates: click-and-poll until the panel opens.
  let open = false;
  for (let i = 0; i < 60 && !open; i++) {
    await page.evaluate(() => document.querySelector('#btn-offline')?.click());
    try {
      await page.waitForSelector('#char-name', { visible: true, timeout: 2000 });
      open = true;
    } catch {
      /* still booting */
    }
  }
  if (!open) throw new Error('offline panel never opened');
  await page.type('#char-name', name);
  await page.evaluate((klass) => {
    document.querySelector(`#offline-select .mini-class[data-class="${klass}"]`)?.click();
  }, cls);
  await sleep(250);
  await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
  await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 240000, polling: 500 });
  await sleep(1200);
  await page.keyboard.press('Escape'); // skip intro cinematic
  await sleep(500);
}

async function prep(page, rows) {
  return page.evaluate((rowPicks) => {
    const sim = window.__game.sim;
    sim.setPlayerLevel(20);
    const ok = sim.applyTalents({ spec: null, rows: rowPicks });
    const p = sim.player;
    p.hp = p.maxHp;
    p.resource = p.maxResource;
    return ok;
  }, rows);
}

async function target(page) {
  return page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    const mobs = [...sim.entities.values()].filter((e) => e.kind === 'mob' && !e.dead);
    mobs.sort(
      (a, b) =>
        (a.pos.x - p.pos.x) ** 2 +
        (a.pos.z - p.pos.z) ** 2 -
        ((b.pos.x - p.pos.x) ** 2 + (b.pos.z - p.pos.z) ** 2),
    );
    const mob = mobs[0];
    if (!mob) return false;
    p.pos.x = mob.pos.x - 4;
    p.pos.z = mob.pos.z;
    p.targetId = mob.id;
    p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
    mob.hp = mob.maxHp = 100000;
    return true;
  });
}

async function cast(page, id) {
  return page.evaluate((abilityId) => {
    const sim = window.__game.sim;
    const p = sim.player;
    p.resource = p.maxResource;
    p.gcdRemaining = 0;
    if (p.cooldowns?.clear) p.cooldowns.clear();
    sim.castAbility(abilityId);
  }, id);
}

async function waitCastDone(page, ms = 3500) {
  await page
    .waitForFunction(() => window.__game.sim.player.castingAbility === null, { timeout: ms })
    .catch(() => {});
}

async function burst(page, tag) {
  for (let i = 0; i < 4; i++) {
    await page.screenshot({ path: `${SHOT_DIR}/fx-${tag}-${i + 1}.png` });
    await sleep(120);
  }
  console.log(`shot fx-${tag}-{1..4}.png`);
}

async function zoomIn(page, clicks = 6) {
  // wheel-zoom the chase camera in so the character fills more of the frame
  await page.mouse.move(800, 450);
  for (let i = 0; i < clicks; i++) {
    await page.mouse.wheel({ deltaY: -240 });
    await sleep(80);
  }
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    userDataDir: PROFILE,
    args: ['--window-size=1600,900', '--no-sandbox'],
    defaultViewport: { width: 1600, height: 900 },
  });
  const page = await browser.newPage();

  // ---- priest: procSurge (Searing Light), wardBloom (Inner Fire), echoBurst
  await boot(page, 'priest', 'Fxpriest');
  await prep(page, {
    5: 'pri_r5_searing_light',
    14: 'pri_r14_greater_heal',
    17: 'pri_r17_inner_fire',
  });
  if (!(await target(page))) throw new Error('no mob near priest spawn');
  await zoomIn(page);

  // procSurge: three completed Smites, shoot the instant the charge aura lands.
  for (let i = 0; i < 3; i++) {
    await cast(page, 'smite');
    await waitCastDone(page);
    await sleep(150);
  }
  await burst(page, 'procsurge');

  // wardBloom: a single hit above 15% max hp triggers the Inner Fire ward.
  await page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    sim.dealDamage(null, p, Math.round(p.maxHp * 0.25), false, 'physical', null, 'hit');
  });
  await burst(page, 'wardbloom');

  // echoBurst: Solemn Prayer leaves the echo; a crash below 35% fires it.
  await page.evaluate(() => {
    const p = window.__game.sim.player;
    p.hp = Math.round(p.maxHp * 0.6);
  });
  await cast(page, 'heal');
  await waitCastDone(page, 5000);
  await sleep(200);
  await page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    sim.dealDamage(null, p, Math.round(p.maxHp * 0.5), false, 'physical', null, 'hit');
  });
  await burst(page, 'echoburst');

  // ---- shaman: detonate (Earthen Jolt eats Cinder Jolt)
  const page2 = await browser.newPage();
  await boot(page2, 'shaman', 'Fxshaman');
  await prep(page2, { 14: 'sha_r14_improved_flame_shock' });
  if (!(await target(page2))) throw new Error('no mob near shaman spawn');
  await zoomIn(page2);
  await cast(page2, 'flame_shock');
  await sleep(600);
  const hadDot = await page2.evaluate(() => {
    const sim = window.__game.sim;
    const mob = sim.entities.get(sim.player.targetId);
    return !!mob?.auras.some((a) => a.kind === 'dot');
  });
  console.log('flame_shock dot on target:', hadDot);
  await cast(page2, 'earth_shock'); // cooldowns cleared inside cast()
  await sleep(80);
  await burst(page2, 'detonate');

  await browser.close();
  console.log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
