// Screenshot the Bound Guardian re-summon fix (max graphics, ?gfx=ultra) in the
// offline client. Boots the game, places the player on the crypt ritual circle
// with the quest active and the Crypt Keystone in hand, summons the guardian,
// force-despawns it as the idle-despawn would (leash/wipe), then re-uses the
// ritual circle to prove a fresh guardian is summoned and the kill stays
// reachable. Captures the re-summoned boss and its elite target frame.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = (process.env.GAME_URL ?? 'http://localhost:5173') + '/?gfx=ultra';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Brannok');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => !!window.__game && !!window.__game.sim, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));

const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  p.maxHp = 100000; p.hp = 100000;

  const ritual = [...sim.entities.values()].find((e) => e.kind === 'object' && e.objectItemId === 'crypt_ritual_circle');
  const to = (x, z) => { p.pos.x = x; p.pos.z = z; p.prevPos = { ...p.pos }; };
  to(ritual.pos.x, ritual.pos.z);

  sim.questLog.set('q_nythraxis_bound_guardian', { questId: 'q_nythraxis_bound_guardian', counts: [0, 0, 0], state: 'active' });
  sim.addItem('crypt_keystone', 1);

  // First summon, then simulate the idle-despawn that previously stranded the quest.
  sim.pickUpObject(ritual.id);
  const first = [...sim.entities.values()].find((e) => e.templateId === 'bound_guardian' && !e.dead);
  sim.entities.delete(first.id);
  const goneAfterDespawn = ![...sim.entities.values()].some((e) => e.templateId === 'bound_guardian' && !e.dead);

  // Re-use the ritual circle: with the fix, a fresh guardian is summoned even
  // though the interact objective (counts[0]) is already satisfied.
  to(ritual.pos.x, ritual.pos.z);
  sim.pickUpObject(ritual.id);
  const guardian = [...sim.entities.values()].find((e) => e.templateId === 'bound_guardian' && !e.dead);

  // Frame the re-summoned boss for the shot.
  guardian.pos.x = p.pos.x + 6; guardian.pos.z = p.pos.z;
  sim.targetEntity(guardian.id);
  p.facing = Math.atan2(guardian.pos.x - p.pos.x, guardian.pos.z - p.pos.z);
  g.input.camYaw = p.facing;

  return {
    interactCount: sim.questLog.get('q_nythraxis_bound_guardian').counts[0],
    keystone: sim.countItem('crypt_keystone', sim.playerId),
    goneAfterDespawn,
    resummoned: !!guardian,
    name: guardian?.name,
    level: guardian?.level,
  };
});
console.log('bound_guardian resummon:', JSON.stringify(result));

await new Promise((r) => setTimeout(r, 1000));
await page.screenshot({ path: 'tmp/bound_guardian_resummon_full.png' });

const box = await page.evaluate(() => {
  const el = document.querySelector('#target-frame');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
if (box) {
  const pad = 18;
  await page.screenshot({
    path: 'tmp/bound_guardian_resummon_targetframe.png',
    clip: {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: box.w + pad * 2, height: box.h + pad * 2,
    },
  });
}

console.log('saved tmp/bound_guardian_resummon_full.png, tmp/bound_guardian_resummon_targetframe.png');
await browser.close();
