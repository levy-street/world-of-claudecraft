// Wildheart Basin visual E2E: enter offline through the Palmreach jaguar maw
// and capture the portal, caldera routes, rare Beastmaster, and Zulgar. Needs a
// running dev server with offline dev commands.
//
//   BROWSER_PATH=<chrome> GAME_URL=http://localhost:5173 node scripts/wildheart_shots.mjs

import fs from 'node:fs';
import { chromium } from 'playwright';
import { dismissEntryOverlays, enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOT_DIR ?? 'docs/screenshots/wildheart';
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_PATH || undefined,
  channel: process.env.BROWSER_PATH ? undefined : 'chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
const page = await context.newPage();
await page.addInitScript(() => {
  try {
    window.localStorage.setItem('woc.cameraModePrompt.shown', '1');
  } catch {
    // Private browser contexts can reject localStorage; shot() also dismisses the prompt.
  }
});
page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`CONSOLE: ${message.text()}`);
});

async function tick(frames = 6) {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
  }, frames);
}

async function shot(name) {
  await page
    .waitForFunction(
      () => !document.querySelector('#loading-screen')?.classList.contains('visible'),
      { timeout: 30000 },
    )
    .catch(() => {});
  await dismissEntryOverlays(page);
  await page.evaluate(() => {
    document.querySelector('.camera-prompt-confirm')?.click();
    const gpuNotice = document.getElementById('gpu-notice');
    if (gpuNotice) gpuNotice.hidden = true;
  });
  await tick(5);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
}

console.log('loading + entering offline...');
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await enterOfflineGame(page, { charName: 'Basinwalker', settleMs: 2500 });
await page.waitForFunction(() => !!window.__game?.world?.player, { timeout: 30000, polling: 200 });
await page.evaluate(() => {
  const world = window.__game.world;
  world.chat('/dev level 22', world.player.id);
  world.chat('/dev god', world.player.id);
});

const door = await page.evaluate(() => {
  const world = window.__game.world;
  const entity = [...world.entities.values()].find(
    (candidate) =>
      candidate.templateId === 'dungeon_door' && candidate.dungeonId === 'wildheart_basin',
  );
  if (!entity) throw new Error('wildheart_basin door not found in overworld');
  world.player.pos = { x: entity.pos.x, y: 0, z: entity.pos.z - 9 };
  world.player.prevPos = { ...world.player.pos };
  world.player.facing = 0;
  world.rebucket(world.player);
  window.__game.renderer.camYaw = 0;
  window.__game.renderer.camDist = 7;
  window.__game.renderer.camPitch = 0.24;
  window.__game.input.camYaw = 0;
  return { x: entity.pos.x, z: entity.pos.z };
});
await tick(12);
await shot('wildheart-portal');

await page.evaluate((position) => {
  const world = window.__game.world;
  world.player.pos = { x: position.x, y: 0, z: position.z };
  world.player.prevPos = { ...world.player.pos };
  world.rebucket(world.player);
}, door);
await tick(14);

const origin = await page.evaluate(() => {
  const world = window.__game.world;
  return { x: world.player.pos.x, z: world.player.pos.z + 5 };
});

// Keep the arrival pair on the two banks for the establishing shot. Their
// authored positions intentionally teach the first pull, but a teleported
// screenshot camera would otherwise drag both directly into the foreground.
await page.evaluate(
  ({ originX, originZ }) => {
    const world = window.__game.world;
    let side = -1;
    for (const entity of world.entities.values()) {
      if (!entity.templateId?.startsWith('wildheart_') || entity.pos.z - originZ >= 55) continue;
      entity.pos = { x: originX + side * 29, y: entity.pos.y, z: entity.pos.z };
      entity.prevPos = { ...entity.pos };
      entity.targetId = null;
      world.rebucket(entity);
      side *= -1;
    }
  },
  { originX: origin.x, originZ: origin.z },
);

async function frameLocal(name, x, z, lookX, lookZ, distance, pitch) {
  await page.evaluate(
    ({
      originX,
      originZ,
      x: localX,
      z: localZ,
      lookX: targetX,
      lookZ: targetZ,
      distance,
      pitch,
    }) => {
      const world = window.__game.world;
      world.player.pos = { x: originX + localX, y: 0, z: originZ + localZ };
      world.player.prevPos = { ...world.player.pos };
      world.player.facing = Math.atan2(targetX - localX, targetZ - localZ);
      world.rebucket(world.player);
      window.__game.renderer.camYaw = world.player.facing;
      window.__game.renderer.camDist = distance;
      window.__game.renderer.camPitch = pitch;
      window.__game.input.camYaw = world.player.facing;
    },
    { originX: origin.x, originZ: origin.z, x, z, lookX, lookZ, distance, pitch },
  );
  await shot(name);
}

await frameLocal('wildheart-overlook', -14, 19, 2, 145, 18, 0.58);
await frameLocal('wildheart-waterfall-route', 43, 126, 72, 145, 11, 0.4);

async function frameMob(templateId, name, offsetX, offsetZ, cameraDistance, clearOthers = false) {
  const found = await page.evaluate(
    ({ templateId, offsetX, offsetZ, cameraDistance, clearOthers }) => {
      const world = window.__game.world;
      const mob = [...world.entities.values()].find(
        (entity) => entity.templateId === templateId && !entity.dead,
      );
      if (!mob) return false;
      if (clearOthers) {
        for (const entity of world.entities.values()) {
          if (entity === mob || !entity.templateId?.startsWith('wildheart_')) continue;
          entity.pos = { x: mob.pos.x + 90, y: entity.pos.y, z: mob.pos.z - 90 };
          entity.prevPos = { ...entity.pos };
          world.rebucket(entity);
        }
      }
      world.player.pos = { x: mob.pos.x + offsetX, y: mob.pos.y, z: mob.pos.z + offsetZ };
      world.player.prevPos = { ...world.player.pos };
      world.player.facing = Math.atan2(
        mob.pos.x - world.player.pos.x,
        mob.pos.z - world.player.pos.z,
      );
      world.rebucket(world.player);
      window.__game.renderer.camYaw = world.player.facing;
      window.__game.renderer.camDist = cameraDistance;
      window.__game.renderer.camPitch = 0.32;
      window.__game.input.camYaw = world.player.facing;
      world.targetEntity?.(mob.id);
      return true;
    },
    { templateId, offsetX, offsetZ, cameraDistance, clearOthers },
  );
  if (!found) throw new Error(`${templateId} not found in Wildheart instance`);
  await shot(name);
}

await frameMob('wildheart_beastmaster', 'wildheart-beastmaster', 6, -10, 7);
await frameMob('wildheart_high_priest', 'wildheart-zulgar', 2, -12, 5, true);

console.log(
  errors.length ? `PAGE ERRORS (${errors.length}):\n${errors.join('\n')}` : 'no page errors',
);
await browser.close();
