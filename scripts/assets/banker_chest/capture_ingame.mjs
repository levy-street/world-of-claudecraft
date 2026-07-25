// Capture matched banker-chest evidence from a running World of ClaudeCraft client.
//
// Required environment variables:
//   GAME_URL     Base URL of the running worktree, such as http://127.0.0.1:5183
//   SHOT_PREFIX  Output prefix, normally before or after
//
// Optional environment variables:
//   PROFILE_NAME desktop-ultra or mobile-low; omit to capture both
//   BANKER_ID    NPC template ID; defaults to bursar_fernando
//   EXPECT_CHEST 0 for a release-base capture, 1 for a feature capture
//   OUT_DIR      Absolute or working-directory-relative screenshot directory
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from '../../browser_path.mjs';
import { enterOfflineGame } from '../../enter_offline_game.mjs';
import { suppressGpuNotice } from '../../lib/gpu_notice_suppress.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const GAME_URL = process.env.GAME_URL;
const SHOT_PREFIX = process.env.SHOT_PREFIX;
const BANKER_ID = process.env.BANKER_ID ?? 'bursar_fernando';
const OUT_DIR = path.resolve(
  process.env.OUT_DIR ?? path.join(ROOT, 'docs/screenshots/banker-chest'),
);

if (!GAME_URL || !SHOT_PREFIX) {
  throw new Error('GAME_URL and SHOT_PREFIX are required');
}

const expectedChest =
  process.env.EXPECT_CHEST === undefined ? null : process.env.EXPECT_CHEST === '1';
const profiles = [
  {
    name: 'desktop-ultra',
    query: '?gfx=ultra',
    expectedTier: 'ultra',
    settings: {
      graphicsPreset: 4,
      terrainDetail: 1,
      foliageDensity: 1,
      effectsQuality: 1,
      shadowQuality: 1,
      brightness: 1,
      renderScale: 1,
    },
    viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
    mobile: false,
  },
  {
    name: 'mobile-low',
    query: '?gfx=low',
    expectedTier: 'low',
    settings: {
      graphicsPreset: 1,
      terrainDetail: 0,
      foliageDensity: 0,
      effectsQuality: 0,
      shadowQuality: 0,
      brightness: 1,
      renderScale: 1,
    },
    viewport: {
      width: 844,
      height: 390,
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    },
    mobile: true,
  },
].filter((profile) => !process.env.PROFILE_NAME || profile.name === process.env.PROFILE_NAME);

if (profiles.length === 0) throw new Error(`Unknown PROFILE_NAME: ${process.env.PROFILE_NAME}`);

mkdirSync(OUT_DIR, { recursive: true });

for (const profile of profiles) {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: [
      `--window-size=${profile.viewport.width},${profile.viewport.height}`,
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
    ],
    defaultViewport: profile.viewport,
  });

  try {
    const page = await browser.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    if (profile.mobile) {
      await page.emulate({
        viewport: profile.viewport,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
          '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      });
      const cdp = await page.target().createCDPSession();
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'pointer', value: 'coarse' },
          { name: 'hover', value: 'none' },
        ],
      });
    }

    await page.evaluateOnNewDocument((settings) => {
      localStorage.setItem('woc_settings', JSON.stringify(settings));
      localStorage.setItem('woc_spawn_intro_seen:offline:warrior:Vaultseer', '1');
    }, profile.settings);
    await suppressGpuNotice(page);

    await page.goto(`${GAME_URL}/${profile.query}`, {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });
    if (profile.mobile) {
      await page.evaluate(() => document.body.classList.add('mobile-touch'));
    }
    const booted = await enterOfflineGame(page, {
      charClass: 'warrior',
      charName: 'Vaultseer',
      settleMs: 2000,
    });
    if (!booted) throw new Error('offline game did not boot');

    const sceneState = await page.evaluate(
      (mobile, bankerTemplateId) => {
        const game = window.__game;
        const banker = [...game.sim.entities.values()].find(
          (entity) => entity.kind === 'npc' && entity.templateId === bankerTemplateId,
        );
        if (!banker) throw new Error(`${bankerTemplateId} is not present in the live simulation`);

        const forwardX = Math.sin(banker.facing);
        const forwardZ = Math.cos(banker.facing);
        const rightX = Math.cos(banker.facing);
        const rightZ = -Math.sin(banker.facing);
        const targetX = banker.pos.x + rightX * 0.42 - forwardX * 0.32;
        const targetZ = banker.pos.z + rightZ * 0.42 - forwardZ * 0.32;
        const frontDistance = mobile ? 4.8 : 7.2;
        const sideDistance = mobile ? 1.8 : 3;
        const cameraX = targetX + forwardX * frontDistance + rightX * sideDistance;
        const cameraZ = targetZ + forwardZ * frontDistance + rightZ * sideDistance;
        const cameraY = mobile ? 3.2 : 4.05;
        const targetY = mobile ? 2.75 : 1.9;

        const player = game.sim.player;
        player.pos.x = cameraX + forwardX * 1.5;
        player.pos.y = 0;
        player.pos.z = cameraZ + forwardZ * 1.5;
        player.prevPos.x = player.pos.x;
        player.prevPos.y = player.pos.y;
        player.prevPos.z = player.pos.z;
        player.hp = player.maxHp = 999999;

        const makeVector = (x, y, z) => game.renderer.camera.position.clone().set(x, y, z);
        game.renderer.editorCam = {
          pos: makeVector(cameraX, cameraY, cameraZ),
          target: makeVector(targetX, targetY, targetZ),
        };

        document.querySelector('.tut-skip')?.click();
        document.querySelector('.camera-prompt-confirm')?.click();
        const style = document.createElement('style');
        style.textContent = '.nameplate.np-hostile { display: none !important; }';
        document.head.appendChild(style);

        return {
          banker: {
            id: banker.id,
            x: banker.pos.x,
            y: banker.pos.y,
            z: banker.pos.z,
            facing: banker.facing,
          },
          camera: { x: cameraX, y: cameraY, z: cameraZ },
          target: { x: targetX, y: targetY, z: targetZ },
        };
      },
      profile.mobile,
      BANKER_ID,
    );

    await delay(3000);
    const renderState = await page.evaluate(async (bankerId) => {
      const game = window.__game;
      const { GFX } = await import('/src/render/gfx.ts');
      const view = game.renderer.views.get(bankerId);
      const chest = view?.group.getObjectByName('bankerChestDecoration');
      return {
        preset: JSON.parse(localStorage.getItem('woc_settings') ?? '{}').graphicsPreset,
        tier: GFX.tier,
        bankerVisible: view?.group.visible ?? false,
        chestPresent: !!chest,
        chestVisible: chest?.visible ?? false,
        chestWorld: chest
          ? (() => {
              const position = chest.getWorldPosition(game.renderer.camera.position.clone());
              return { x: position.x, y: position.y, z: position.z };
            })()
          : null,
      };
    }, sceneState.banker.id);

    const output = path.join(OUT_DIR, `${SHOT_PREFIX}-${profile.name}.png`);
    await page.screenshot({ path: output });
    console.log(
      JSON.stringify(
        { output, profile: profile.name, sceneState, renderState, pageErrors, consoleErrors },
        null,
        2,
      ),
    );
    if (!renderState.bankerVisible) throw new Error('banker render view is not visible');
    if (renderState.tier !== profile.expectedTier) {
      throw new Error(`expected ${profile.expectedTier} tier, got ${renderState.tier}`);
    }
    if (expectedChest !== null && renderState.chestPresent !== expectedChest) {
      throw new Error(`expected chest presence ${expectedChest}, got ${renderState.chestPresent}`);
    }
    if (expectedChest && !renderState.chestVisible) {
      throw new Error('expected the banker chest to be visible');
    }
    if (pageErrors.length > 0) throw new Error(pageErrors.join(' | '));
  } finally {
    await browser.close();
  }
}
