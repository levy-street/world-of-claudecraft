// Screenshot script for the Expose affix (Cracked Guard).
// Boots the offline client, parks a warrior next to a Varkas Boneguard, forces
// its on-hit Expose proc, and captures the red Cracked Guard debuff on the
// player frame plus a cropped close-up. Needs `npm run dev` on :5173.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Highwatch');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 1500));

// Level up so the lvl18-19 Boneguard isn't trivially out of band, god-mode the
// player so they survive the swings, and force the Expose proc to 100%.
const setup = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  sim.setPlayerLevel(20);
  const p = sim.player;
  p.maxHp = 1e5; p.hp = 1e5;

  // Varkas Boneguards only exist as Marrowlord Varkas's summoned adds, so find
  // the Marrowlord (a rare in a static camp) and call up a real Boneguard.
  let boss = null;
  for (const e of sim.entities.values()) {
    if (e.templateId === 'marrowlord_varkas' && !e.dead) { boss = e; break; }
  }
  if (!boss) return { found: false };
  // teleport beside the Marrowlord, then summon one authentic Boneguard
  p.pos.x = boss.pos.x + 8; p.pos.z = boss.pos.z; p.pos.y = boss.pos.y;
  boss.aggroTargetId = p.id;
  sim.spawnBossAdds(boss, 'varkas_boneguard', 1);
  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.templateId === 'varkas_boneguard' && !e.dead) {
      const dd = Math.hypot(e.pos.x - boss.pos.x, e.pos.z - boss.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  if (!mob) return { found: false };
  // hide the boss so only the Boneguard frames in the shot, park the player ~6yd off
  boss.pos.x = boss.pos.x - 40;
  p.pos.x = mob.pos.x + 6; p.pos.z = mob.pos.z + 2; p.pos.y = mob.pos.y;
  return { found: true, mobId: mob.id };
});

if (!setup.found) {
  console.log('could not summon a varkas_boneguard from Marrowlord Varkas — FAIL');
  await browser.close();
  process.exit(1);
}

// Drive swings until Cracked Guard lands. The affix is a real 25% proc shipped
// on the Boneguard, so ~120 swings makes it virtually certain — no need to mutate
// the live template (which the sim closes over privately).
const applied = await page.evaluate(async (mobId) => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  const mob = sim.entities.get(mobId);
  let ok = false;
  for (let i = 0; i < 120 && !ok; i++) {
    sim.mobSwing(mob, p);
    ok = p.auras.some((a) => a.kind === 'expose');
    await new Promise((r) => setTimeout(r, 20));
  }
  // pin the Boneguard a few yards directly in front of the player and stop it
  // wandering, then aim the third-person camera down that line.
  mob.pos.x = p.pos.x; mob.pos.z = p.pos.z + 5; mob.pos.y = p.pos.y;
  mob.aiState = 'idle'; mob.aggroTargetId = null;
  if (mob.vel) { mob.vel.x = 0; mob.vel.z = 0; }
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  g.input.camDist = 8;
  if ('camPitch' in g.input) g.input.camPitch = 0.18;
  sim.targetEntity(mob.id);
  return ok;
}, setup.mobId);

await new Promise((r) => setTimeout(r, 800));
console.log('Cracked Guard applied to player:', applied ? 'OK' : 'FAIL');

await page.screenshot({ path: 'tmp/expose_full.png' });
// close-up of the player's buff bar (top-right) where Cracked Guard shows as a
// red-bordered debuff with its countdown.
await page.screenshot({ path: 'tmp/expose_debuff.png', clip: { x: 1330, y: 2, width: 270, height: 96 } });

console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 10).join('\n') : 'no page errors');
await browser.close();
