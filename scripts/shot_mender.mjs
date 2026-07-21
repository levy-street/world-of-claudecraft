// Screenshot for the Gravecaller Mender support-heal mechanic (mendAlly).
// Drives the offline world, repurposes two nearby mobs into a Mender + a wounded
// ally right in front of the player, forces the Grave Mending cast, and captures
// the green heal floating-combat-text rising over the healed ally.
// Requires `npm run dev` on :5173.
//
// Usage: node scripts/shot_mender.mjs
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = 'http://localhost:5173/';
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

  // Offline flow: Play Offline → name → pick class → Start.
  await page.waitForSelector('#btn-offline', { timeout: 15000 });
  await page.evaluate(() => document.querySelector('#btn-offline').click());
  await page.waitForSelector('#char-name', { visible: true });
  await page.evaluate(() => {
    const n = document.querySelector('#char-name');
    n.value = 'Mendwatch';
    n.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.mini-class[data-class="priest"]')?.click();
  });
  await page.evaluate(() => document.querySelector('#btn-start-offline').click());
  await new Promise((r) => setTimeout(r, 3000));

  // Stage the scene: god-mode the player, repurpose two mobs into a Mender and a
  // wounded ally a few yards in front of the camera.
  await page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    p.hp = p.maxHp;
    const mobs = [...sim.entities.values()].filter((e) => e.kind === 'mob' && !e.dead);
    const fx = p.pos.x + Math.sin(p.facing) * 7;
    const fz = p.pos.z + Math.cos(p.facing) * 7;
    const ground = (x, z) => sim.groundPos(x, z);

    const mender = mobs[0];
    const ally = mobs[1];
    window.__mender = mender.id;
    window.__ally = ally.id;

    mender.templateId = 'gravecaller_mender';
    mender.name = 'Gravecaller Mender';
    Object.assign(mender.pos, ground(fx - 2, fz));
    mender.prevPos = { ...mender.pos };
    mender.hostile = true;

    ally.name = 'Gravecaller Cultist';
    Object.assign(ally.pos, ground(fx + 2, fz));
    ally.prevPos = { ...ally.pos };
    ally.hostile = true;
    ally.maxHp = 600;
  });

  // Force repeated Grave Mending casts so the green heal text is on screen,
  // re-wounding the ally each beat. Capture mid-rise.
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => {
      const sim = window.__game.sim;
      const mender = sim.entities.get(window.__mender);
      const ally = sim.entities.get(window.__ally);
      if (!mender || !ally) return;
      ally.hp = Math.round(ally.maxHp * 0.4); // keep it wounded so the mend has work to do
      mender.inCombat = true;
      mender.combatTimer = 0;
      mender.mendTimer = 0; // fire now
    });
    await new Promise((r) => setTimeout(r, 180));
  }

  // Fire one clean cast and grab the floating green heal numbers mid-rise.
  await page.evaluate(() => {
    const sim = window.__game.sim;
    const mender = sim.entities.get(window.__mender);
    const ally = sim.entities.get(window.__ally);
    if (mender && ally) { ally.hp = Math.round(ally.maxHp * 0.4); mender.inCombat = true; mender.mendTimer = 0; }
  });
  await new Promise((r) => setTimeout(r, 110));
  await page.screenshot({ path: `${OUT}/mender-heal-fct.png`, clip: { x: 430, y: 90, width: 470, height: 360 } });
  console.log('saved mender-heal-fct.png (heal numbers)');

  await new Promise((r) => setTimeout(r, 80));
  await page.screenshot({ path: `${OUT}/mender-heal.png` });
  console.log('saved mender-heal.png (full scene)');

  // Cropped close-up on the two actors + the rising green heal numbers.
  await page.screenshot({ path: `${OUT}/mender-heal-actors.png`, clip: { x: 430, y: 90, width: 470, height: 360 } });
  console.log('saved mender-heal-actors.png (close-up)');

  // Cropped on the combat log showing the repeated Grave Mending cast lines.
  await page.screenshot({ path: `${OUT}/mender-heal-log.png`, clip: { x: 8, y: 470, width: 560, height: 250 } });
  console.log('saved mender-heal-log.png (combat log)');
} finally {
  await browser.close();
}
