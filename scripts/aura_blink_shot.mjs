// Visual proof of the expiring-aura blink. Enters the offline game via the
// shared enterOfflineGame helper, applies one long buff plus a nearly-expired
// buff on the player and a nearly-expired DoT on a targeted mob, then captures
// the HUD twice mid-blink (bright and dim phases) so the PR shows the flash
// without a video.
//   node scripts/aura_blink_shot.mjs [suffix]   (needs `npm run dev`)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const SUFFIX = process.argv[2] ?? 'after';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Blinky' });

// One steady long buff, one expiring buff on the player, one expiring DoT on a
// targeted mob, applied directly so the shot is deterministic.
await page.evaluate(() => {
  const sim = window.__game.sim;
  const p = sim.player;
  sim.applyAura(p, {
    id: 'battle_shout',
    name: 'Battle Shout',
    kind: 'buff_ap',
    remaining: 110,
    duration: 120,
    value: 30,
    sourceId: p.id,
    school: 'physical',
  });
  sim.applyAura(p, {
    id: 'shield_block',
    name: 'Shield Block',
    kind: 'buff_ap',
    remaining: 8,
    duration: 30,
    value: 10,
    sourceId: p.id,
    school: 'physical',
  });
  const mob = [...sim.entities.values()].find((e) => e.kind === 'mob' && !e.dead);
  sim.applyAura(mob, {
    id: 'rend',
    name: 'Rend',
    kind: 'dot',
    remaining: 8,
    duration: 30,
    value: 5,
    tickInterval: 3,
    sourceId: p.id,
    school: 'physical',
  });
  sim.targetEntity(mob.id, p.id);
});
await new Promise((r) => setTimeout(r, 700));

const probe = await page.evaluate(() => {
  // Dismiss any perf/GPU toast so it never overlays the capture.
  for (const el of document.querySelectorAll('.toast, .perf-warning, [data-dismiss]')) el.remove();
  const rect = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, r.x - 8),
      y: Math.max(0, r.y - 8),
      width: r.width + 16,
      height: r.height + 16,
    };
  };
  return {
    expiring: document.querySelectorAll('.buff.expiring').length,
    total: document.querySelectorAll('.buff').length,
    target: rect('#tf-debuffs'),
    buffs: rect('#buff-bar'),
  };
});
console.log('probe:', JSON.stringify({ expiring: probe.expiring, total: probe.total }));

// Two captures ~0.4s apart land on opposite blink phases (0.8s cycle), tightly
// clipped to the target frame (debuff strip) and the player buff bar.
// Force each phase deterministically: pause the animation at 0% (bright) then
// at its midpoint (dim) via an injected style, so the stills never race the clock.
const phase = async (css) =>
  page.evaluate((rules) => {
    let el = document.querySelector('#blink-shot-style');
    if (!el) {
      el = document.createElement('style');
      el.id = 'blink-shot-style';
      document.head.appendChild(el);
    }
    el.textContent = rules;
  }, css);
for (const [name, clip] of [
  ['target', probe.target],
  ['buffs', probe.buffs],
]) {
  if (!clip || clip.width < 4) continue;
  const wide = { ...clip, width: Math.max(clip.width, 140) };
  await phase(
    '.buff.expiring { animation-play-state: paused !important; animation-delay: 0s !important; }',
  );
  await new Promise((r) => setTimeout(r, 150));
  await page.screenshot({ path: `tmp/aura-blink-${SUFFIX}-${name}-bright.png`, clip: wide });
  await phase(
    '.buff.expiring { animation-play-state: paused !important; animation-delay: -0.4s !important; }',
  );
  await new Promise((r) => setTimeout(r, 150));
  await page.screenshot({ path: `tmp/aura-blink-${SUFFIX}-${name}-dim.png`, clip: wide });
}
await phase('');
console.log(`wrote tmp/aura-blink-${SUFFIX}-{target,buffs}-{bright,dim}.png`);

await browser.close();
process.exit(0);
