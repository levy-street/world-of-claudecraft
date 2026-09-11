// Before/after captures for the Last Keep churchyard graveyard fix
// (src/sim/content/graveyards.ts, gy_last_keep). Boots the offline world at
// the LOWEST graphics preset (the standing capture rule), frames the keep's
// churchyard south of the chapel (before: headstones and no Pale Keeper;
// after: the Pale Keeper hovering its yard), then dies at the keep door,
// releases, and frames wherever the ghost rose (before: the Wyrmwatch cairns
// nearly 300 yd north; after: the churchyard beside the keep). The framing
// mechanism is drakelands_site_shots.mjs's editor free-cam seam.
// Needs `npm run dev` running; browser via scripts/browser_path.mjs.
//   OUT_DIR=/tmp/lk-after node scripts/last_keep_graveyard_shot.mjs
//   MOBILE=1 OUT_DIR=/tmp/lk-after node scripts/last_keep_graveyard_shot.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT_DIR ?? '/tmp/last_keep_graveyard_shot';
const MOBILE = process.env.MOBILE === '1';
fs.mkdirSync(OUT, { recursive: true });

// mobile is landscape-only in-game on the web client
const VIEWPORT = MOBILE
  ? { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { width: 1600, height: 900 };
const SUFFIX = MOBILE ? '-mobile' : '-desktop';

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: VIEWPORT,
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
// The standing capture rule: seed the LOWEST graphics preset before boot.
await page.evaluateOnNewDocument(
  "try { localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 })); } catch (e) {}",
);

let booted = false;
for (let attempt = 0; attempt < 4 && !booted; attempt++) {
  try {
    await page.goto(URL, { waitUntil: 'load', timeout: 45000 });
    await page.waitForSelector('#btn-offline', { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2500));
    await page.evaluate(() => document.querySelector('#btn-offline').click());
    await new Promise((r) => setTimeout(r, 400));
    await page.type('#char-name', 'Yardcheck');
    await page.evaluate(() => {
      document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
      document.querySelector('#btn-start-offline').click();
    });
    const deadline = Date.now() + 120000;
    let ready = false;
    while (!ready && Date.now() < deadline) {
      ready = await page.evaluate(() => {
        const gate = [...document.querySelectorAll('button')].find(
          (b) => b.textContent.trim() === 'Continue to Game' && b.getBoundingClientRect().width > 0,
        );
        gate?.click();
        return !!window.__game?.sim?.player;
      });
      if (!ready) await new Promise((r) => setTimeout(r, 750));
    }
    if (!ready) throw new Error('the world did not boot within 120s');
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
const OVERLAY_BUTTONS = ['Confirm', 'Dismiss', 'Skip Tutorial', 'Understood'];
async function clearOverlays() {
  return page.evaluate((labels) => {
    let clicked = false;
    for (const label of labels) {
      const btn = [...document.querySelectorAll('button')].find(
        (b) => b.textContent.trim() === label && b.getBoundingClientRect().width > 0,
      );
      if (btn) {
        btn.click();
        clicked = true;
      }
    }
    return clicked;
  }, OVERLAY_BUTTONS);
}
for (let i = 0; i < 30; i++) {
  const clicked = await clearOverlays();
  if (!clicked && i > 6) break;
  await new Promise((r) => setTimeout(r, 500));
}

async function teleport(x, z) {
  await page.evaluate(
    (x, z) => {
      const p = window.__game.sim.player;
      p.pos.x = x;
      p.pos.z = z;
      p.prevPos.x = x;
      p.prevPos.z = z;
    },
    x,
    z,
  );
}

async function frame(name, cam, target, settleMs = 7000) {
  await page.evaluate(
    (c, t) => {
      const g = window.__game;
      const gy = g.sim.player.pos.y;
      g.renderer.editorCam = {
        pos: { x: c.x, y: gy + c.h, z: c.z },
        target: { x: t.x, y: gy + t.h, z: t.z },
      };
    },
    cam,
    target,
  );
  await new Promise((r) => setTimeout(r, settleMs));
  for (let i = 0; i < 6; i++) {
    if (!(await clearOverlays())) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `${OUT}/${name}${SUFFIX}.png` });
  console.log('wrote', `${OUT}/${name}${SUFFIX}.png`);
}

// 1. The churchyard south of the keep chapel, from the plaza side.
const YARD = { x: 451, z: 2134 };
// park the player off-frame, south-east of the yard, so only the yard shows
await teleport(YARD.x + 22, YARD.z - 14);
await page.evaluate(() => {
  const p = window.__game.sim.player;
  p.maxHp = 99999;
  p.hp = 99999;
});
await frame('churchyard', { x: 434, z: 2116, h: 12 }, { x: YARD.x, z: YARD.z, h: 1 });

// 2. Die at the keep's dungeon door and release: where does the ghost rise?
// 3 yd short of doorPos (479.4, 2168.1): the death stays on the terrace, outside
// the instance trigger, the way a player dies fighting at the keep.
const DOOR = { x: 474, z: 2168 };
await teleport(DOOR.x, DOOR.z);
await new Promise((r) => setTimeout(r, 1500));
const rose = await page.evaluate(async () => {
  const g = window.__game;
  const p = g.sim.player;
  p.hp = 0;
  p.dead = true;
  await new Promise((r) => setTimeout(r, 300));
  g.sim.releaseSpirit();
  await new Promise((r) => setTimeout(r, 300));
  return { x: p.pos.x, z: p.pos.z, ghost: !!p.ghost };
});
console.log('ghost rose at', JSON.stringify(rose));
const yardsFromDoor = Math.hypot(rose.x - DOOR.x, rose.z - DOOR.z);
console.log('yards from the keep door:', yardsFromDoor.toFixed(1));
// Frame the ghost from behind, looking toward the keep door.
const dx = DOOR.x - rose.x;
const dz = DOOR.z - rose.z;
const dl = Math.hypot(dx, dz) || 1;
await frame(
  'release-from-keep',
  { x: rose.x - (dx / dl) * 12, z: rose.z - (dz / dl) * 12, h: 8 },
  { x: rose.x, z: rose.z, h: 2 },
);

await browser.close();
console.log('done');
