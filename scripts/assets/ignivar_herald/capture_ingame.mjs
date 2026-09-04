// Capture Ignivar through the real character loader inside the live raid room.
// Requires the worktree dev server at GAME_URL (defaults to 127.0.0.1:5173).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from '../../browser_path.mjs';
import { enterOfflineGame } from '../../enter_offline_game.mjs';
import { suppressGpuNotice } from '../../lib/gpu_notice_suppress.mjs';

const gameUrl = process.env.GAME_URL ?? 'http://127.0.0.1:5173';
const output = path.resolve(process.env.SHOT_OUT ?? 'tmp/ignivar-boss-model-ingame-colossus.png');
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

mkdirSync(path.dirname(output), { recursive: true });
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
const consoleErrors = [];
const assetResponses = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('response', (response) => {
  if (response.url().includes('/models/creatures/ignivar_herald.glb')) {
    assetResponses.push({ status: response.status(), url: response.url() });
  }
});
await suppressGpuNotice(page);

try {
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem(
      'woc_settings',
      JSON.stringify({
        graphicsPreset: 5,
        terrainDetail: 1,
        effectsQuality: 1,
        shadowQuality: 1,
      }),
    );
  });
  await page.goto(`${gameUrl}?gfx=ultra`, {
    waitUntil: 'networkidle0',
    timeout: 120_000,
  });
  const booted = await enterOfflineGame(page, {
    charClass: 'warrior',
    charName: 'Forgebreaker',
    settleMs: 800,
    gameBootTimeoutMs: 120_000,
  });
  if (!booted) {
    await page.screenshot({ path: output });
    throw new Error(
      `offline world did not boot; page=${page.url()}; errors=${JSON.stringify(errors)}; console=${JSON.stringify(consoleErrors)}`,
    );
  }

  const state = await page.evaluate(() => {
    const game = window.__game;
    game.sim.setPlayerLevel(60);
    game.sim.chat('/dev god');
    game.sim.chat('/dev dungeon ignivar_raid_arena');
    for (let index = 0; index < 10; index++) game.sim.tick();

    const player = game.sim.player;
    const boss = [...game.sim.entities.values()].find(
      (entity) => entity.templateId === 'ignivar_herald_of_the_last_flame',
    );
    if (!boss) return { bossId: null };
    player.pos.x = boss.pos.x;
    player.pos.z = boss.pos.z + 13;
    player.prevPos = { ...player.pos };
    player.facing = Math.PI;
    player.prevFacing = Math.PI;
    player.vx = 0;
    player.vz = 0;

    game.input.camYaw = Math.PI;
    game.input.camPitch = 0.34;
    game.input.camDist = 9;
    boss.hostile = false;
    boss.attackable = false;
    boss.inCombat = false;
    boss.targetId = null;
    boss.facing = 0;
    boss.prevFacing = 0;
    return {
      bossId: boss?.id ?? null,
      bossScale: boss?.scale ?? null,
      bossPosition: boss?.pos ?? null,
    };
  });
  if (!state.bossId) throw new Error('Ignivar did not spawn in the raid room');

  await page.evaluate(() => {
    document.querySelector('#options-menu [data-close]')?.click();
    const dismiss = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Dismiss',
    );
    dismiss?.click();
  });

  await sleep(4_000);
  await page.screenshot({ path: output });
  const renderState = await page.evaluate((bossId) => {
    const view = window.__game.renderer.views.get(bossId);
    const names = [];
    let skinnedMeshes = 0;
    let maxJointCount = 0;
    let hasPbrTextures = false;
    let hasRuntimeReadabilityMaterial = false;
    view?.group?.traverse((object) => {
      names.push(object.name);
      if (object.isSkinnedMesh) {
        skinnedMeshes++;
        maxJointCount = Math.max(maxJointCount, object.skeleton?.bones?.length ?? 0);
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        hasPbrTextures ||= materials.some(
          (material) =>
            Boolean(material?.map) &&
            Boolean(material?.normalMap) &&
            Boolean(material?.roughnessMap) &&
            Boolean(material?.metalnessMap),
        );
        hasRuntimeReadabilityMaterial ||= materials.some(
          (material) =>
            Boolean(material?.emissiveMap) &&
            (material?.emissiveIntensity ?? 0) > 0 &&
            Math.abs((material?.envMapIntensity ?? 0) - 1.6) < 0.001,
        );
      }
    });
    return {
      viewExists: Boolean(view),
      hasDedicatedRoot: names.includes('IgnivarRig'),
      hasCoreSocket: names.includes('vfx_core'),
      hasLeftVentSocket: names.some((name) =>
        ['vfx_vent.l', 'vfx_ventl', 'vfx_vent_l'].includes(name),
      ),
      hasRightVentSocket: names.some((name) =>
        ['vfx_vent.r', 'vfx_ventr', 'vfx_vent_r'].includes(name),
      ),
      hasCorePlume: names.includes('vfx_core__plume'),
      hasLeftVentPlume: names.some((name) => /^vfx_vent(?:\.|_)?l__plume$/.test(name)),
      hasRightVentPlume: names.some((name) => /^vfx_vent(?:\.|_)?r__plume$/.test(name)),
      hasCoreFlame: names.includes('vfx_core__flame'),
      hasPulse: names.includes('ignivar__pulse_shell'),
      hasShockwave: names.includes('ignivar__shockwave'),
      skinnedMeshes,
      maxJointCount,
      hasPbrTextures,
      hasRuntimeReadabilityMaterial,
      registeredViewLights: view?.viewLights?.length ?? 0,
    };
  }, state.bossId);

  if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
  const unexpectedConsoleErrors = consoleErrors.filter(
    (message) => !message.includes('status of 502 (Bad Gateway)'),
  );
  if (unexpectedConsoleErrors.length) {
    throw new Error(`console errors: ${unexpectedConsoleErrors.join('; ')}`);
  }
  if (!assetResponses.some((response) => response.status === 200)) {
    throw new Error(`Ignivar GLB did not load successfully: ${JSON.stringify(assetResponses)}`);
  }
  if (!renderState.viewExists || !renderState.hasDedicatedRoot) {
    throw new Error(`dedicated Ignivar view missing: ${JSON.stringify(renderState)}`);
  }
  if (
    !renderState.hasCoreSocket ||
    !renderState.hasLeftVentSocket ||
    !renderState.hasRightVentSocket ||
    !renderState.hasCorePlume ||
    !renderState.hasLeftVentPlume ||
    !renderState.hasRightVentPlume ||
    !renderState.hasCoreFlame ||
    !renderState.hasPulse ||
    !renderState.hasShockwave ||
    renderState.skinnedMeshes !== 1 ||
    renderState.maxJointCount < 17 ||
    !renderState.hasPbrTextures ||
    !renderState.hasRuntimeReadabilityMaterial
  ) {
    throw new Error(`Ignivar animation/shadow contract failed: ${JSON.stringify(renderState)}`);
  }
  console.log(JSON.stringify({ output, state, renderState, assetResponses }, null, 2));
} finally {
  await browser.close();
}
