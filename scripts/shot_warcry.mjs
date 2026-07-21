// Screenshot for the Deepfen Snapper ally-haste mechanic (warcry / Tide Cadence).
// Drives the offline world, repurposes three nearby mobs into a murloc school in
// front of the player, forces the Tide Cadence pulse, and captures the buffed
// pack, the combat log, and a snapper's target frame carrying the haste buff.
// Requires `npm run dev` (pass GAME_URL if it landed off :5173).
//
// Usage: node scripts/shot_warcry.mjs
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

  // Offline flow: Play Offline (auto-selects warrior) → name → Start.
  await page.waitForSelector('#btn-offline', { timeout: 15000 });
  await page.evaluate(() => document.querySelector('#btn-offline').click());
  await page.waitForSelector('#char-name', { visible: true });
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => {
    const n = document.querySelector('#char-name');
    n.value = 'Tidewatch';
    n.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => document.querySelector('#btn-start-offline').click());
  await new Promise((r) => setTimeout(r, 3000));

  // Stage the scene: god-mode the player, repurpose three mobs into a Deepfen
  // murloc school clustered a few yards in front of the camera.
  await page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    p.gm = true;
    p.hp = p.maxHp;
    const mobs = [...sim.entities.values()].filter((e) => e.kind === 'mob' && !e.dead);
    const fx = p.pos.x + Math.sin(p.facing) * 7;
    const fz = p.pos.z + Math.cos(p.facing) * 7;
    const ground = (x, z) => sim.groundPos(x, z);
    const offsets = [[-2.5, 0], [2.5, 0.5], [0, 2.5]];
    window.__school = [];
    for (let i = 0; i < 3 && i < mobs.length; i++) {
      const m = mobs[i];
      m.templateId = 'deepfen_murloc';
      m.name = 'Deepfen Snapper';
      m.level = 9;
      Object.assign(m.pos, ground(fx + offsets[i][0], fz + offsets[i][1]));
      m.prevPos = { ...m.pos };
      m.hostile = true;
      m.inCombat = true;
      m.combatTimer = 0;
      window.__school.push(m.id);
    }
    // Target the lead snapper so its target frame (and buff) is on screen.
    p.targetId = window.__school[0];
    if (window.__game.input) window.__game.input.targetId = window.__school[0];
  });

  // Drive several Tide Cadence pulses so the whole school carries the haste buff.
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => {
      const sim = window.__game.sim;
      for (const id of window.__school) {
        const m = sim.entities.get(id);
        if (!m) continue;
        m.inCombat = true;
        m.warcryTimer = 0; // fire the pulse now
        sim.updateBossMechanics?.(m) ?? sim['updateBossMechanics'](m);
      }
    });
    await new Promise((r) => setTimeout(r, 160));
  }

  // Report the applied auras as proof.
  const proof = await page.evaluate(() => {
    const sim = window.__game.sim;
    return window.__school.map((id) => {
      const m = sim.entities.get(id);
      const a = m?.auras.find((x) => x.id === 'warcry_deepfen_murloc');
      return { name: m?.name, haste: a ? a.value : null, remaining: a ? Math.round(a.remaining * 10) / 10 : null };
    });
  });
  console.log('Tide Cadence auras:', JSON.stringify(proof));

  await new Promise((r) => setTimeout(r, 120));
  await page.screenshot({ path: `${OUT}/warcry-scene.png` });
  console.log('saved warcry-scene.png (full scene — the buffed murloc school)');

  await page.screenshot({ path: `${OUT}/warcry-actors.png`, clip: { x: 420, y: 90, width: 470, height: 360 } });
  console.log('saved warcry-actors.png (close-up on the school)');

  // Combat log showing the repeated "channels Tide Cadence" lines.
  await page.screenshot({ path: `${OUT}/warcry-log.png`, clip: { x: 8, y: 470, width: 560, height: 250 } });
  console.log('saved warcry-log.png (combat log)');

  // Target frame of the lead snapper (top-left), which carries the haste buff.
  await page.screenshot({ path: `${OUT}/warcry-targetframe.png`, clip: { x: 0, y: 0, width: 420, height: 150 } });
  console.log('saved warcry-targetframe.png (target frame)');
} finally {
  await browser.close();
}
