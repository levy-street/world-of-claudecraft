// Screenshot harness for issue #2678: the offline "Create Character" screen's
// default (skin 0) class preview, for the three model-sharing classes whose
// manifest.ts tintStrength washed the shared base texture under a near-solid
// color (player_priest / player_shaman / player_warlock). Captures the live
// 3D turntable preview (#offline-preview-container) exactly as a new player
// sees it before ever entering the world, on both desktop and mobile
// viewports.
//
// Captures BOTH the "before" (pre-fix tintStrength 0.5/0.4/0.45) and "after"
// (fixed, whatever the working tree currently ships) states from a SINGLE
// page load: after the initial (expensive, asset-heavy) boot, the fixed
// values are already live from the current source, so those shots come
// first; the pre-fix values are then patched onto the already-loaded
// manifest module in-page (re-selecting each class to force a material
// rebuild against the patched value) rather than reloading the page and
// paying the whole boot cost a second time. Two page loads (one per
// viewport) are unavoidable since viewport is fixed at browser launch, but
// each only pays the boot cost once instead of twice.
//
//   node scripts/charcreate_tint_wash_shot.mjs
//
// Needs `npm run dev` running at GAME_URL (default http://localhost:5173).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as DETECTED } from './browser_path.mjs';

// Force a non-software-GL material tier (?gfx=high): swiftshader is mapped to
// the 'low' tier, which routes through Lambert materials plus an unconditional
// low-readability white lift that swamps the class tint delta this shot exists
// to show. Real players hitting this bug are on standard-tier materials.
const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}?gfx=high`;
const OUT_DIR = process.env.OUT_DIR ?? 'tmp/charcreate-tint-shots';
fs.mkdirSync(OUT_DIR, { recursive: true });

const BROWSER_PATH = process.env.BROWSER_PATH ?? DETECTED ?? '/usr/bin/chromium';

const PRE_FIX_STRENGTH = { priest: 0.5, shaman: 0.4, warlock: 0.45 };
const TINTED_CLASSES = ['priest', 'shaman', 'warlock'];
const KEY_OF = { priest: 'player_priest', shaman: 'player_shaman', warlock: 'player_warlock' };

async function shootDevice(browser, device) {
  const viewport = device === 'mobile' ? { width: 844, height: 390 } : { width: 1600, height: 900 };
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log(`PAGEERROR[${device}]:`, e.message));
  await page.setViewport(viewport);
  if (device === 'mobile') {
    const client = await page.target().createCDPSession();
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: true,
    });
  }
  // domcontentloaded, not networkidle0: an unreachable /api/site-presence
  // heartbeat (no game server behind this dev instance) retries frequently
  // enough to keep the network non-idle forever and time out the navigation.
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const jsClick = (sel) =>
    page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) throw new Error(`missing ${s}`);
      el.click();
    }, sel);

  await new Promise((r) => setTimeout(r, 400));
  await jsClick('#btn-offline');
  await page.waitForSelector('#offline-select .mini-class[data-class="warrior"]', {
    visible: true,
    timeout: 15000,
  });
  // Wait for charactersReady() to resolve AND the preview canvas to be
  // re-parented into #offline-preview-container (main.ts's
  // updatePreviewContainer, driven off charactersReady().then()): a fixed
  // sleep is not reliable here, this box can be shared/loaded well past a
  // short default while the character + weapon-skin GLBs (the preview's
  // eager preload set) finish fetching and parsing.
  //
  // charactersReady().then() also picks online vs offline as the mount
  // container from whichever of #charselect-panel/#offline-select is visible
  // AT THE MOMENT it resolves. On a fast dev-server run that promise can
  // settle before this script's click above has been processed, mounting the
  // preview into the hidden #online-preview-container instead, where the
  // canvas never gets a real size. Re-firing #btn-offline once the offline
  // panel is already the active one is harmless (main.ts's panel switcher
  // takes the same-panel "instant" branch and just re-syncs the mount), so
  // poll the width check and retry the click on every miss instead of
  // trusting a single wait to land on the right side of that race.
  let previewReady = false;
  for (let attempt = 0; attempt < 60 && !previewReady; attempt++) {
    previewReady = await page
      .waitForFunction(
        () => (document.querySelector('#char-preview-canvas')?.clientWidth ?? 0) > 0,
        { timeout: 8000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!previewReady) await jsClick('#btn-offline');
  }
  if (!previewReady) throw new Error(`[${device}] character preview canvas never sized`);
  console.log(`[${device}] preview booted`);

  async function shot(name) {
    // Mobile's compact landscape layout gives the preview box just 100px of
    // height by design (see shell.css's `body.mobile-touch #offline-select
    // .char-preview-container` rule), so a tight crop is too small to read
    // the tint delta: capture the whole screen instead, matching how a
    // reviewer would actually see the create screen on a phone.
    if (device === 'mobile') {
      await page.screenshot({ path: `${OUT_DIR}/${device}-${name}.png` });
      console.log('shot:', device, name);
      return;
    }
    let box = null;
    for (let i = 0; i < 10; i++) {
      box = await page.evaluate(() => {
        const el = document.querySelector('#offline-preview-container');
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      });
      if (box && box.w > 0 && box.h > 0) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    if (box && box.w > 0 && box.h > 0) {
      await page.screenshot({
        path: `${OUT_DIR}/${device}-${name}.png`,
        clip: { x: box.x, y: box.y, width: box.w, height: box.h },
      });
    } else {
      await page.screenshot({ path: `${OUT_DIR}/${device}-${name}.png` });
    }
    console.log('shot:', device, name);
  }

  async function selectClass(cls) {
    await jsClick(`#offline-select .mini-class[data-class="${cls}"]`);
    // Let the turntable settle onto the new class model + materials.
    await new Promise((r) => setTimeout(r, 1800));
  }

  // "after": the fixed tintStrength values already live in the current
  // source tree. Include warrior (owns its model outright, never tinted) as
  // a stable no-regression reference alongside the three fixed classes.
  for (const cls of [...TINTED_CLASSES, 'warrior']) {
    await selectClass(cls);
    await shot(`after-${cls}`);
  }

  // Patch the already-loaded manifest module's tintStrength back to the
  // pre-fix values in place, via the SAME module instance the running page's
  // character-preview code reads (Vite dev serves ESM directly, so a fresh
  // dynamic import() in-page resolves the module the app already has
  // loaded, not a new copy). Avoids a second full page load + asset-boot
  // wait just to compare against the old values.
  await page.evaluate(
    async ({ keyOf, strengths }) => {
      const mod = await import('/src/render/characters/manifest.ts');
      for (const [cls, key] of Object.entries(keyOf)) {
        mod.VISUALS[key].tintStrength = strengths[cls];
      }
    },
    { keyOf: KEY_OF, strengths: PRE_FIX_STRENGTH },
  );

  for (const cls of TINTED_CLASSES) {
    // Force a rebuild: renderClassDetails only calls characterPreview.setClass
    // when the class actually changes, so bounce through warrior first.
    await selectClass('warrior');
    await selectClass(cls);
    await shot(`before-${cls}`);
  }

  await page.close();
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 600000,
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--disable-crash-reporter',
    '--disable-breakpad',
  ],
});

const devices = (process.env.DEVICES ?? 'desktop,mobile').split(',');
for (const device of devices) {
  await shootDevice(browser, device);
}

await browser.close();
console.log('done');
