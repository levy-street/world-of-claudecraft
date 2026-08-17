// Screenshots for the castle exterior fixes: the Dawnhold curtain's remainder
// breach (now filled), the Ashen Bulwark's previously invisible walls (now a
// full render assembly, src/render/bulwark_features.ts), and the banner cloth
// that vanished from outside the walls (now double-sided via castle_kit).
// Boots the offline world once, then drives the renderer's editor free-cam
// seam through one framing per fix, outside the walls where each defect was
// reported. Needs `npm run dev` running; browser via scripts/browser_path.mjs.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT_DIR ?? '/tmp/castle_fix_shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

let booted = false;
for (let attempt = 0; attempt < 4 && !booted; attempt++) {
  try {
    await page.goto(URL, { waitUntil: 'load', timeout: 45000 });
    await page.waitForSelector('#btn-offline', { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2500));
    await page.evaluate(() => document.querySelector('#btn-offline').click());
    await new Promise((r) => setTimeout(r, 400));
    await page.type('#char-name', 'Wallcheck');
    await page.evaluate(() => {
      document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
      document.querySelector('#btn-start-offline').click();
    });
    await page.waitForFunction(() => !!window.__game?.sim?.player, {
      timeout: 120000,
      polling: 500,
    });
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
// The first-run camera picker mounts a beat after world entry; poll it (and
// the software-GL notice) away before any framing, or the first shot eats it.
for (let i = 0; i < 30; i++) {
  const cleared = await page.evaluate(() => {
    for (const label of ['Confirm', 'Dismiss']) {
      const btn = [...document.querySelectorAll('button')].find(
        (b) => b.textContent.trim() === label && b.getBoundingClientRect().width > 0,
      );
      btn?.click();
    }
    return ![...document.querySelectorAll('button')].some(
      (b) => b.textContent.trim() === 'Confirm' && b.getBoundingClientRect().width > 0,
    );
  });
  if (cleared && i > 3) break;
  await new Promise((r) => setTimeout(r, 500));
}

// Free-cam shot: teleport the player near the camera (drives zone features,
// entity interest, and streaming), then pin the exact pose via editorCam.
// Teleports cross zones here, so give the streamer a longer settle.
async function shot(name, cam, target, settleMs = 6000) {
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
  // the first-run camera picker and software-GL notice mount late; clear
  // whichever is up right before the frame (idempotent)
  await page.evaluate(() => {
    for (const label of ['Confirm', 'Dismiss']) {
      const btn = [...document.querySelectorAll('button')].find(
        (b) => b.textContent.trim() === label && b.getBoundingClientRect().width > 0,
      );
      btn?.click();
    }
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('wrote', `${OUT}/${name}.png`);
}

// 1. Dawnhold's west curtain from the Evergarden lawn: the wall run beside
// the SW corner tower, where the module grid left the three-yard breach.
await shot('dawnhold_west_wall', { x: 230, z: 916, h: 6 }, { x: 241, z: 917.5, h: 7 });
// 2. Dawnhold's east front from outside the main gate: tower shield banners
// and the gate banners, which used to vanish from this side.
await shot('dawnhold_gate_banners', { x: 302, z: 886, h: 7 }, { x: 291, z: 895, h: 9 });
// 3. The Ashen Bulwark from the isthmus approach: the muster gate front and
// the east curtain, which previously rendered nothing at all.
await shot('bulwark_muster_front', { x: 260, z: 2344, h: 6 }, { x: 243, z: 2340, h: 6 });
// 4. The Bulwark wide from the southeast, Sea Watch behind the south run.
await shot('bulwark_wide', { x: 262, z: 2360, h: 9 }, { x: 230, z: 2330, h: 6 });
// 5. The Last Keep's west front from the Wyrmwatch road: barbican banners and
// the wall-walk banners, from the outside where they used to vanish.
await shot('lastkeep_west_banners', { x: 336, z: 2026, h: 8 }, { x: 361, z: 2030, h: 11 });

await browser.close();
console.log('done');
