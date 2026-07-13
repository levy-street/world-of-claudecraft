// Screenshots + a smoke drive of the starter tutorial on Dawnhaven Isle.
//
// Needs `npm run dev`. Boots straight onto the isle with the DEV-only
// ?tutorial=<class> param, waits for the world, then walks the player up the beach
// path (which fires the Warden reveal) and west to the ambush brush (which fires
// the wolf reveal), capturing each beat on a desktop and a phone viewport. Any
// console error fails the run, so a broken isle is loud rather than a pretty
// screenshot of nothing.
//
//   node scripts/starter_tutorial_shots.mjs [--class mage] [--port 5177]
//
// Browser via scripts/browser_path.mjs (BROWSER_PATH overrides).

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};

const CLASS = arg('class', 'warrior');
const URL = process.env.GAME_URL ?? `http://localhost:${arg('port', '5177')}`;
const OUT = process.env.OUT_DIR ?? path.resolve('docs/screenshots/starter-tutorial');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

/** Nudge the offline player toward a spot, the way a walking player would arrive:
 *  set the position along the path and let the sim settle the ground height. This
 *  is the sowfield-shot idiom (offline Sim, dev handle), not a gameplay path. */
async function walkTo(page, x, z, steps = 24) {
  await page.evaluate(
    async (tx, tz, n) => {
      const g = window.__game;
      const p = g.sim.player;
      const sx = p.pos.x;
      const sz = p.pos.z;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        p.pos.x = sx + (tx - sx) * t;
        p.pos.z = sz + (tz - sz) * t;
        p.prevPos.x = p.pos.x;
        p.prevPos.z = p.pos.z;
        p.facing = Math.atan2(tx - p.pos.x, tz - p.pos.z);
        await new Promise((r) => setTimeout(r, 90));
      }
    },
    x,
    z,
    steps,
  );
}

// One browser per viewport: a second swiftshader WebGL context in the same browser
// reliably starves the first one's boot and times out.
for (const [label, viewport] of [
  ['desktop', { width: 1600, height: 900 }],
  // LANDSCAPE, because the game refuses to run in portrait on a phone ("Rotate to
  // Landscape"). deviceScaleFactor 1: a 2x backing store on a software GL context is
  // what was timing the mobile boot out, and the layout under test is the CSS one.
  ['mobile', { width: 932, height: 430, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }],
]) {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    // The software GL boot of a whole world takes minutes; the CDP default (180s)
    // cuts the waitForFunction poll off mid-boot.
    protocolTimeout: 480000,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    page.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`[${label}] ${m.text()}`);
    });

    console.log(`\n== ${label} (${CLASS}) ==`);
    await page.goto(`${URL}/?tutorial=${CLASS}`, { waitUntil: 'load', timeout: 60000 });
    // A phone gets the "play in landscape fullscreen" preflight, and world entry
    // AWAITS its Continue button, so the boot hangs forever without this tap.
    if (viewport.hasTouch) {
      await page
        .waitForSelector('#mobile-preflight-continue', { visible: true, timeout: 30000 })
        .then(() =>
          page.evaluate(() => document.getElementById('mobile-preflight-continue').click()),
        )
        .catch(() => {});
    }
    await page.waitForFunction(() => !!window.__game?.sim?.player, {
      timeout: 240000,
      polling: 500,
    });

    const shot = async (name) => {
      const file = path.join(OUT, `${label}-${name}.png`);
      await page.screenshot({ path: file });
      console.log(`  ${path.relative(process.cwd(), file)}`);
    };

    // Ride out the spawn cinematic, then the arrival on the beach.
    await sleep(12000);
    await shot('01-landing');

    // Up the path. Crossing into 22yd of the knoll fires the Warden reveal, and we
    // stop INSIDE her reach radius (WARDEN_REACH_YARDS = 6, and she stands at z=-21):
    // the `land` step does not complete until the player actually gets to her, and
    // until it does, taking the task cannot advance the script to the yard.
    await walkTo(page, 0, -16);
    await sleep(1200);
    await shot('02-warden-reveal');
    await sleep(4200);
    await shot('03-warden');

    // Take her task. THAT is what fires the yard reveal: the camera sweeps east off
    // the player's shoulder onto an empty practice yard and the three dummies land
    // in it. Done through the sim's own talkToNpc, which is exactly what the Interact
    // key calls.
    await page.evaluate(() => {
      const g = window.__game;
      const warden = [...g.sim.entities.values()].find((e) => e.templateId === 'dawnhaven_warden');
      if (warden) g.sim.talkToNpc(warden.id);
    });
    await sleep(3400);
    await shot('04-practice-yard');
    await sleep(3000);
    await shot('04b-dummies-landed');

    // Walk over to them.
    await walkTo(page, 22, 4);
    await sleep(2000);

    // West to the ambush brush, then fire the wolf reveal. The reveal normally
    // triggers on the `hunt` step, which a screenshot run has not played up to, so
    // the scene is driven directly through the dev handle: the cinematic, the staged
    // spawn and the VFX burst are all the real ones.
    await walkTo(page, -8, 9);
    await page.evaluate(() => {
      window.__game.tutorialScenes?.play('wolfReveal', performance.now() / 1000);
    });
    await sleep(1900);
    await shot('05-wolf-reveal');
    await sleep(3200);
    await shot('06-wolf');

    const state = await page.evaluate(() => {
      const g = window.__game;
      const ents = [...g.sim.entities.values()];
      return {
        zone: g.sim.player.pos,
        warden: ents.filter((e) => e.templateId === 'dawnhaven_warden').length,
        dummies: ents.filter((e) => e.templateId === 'dawnhaven_dummy').length,
        wolves: ents.filter((e) => e.templateId === 'dawnhaven_strandwolf').length,
      };
    });
    console.log(`  entities: ${JSON.stringify(state)}`);
    if (state.warden !== 1) errors.push(`[${label}] warden not staged in (${state.warden})`);
    // The dummies exist ONLY because the yard reveal staged them (nothing spawns them
    // at world init), so this doubles as proof the reveal fired.
    if (state.dummies !== 3) errors.push(`[${label}] expected 3 dummies, got ${state.dummies}`);
    // 4 from the pack camp + the 1 the reveal staged.
    if (state.wolves < 5) errors.push(`[${label}] ambush wolf never spawned (${state.wolves})`);

    await page.close();
  } finally {
    await browser.close();
  }
}

if (errors.length > 0) {
  console.error('\nFAILURES:');
  for (const e of [...new Set(errors)]) console.error(`  ${e}`);
  process.exit(1);
}
console.log('\nclean: no console errors, every reveal staged.');
