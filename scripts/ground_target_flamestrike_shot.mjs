// Functional validation for PR #1064's ground-targeted casting, driven through
// the REAL client chain: boots the offline game as a mage, levels to 20 (learns
// Flamestrike), targets the nearest hostile mob, casts through the HUD slot
// routing (hud.castSlot -> castAbilityAt -> sim), then asserts the ground zone
// spawned at the mob's spot, the mob took zone damage, and screenshots the
// burning zone. Needs `npm run dev` on :5173 (or GAME_URL).
//
// Env: GAME_URL (default http://localhost:5173), SHOT_PREFIX (default
// ground_target). Exits non-zero on any failed assertion.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const PREFIX = process.env.SHOT_PREFIX ?? 'ground_target';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => {
  pageErrors.push(e.message);
  console.log('PAGEERROR:', e.message);
});
await page.bringToFront();

const jsClick = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

// first load pays the cold vite transform, allow up to 3 minutes
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await jsClick('#btn-offline');
await sleep(400);
await page.waitForSelector('#char-name', { timeout: 30000 });
await page.type('#char-name', 'Pyro');
await jsClick('#offline-select .mini-class[data-class="mage"]');
await sleep(300);
await jsClick('#btn-start-offline');
await page.bringToFront();
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60000 });
await sleep(1500);

const result = await page.evaluate(async () => {
  const g = window.__game;
  const sim = g.sim;
  const sleepIn = (ms) => new Promise((r) => setTimeout(r, ms));

  sim.setPlayerLevel(20);
  await sleepIn(300);
  const me = sim.player;

  // Flamestrike must be known at 20.
  const known = sim.known?.find?.((k) => k.def.id === 'flamestrike');
  if (!known) return { fail: 'flamestrike not in known abilities at level 20' };

  // Nearest living hostile mob.
  let mob = null;
  let best = Infinity;
  for (const e of sim.entities.values()) {
    if (e.id === me.id || e.dead || !e.hostile) continue;
    const d = Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z);
    if (d < best) {
      best = d;
      mob = e;
    }
  }
  if (!mob) return { fail: 'no hostile mob found near spawn' };
  sim.targetEntity(mob.id);
  const mobHp0 = mob.hp;
  const aimWant = { x: mob.pos.x, z: mob.pos.z };

  // Cast through the HUD slot routing when Flamestrike is on the bar (the real
  // button path); otherwise through the IWorld seam the HUD uses underneath.
  let path = 'castAbilityAt (IWorld seam)';
  let slot = -1;
  for (let i = 1; i <= 22; i++) {
    const res = g.hud.abilityForSlot?.(i);
    if (res?.def?.id === 'flamestrike') {
      slot = i;
      break;
    }
  }
  if (slot > 0) {
    path = `hud.castSlot(${slot})`;
    g.hud.castSlot(slot);
  } else {
    sim.castAbilityAt('flamestrike', aimWant);
  }
  // Flamestrike is an instant ground cast: on success it resolves this tick and
  // arms the GCD; a cast-time version would set castingAbility instead.
  const started = me.castingAbility === 'flamestrike' || me.gcdRemaining > 0;
  if (!started) {
    const errs = (sim.drainEvents?.() ?? []).filter((e) => e.type === 'error');
    return {
      fail: 'cast did not fire (no cast bar, no gcd)',
      path,
      errors: errs.map((e) => e.text),
    };
  }
  const castTotal = me.castTotal;

  // Ride out any cast time plus a couple of seconds of zone ticks.
  await sleepIn((castTotal + 2.5) * 1000);
  const zones = (sim.groundAoEs ?? []).map((z) => ({
    x: z.x ?? z.pos?.x,
    z: z.z ?? z.pos?.z,
    name: z.name ?? z.ability ?? 'zone',
  }));
  // The sim clamps the aim to the ability's range from the caster, so the zone
  // must sit within range of the cast spot AND closer to the aim than the
  // caster was (i.e. clamped along the aim line, or exactly at the aim when in
  // range). A zone at the caster's feet with a distant aim would fail this.
  const range = known.def.range;
  const zoneOk =
    zones.find((z) => {
      const fromCaster = Math.hypot(z.x - me.pos.x, z.z - me.pos.z);
      const toAim = Math.hypot(z.x - aimWant.x, z.z - aimWant.z);
      return fromCaster <= range + 0.5 && toAim < best - 0.5;
    }) ?? null;
  await sleepIn(1500);
  return {
    path,
    castTotal,
    range,
    mobDist: Math.round(best * 10) / 10,
    zones,
    zoneOk,
    mobHp0,
    mobHp1: mob.hp,
    mobDamaged: mob.hp < mobHp0,
  };
});

console.log(JSON.stringify(result, null, 2));
await page.screenshot({ path: `tmp/${PREFIX}_flamestrike.png` });
console.log(`shot: tmp/${PREFIX}_flamestrike.png`);
await browser.close();

if (result.fail) {
  console.error('FAIL:', result.fail);
  process.exit(1);
}
if (!result.zoneOk) {
  console.error('FAIL: no ground zone within range of the caster along the aim line', result.zones);
  process.exit(1);
}
if (!result.mobDamaged) {
  console.error('FAIL: mob took no damage from the zone');
  process.exit(1);
}
if (pageErrors.length) {
  console.error('FAIL: page errors during run', pageErrors);
  process.exit(1);
}
console.log(
  `PASS: Flamestrike via ${result.path}, zone clamped to range ${result.range} toward the aim (mob at ${result.mobDist}yd), mob ${result.mobHp0} -> ${result.mobHp1}`,
);
