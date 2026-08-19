// Visual proof for the Weirdo Cream truck mount: boots the offline game, grants
// the ignition key, rides it, and captures the angles that matter for this
// asset specifically.
//
// The load-bearing shot is the CAB. The whole design premise is that the driver
// sits in an open cab and no part of the body intersects the shell, so the
// capture puts the camera on the truck from the front and the side while the
// player is mounted and moving, plus a jump (which is what fires the chime).
//
//   node scripts/weirdo_cream_truck_shot.mjs    (needs `npm run dev`)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOT_DIR ?? 'docs/screenshots/weirdo-cream-truck/in-game';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR:', error.message));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jsClick = (selector) =>
  page.evaluate((value) => {
    const element = document.querySelector(value);
    if (!element) throw new Error(`missing ${value}`);
    element.click();
  }, selector);

await page.goto(URL, { waitUntil: 'load', timeout: 90_000 });
await page.waitForSelector('#btn-offline', { timeout: 90_000 });
await sleep(400);
await jsClick('#btn-offline');
await sleep(300);
await page.type('#char-name', 'Luffy');
await jsClick('#offline-select .mini-class[data-class="warrior"]');
await jsClick('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 40_000 });
await sleep(2000);
await page.evaluate(() => {
  const button = [...document.querySelectorAll('button')].find((candidate) =>
    /skip tutorial/i.test(candidate.textContent || ''),
  );
  button?.click();
});
await sleep(400);

await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(20, sim.playerId);
  sim.addItem('reins_weirdo_cream_truck', 1);
  sim.selectMount('weirdo_cream_truck');
});
await sleep(400);

await page.waitForFunction(
  () => {
    const sim = window.__game.sim;
    if (!sim.player.mountKey) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', bubbles: true }));
    }
    return sim.player.mountKey === 'weirdo_cream_truck';
  },
  { timeout: 15_000, polling: 250 },
);
// The mount GLB is lazyPreload: wait for the visual, not a fixed nap.
await page.waitForFunction(
  () => !!window.__game.renderer?.views?.get(window.__game.sim.playerId)?.mountVisual,
  { timeout: 30_000, polling: 300 },
);
await sleep(1200);

/** Orbit the camera to a yaw/pitch and hold, so a shot frames the truck. */
async function orbit(yaw, pitch, name) {
  await page.evaluate(
    (y, p) => {
      const input = window.__game.input;
      if (input) {
        input.camYaw = y;
        input.camPitch = p;
      }
    },
    yaw,
    pitch,
  );
  await sleep(700);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`${name}: ${OUT}/${name}.png`);
}

await orbit(Math.PI, -0.12, 'cab-front');
await orbit(Math.PI / 2, -0.1, 'flank-signage');
await orbit(0, -0.15, 'rear-portrait');

// Rolling, so the wheels and the body bounce are in the frame.
await page.keyboard.down('w');
await sleep(1100);
await page.screenshot({ path: `${OUT}/rolling.png` });
console.log(`rolling: ${OUT}/rolling.png`);

// The jump: this is the frame the chime fires on.
await page.keyboard.down('Space');
await sleep(120);
await page.keyboard.up('Space');
await sleep(260);
await page.screenshot({ path: `${OUT}/jump-chime.png` });
console.log(`jump: ${OUT}/jump-chime.png`);
await page.keyboard.up('w');

await browser.close();
