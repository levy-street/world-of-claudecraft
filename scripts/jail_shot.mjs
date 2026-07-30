// Screenshot tour of the moderation jail scene (src/render/jail_scene.ts).
// Boots an offline character, teleports into the jail area, and captures the
// visitor aisle, the cage exterior/interior, and the guard post.
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes to tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const JAIL = { x: -12000, z: -12000 };
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
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE:', m.text());
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(200);
await page.type('#char-name', 'Warden');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction('window.__game && window.__game.sim && window.__game.sim.player', {
  timeout: 90000,
});
await sleep(1500);
// dismiss the tutorial toast so it does not cover the frame
await page.evaluate(() => {
  for (const el of document.querySelectorAll('button')) {
    if (/skip tutorial/i.test(el.textContent ?? '')) el.click();
  }
});

const tp = async (x, z, yaw = 0, pitch = 0.32, dist = 12) => {
  await page.evaluate(
    (x, z, yaw, pitch, dist) => {
      const g = window.__game;
      const p = g.sim.player;
      if (p.dead) g.sim.releaseSpirit();
      p.maxHp = 99999;
      p.hp = 99999;
      p.pos.x = x;
      p.pos.z = z;
      p.facing = yaw;
      g.input.camYaw = yaw;
      g.input.camPitch = pitch;
      g.input.camDist = dist;
    },
    x,
    z,
    yaw,
    pitch,
    dist,
  );
  await sleep(3000); // let the chase camera settle after the long teleport
};

// warm-up hop: give the chase camera time to cross the 12km teleport before
// the framed shots
await tp(JAIL.x + 25, JAIL.z, -Math.PI / 2, 0.22, 9);
await sleep(4000);

// visitor spawn, looking west at the cage gate
await tp(JAIL.x + 24, JAIL.z - 4.25, -Math.PI / 2, 0.18, 8);
await page.screenshot({ path: 'tmp/jail-01-visitor.png' });

// guard post from the north, looking south along the east aisle
await tp(JAIL.x + 26, JAIL.z + 12, Math.PI - 0.4, 0.3, 7);
await page.screenshot({ path: 'tmp/jail-02-guardpost.png' });

// inside the cage, centre, looking east toward the keyring/guard side
await tp(JAIL.x, JAIL.z, Math.PI / 2, 0.2, 9);
await page.screenshot({ path: 'tmp/jail-03-cage-east.png' });

// inside the cage, looking west at the cots
await tp(JAIL.x + 6, JAIL.z, -Math.PI / 2, 0.25, 9);
await page.screenshot({ path: 'tmp/jail-04-cage-cots.png' });

// wide view from the SW corner across the room
await tp(JAIL.x - 30, JAIL.z + 28, Math.atan2(30, -28), 0.45, 16);
await page.screenshot({ path: 'tmp/jail-05-wide.png' });

// the gate arch from inside the cage
await tp(JAIL.x + 10, JAIL.z - 4.25, Math.PI / 2, 0.18, 8);
await page.screenshot({ path: 'tmp/jail-06-gate-inside.png' });

// the latrine corner (bucket + stains)
await tp(JAIL.x + 9, JAIL.z + 9, Math.PI / 4, 0.55, 7);
await page.screenshot({ path: 'tmp/jail-07-latrine.png' });

await browser.close();
console.log('done -> tmp/jail-0*.png');
