// Captures the vertical nameplate stacking offline: a tight pack of mobs whose
// overhead labels project on top of each other, desktop and mobile (landscape).
// Run once on the branch and once on the base commit for before/after.
// Needs the dev client running:  npm run dev
//   GAME_URL=http://localhost:5173 SHOT_TAG=after node scripts/nameplate_stack_shot.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const TAG = process.env.SHOT_TAG ?? 'after';
const OUT = process.env.SHOTS_DIR ?? 'tmp/shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

// One tight knot of mobs in front of the player: close enough that their
// projected label anchors collide, at slightly different depths so the stack
// has a meaningful near-to-far order.
const PACK = [
  { side: -1.4, ahead: 8.0 },
  { side: -0.4, ahead: 9.2 },
  { side: 0.7, ahead: 10.4 },
  { side: 1.6, ahead: 11.8 },
  { side: -0.9, ahead: 13.0 },
  { side: 0.3, ahead: 14.4 },
];

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 60000,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});

async function shoot(label, viewport, emulateTouch) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await page.setViewport(viewport);
  if (emulateTouch) {
    const client = await page.target().createCDPSession();
    await client.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'pointer', value: 'coarse' }],
    });
  }
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // shared entry flow: it also dismisses the intro, tutorial and camera prompt
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'Thorgar', settleMs: 3000 });
  await page.waitForFunction(() => window.__game?.sim?.entities?.size > 3, {
    timeout: 30000,
    polling: 300,
  });
  await sleep(1000);

  // Stage the pack along the CAMERA's own view direction rather than the
  // player's facing: the chase camera keeps its yaw, so a pack lined up on
  // p.facing can end up off to one side of the frame.
  const stage = `(pack) => {
    const g = window.__game;
    const sim = g.sim;
    const p = sim.player;
    const cam = g.renderer.camera;
    const fwd = cam.getWorldDirection(cam.position.clone());
    const len = Math.hypot(fwd.x, fwd.z) || 1;
    const fx = fwd.x / len;
    const fz = fwd.z / len;
    const mobs = window.__packIds
      ? window.__packIds.map((id) => sim.entities.get(id)).filter(Boolean)
      : [...sim.entities.values()]
          .filter((e) => e.templateId && !e.dead && e.kind === 'mob' && e.ownerId == null)
          .slice(0, pack.length);
    mobs.forEach((e, i) => {
      e.pos.x = p.pos.x + fx * pack[i].ahead - fz * pack[i].side;
      e.pos.z = p.pos.z + fz * pack[i].ahead + fx * pack[i].side;
      e.pos.y = p.pos.y;
      e.hp = e.maxHp;
      e.dead = false;
      e.inCombat = false;
      e.aggroTargetId = null;
    });
    window.__packIds = mobs.map((e) => e.id);
    document.querySelector('.camera-prompt-confirm')?.click();
    // headless swiftshader raises the software-rendering notice; it is not part
    // of the change under review, so keep it out of the frame
    document.querySelector('#gpu-notice button')?.click();
    document.querySelector('#gpu-notice')?.setAttribute('hidden', '');
    return mobs.length;
  }`;
  const placed = await page.evaluate(`(${stage})(${JSON.stringify(PACK)})`);
  console.log(`${label}: placed ${placed} mobs`);
  await sleep(1200);

  // Re-stage right before the shot: mobs wander, and a drifting pack would make
  // the before/after pair frame two different scenes.
  for (let pass = 0; pass < 3; pass++) {
    await sleep(500);
    await page.evaluate(`(${stage})(${JSON.stringify(PACK)})`);
  }
  await sleep(400);

  const path = `${OUT}/nameplate-stack-${label}-${TAG}.png`;
  await page.screenshot({ path });
  console.log(`saved ${path}`);
  await page.close();
}

try {
  await shoot('desktop', { width: 1280, height: 760 }, false);
  // in-game mobile is landscape-only on the web client
  await shoot('mobile', { width: 844, height: 390, isMobile: true, hasTouch: true }, true);
} finally {
  await browser.close();
}
