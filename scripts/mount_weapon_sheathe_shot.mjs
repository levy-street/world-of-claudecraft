// Visual proof for the mount weapon-sheathe fix: boots the offline game as a
// warrior (a visible held weapon by default), grants a mount, rides it, and
// shoots the rider from the side/behind. On the pre-fix source the drawn
// weapon still shows in hand while mounted; on the fix it renders on the
// back, the same overlay that already sheathes a drawn weapon while
// swimming. Needs `npm run dev`.
//
//   GAME_URL=http://localhost:5199 OUT=tmp/mount_sheathe_after node scripts/mount_weapon_sheathe_shot.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT ?? 'tmp/mount_sheathe_shots';
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1280,800', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message));

await page.evaluateOnNewDocument(() => {
  try {
    window.localStorage.setItem('woc.cameraModePrompt.shown', '1');
    // Standing capture rule: seed the lowest graphics preset before boot.
    window.localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {
    /* private mode: the prompts are dismissed below instead */
  }
});
await page.goto(URL, { waitUntil: 'load', timeout: 90000 });
await page.waitForSelector('#btn-offline', { timeout: 90000 });
await wait(400);
await page.evaluate(() => document.querySelector('#btn-offline').click());
await wait(400);
await page.type('#char-name', 'Rider');
await page.evaluate(() => {
  document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
  document.querySelector('#btn-start-offline').click();
});
await page.waitForFunction(() => !!window.__game?.world?.player, { timeout: 90000 });
// The first-visit island arrival cinematic (src/game/arrival_cinematic.ts)
// owns camDist/camPitch itself for ARRIVAL_CINEMATIC_SECONDS (4.5s), starting
// high and far; wait it out so the parked camera below actually sticks.
await wait(5200);

/** Dismiss whatever first-run/NPC-gossip/perf-warning chrome is on top: the
 *  camera-mode prompt, the tutorial skip, the Proving Shore welcome gossip
 *  (a scripted zone-entry popup, independent of movement), and the
 *  software-rasterizer banner. Called before every shot since the gossip
 *  window can still be settling in when the first capture fires. */
async function dismissChrome(pg) {
  await pg.evaluate(() => {
    document.querySelector('.camera-prompt-confirm')?.click();
    for (const b of document.querySelectorAll('button')) {
      const t = b.textContent ?? '';
      if (/skip tutorial|understood|dismiss/i.test(t)) b.click();
    }
  });
}
await dismissChrome(page);
await wait(700);

/** Park the camera to the rider's side/behind, framing the held/on-back weapon.
 *  A mounted silhouette (horse + rider) needs more distance than a standing
 *  solo character to frame the same way. */
async function park(pg, dist = 4.5) {
  await dismissChrome(pg);
  await pg.evaluate((d) => {
    const g = window.__game;
    g.input.camDist = d;
    g.input.camPitch = 0.28;
    g.input.camYaw = g.sim.player.facing + 0.6; // off-axis so the weapon isn't hidden behind the body
  }, dist);
  await wait(1000);
  await dismissChrome(pg);
  await wait(300);
}

// Level so the mount and the starting weapon are both usable, then grant a
// classic ground mount (the Valorsteed reins) and confirm the weapon starts
// drawn (a fresh warrior spawns with one equipped and drawn by default).
await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(20, sim.playerId);
  sim.addItem('reins_valorsteed', 1);
  const meta = sim.meta(sim.playerId);
  if (meta) meta.ridingTrained = true; // skip Marla's gold gate for the shot
  if (sim.player.weaponStowed) window.__game.world.toggleWeaponStow();
});
await wait(300);
await park(page);
await page.screenshot({ path: `${OUT}/ground-drawn.png` });
console.log(
  'on the ground, drawn:',
  await page.evaluate(() => ({
    weaponStowed: window.__game.sim.player.weaponStowed,
    mountKey: window.__game.sim.player.mountKey,
  })),
);

// Ride: reins are an item, not a picker. `useItem` routes through
// summonMountItem (src/world_api/mounts.ts), the same path a bag double-click
// or an action-bar reins slot uses.
await page.waitForFunction(
  () => {
    const sim = window.__game.sim;
    if (!sim.player.mountKey) window.__game.world.useItem('reins_valorsteed');
    return sim.player.mountKey === 'valorsteed';
  },
  { timeout: 10000, polling: 250 },
);
await page.waitForFunction(
  () => !!window.__game.renderer?.views?.get(window.__game.sim.playerId)?.mountVisual,
  { timeout: 20000, polling: 300 },
);
await wait(1200);
await park(page, 7); // the horse+rider silhouette needs more room than a solo body
await page.screenshot({ path: `${OUT}/mounted-weapon.png` });
console.log(
  'mounted:',
  await page.evaluate(() => ({
    weaponStowed: window.__game.sim.player.weaponStowed,
    mountKey: window.__game.sim.player.mountKey,
  })),
);

// Dismount and confirm the player's own drawn choice is restored.
await page.evaluate(() => window.__game.world.toggleMounted());
await page.waitForFunction(() => !window.__game.sim.player.mountKey, {
  timeout: 10000,
  polling: 250,
});
await wait(800);
await park(page);
await page.screenshot({ path: `${OUT}/dismounted-drawn.png` });
console.log(
  'dismounted:',
  await page.evaluate(() => ({
    weaponStowed: window.__game.sim.player.weaponStowed,
    mountKey: window.__game.sim.player.mountKey,
  })),
);

await browser.close();
console.log(`wrote ${OUT}/`);
