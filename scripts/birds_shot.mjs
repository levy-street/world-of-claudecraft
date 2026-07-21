// Screenshots of the ambient bird flock (src/render/birds.ts) for the PR.
// Boots the offline world, looks up at the sky, and captures the flock drifting
// overhead. Needs `npm run dev` running. Browser via scripts/browser_path.mjs.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'tmp/birds';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.click('#btn-offline');
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Skylark');
await page.click('#offline-select .mini-class[data-class="hunter"]');
await page.click('#btn-start-offline');
await new Promise((r) => setTimeout(r, 3000));

// Open meadow on the vale plain, immortal photographer.
await page.evaluate(() => {
  const g = window.__game;
  const p = g.sim.player;
  p.maxHp = 99999; p.hp = 99999;
  p.pos.x = 0; p.pos.z = -40;
  p.facing = 0;
  g.input.camYaw = Math.PI;
  g.input.camPitch = -0.4; // pitch the orbit camera up toward the sky
});

// First: the flock as it naturally drifts overhead (lower pitch = more sky).
for (let i = 0; i < 4; i++) {
  await new Promise((r) => setTimeout(r, 1100));
  await page.screenshot({ path: `${OUT}/birds_drift_${i}.png` });
}

// Then a staged hero shot: freeze the flock (update is a reassignable closure)
// and arc a V-formation across the sky ahead of the camera so the silhouettes
// fill the frame for the still.
await page.evaluate(() => {
  const g = window.__game;
  const birds = g.renderer.birds;
  birds.update = () => {}; // freeze positions for the photo
  birds.group.visible = true;
  const kids = birds.group.children;
  const cam = g.renderer.camera;
  cam.updateMatrixWorld();
  // True forward from the camera, then a horizontal "right" perpendicular to it.
  const fwd = kids[0].position.clone();
  cam.getWorldDirection(fwd);
  const rl = Math.hypot(fwd.x, fwd.z) || 1;
  const rx = fwd.z / rl, rz = -fwd.x / rl; // right vector on the ground plane
  const cy = g.input.camYaw;
  kids.forEach((b, i) => {
    const rank = Math.ceil(i / 2);
    const side = i % 2 === 0 ? 1 : -1;
    const ahead = 26 + rank * 6;
    const lateral = side * rank * 7;
    b.position.set(
      cam.position.x + fwd.x * ahead + rx * lateral,
      cam.position.y + fwd.y * ahead + 10 + rank * 1.4, // lift above the look line
      cam.position.z + fwd.z * ahead + rz * lateral,
    );
    // Bank the flock gently toward the camera so the flat wings present some
    // span instead of being seen edge-on from the near-horizontal third-person
    // view; the flap then reads as a shallow V.
    b.rotation.set(0, cy + Math.PI, 0.55);
    b.scale.setScalar(1.7);
    b.children[0].rotation.z = 0.5;  // wings mid-flap
    b.children[1].rotation.z = -0.5;
  });
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${OUT}/birds_hero.png` });

await browser.close();
console.log('wrote screenshots to', OUT);
