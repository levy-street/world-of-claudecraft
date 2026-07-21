// Visual + behavioural probe of the reworked Vale Cup controls on the OFFLINE
// client: the new 4-move kit on the bar, the hold-to-charge shoot power meter,
// and that releasing fires the ball. Needs `npm run dev`.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOT_DIR ?? 'tmp/vcup_shoot_e2e';
fs.mkdirSync(OUT, { recursive: true });
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

// Practice 3v3, fast-forward the briefing, reach kickoff.
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
await sleep(400);

// Confirm the new 4-move kit is on the bar.
const kit = await page.evaluate(() => window.__game.sim.known.map((k) => k.def.id));
console.log('CHECK kit:', JSON.stringify(kit));

// Stand on the ball facing the east goal, then HOLD the shoot key (Digit2) to
// charge; screenshot the power meter mid-charge; release to fire.
await page.evaluate(() => {
  const sim = window.__game.sim;
  const me = sim.player;
  const ball = sim.vcup.match.ball;
  me.pos.x = ball.x - 1.5;
  me.pos.z = ball.z;
  me.prevPos = { ...me.pos };
  me.facing = Math.PI / 2;
  ball.vx = 0;
  ball.vy = 0;
  ball.vz = 0;
});
await page.evaluate(() =>
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', bubbles: true })),
);
await sleep(550); // ~65% charge (SHOOT_CHARGE_MS 850)
await page.screenshot({ path: `${OUT}/shoot1_charging.png` });
console.log('wrote', `${OUT}/shoot1_charging.png`);
const charging = await page.evaluate(() => {
  const el = document.getElementById('vcup-charge');
  return {
    shown: !!el && el.style.display !== 'none',
    fill: el?.querySelector('.vcup-charge-fill')?.style.width,
  };
});
console.log('CHECK charging meter:', JSON.stringify(charging));
await page.evaluate(() =>
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Digit2', bubbles: true })),
);
await sleep(120);
const shot = await page.evaluate(() => {
  const b = window.__game.sim.vcup.match.ball;
  return { speed: Math.hypot(b.vx, b.vz), vx: b.vx };
});
console.log('CHECK ball fired on release:', JSON.stringify(shot));
await sleep(400);
await page.screenshot({ path: `${OUT}/shoot2_fired.png` });
console.log('wrote', `${OUT}/shoot2_fired.png`);

console.log('done');
await browser.close();
