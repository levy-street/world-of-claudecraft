// Mobile screenshot harness for the Joystick Size setting.
// Boots the offline game in a touch-emulated landscape phone viewport and
// captures the on-screen joysticks at the min / default / max joystick scales.
// Needs `npm run dev` running on :5173. Saves PNGs to tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

// A landscape phone: width<940 keeps us inside PHONE_TOUCH_QUERY, landscape
// avoids the rotate-device overlay.
const VIEWPORT = { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

// The mobile-touch CSS floor keeps every touch target at >=40x40 px.
const TOUCH_MIN = 40;

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=844,390', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: VIEWPORT,
});
const page = await browser.newPage();
const errors = [];
// The offline dev server (npm run dev with no game server) 502s the homepage's
// background project-stats fetch; that is expected offline and unrelated to the
// mobile UI under test, so it is not a script failure.
const IGNORED_CONSOLE = /502|Bad Gateway|fetch project stats/i;
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !IGNORED_CONSOLE.test(msg.text())) {
    errors.push(`CONSOLE: ${msg.text()}`);
  }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Thumbster', settleMs: 2500 });

// Force the touch layer on. Headless Chromium doesn't always report
// (pointer: coarse), so we apply the same body class MobileControls would.
await page.evaluate(() => document.body.classList.add('mobile-touch'));
await new Promise((r) => setTimeout(r, 200));
const touchOn = await page.evaluate(() => document.body.classList.contains('mobile-touch'));
console.log('mobile-touch active:', touchOn);

// Apply a joystick scale exactly as applySetting('joystickScale') does, then shoot.
async function shoot(scale, name) {
  await page.evaluate((s) => {
    document.getElementById('mobile-controls')?.style.setProperty('--joy-scale', String(s));
  }, scale);
  await new Promise((r) => setTimeout(r, 250));
  await page.screenshot({ path: `tmp/${name}` });
  console.log(`saved tmp/${name}`, `(scale ${scale})`);
}

await shoot(0.7, 'joystick_small.png');
await shoot(1.0, 'joystick_default.png');
await shoot(1.3, 'joystick_large.png');

// Defense-in-depth for the >=40x40 mobile-touch CSS floor. That floor is the
// DEFAULT touch-target contract; the joystickScale slider (0.7 to 1.3, def 1) is
// a separate user opt-in that can render smaller, so measure at the DEFAULT scale
// where the floor applies. getBoundingClientRect honours the --joy-scale
// transform.
await page.evaluate(() => {
  document.getElementById('mobile-controls')?.style.setProperty('--joy-scale', '1');
});
await new Promise((r) => setTimeout(r, 250));
const joystickSizes = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('.mobile-joystick'));
  return els.map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.id, width: r.width, height: r.height };
  });
});
if (!joystickSizes.length) errors.push('TOUCH-SIZE: found no joysticks to measure');
for (const j of joystickSizes) {
  if (j.width < TOUCH_MIN || j.height < TOUCH_MIN) {
    errors.push(
      'TOUCH-SIZE: #' +
        j.id +
        ' is ' +
        j.width.toFixed(1) +
        'x' +
        j.height.toFixed(1) +
        ' px, under the ' +
        TOUCH_MIN +
        'x' +
        TOUCH_MIN +
        ' touch floor',
    );
  }
}

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
if (errors.length) process.exit(1);
