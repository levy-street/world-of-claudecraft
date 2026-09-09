// Screenshot + proof harness for the slope-glue fall-through fix.
//
// Boots an offline warrior at the LOWEST graphics preset, teleports them to
// the mainland shore beside the Forgefather Fortress bridge's west leg (The
// Drakelands), and walks them at the deck through the sim's own move input at
// tick precision. Before the fix the slope glue kept the body on the buried
// bridge planks while the shore rose over them, seating the player yards
// under the ground; after it the terrain takes over. Logs the sim numbers
// (feet vs terrain height) as the physics proof next to the pixels.
//
// Needs `npm run dev` (override the port with GAME_URL). Writes to tmp/.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const SLUG = process.env.SHOT_SLUG ?? 'slope-glue';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

// The lowest preset, seeded before the app boots (the standing capture rule).
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {
    /* ignore */
  }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Plunger' });
if (!booted) throw new Error('offline world did not boot');
await sleep(800);

async function frame() {
  await page.screenshot({ path: 'tmp/_frame.png' });
}

// A plain-terrain point up the shore, walking DOWN the slope across the
// bridge planks and up the far side (the world sweep's reachable burial).
const START = { x: 437.35, z: 2193.85 };
const DECK = { x: 444.1, z: 2197.75 };

function teleportAndWalk(ticks) {
  return page.evaluate(
    ({ start, deck, ticks }) => {
      const g = window.__game;
      g.sim.setPlayerLevel(60);
      const p = g.sim.player;
      const idle = {
        forward: false,
        back: false,
        turnLeft: false,
        turnRight: false,
        strafeLeft: false,
        strafeRight: false,
        jump: false,
      };
      p.pos.x = start.x;
      p.pos.z = start.z;
      p.pos.y = g.sim.groundPos(start.x, start.z).y;
      p.pos.y += 3;
      p.prevPos = { ...p.pos };
      p.fallStartY = p.pos.y;
      const facing = Math.atan2(deck.x - start.x, deck.z - start.z);
      p.facing = facing;
      p.prevFacing = facing;
      p.vx = 0;
      p.vy = 0;
      p.vz = 0;
      p.onGround = false;
      p.jumping = false;
      p.climb = null;
      for (let i = 0; i < 200 && !p.onGround; i++) {
        p.fallStartY = p.pos.y;
        Object.assign(g.sim.moveInput, idle);
        g.sim.tick();
      }
      if (!p.onGround) return { error: 'never settled' };
      let worst = 0;
      for (let i = 0; i < ticks; i++) {
        Object.assign(g.sim.moveInput, { ...idle, forward: true });
        g.sim.tick();
        const ground = g.sim.groundPos(p.pos.x, p.pos.z).y;
        worst = Math.max(worst, ground - p.pos.y);
      }
      Object.assign(g.sim.moveInput, idle);
      const ground = g.sim.groundPos(p.pos.x, p.pos.z).y;
      return {
        at: { x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2) },
        ground: +ground.toFixed(2),
        under: +(ground - p.pos.y).toFixed(2),
        worstUnder: +worst.toFixed(2),
        onGround: p.onGround,
      };
    },
    { start: START, deck: DECK, ticks },
  );
}

function cinematicCam(yaw, dist, pitch) {
  return page.evaluate(
    ({ yaw, dist, pitch }) => {
      const inp = window.__game.input;
      inp.camYaw = yaw;
      inp.camDist = dist;
      inp.camPitch = pitch;
    },
    { yaw, dist, pitch },
  );
}

function dismissPerfBanner() {
  return page.evaluate(() => {
    document.getElementById('tutorial-greeting')?.remove();
    const dismiss = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Dismiss',
    );
    dismiss?.click();
  });
}

const walked = await teleportAndWalk(50);
console.log('walked:', JSON.stringify(walked));
if (walked.error) {
  await browser.close();
  process.exit(1);
}
await dismissPerfBanner();
await cinematicCam(2.2, 7, 0.35);
for (let i = 0; i < 6; i++) {
  await frame();
  await sleep(120);
}
await page.screenshot({ path: `tmp/${SLUG}.png` });
console.log(`RESULT worstUnder=${walked.worstUnder} -> tmp/${SLUG}.png`);
await browser.close();
