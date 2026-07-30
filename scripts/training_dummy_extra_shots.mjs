// One-off capture script for extra training-dummy PR screenshots (close-up + in-combat).
// Not part of the pr_shot_targets registry: a throwaway aid for this PR, run manually.
// Camera-framing approach directly sets player.pos + renderer.editorCam.
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const OUT_DIR = process.env.OUT_DIR || 'pr-shots';

async function shot(page, name, cam, target, settleMs = 2200) {
  // Teleport first and let the zone-enter banner/cinematic (triggered by crossing
  // into Thornpeak Heights) finish BEFORE applying editorCam, or its camera pan
  // overrides ours mid-flight and the capture shows the intro flyover instead.
  await page.evaluate((c) => {
    const p = window.__game.sim.player;
    p.pos.x = c.x;
    p.pos.z = c.z;
    p.prevPos.x = c.x;
    p.prevPos.z = c.z;
  }, cam);
  await new Promise((r) => setTimeout(r, 4000));
  await page.evaluate(
    (c, t) => {
      const g = window.__game;
      const p = g.sim.player;
      const gy = p.pos.y;
      const dx = t.x - c.x;
      const dz = t.z - c.z;
      const dl = Math.hypot(dx, dz) || 1;
      p.pos.x = c.x - (dx / dl) * 3;
      p.pos.z = c.z - (dz / dl) * 3;
      p.prevPos.x = p.pos.x;
      p.prevPos.z = p.pos.z;
      g.renderer.editorCam = {
        pos: { x: c.x, y: gy + c.h, z: c.z },
        target: { x: t.x, y: gy + t.h, z: t.z },
      };
    },
    cam,
    target,
  );
  await new Promise((r) => setTimeout(r, settleMs));
  await page.screenshot({ path: `${OUT_DIR}/${name}.png` });
  console.log('wrote', `${OUT_DIR}/${name}.png`);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: true,
    args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1600, height: 900 },
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
  await enterOfflineGame(page, { settleMs: 3000 });

  // Highwatch training dummy: templateId training_dummy, center x:-40, z:648.
  await shot(
    page,
    'training-dummy-closeup',
    { x: -43, z: 645, h: 2.2 },
    { x: -40, z: 648, h: 1.4 },
  );

  // Target + swing so combat feedback (FCT + health bar) is visible.
  await page.evaluate(() => {
    const g = window.__game;
    const sim = g?.sim;
    if (!sim) return;
    const dummy = [...sim.entities.values()].find((e) => e.templateId === 'training_dummy');
    if (dummy) {
      sim.player.targetId = dummy.id;
      sim.startAutoAttack?.();
    }
  });
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: `${OUT_DIR}/training-dummy-combat.png` });
  console.log('wrote', `${OUT_DIR}/training-dummy-combat.png`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
