// Screenshots of the Sowfield (Vale Cup stadium, src/render/vale_cup_stadium.ts)
// in the southern vale. Boots the offline world, then drives the renderer's
// editor free-cam seam (editorCam bypasses the chase camera, so framing is
// exact) through the gate approach, the pitch from the stands, a goal mouth,
// the boarball during a practice match, and a wide vale shot.
// Needs `npm run dev` running; pass GAME_URL if vite picked a non-default port.
// Browser via scripts/browser_path.mjs.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT =
  process.env.OUT_DIR ??
  '/private/tmp/claude-501/-Users-maxpolaczuk-misc-world-of-claudecraft/dcd10462-1610-43f2-aed5-ed902f9c03d5/scratchpad/sowfield_shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

// Boot with retries: the dev server may force a full reload mid-boot right
// after an edit (dep re-optimization), which kills the execution context.
let booted = false;
for (let attempt = 0; attempt < 4 && !booted; attempt++) {
  try {
    await page.goto(URL, { waitUntil: 'load', timeout: 45000 });
    await page.waitForSelector('#btn-offline', { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2500)); // let any pending reload land
    // DOM clicks (the footstep_walk_shot.mjs pattern): the boot menu may sit
    // under the marketing takeover, so a trusted pointer click can miss it.
    await page.evaluate(() => document.querySelector('#btn-offline').click());
    await new Promise((r) => setTimeout(r, 400));
    await page.type('#char-name', 'Groundsman');
    await page.evaluate(() => {
      document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
      document.querySelector('#btn-start-offline').click();
    });
    // cold vite + swiftshader boot is slow: wait for the live game handle
    await page.waitForFunction(() => !!window.__game?.sim?.player, {
      timeout: 120000,
      polling: 500,
    });
    booted = true;
  } catch (err) {
    console.log(`boot attempt ${attempt + 1} failed:`, err.message);
  }
}
if (!booted) {
  await browser.close();
  throw new Error('could not boot the offline world');
}
await new Promise((r) => setTimeout(r, 2500));
// clear the tutorial takeover so it does not block the framing
await page.evaluate(() => {
  const skip = [...document.querySelectorAll('button')].find((b) =>
    (b.textContent || '').includes('Skip Tutorial'),
  );
  skip?.click();
});
// log the measured kit sizes so a mis-scaled GLB placement is diagnosable
const sizes = await page.evaluate(() => {
  const stadium = window.__game.renderer.scene.getObjectByName('sowfield-stadium');
  return stadium ? stadium.userData.kitSizes : null;
});
console.log('kit sizes:', JSON.stringify(sizes));

// Free-cam shot: teleport the player near the camera (drives entity interest,
// ambience, and streaming), then pin the exact camera pose via editorCam.
async function shot(name, cam, target, settleMs = 1600) {
  await page.evaluate(
    async (c, t) => {
      const g = window.__game;
      const p = g.sim.player;
      p.maxHp = 99999;
      p.hp = 99999;
      p.pos.x = c.x;
      p.pos.z = c.z;
      p.prevPos.x = c.x;
      p.prevPos.z = c.z;
      await new Promise((r) => setTimeout(r, 250)); // sim settles ground y
      const gy = p.pos.y;
      // step the player back behind the camera so the rig stays out of frame
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
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('wrote', `${OUT}/${name}.png`);
}

// 1. the gate approach from town (walking south down the x=0 column)
await shot('01_gate_approach', { x: -11, z: -68, h: 3.4 }, { x: -11, z: -86, h: 2.6 });
// 2. the pitch from the south stand, looking north across the ground
await shot('02_pitch_from_stand', { x: -14, z: -134.5, h: 4.6 }, { x: -11, z: -108, h: 0.4 });
// 3. west goal mouth close-up, from inside the pitch at a diagonal
await shot('03_goal_mouth', { x: -25, z: -106.5, h: 1.9 }, { x: -32.4, z: -112, h: 1 });
// 4. the Copper Pail plinth from the west, gate + wagon + Bram as the backdrop
await shot('04_gate_pail', { x: -20.2, z: -81.4, h: 1.9 }, { x: -15.9, z: -82.1, h: 1.35 });

// 5. the boarball: spawn a practice match if the sim module is on disk
const practice = await page.evaluate(() => {
  const g = window.__game;
  if (typeof g.sim.vcupPracticeStart === 'function') {
    try {
      g.sim.vcupPracticeStart(2);
      return true;
    } catch (e) {
      console.log('practice start failed:', e?.message);
      return false;
    }
  }
  return false;
});
if (practice) {
  // catch the kickoff countdown: the ball sits untouched at center while the
  // teams hold their halves, the one reliable close-up window
  await page
    .waitForFunction(() => window.__game.sim.cupInfo?.match?.ballId != null, {
      timeout: 15000,
      polling: 200,
    })
    .catch(() => {});
  // park the ball in a clear spot and shoot before the bots reach it (offline
  // sim state is directly writable; the match physics resumes from there)
  const ballPos = await page.evaluate(() => {
    const g = window.__game;
    const id = g.sim.cupInfo?.match?.ballId;
    const e = id != null ? g.sim.entities.get(id) : null;
    if (!e) return null;
    e.pos.x = -11;
    e.pos.z = -104;
    e.prevPos.x = e.pos.x;
    e.prevPos.z = e.pos.z;
    const p = g.sim.player;
    p.pos.x = -6;
    p.pos.z = -101;
    p.prevPos.x = p.pos.x;
    p.prevPos.z = p.pos.z;
    const gy = e.pos.y;
    g.renderer.editorCam = {
      pos: { x: -10.2, y: gy + 1.15, z: -100.9 },
      target: { x: -11, y: gy + 0.6, z: -104 },
    };
    return { x: e.pos.x, z: e.pos.z };
  });
  console.log('ball parked at', JSON.stringify(ballPos));
  if (ballPos) {
    await new Promise((r) => setTimeout(r, 350));
    await page.screenshot({ path: `${OUT}/05_ball_closeup.png` });
    console.log('wrote', `${OUT}/05_ball_closeup.png`);
  }
  await shot('06_match_wide', { x: -11, z: -131, h: 6.5 }, { x: -11, z: -107, h: 0 }, 1400);
  // 8. the goal fireworks: inject the vcupGoal event directly (deterministic
  // timing; a real goal lands whenever the bots feel like it)
  await page.evaluate(() => {
    const g = window.__game;
    g.renderer.editorCam = {
      pos: { x: -6, y: g.sim.player.pos.y + 2.4, z: -119 },
      target: { x: 11, y: g.sim.player.pos.y + 9, z: -112 },
    };
    g.renderer.handleEvent({
      type: 'vcupGoal',
      scorerName: 'Reeve Marlow',
      team: 'A',
      scoreA: 1,
      scoreB: 0,
      nationA: 'vale',
      nationB: 'coliseum',
      x: 11,
      z: -112,
    });
  });
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: `${OUT}/08_goal_fireworks.png` });
  console.log('wrote', `${OUT}/08_goal_fireworks.png`);
} else {
  console.log('vcupPracticeStart not available; skipping ball shots');
}

// 7. wide daytime vale shot from the northeast rise, looking southwest
await shot('07_wide_vale', { x: 27, z: -70, h: 13 }, { x: -16, z: -112, h: 0 });

await browser.close();
console.log('done ->', OUT);
