// Real-client visual proof for the rideable tank mount.
//
// Needs a Vite dev server (GAME_URL defaults to http://127.0.0.1:5173).
// The script enters an offline developer world, acquires the tank through
// /dev mounts, summons it through its inventory item, and captures two
// in-game views. Environment overrides can capture Low/mobile/HUD evidence:
// GROUNDSHAKER_GRAPHICS_PRESET=1 GROUNDSHAKER_SHOW_UI=1 GROUNDSHAKER_TOUCH=1 GROUNDSHAKER_WIDTH=960 GROUNDSHAKER_HEIGHT=540
// GROUNDSHAKER_CAPTURE_SUFFIX=-low-mobile node scripts/terrorspark_groundshaker_shot.mjs

import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5173';
const OUT = 'docs/screenshots/terrorspark-groundshaker/in-game';
const GRAPHICS_PRESET = Number(process.env.GROUNDSHAKER_GRAPHICS_PRESET ?? 4);
const SHOW_UI = process.env.GROUNDSHAKER_SHOW_UI === '1';
const WIDTH = Number(process.env.GROUNDSHAKER_WIDTH ?? 1600);
const HEIGHT = Number(process.env.GROUNDSHAKER_HEIGHT ?? 1000);
const TOUCH = process.env.GROUNDSHAKER_TOUCH === '1';
const CAPTURE_SUFFIX = process.env.GROUNDSHAKER_CAPTURE_SUFFIX ?? '';
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    `--window-size=${WIDTH},${HEIGHT}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-dev-shm-usage',
    '--no-sandbox',
  ],
  defaultViewport: {
    width: WIDTH,
    height: HEIGHT,
    hasTouch: TOUCH,
    isMobile: TOUCH,
  },
});

const page = await browser.newPage();
const errors = [];
const consoleErrors = [];
page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(`CONSOLE: ${message.text()}`);
});

await page.evaluateOnNewDocument((graphicsPreset) => {
  localStorage.setItem('woc_gpu_notice_dismissed', '1');
  localStorage.setItem(
    'woc_settings',
    JSON.stringify({
      graphicsPreset,
      terrainDetail: 1,
      foliageDensity: 1,
      effectsQuality: 1,
      shadowQuality: 1,
      brightness: 1,
    }),
  );
}, GRAPHICS_PRESET);
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60_000 });
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Tankdriver',
  settleMs: 1800,
  gameBootTimeoutMs: 60_000,
});
if (!booted) {
  await page.screenshot({ path: `${OUT}/groundshaker-boot-failure.png` });
  console.error([...errors, ...consoleErrors].join('\n'));
  await browser.close();
  throw new Error('offline game did not boot');
}

const summon = await page.evaluate(() => {
  const game = window.__game;
  const sim = game.sim;
  sim.chat('/dev mounts');
  const added = sim.countItem('reins_terrorspark_groundshaker', sim.playerId);
  const used = sim.useItem('reins_terrorspark_groundshaker', sim.playerId);
  return { added, used };
});
if (summon.added !== 1) {
  throw new Error(`tank summon setup failed: ${JSON.stringify(summon)}`);
}

await page.waitForFunction(
  () => window.__game?.sim?.player?.mountKey === 'terrorspark_groundshaker',
  {
    timeout: 10_000,
  },
);
await page.waitForFunction(
  () => {
    const game = window.__game;
    const view = game?.renderer?.views?.get(game.sim.playerId);
    return (
      view?.mountVisualKey === 'mount_terrorspark_groundshaker' && view?.mountVisual?.root?.visible
    );
  },
  { timeout: 20_000 },
);

const rig = await page.evaluate((showUi) => {
  const game = window.__game;
  const sim = game.sim;
  const player = sim.player;
  player.pos.x += 16;
  player.pos.z += 12;
  player.facing = 0;
  player.prevPos = { ...player.pos };
  player.hp = player.maxHp;
  game.input.camYaw = 3.75;
  game.input.camPitch = 0.22;
  game.input.camDist = 7.2;

  for (const entity of sim.entities.values()) {
    if (entity.id === player.id || entity.kind === 'player') continue;
    if (Math.hypot(entity.pos.x - player.pos.x, entity.pos.z - player.pos.z) < 18) {
      entity.pos.x += 80;
      entity.pos.z += 80;
      entity.prevPos = { ...entity.pos };
    }
  }

  if (!showUi) {
    const ui = document.querySelector('#ui');
    if (ui) ui.style.visibility = 'hidden';
  }
  const dismiss = [...document.querySelectorAll('button')].find((button) =>
    /^dismiss$/i.test(button.textContent?.trim() ?? ''),
  );
  dismiss?.click();

  const view = game.renderer.views.get(player.id);
  const mount = view.mountVisual.root;
  const rider = view.visual.root;
  return {
    mountKey: player.mountKey,
    mountVisualKey: view.mountVisualKey,
    playerPos: { ...player.pos },
    mountScale: mount.scale.toArray(),
    riderLocal: rider.position.toArray(),
    mountLocal: mount.position.toArray(),
  };
}, SHOW_UI);

await sleep(1800);
await page.evaluate(() => {
  const game = window.__game;
  game.input.camYaw = 3.75;
  game.input.camPitch = 0.22;
  game.input.camDist = 7.2;
  [...document.querySelectorAll('button')]
    .find((button) => /^dismiss$/i.test(button.textContent?.trim() ?? ''))
    ?.click();
});
await sleep(300);
await page.screenshot({ path: `${OUT}/groundshaker-mounted-hero${CAPTURE_SUFFIX}.png` });

await page.evaluate(() => {
  const game = window.__game;
  game.input.camYaw = 1.42;
  game.input.camPitch = 0.16;
  game.input.camDist = 7.8;
  [...document.querySelectorAll('button')]
    .find((button) => /^dismiss$/i.test(button.textContent?.trim() ?? ''))
    ?.click();
});
await sleep(700);
await page.screenshot({ path: `${OUT}/groundshaker-mounted-side${CAPTURE_SUFFIX}.png` });

console.log(JSON.stringify({ rig, errors, consoleErrors }, null, 2));
if (errors.length > 0) process.exitCode = 1;
await browser.close();
