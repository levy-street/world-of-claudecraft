// Screenshot for Mogger's wardAllies support mechanic (Bracing Order).
// Drives the offline world, repurposes nearby mobs into Mogger + two lackeys in
// front of the player, forces the Bracing Order ward, and captures the scene,
// the target frame, and the combat log showing the crew being shielded.
// Requires `npm run dev` (pass GAME_URL if it landed on another port).
//
// Usage: node scripts/shot_ward_allies.mjs
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL || 'http://localhost:5173/';
const OUT = 'tmp/shots';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle2' });

  // Offline flow: Play Offline → name → Start (warrior auto-selected).
  await page.waitForSelector('#btn-offline', { timeout: 15000 });
  await page.evaluate(() => document.querySelector('#btn-offline').click());
  await page.waitForSelector('#char-name', { visible: true });
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => {
    const n = document.querySelector('#char-name');
    n.value = 'Wardwatch';
    n.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => document.querySelector('#btn-start-offline').click());
  await new Promise((r) => setTimeout(r, 3000));

  // Stage: god-mode player; reskin three mobs into Mogger + two lackeys, lined
  // up a few yards in front of the camera, and target Mogger for the frame.
  await page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    p.gm = true;
    p.hp = p.maxHp;
    // Relocate to a clear field away from the town hub so the shot isn't
    // cluttered with friendly NPCs.
    Object.assign(p.pos, sim.groundPos(80, 60));
    p.prevPos = { ...p.pos };
    p.facing = 0;
    const mobs = [...sim.entities.values()].filter((e) => e.kind === 'mob' && !e.dead);
    const fx = p.pos.x + Math.sin(p.facing) * 8;
    const fz = p.pos.z + Math.cos(p.facing) * 8;
    const ground = (x, z) => sim.groundPos(x, z);

    const mogger = mobs[0];
    window.__mogger = mogger.id;
    mogger.templateId = 'mogger';
    mogger.name = 'Mogger';
    mogger.level = 6;
    Object.assign(mogger.pos, ground(fx, fz));
    mogger.prevPos = { ...mogger.pos };
    mogger.hostile = true;

    window.__lackeys = [];
    for (let i = 1; i <= 2; i++) {
      const l = mobs[i];
      if (!l) break;
      l.templateId = 'mogger_lackey';
      l.name = 'Mogger Lackey';
      l.level = 6;
      Object.assign(l.pos, ground(fx + (i === 1 ? -3 : 3), fz - 1));
      l.prevPos = { ...l.pos };
      l.hostile = true;
      window.__lackeys.push(l.id);
    }
    // Declutter: banish every other mob far away so only the crew is in frame.
    const crew = new Set([mogger.id, ...window.__lackeys]);
    for (const e of sim.entities.values()) {
      if (e.kind === 'mob' && !crew.has(e.id)) { e.pos.x += 100000; e.prevPos = { ...e.pos }; }
    }
    // Target Mogger so the target frame names the warding boss.
    p.targetId = mogger.id;
    if (window.__game.hud?.setTarget) window.__game.hud.setTarget(mogger.id);
  });

  // Force the Bracing Order ward to fire repeatedly so the absorb is fresh on
  // the crew and the combat-log lines accumulate.
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => {
      const sim = window.__game.sim;
      const mogger = sim.entities.get(window.__mogger);
      if (!mogger) return;
      mogger.inCombat = true;
      mogger.combatTimer = 0;
      mogger.wardTimer = 0.001; // fire now
      sim.updateBossMechanics(mogger);
    });
    await new Promise((r) => setTimeout(r, 160));
  }

  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: `${OUT}/ward_scene.png` });
  console.log('saved ward_scene.png (full scene)');

  // Cropped close-up on Mogger + lackeys (the shielded crew).
  await page.screenshot({ path: `${OUT}/ward_actors.png`, clip: { x: 420, y: 110, width: 480, height: 360 } });
  console.log('saved ward_actors.png (close-up)');

  // Cropped on the combat log showing the Bracing Order ward lines.
  await page.screenshot({ path: `${OUT}/ward_log.png`, clip: { x: 8, y: 470, width: 580, height: 250 } });
  console.log('saved ward_log.png (combat log)');
} finally {
  await browser.close();
}
