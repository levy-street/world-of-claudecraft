// Captures the Evergarden wisp maze trial (world quest wq_evergarden_wisp_maze)
// through the real offline client: an overview of the whole maze and its
// surroundings, the gameplay chase view, and a close look at the guardians.
// Requires a dev server on GAME_URL (default 127.0.0.1:5173). Lowest graphics
// preset by default (the capture rule); `--high` shoots the Ultra profile.
//
//   GAME_URL=http://127.0.0.1:5177 SHOT_OUT=tmp/wisp-maze PREFIX=after node scripts/wisp_maze_shot.mjs

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';

const gameUrl = process.env.GAME_URL ?? 'http://127.0.0.1:5173';
const outputDirectory = path.resolve(process.env.SHOT_OUT ?? 'tmp/wisp-maze');
const prefix = process.env.PREFIX ?? 'shot';
const high = process.argv.includes('--high');
const mobile = process.argv.includes('--mobile');
const viewport = mobile
  ? { width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
  : { width: 1600, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

mkdirSync(outputDirectory, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    `--window-size=${viewport.width},${viewport.height}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: viewport,
});
const page = await browser.newPage();
if (mobile) {
  await page.setUserAgent(
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36',
  );
}
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await suppressGpuNotice(page);

// A fixed camera for scenic frames: every WebGLRenderer.render call re-seats the
// live camera, so post passes and culling all see the same pose.
const pinCamera = (pose) =>
  page.evaluate((p) => {
    const game = window.__game;
    const gl = game.renderer.webgl;
    if (!gl.__origRender) gl.__origRender = gl.render.bind(gl);
    window.__pinnedPose = p;
    gl.render = (scene, camera) => {
      const pose = window.__pinnedPose;
      if (pose && camera.isPerspectiveCamera) {
        // The live camera's world matrix is frozen between frames: compose it here.
        // lookAt reads its eye from matrixWorld, so seat the position first.
        camera.position.set(pose.eye[0], pose.eye[1], pose.eye[2]);
        camera.updateMatrix();
        camera.matrixWorld.copy(camera.matrix);
        camera.lookAt(pose.at[0], pose.at[1], pose.at[2]);
        camera.updateMatrix();
        camera.matrixWorld.copy(camera.matrix);
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      }
      return gl.__origRender(scene, camera);
    };
  }, pose);

const shoot = async (name, hideUi = true) => {
  await page.evaluate((hide) => {
    document.getElementById('gpu-notice')?.remove();
    const ui = document.querySelector('#ui');
    if (ui) ui.style.visibility = hide ? 'hidden' : '';
  }, hideUi);
  await sleep(2500);
  const file = path.join(outputDirectory, `${prefix}-${name}${mobile ? '-mobile' : ''}.png`);
  await page.screenshot({ path: file });
  console.log('shot', file);
};

try {
  await page.evaluateOnNewDocument(
    (preset) => {
      localStorage.setItem('woc_unsupported_browser_dismissed', '1');
      localStorage.setItem('woc.cameraModePrompt.shown', '1');
      localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: preset }));
    },
    high ? 5 : 1,
  );
  await page.goto(high ? `${gameUrl}?gfx=ultra` : gameUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  });
  const booted = await enterOfflineGame(page, {
    charClass: 'warrior',
    charName: 'Mazewalker',
    settleMs: 800,
    gameBootTimeoutMs: 240_000,
    selectorTimeoutMs: 90_000,
  });
  if (!booted && !(await page.evaluate(() => Boolean(window.__game?.sim?.player)))) {
    throw new Error(`offline world did not boot: ${JSON.stringify(pageErrors)}`);
  }
  await page.addStyleTag({
    content:
      '#gpu-notice, [class*="gpu-notice"], [id*="gpu-notice"], #tutorial-greeting, #loot-settings-window, #options-menu, .camera-prompt-backdrop { display: none !important; }',
  });
  await page.evaluate(() => {
    const game = window.__game;
    game.sim.chat('/dev god');
    game.sim.chat('/dev wisps hard');
  });
  // Let the zone stream in and the maze gate settle.
  await sleep(12_000);
  // Site (450, 1040); the maze spans 44 yd. Ground is about 20 there; read it.
  const ground = await page.evaluate(() => window.__game.sim.player.pos.y);
  const g = (y) => ground + y;
  await pinCamera({ eye: [450, g(42), 1000], at: [450, g(0), 1042] });
  await shoot('overview');
  await pinCamera({ eye: [480, g(8), 1012], at: [455, g(0), 1035] });
  await shoot('northeast');
  await pinCamera({ eye: [492, g(14), 1072], at: [456, g(0), 1036] });
  await shoot('southeast');
  const guardian = await page.evaluate(() => {
    const game = window.__game;
    const state = game.sim.worldQuestLog?.get?.('wq_evergarden_wisp_maze')?.wispMaze;
    const enemy = state?.enemies?.[0];
    return enemy ? { x: 450 + enemy.x, z: 1040 + enemy.z } : { x: 450, z: 1024 };
  });
  await pinCamera({
    eye: [guardian.x + 2.5, g(2.6), guardian.z + 3.8],
    at: [guardian.x, g(1.2), guardian.z],
  });
  await shoot('guardian');
  await page.evaluate(() => {
    window.__pinnedPose = null;
    const input = window.__game.input;
    input.camPitch = 0.55;
    input.camDist = 14;
  });
  await shoot('gameplay', false);
  if (pageErrors.length) console.log('page errors', pageErrors.slice(0, 5));
} finally {
  await browser.close();
}
