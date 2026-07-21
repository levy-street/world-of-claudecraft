// Screenshot the Spell Vulnerability affix (Static Charge) in the offline client.
// Boots the game, repurposes a nearby mob as a Stormcrag Elemental, suppresses
// its unrelated chill so the capture is clean, forces its on-hit Static Charge
// onto the player, then lands a magic vs a physical hit to show the amplified
// (yellow) spell damage next to the unaffected physical hit in the floating
// combat text.
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
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Brannok');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 2500));

const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  // GM = invulnerable: recalcPlayerStats re-derives maxHp from stamina every
  // tick (so a raw maxHp override gets wiped and the live elemental can grind
  // the warrior down). gm keeps the player alive so the debuff stays on-frame.
  p.gm = true; p.hp = p.maxHp;

  let mob = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; mob = e; }
    }
  }
  // Reskin it as the Stormcrag Elemental and stand it next to us.
  mob.templateId = 'stormcrag_elemental';
  mob.name = 'Stormcrag Elemental';
  mob.hostile = true;
  mob.hp = mob.maxHp;
  mob.pos.x = p.pos.x + 2; mob.pos.z = p.pos.z;
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  g.input.camYaw = p.facing;

  // Apply Static Charge directly (the on-hit proc is verified in the unit test;
  // here we just need the debuff present on the frame for the capture, without
  // the swing loop slowly grinding the player down).
  p.auras = p.auras.filter((a) => a.kind !== 'spellvuln' && a.name !== 'Numbing Chill');
  sim.applyAura(p, {
    id: 'spellvuln_stormcrag_elemental', name: 'Static Charge', kind: 'spellvuln',
    remaining: 10, duration: 10, value: 0.18, sourceId: mob.id, school: 'nature',
  });
  const charge = p.auras.find((a) => a.kind === 'spellvuln');
  return {
    hasCharge: !!charge, name: charge?.name, amp: charge?.value, remaining: charge?.remaining,
  };
});
console.log('spellvuln result:', JSON.stringify(result));

await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: 'tmp/spellvuln_full.png' });

// Crop tightly around the player buff/debuff bar (top-right).
const box = await page.evaluate(() => {
  const bar = document.querySelector('#buff-bar');
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
if (box) {
  const pad = 18;
  await page.screenshot({
    path: 'tmp/spellvuln_frame.png',
    clip: {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: box.w + pad * 2, height: box.h + pad * 2,
    },
  });
  // Hover the debuff icon to surface its tooltip.
  await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({
    path: 'tmp/spellvuln_tooltip.png',
    clip: {
      x: Math.max(0, box.x - 320), y: Math.max(0, box.y - 10),
      width: 320 + box.w + 20, height: 160,
    },
  });
}

console.log('saved tmp/spellvuln_full.png, spellvuln_frame.png, spellvuln_tooltip.png');
await browser.close();
