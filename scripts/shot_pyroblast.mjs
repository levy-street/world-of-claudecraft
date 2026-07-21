// Screenshot the mage Pyroblast ability in the offline client.
// Boots an offline mage, levels to 20 so Pyroblast is learned, stands a dummy
// target in front, casts the spell (capturing the long 6s cast bar and the
// fire DoT it leaves on the target), then opens the spellbook for its tooltip.
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
page.on('pageerror', (e) => console.log('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 400));
await page.type('#char-name', 'Pyra');
await page.evaluate(() => {
  const el = document.querySelector('#offline-select .mini-class[data-class="mage"]');
  if (el) el.click();
});
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

// Level to 20 (refreshes the known-ability cache), gm-survive the ambient loop,
// stand a passive dummy ~12yd ahead, target + face it, then start the cast.
const setup = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  sim.setPlayerLevel(20, p.id);
  p.gm = true;
  p.resource = p.maxResource;

  // Pick a mob out in open wilderness (a forest wolf) so line-of-sight is
  // clear — the town hub is cluttered with buildings. Move the PLAYER to it
  // rather than dragging the mob into terrain (mirrors the fireball sim test).
  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.templateId === 'forest_wolf') {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  if (!mob) { // fall back to any mob if no wolf is loaded
    for (const e of sim.entities.values()) {
      if (e.kind === 'mob' && !e.dead) {
        const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
        if (dd < d) { d = dd; mob = e; }
      }
    }
  }
  mob.name = 'Training Dummy';
  mob.level = 20;
  mob.hostile = true;           // a damage spell needs a hostile target...
  mob.maxHp = 5000; mob.hp = 5000;
  // ...but root it so it can't close to melee and push back the 6s cast.
  sim.applyAura(mob, {
    id: 'shot_root', name: 'Held', kind: 'root',
    remaining: 60, duration: 60, value: 1, sourceId: p.id, school: 'frost',
  });
  // Stand the player 12yd from the wolf at the wolf's ground height.
  p.pos.x = mob.pos.x - 12; p.pos.z = mob.pos.z; p.pos.y = mob.pos.y;
  p.prevPos = { ...p.pos }; p.vx = 0; p.vz = 0; p.vy = 0; p.onGround = true;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;

  sim.castAbility('pyroblast', p.id);
  return { casting: p.castingAbility, castTotal: p.castTotal, mobId: mob.id };
});
console.log('cast started:', JSON.stringify(setup));

// Mid-cast: the long 6s cast bar is the signature of the spell.
await new Promise((r) => setTimeout(r, 2600));
await page.screenshot({ path: 'tmp/pyroblast_cast.png' });

// Let the cast complete and the fire DoT land on the target.
await new Promise((r) => setTimeout(r, 6500));
const impact = await page.evaluate((mobId) => {
  const sim = window.__game.sim;
  const mob = sim.entities.get(mobId);
  const dot = mob?.auras?.find((a) => a.kind === 'dot');
  return { mobHp: mob?.hp, mobMaxHp: mob?.maxHp, hasDot: !!dot, dotName: dot?.name,
    auras: mob?.auras?.map((a) => a.kind) };
}, setup.mobId);
console.log('impact:', JSON.stringify(impact));
await page.screenshot({ path: 'tmp/pyroblast_impact.png' });

// Crop the target unit frame so the fire DoT debuff icon is legible.
const tf = await page.evaluate(() => {
  const el = document.querySelector('#target-frame');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
if (tf && tf.w > 0) {
  const pad = 24;
  await page.screenshot({
    path: 'tmp/pyroblast_target.png',
    clip: {
      x: Math.max(0, tf.x - pad), y: Math.max(0, tf.y - pad),
      width: tf.w + pad * 2, height: tf.h + pad * 2,
    },
  });
}

// Open the spellbook and hover the Pyroblast entry for its tooltip.
await page.evaluate(() => window.__game.hud.toggleSpellbook());
await new Promise((r) => setTimeout(r, 500));
const box = await page.evaluate(() => {
  const sb = document.querySelector('#spellbook');
  if (!sb) return null;
  // smallest element whose text is exactly the ability name
  let best = null;
  for (const el of sb.querySelectorAll('*')) {
    if (el.textContent && el.textContent.trim() === 'Pyroblast' &&
        (!best || el.textContent.length < best.textContent.length)) best = el;
  }
  if (best) {
    const r = best.getBoundingClientRect();
    return { hx: r.left + r.width / 2, hy: r.top + r.height / 2 };
  }
  const r = sb.getBoundingClientRect();
  return { hx: r.left + r.width / 2, hy: r.top + 40 };
});
if (box) {
  await page.mouse.move(box.hx, box.hy);
  await new Promise((r) => setTimeout(r, 500));
}
await page.screenshot({ path: 'tmp/pyroblast_spellbook.png' });

console.log('saved tmp/pyroblast_cast.png, pyroblast_impact.png, pyroblast_spellbook.png');
await browser.close();
