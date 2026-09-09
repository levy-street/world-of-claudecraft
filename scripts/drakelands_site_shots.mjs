// Before/after captures for the Drakelands map-improvements epic
// (docs/design/drakelands-improvements/plan.md): the Last Keep on its new
// site, the rebuilt Wyrmwatch, the Trollmoot on the old keep grounds, and the
// razed Ashen Bulwark headland. Boots the offline world once at the LOWEST
// graphics preset (the standing capture rule), then drives the renderer's
// editor free-cam seam through one framing per site, the castle_fix_shots.mjs
// mechanism. Run once on the branch (after) and once on the base (before).
// Needs `npm run dev` running; browser via scripts/browser_path.mjs.
//   OUT_DIR=/tmp/drakelands-after node scripts/drakelands_site_shots.mjs
//   MOBILE=1 OUT_DIR=/tmp/drakelands-after node scripts/drakelands_site_shots.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT_DIR ?? '/tmp/drakelands_site_shots';
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
    await page.type('#char-name', 'Sitecheck');
    await page.evaluate(() => {
      document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
      document.querySelector('#btn-start-offline').click();
    });
    // The mobile shell gates entry behind the "Play in Landscape Fullscreen"
    // notice (its Continue to Game button); poll it away while the world
    // boots, then wait for the player the way the desktop flow does.
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
await page.evaluate(() => {
  const skip = [...document.querySelectorAll('button')].find((b) =>
    (b.textContent || '').includes('Skip Tutorial'),
  );
  skip?.click();
});
// The first-run camera picker, the software-GL notice, the tutorial prompt,
// and the Proving Shore ferryman's greeting all mount a beat after world
// entry; poll them away before any framing, or the first shot eats them.
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

// Free-cam shot: teleport the player near the camera (drives zone features,
// entity interest, and streaming), then pin the exact pose via editorCam.
// Teleports cross zones here, so give the streamer a longer settle.
async function shot(name, cam, target, settleMs = 7000) {
  await page.evaluate(
    async (c, t) => {
      const g = window.__game;
      const p = g.sim.player;
      p.maxHp = 99999;
      p.hp = 99999;
      p.pos.x = c.x;
      p.pos.z = c.z;
      p.prevPos.x = c.x;
      p.prevPos.z = c.z;
      await new Promise((r) => setTimeout(r, 250));
      const gy = p.pos.y;
      const dx = t.x - c.x;
      const dz = t.z - c.z;
      const dl = Math.hypot(dx, dz) || 1;
      p.pos.x = c.x - (dx / dl) * 3;
      p.pos.z = c.z - (dz / dl) * 3;
      p.prevPos.x = p.pos.x;
      p.prevPos.z = p.pos.z;
      g.renderer.editorCam = {
        pos: { x: c.x, y: gy + c.h, z: c.z },
        target: { x: t.x, y: gy + t.h, z: t.z },
      };
    },
    cam,
    target,
  );
  await new Promise((r) => setTimeout(r, settleMs));
  // whatever mounted late (a greeting from a teleport-adjacent NPC, the
  // camera picker) is cleared right before the frame; idempotent
  for (let i = 0; i < 6; i++) {
    if (!(await clearOverlays())) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `${OUT}/${name}${SUFFIX}.png` });
  console.log('wrote', `${OUT}/${name}${SUFFIX}.png`);
}

// 1. The Last Keep's new site from the dune-fork road's terminus: the triple
//    gate house and the long west wall (before: the open Trollmoot rise).
await shot('keep-west-approach', { x: 412, z: 2148, h: 9 }, { x: 446, z: 2160, h: 4 });
// 2. The temple court and the placed castle_door, the keep's dungeon door,
//    from the plaza foot of the temple stair.
await shot('keep-temple-court', { x: 462, z: 2168, h: 6 }, { x: 481, z: 2168, h: 4 });
// 3. The whole keep from the bonefield side, south of the pad.
await shot('keep-wide-south', { x: 462, z: 2108, h: 20 }, { x: 466, z: 2150, h: 2 });
// 4. Wyrmwatch's hub: the tavern row, its sign, and the stables yard
//    (before: the old inn, stalls, well, and palisade).
await shot('wyrmwatch-hub', { x: 400, z: 1934, h: 9 }, { x: 410, z: 1914, h: 3 });
// 5. The church and its gravestone garden on the west gate lawn.
await shot('wyrmwatch-church', { x: 404, z: 1892, h: 8 }, { x: 389, z: 1872, h: 5 });
// 6. The Trollmoot on the old keep grounds: the restored ruin ring with the
//    troll camps (before: the Last Keep's curtain wall and barbican).
await shot('trollmoot-old-grounds', { x: 388, z: 2006, h: 11 }, { x: 422, z: 2032, h: 2 });
// 7. The Ashen Bulwark headland from the southeast (before: the barracks
//    compound; after: natural coast for the placer rebuild to come).
await shot('bulwark-headland', { x: 262, z: 2360, h: 9 }, { x: 230, z: 2330, h: 6 });

await browser.close();
console.log('done');
