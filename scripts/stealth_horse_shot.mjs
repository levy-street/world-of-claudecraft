// Before/after proof for the "stealth horse" duel exploit: mounting while
// stealthed (Rogue Duskveil) used to leave the stealth aura active, so a
// mounted rider stayed concealed (server/game.ts canObserveEntity hides a
// stealthed player from a non-party/non-ally viewer beyond a shrunk detection
// radius) while ALSO riding at full mount speed. Boots the offline game as a
// rogue, casts Duskveil, then rides the horse (the real summonMountItem path
// via reins), and shoots the HUD buff bar once the summon channel completes:
// pre-fix the Duskveil buff is still up while mounted, post-fix it is gone.
//
// Needs `npm run dev` (or a bare `vite`) already running. Writes to tmp/.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5199';
const OUT = process.env.SHOT_PREFIX ?? 'tmp/stealth_horse';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

// Standing capture rule: seed the lowest graphics preset before boot (this is
// a gameplay proof, not a graphics comparison).
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {
    /* ignore */
  }
  // The spawn-area gossip note (#tutorial-greeting) re-triggers on every
  // proximity re-check, not just once: a single dismiss click loses the race
  // against it reopening a moment later. Auto-close it every time it mounts,
  // for the whole session, so it can never sit in front of a capture.
  const closeIfPresent = () => {
    const el = document.getElementById('tutorial-greeting');
    if (!el) return;
    el.querySelector('[data-close], [data-skip]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
  };
  new MutationObserver(closeIfPresent).observe(document, { childList: true, subtree: true });
});

// domcontentloaded, not networkidle0: the Vite dev client keeps an HMR
// WebSocket open indefinitely, which can starve networkidle0 under load.
// enterOfflineGame does its own waitForSelector('#btn-offline', ...) gate.
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
const booted = await enterOfflineGame(page, {
  charClass: 'rogue',
  charName: 'Shade',
  selectorTimeoutMs: 60000,
  gameBootTimeoutMs: 90000,
});
if (!booted) {
  await page.screenshot({ path: 'tmp/_boot_fail.png' }).catch(() => {});
  throw new Error('offline world did not boot');
}
await sleep(500);

// Dismiss the spawn-area tutorial greeting note and the swiftshader
// "graphics lowered" banner so neither covers the shot.
async function dismissChrome() {
  await page
    .evaluate(() => {
      document.querySelector('[data-close]')?.click();
      document.querySelector('.entry-guard-dismiss')?.click();
    })
    .catch(() => {});
}
await dismissChrome();
await sleep(300);

// Level up, grant a horse, learn riding, cast Duskveil, and frame the camera
// on the player so the HUD buff bar and the character are both in shot.
const before = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  // Nearby training dummies at spawn are stationary and never reach a player
  // who never moves toward them, but force inCombat off every frame anyway
  // (belt and suspenders: this suite only cares about the mount+stealth
  // interaction, not spawn-area aggro). Also hold the player pinned a few
  // yards above their spawn Y with zero vertical velocity: some starting
  // zones sit right at the local water line, which registers as "swimming"
  // and cancels an in-flight mount summon exactly like combat does; holding
  // clear of it (without ever free-falling, so no fall damage) sidesteps
  // needing to know which zone a given class spawns in.
  // Step away from the Ferryman Odo gossip trigger (its proximity note
  // re-opens repeatedly and would otherwise cover the shot).
  p.pos.x -= 20;
  p.pos.z -= 20;
  p.prevPos = { ...p.pos };
  const holdY = p.pos.y + 6;
  window.__killCombat = setInterval(() => {
    const pl = sim.player;
    pl.inCombat = false;
    pl.combatTimer = 0;
    pl.pos.y = holdY;
    pl.vy = 0;
    pl.onGround = false;
  }, 50);
  sim.setPlayerLevel(20);
  sim.addItem('reins_valorsteed', 1);
  const meta = sim.players.get(sim.playerId);
  if (meta) meta.ridingTrained = true;
  p.inCombat = false;
  p.combatTimer = 0;
  g.input.camYaw = p.facing;
  g.input.camDist = 9;
  g.input.camPitch = 0.24;
  sim.castAbility('stealth'); // Duskveil
  const hasStealth = p.auras.some((a) => a.kind === 'stealth');
  return { hasStealth, mountKey: p.mountKey };
});
if (!before.hasStealth) throw new Error(`Duskveil did not apply: ${JSON.stringify(before)}`);
for (let i = 0; i < 3; i++) {
  await dismissChrome();
  await sleep(250);
}
await page.screenshot({ path: 'tmp/_stealthed_premount.png' });

// Ride the horse through the REAL reins path (useItem -> summonMountItem),
// the exact code path cancelFormsAndGhostWolf runs from.
const useResult = await page.evaluate(() => {
  const p = window.__game.sim.player;
  window.__game.sim.useItem('reins_valorsteed');
  return { mountCastKey: p.mountCastKey, mountCastRemaining: p.mountCastRemaining };
});
if (useResult.mountCastKey !== 'valorsteed') {
  throw new Error(`mount summon did not start: ${JSON.stringify(useResult)}`);
}

// The summon channel is MOUNT_SUMMON_SECONDS (1.5s) of SIM time. Under heavy
// machine load the page's own real-time rAF loop can let something else
// (training-dummy aggro at spawn) flip inCombat between our setInterval
// corrections, silently cancelling the channel before it completes. Drive
// the channel deterministically instead, exactly like
// tests/mounts.test.ts's finishTransition helper: force inCombat off and
// call sim.tick() directly in a tight synchronous loop, no wall-clock
// dependency. clearInterval on the setInterval hack first so it cannot race
// this loop.
await page.evaluate(() => {
  clearInterval(window.__killCombat);
  const sim = window.__game.sim;
  const p = sim.player;
  const steps = Math.ceil(1.5 / (1 / 20)) + 4;
  for (let i = 0; i < steps && p.mountKey !== 'valorsteed'; i++) {
    p.inCombat = false;
    p.combatTimer = 0;
    sim.tick();
  }
});
// Mounting plays an arrival cinematic that owns the camera for a few seconds
// (precedent: the mount weapon-sheathe overlay work), and the mount GLB needs
// a beat to stream in; give both time before capturing, and clear any note
// that reappeared in the meantime.
await sleep(3500);
for (let i = 0; i < 4; i++) {
  await dismissChrome();
  await sleep(250);
}

const after = await page.evaluate(() => {
  const p = window.__game.sim.player;
  return {
    mountKey: p.mountKey,
    hasStealth: p.auras.some((a) => a.kind === 'stealth'),
    stealthed: p.stealthed,
  };
});
if (after.mountKey !== 'valorsteed') {
  throw new Error(`mount summon did not complete: ${JSON.stringify(after)}`);
}
await page.screenshot({ path: `${OUT}_full.png` });
// The buff bar sits beside the minimap in the top-right corner (see the
// pre-mount reference frame): a fixed crop there is more reliable under
// headless swiftshader than trusting #buff-bar's own (often zero-buff,
// zero-size) bounding rect.
await page.screenshot({
  path: `${OUT}_topright.png`,
  clip: { x: 1330, y: 0, width: 270, height: 170 },
});

console.log('RESULT:', JSON.stringify({ before, after }));
console.log(errors.length ? `PAGE ERRORS:\n${errors.slice(0, 10).join('\n')}` : 'no page errors');
await browser.close();
