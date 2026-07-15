// Bespoke capture for PR #1921 real in-game before/after screenshots.
// Teleports the offline player into The Drowned Litany (marsh dressing props),
// the Protect Yumi maze (brazier/torch), and the collapsed_reliquary door
// (dungeon_door_arch), then shoots each prop.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOT_DIR ?? 'tmp/tripo_shots';
const MOBILE = process.env.MOBILE === '1';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 60000,
  args: (MOBILE ? ['--window-size=900,420'] : ['--window-size=1280,760']).concat([
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--no-crash-upload',
  ]),
  defaultViewport: MOBILE
    ? { width: 900, height: 420, isMobile: true, hasTouch: true }
    : { width: 1280, height: 760 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await enterOfflineGame(page, { settleMs: 2000 });

async function teleportAndFace(x, z, faceX, faceZ, yaw) {
  await page.evaluate(
    (x, z, faceX, faceZ, yaw) => {
      const w = window.__game.world;
      w.player.pos.x = x;
      w.player.pos.z = z;
      if (typeof faceX === 'number') {
        w.player.facing = Math.atan2(faceX - x, faceZ - z);
      } else if (typeof yaw === 'number') {
        w.player.facing = yaw;
      }
      window.__game.renderer?.snapCameraToPlayer?.();
    },
    x,
    z,
    faceX ?? null,
    faceZ ?? null,
    yaw ?? null,
  );
  await sleep(700);
}

async function shot(name) {
  await sleep(300);
  const suffix = MOBILE ? '-mobile' : '';
  await page.screenshot({ path: `${OUT}/${name}${suffix}.png` });
  console.log(`shot ${name}${suffix}`);
}

const mode = process.argv[2]; // 'marsh' | 'yumi' | 'door'

if (mode === 'door') {
  // collapsed_reliquary dungeon_door marker (zone1), reuses dungeon_door_arch.
  await teleportAndFace(-5, -52, -5, -55);
  await shot('dungeon_door_arch');
} else if (mode === 'yumi') {
  // Yumi maze slot 0 origin (8400, -1250); braziers sit at the plazas near
  // origin, torches line the corridors just off it.
  await teleportAndFace(8400, -1246, 8400, -1250);
  await shot('yumi_brazier_stand');
  await teleportAndFace(8403, -1252, 8403, -1250);
  await shot('yumi_torch_handle');
} else if (mode === 'marsh') {
  await page.evaluate(() => {
    const w = window.__game.world;
    w.player.level = 20;
    w.enterDelve('drowned_litany', 'normal');
  });
  await sleep(2500);
  const probe = await page.evaluate(() => {
    const w = window.__game.world;
    return {
      inDelve: !!w.delveRun,
      moduleId: w.delveRun?.moduleId ?? null,
      x: w.player?.pos?.x,
      z: w.player?.pos?.z,
    };
  });
  console.log('marsh probe', JSON.stringify(probe));
  if (!probe.inDelve) {
    console.log('FAILED to enter drowned_litany delve');
    process.exit(1);
  }
  // Sweep the player position around the module origin looking for placed
  // props (litany dressing anchors are module-local, so scan a local grid
  // near spawn and just shoot the general dressed area at a few points).
  const spots = [
    [0, 6, 'marsh_area_1'],
    [10, 14, 'marsh_area_2'],
    [-8, 18, 'marsh_area_3'],
    [4, 26, 'marsh_area_4'],
  ];
  for (const [dx, dz, label] of spots) {
    await teleportAndFace(probe.x + dx, probe.z + dz, probe.x, probe.z);
    await shot(label);
  }
}

await page.close();
await browser.close();
if (errors.length) console.log('page errors:', errors.slice(0, 5).join('; '));
process.exit(0);
