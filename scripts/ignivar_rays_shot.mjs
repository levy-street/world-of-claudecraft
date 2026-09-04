// Captures Revolving Inferno's warning and active phases through the real client.
// Requires the worktree dev server on GAME_URL, defaulting to 127.0.0.1:5173.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';

const gameUrl = process.env.GAME_URL ?? 'http://127.0.0.1:5173';
const outputDirectory = path.resolve(process.env.SHOT_OUT ?? 'tmp/ignivar-rays');
const graphicsProfile = process.argv.includes('--low-mobile') ? 'low-mobile' : 'ultra';
const mobile = graphicsProfile === 'low-mobile';
const viewport = mobile
  ? { width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
  : { width: 1600, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
const graphicsPreset = mobile ? 1 : 5;
const forcedGraphicsTier = mobile ? 'low' : 'ultra';
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
const consoleErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') {
    consoleErrors.push({ text: message.text(), url: message.location().url });
  }
});
await suppressGpuNotice(page);

try {
  await page.evaluateOnNewDocument(
    (stagedGraphicsPreset, stagedMobile) => {
      localStorage.setItem('woc_unsupported_browser_dismissed', '1');
      localStorage.setItem(
        'woc_settings',
        JSON.stringify({
          graphicsPreset: stagedGraphicsPreset,
          terrainDetail: stagedMobile ? 0 : 1,
          effectsQuality: stagedMobile ? 0 : 1,
          shadowQuality: stagedMobile ? 0 : 1,
        }),
      );
    },
    graphicsPreset,
    mobile,
  );
  await page.goto(`${gameUrl}?gfx=${forcedGraphicsTier}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  });
  const booted = await enterOfflineGame(page, {
    charClass: 'warrior',
    charName: 'Raywatcher',
    settleMs: 800,
    gameBootTimeoutMs: 90_000,
  });
  const debugState = await page.evaluate(() => ({
    game: Boolean(window.__game),
    sim: Boolean(window.__game?.sim),
    player: Boolean(window.__game?.sim?.player),
  }));
  if (!booted && !debugState.player) {
    const failure = path.join(outputDirectory, 'boot-failure.png');
    await page.screenshot({ path: failure });
    throw new Error(
      `offline world did not boot: ${JSON.stringify({ failure, debugState, pageErrors, consoleErrors })}`,
    );
  }

  const bossId = await page.evaluate(() => {
    const game = window.__game;
    game.sim.setPlayerLevel(60);
    game.sim.chat('/dev god');
    game.sim.chat('/dev dungeon ignivar_raid_arena normal');
    for (let index = 0; index < 10; index++) game.sim.tick();
    const player = game.sim.player;
    const boss = [...game.sim.entities.values()].find(
      (entity) => entity.templateId === 'ignivar_herald_of_the_last_flame',
    );
    if (!boss) return null;
    player.pos.x = boss.pos.x;
    player.pos.z = boss.pos.z + 1;
    player.prevPos = { ...player.pos };
    player.facing = Math.PI;
    player.prevFacing = Math.PI;
    player.vx = 0;
    player.vz = 0;
    game.input.camYaw = Math.PI;
    game.input.camPitch = 0.72;
    game.input.camDist = 31;
    boss.hostile = false;
    boss.attackable = false;
    boss.inCombat = false;
    boss.targetId = null;
    boss.facing = 0;
    boss.prevFacing = 0;
    return boss.id;
  });
  if (!bossId) throw new Error('Ignivar did not spawn in the raid room');

  async function stage(phase, remaining) {
    await page.evaluate(
      (id, stagedPhase, stagedRemaining) => {
        clearInterval(window.__ignivarRayStage);
        const apply = () => {
          const boss = window.__game.sim.entities.get(id);
          if (!boss) return;
          boss.castingAbility = 'Revolving Inferno';
          boss.castTotal = 10;
          boss.castRemaining = stagedRemaining;
          boss.channeling = true;
          boss.facing = 0;
          boss.prevFacing = 0;
          boss.hostile = false;
          boss.attackable = false;
          boss.inCombat = false;
          boss.targetId = null;
          boss.userData = { ...(boss.userData ?? {}), stagedPhase };
        };
        apply();
        window.__ignivarRayStage = setInterval(apply, 16);
      },
      bossId,
      phase,
      remaining,
    );
    await sleep(1_200);
    const output = path.join(outputDirectory, `${graphicsProfile}-${phase}.png`);
    await page.screenshot({ path: output });
    return output;
  }

  const windup = await stage('windup', 9);
  const active = await stage('active', 6);
  const renderState = await page.evaluate((id) => {
    const view = window.__game.renderer.views.get(id);
    const rays = view?.group?.getObjectByName('ignivarRotatingRaysTelegraph');
    const phases = rays?.children
      .filter((child) => child.userData.vfxLayer === 'fireBeam')
      .map((beam) => beam.userData.phase);
    return {
      viewExists: Boolean(view),
      raysVisible: rays?.visible ?? false,
      rayChildren: rays?.children.length ?? 0,
      phases,
    };
  }, bossId);

  const fatalConsoleErrors = consoleErrors.filter(
    (entry) => !entry.text.startsWith('Failed to load resource:'),
  );
  if (pageErrors.length || fatalConsoleErrors.length) {
    throw new Error(
      `client errors: ${JSON.stringify({ pageErrors, fatalConsoleErrors }, null, 2)}`,
    );
  }
  if (
    !renderState.viewExists ||
    !renderState.raysVisible ||
    renderState.rayChildren !== 12 ||
    renderState.phases?.some((phase) => phase !== 'active')
  ) {
    throw new Error(`ray render contract failed: ${JSON.stringify(renderState)}`);
  }
  console.log(JSON.stringify({ graphicsProfile, viewport, windup, active, renderState }, null, 2));
} finally {
  await browser.close();
}
