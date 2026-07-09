// Verify the Vale Cup sport moves AUTOCAST on press (no ground-target reticle)
// and that key 1 casts your first sport move (Kick) on the pitch instead of the
// inert auto-attack. Offline client; needs `npm run dev`.
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  protocolTimeout: 120000,
  args: [
    '--no-sandbox',
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(`${URL}/?gfx=high`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(400);
await page.type('#char-name', 'Striker');
await page.evaluate(() => {
  document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
  document.querySelector('#btn-start-offline').click();
});
await page.waitForFunction(() => Boolean(window.__game?.sim), { timeout: 60000, polling: 500 });
await sleep(1000);

// Seat a practice 3v3 and fast-forward the briefing so we reach kickoff quickly.
await page.evaluate(() => window.__game.sim.vcupPracticeStart(3));
await page.waitForFunction(() => Boolean(window.__game.sim.vcup.match), {
  timeout: 10000,
  polling: 200,
});
await page.evaluate(() => {
  window.__game.sim.vcup.match.briefingTimer = 0.05;
});
await page.waitForFunction(() => window.__game.sim.vcup.match?.phase === 'active', {
  timeout: 15000,
  polling: 200,
});
await sleep(300);

// Press the Kick key (bar slot 1 = key "2") with the ball at our feet, facing east.
const kick = await page.evaluate(() => {
  const { sim, hud } = window.__game;
  const me = sim.player;
  const ball = sim.vcup.match.ball;
  me.pos.x = ball.x - 2;
  me.pos.z = ball.z;
  me.prevPos = { ...me.pos };
  me.facing = Math.PI / 2; // face east (+x), toward the enemy goal
  ball.vx = 0;
  ball.vy = 0;
  ball.vz = 0;
  hud.castSlot(1); // Kick, autocast on press
  return { reticle: hud.isGroundAimActive(), speed: Math.hypot(ball.vx, ball.vz), vx: ball.vx };
});
console.log('CHECK kick autocast (no reticle, ball moves east):', JSON.stringify(kick));

// Press key 1 (bar slot 0): on the pitch this must cast Kick, NOT toggle auto-attack.
const key1 = await page.evaluate(() => {
  const { sim, hud } = window.__game;
  const me = sim.player;
  me.cooldowns?.clear?.(); // clear the Kick cooldown from the first check
  const ball = sim.vcup.match.ball;
  me.pos.x = ball.x - 2;
  me.pos.z = ball.z;
  me.prevPos = { ...me.pos };
  me.facing = Math.PI / 2;
  ball.vx = 0;
  ball.vy = 0;
  ball.vz = 0;
  hud.castSlot(0); // key 1
  return { autoAttack: sim.player.autoAttack, speed: Math.hypot(ball.vx, ball.vz) };
});
console.log('CHECK key 1 casts Kick (no auto-attack):', JSON.stringify(key1));

console.log('done');
await browser.close();
