// Evidence captures for the Smith's Heart raid (docs/design/raid/smith_heart.md)
// in a live offline world: the balcony's first view, each guardian room, the
// Ring with the seal opened into the portal, the hop into the Heart and the
// Heart's overview. Evidence tooling, not a repo test. Needs a dev Vite
// (ALLOW_DEV_COMMANDS is implied offline) serving the worktree.
//
//   node scripts/smith_heart_blockout_shot.mjs <outDir> [label]
//
// Env: SHOT_URL (http://127.0.0.1:5186/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4), SHOT_ONLY (comma list of shot names to take),
// SHOT_MOSAIC=1 (compose every four shots into one 2x2 sheet at half size:
// the iteration mode, a quarter of the images to read).
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5186/';
const OUT = process.argv[2] ?? path.join('tmp', 'smith_heart');
const LABEL = process.argv[3] ?? 'fase2a';
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const ONLY = process.env.SHOT_ONLY ? new Set(process.env.SHOT_ONLY.split(',')) : null;
const MOSAIC = process.env.SHOT_MOSAIC === '1';
// SHOT_DRY=1: walk the whole recipe and log where the player lands, no images.
const DRY = process.env.SHOT_DRY === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The instance-local entry (content/smith_heart_layout.ts SMITH_HEART_ANCHORS).
const ENTRY = { x: -196, z: -210 };

// name, stand (instance-local), look-at, camera yaw offset, pitch, distance,
// and the phase: 'shut' shots run before the portal opens, 'open' after it.
const SHOTS = [
  ['01_balcon', [0, -62], [0, 0], 0, 0.5, 30, 'shut'],
  ['03_martillo_cantera', [-16, -176], [70, -196], 0.04, 0.12, 14, 'shut'],
  ['04_aliento_cornisa', [-52, 194], [20, 198], 0.15, 0.32, 34, 'shut'],
  ['05_temple_lago', [186, -50], [198, 8], -0.1, 0.5, 30, 'shut'],
  ['06_calor_fragua', [-178, 8], [-252, 0], 0.08, 0.22, 24, 'shut'],
  ['02_anillo_portal', [-44, 52], [0, 0], 0.35, 0.36, 26, 'open'],
  ['07_corazon_llegada', 'hop', [188, 172], 0, 0.3, 16, 'open'],
  ['08_corazon_vista', [188, 150], [188, 196], 0.2, 0.95, 78, 'open'],
];

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [`--window-size=${W},${H}`, '--use-angle=d3d11', '--ignore-gpu-blocklist'],
  defaultViewport: { width: W, height: H },
  protocolTimeout: 240000,
});
const taken = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || /THREE\.|shader|WebGL/i.test(m.text()))
      console.log('CONSOLE:', m.type(), m.text().slice(0, 400));
  });
  await page.evaluateOnNewDocument((preset) => {
    try {
      localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: preset }));
    } catch {
      /* ignore */
    }
  }, PRESET);
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
  const booted = await enterOfflineGame(page, {
    charClass: 'warrior',
    charName: 'Heartwalker',
    gameBootTimeoutMs: 180000,
    selectorTimeoutMs: 90000,
    settleMs: 4000,
  });
  if (!booted) throw new Error('offline world did not boot');
  const chat = async (c, wait = 900) => {
    await page.evaluate((line) => window.__game.world.chat(line), c);
    await sleep(wait);
  };
  for (const c of ['/dev level 20', '/dev god', '/dev noaggro', '/dev heart enter'])
    await chat(c, 1500);
  // The Hammer and the Breath are down: two colours on the seal, the ochre and
  // storm-blue rivers lit, as the balcony's first view shows the freed vein.
  await chat('/dev heart kill hammer', 800);
  await chat('/dev heart kill breath', 800);
  for (const p of ['h1', 'h2', 'h3']) await chat(`/dev heart kill pack ${p}`, 300);
  await page.waitForFunction(
    () => {
      let found = false;
      window.__game.renderer.scene.traverse((o) => {
        if (/smithHeart/i.test(o.name)) found = true;
      });
      return found;
    },
    { timeout: 180000, polling: 1000 },
  );
  await page.addStyleTag({ content: '#ui { display: none !important; }' });
  const O = await page.evaluate(
    ([ex, ez]) => {
      const p = window.__game.world.player;
      return { x: p.pos.x - ex, z: p.pos.z - ez };
    },
    [ENTRY.x, ENTRY.z],
  );
  console.log('origin', O);
  const place = async (at, look, yaw, pitch, dist) =>
    page.evaluate(
      ([ox, oz, x, z, fx, fz, yaw, pitch, dist]) => {
        const w = window.__game.world;
        const p = w.player;
        const g = w.ctx.groundPos(ox + x, oz + z);
        p.pos = { ...g };
        p.prevPos = { ...g };
        p.facing = Math.atan2(fx - x, fz - z);
        p.prevFacing = p.facing;
        // Hold the framing every frame (the dungeon zoom ceiling would pull
        // a far camera back in).
        const input = window.__game.input;
        window.__shotHold = { yaw: p.facing + yaw, pitch, dist };
        if (!window.__shotHoldLoop) {
          window.__shotHoldLoop = true;
          const hold = () => {
            const h = window.__shotHold;
            if (h) {
              input.zoomMax = Math.max(input.zoomMax, h.dist);
              input.camYaw = h.yaw;
              input.camPitch = h.pitch;
              input.camDist = h.dist;
            }
            requestAnimationFrame(hold);
          };
          requestAnimationFrame(hold);
        }
      },
      [O.x, O.z, at[0], at[1], look[0], look[1], yaw, pitch, dist],
    );
  let opened = false;
  for (const [name, at, look, yaw, pitch, dist, phase] of SHOTS) {
    if (phase === 'open' && !opened) {
      opened = true;
      // Stand on the Ring facing the seal, light the last vein and let every
      // river reach the seal, then clear the Ring: the seal splits open into
      // the portal. The Ring's shot catches the burst (SHOT_BURST_MS after it
      // opens); the Heart's shots come after.
      await place([-44, 52], [0, 0], 0.35, 0.36, 26);
      await chat('/dev heart kill quench', 300);
      await sleep(11000);
      await chat('/dev heart kill trash', 0);
      await sleep(Number(process.env.SHOT_BURST_MS ?? 2000));
    }
    if (ONLY && !ONLY.has(name)) continue;
    // The Heat's guardian falls before its shot: the giant anvil behind it
    // shows, and the white-gold river runs out of the forge.
    if (name === '06_calor_fragua') await chat('/dev heart kill heat', 300);
    if (at === 'hop') {
      // Walk into the portal for real: the sim sets the player down in the Heart.
      await place([0, -6], [0, 0], 0, pitch, dist);
      await page.evaluate(
        ([ox, oz]) => {
          const p = window.__game.world.player;
          const g = window.__game.world.ctx.groundPos(ox, oz);
          p.pos = { ...g };
          p.prevPos = { ...g };
        },
        [O.x, O.z],
      );
      await sleep(250);
      await page.evaluate(
        ([yaw, pitch, dist]) => {
          const p = window.__game.world.player;
          window.__shotHold = { yaw: p.facing + yaw, pitch, dist };
        },
        [yaw, pitch, dist],
      );
      await sleep(900);
    } else if (name === '02_anillo_portal') {
      // Already standing there: the burst is on.
    } else {
      await place(at, look, yaw, pitch, dist);
      await sleep(DRY ? 1500 : 6000);
    }
    const where = await page.evaluate(() => {
      const p = window.__game.world.player;
      return `${p.pos.x.toFixed(1)} ${p.pos.y.toFixed(1)} ${p.pos.z.toFixed(1)}`;
    });
    console.log(name, 'at', where);
    if (DRY) continue;
    const buf = await page.screenshot();
    if (MOSAIC) {
      taken.push({ name, buf });
    } else {
      fs.mkdirSync(OUT, { recursive: true });
      const file = path.join(OUT, `${name}_${LABEL}.png`);
      fs.writeFileSync(file, buf);
      console.log('SHOT', file);
    }
  }
} finally {
  await browser.close();
}
if (MOSAIC && taken.length) {
  fs.mkdirSync(OUT, { recursive: true });
  const hw = Math.round(W / 2);
  const hh = Math.round(H / 2);
  for (let s = 0; s < taken.length; s += 4) {
    const tiles = await Promise.all(
      taken.slice(s, s + 4).map(async (t, i) => ({
        input: await sharp(t.buf).resize(hw, hh).png().toBuffer(),
        left: (i % 2) * hw,
        top: Math.floor(i / 2) * hh,
      })),
    );
    const file = path.join(OUT, `mosaic_${s / 4 + 1}_${LABEL}.png`);
    await sharp({ create: { width: W, height: H, channels: 3, background: '#000' } })
      .composite(tiles)
      .png()
      .toFile(file);
    console.log(
      'MOSAIC',
      file,
      taken
        .slice(s, s + 4)
        .map((t) => t.name)
        .join(' '),
    );
  }
}
