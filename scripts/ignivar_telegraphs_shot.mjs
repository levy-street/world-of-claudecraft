// Captures Ignivar's Brand, frontal, Falling Cinders ground mark, and Shared Pyre
// through the real client.
// Requires the worktree dev server on GAME_URL, defaulting to 127.0.0.1:5173.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';

const gameUrl = process.env.GAME_URL ?? 'http://127.0.0.1:5173';
const outputDirectory = path.resolve(process.env.SHOT_OUT ?? 'tmp/ignivar-telegraphs');
const graphicsProfile = process.argv.includes('--low-mobile') ? 'low-mobile' : 'ultra';
const mobile = graphicsProfile === 'low-mobile';
const viewport = mobile
  ? { width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
  : { width: 1600, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
const graphicsPreset = mobile ? 1 : 5;
const forcedGraphicsTier = mobile ? 'low' : 'ultra';
const raidTuningOnly = process.argv.includes('--raid-tuning');
const expectRaidTuningVfx = process.argv.includes('--expect-raid-tuning-vfx');
if (expectRaidTuningVfx && !raidTuningOnly) {
  throw new Error('--expect-raid-tuning-vfx requires --raid-tuning');
}
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
      localStorage.setItem('woc.cameraModePrompt.shown', '1');
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
    charName: 'Telegraphwatcher',
    settleMs: 800,
    gameBootTimeoutMs: mobile ? 90_000 : 240_000,
    selectorTimeoutMs: 90_000,
  });
  if (!booted && !(await page.evaluate(() => Boolean(window.__game?.sim?.player)))) {
    throw new Error(`offline world did not boot: ${JSON.stringify({ pageErrors, consoleErrors })}`);
  }
  // QA captures exercise gameplay, not shell notices or raid-admin chrome.
  // Use capture-local CSS so late async mounts cannot reappear between the
  // explicit dismissal below and the next slow SwiftShader frame.
  await page.addStyleTag({
    content:
      '#gpu-notice, #tutorial-greeting, #loot-settings-window, #options-menu, .camera-prompt-backdrop { display: none !important; }',
  });

  const fixture = await page.evaluate(() => {
    const game = window.__game;
    game.sim.setPlayerLevel(60);
    game.sim.chat('/dev god');
    game.sim.chat('/dev dungeon ignivar_raid_arena normal');
    for (let index = 0; index < 10; index++) game.sim.tick();
    game.sim.chat('/dev ignivarraid');
    for (let index = 0; index < 10; index++) game.sim.tick();
    const player = game.sim.player;
    const boss = [...game.sim.entities.values()].find(
      (entity) => entity.templateId === 'ignivar_herald_of_the_last_flame',
    );
    const conduit = [...game.sim.entities.values()].find(
      (entity) =>
        entity.templateId === 'ignivar_water_conduit_ready' &&
        boss &&
        entity.pos.x < boss.pos.x &&
        entity.pos.z > boss.pos.z,
    );
    const allies = [...game.sim.entities.values()].filter(
      (entity) => entity.kind === 'player' && entity.id !== player.id,
    );
    if (!boss || !conduit || allies.length < 3) return null;
    game.input.camYaw = Math.PI;
    game.input.camPitch = 0.78;
    game.input.camDist = 27;
    return {
      playerId: player.id,
      bossId: boss.id,
      conduitId: conduit.id,
      allyIds: allies.slice(0, 4).map((ally) => ally.id),
    };
  });
  if (!fixture) throw new Error('Ignivar raid fixture did not spawn enough actors');
  await page.evaluate(({ playerId, bossId }) => {
    const game = window.__game;
    const boss = game.sim.entities.get(bossId);
    if (!boss) return;
    boss.hostile = true;
    boss.inCombat = true;
    boss.targetId = playerId;
    boss.aggroTargetId = playerId;
    boss.aiState = 'attack';
    game.sim.tick();
  }, fixture);
  await page.evaluate(() => window.__game.hud?.closeLootSettings?.(false));

  async function stage(name) {
    await page.evaluate(
      ({ playerId, bossId, conduitId, allyIds }, stageName) => {
        clearInterval(window.__ignivarTelegraphStage);
        const apply = () => {
          const game = window.__game;
          const player = game.sim.entities.get(playerId);
          const boss = game.sim.entities.get(bossId);
          const conduit = game.sim.entities.get(conduitId);
          const allies = allyIds.map((id) => game.sim.entities.get(id)).filter(Boolean);
          if (!player || !boss || !conduit || allies.length < 3) return;
          const center = {
            x: boss.pos.x,
            y: boss.pos.y,
            z: boss.pos.z + 7,
          };
          player.pos = { ...center };
          player.prevPos = { ...center };
          player.vx = 0;
          player.vz = 0;
          player.facing = Math.PI;
          player.prevFacing = Math.PI;
          player.dead = false;
          player.hp = player.maxHp;
          player.auras = player.auras.filter(
            (aura) =>
              aura.id !== 'ignivar_brand_of_the_pyre' &&
              aura.id !== 'ignivar_shared_pyre' &&
              aura.id !== 'varkhul_shared_pyre',
          );
          for (let index = 0; index < allies.length; index++) {
            const ally = allies[index];
            const angle = (index / allies.length) * Math.PI * 2;
            const radius = stageName === 'soak-ready' && index < 3 ? 3 : 10 + index;
            ally.pos = {
              x: center.x + Math.sin(angle) * radius,
              y: center.y,
              z: center.z + Math.cos(angle) * radius,
            };
            ally.prevPos = { ...ally.pos };
            ally.vx = 0;
            ally.vz = 0;
            ally.dead = false;
            ally.hp = ally.maxHp;
          }
          if (stageName === 'brand-danger') {
            allies[0].pos = { x: center.x + 3.2, y: center.y, z: center.z };
            allies[0].prevPos = { ...allies[0].pos };
          }
          if (stageName.startsWith('brand')) {
            player.auras.push({
              id: 'ignivar_brand_of_the_pyre',
              name: 'Brand of the Pyre',
              kind: 'dot',
              remaining: 600,
              duration: 600,
              value: 1,
              stacks: stageName === 'brand-danger' ? 3 : 1,
              sourceId: boss.id,
              school: 'fire',
            });
          }
          if (stageName.startsWith('soak')) {
            player.auras.push({
              id: 'varkhul_shared_pyre',
              name: 'Shared Pyre',
              kind: 'vulnerability',
              remaining: 3,
              duration: 6,
              value: 0,
              sourceId: boss.id,
              school: 'physical',
            });
          }
          boss.hostile = true;
          boss.inCombat = true;
          boss.targetId = player.id;
          boss.aggroTargetId = player.id;
          boss.aiState = 'attack';
          boss.facing = 0;
          boss.prevFacing = 0;
          conduit.templateId =
            stageName === 'well-active'
              ? 'ignivar_water_conduit_active'
              : 'ignivar_water_conduit_ready';
          if (boss.ignivar) {
            Object.assign(boss.ignivar, {
              brandTimer: 600,
              forgeStrikeTimer: 600,
              frontalTimer: 600,
              frontalCastRemaining: stageName === 'frontal' ? 0.9 : 0,
              frontalFacing: 0,
              skyfireTimer: 600,
              skyfireCastRemaining: 0,
              meteorTimer: 600,
              meteorCastKey: stageName === 'meteor-five' ? 9_002 : 9_001,
              meteorImpactRemaining: stageName.startsWith('meteor-') ? 2.2 : 0,
              meteorPoints:
                stageName === 'meteor-five'
                  ? Array.from({ length: 5 }, (_, index) => {
                      const angle = (index / 5) * Math.PI * 2;
                      return {
                        x: center.x + Math.sin(angle) * 8,
                        z: center.z + Math.cos(angle) * 8,
                      };
                    })
                  : stageName === 'meteor-ground'
                    ? [{ x: center.x, z: center.z }]
                    : [],
              forgeChainsTimer: 600,
              forgeChainsRemaining: 0,
              forgeChainsAttachGraceRemaining: 0,
              forgeChainsPlayerIds: null,
              rotatingRaysTimer: 600,
              rotatingRaysWindupRemaining: 0,
              rotatingRaysActiveRemaining: 0,
              forgeWaveTimer: 600,
              forgeWaveWindupRemaining: 0,
              forgeWaveActiveRemaining: 0,
              soakTimer: 600,
              soakTargetId: null,
              soakRemaining: 0,
              apocalypseTriggered: false,
              apocalypseAddId: null,
              apocalypseCastRemaining: 0,
              apocalypseResolved: false,
              forgeJudgmentPhase: 'idle',
              forgeJudgmentRemaining: 0,
              lastInfernoTriggered: false,
              lastInfernoRemaining: 0,
              lastInfernoResolved: false,
              finalFrontalTimer: 600,
              conduitTimers: stageName === 'well-active' ? { north_west: 10 } : {},
            });
          }
          boss.castingAbility = stageName === 'frontal' ? 'Searing Torrent' : null;
          boss.castTotal = stageName === 'frontal' ? 3 : 0;
          boss.castRemaining = stageName === 'frontal' ? 0.9 : 0;
          boss.channeling = false;
          game.input.camYaw = Math.PI;
          game.input.camPitch = stageName.startsWith('soak')
            ? 0.76
            : stageName === 'frontal'
              ? 0.82
              : 0.9;
          game.input.camDist = stageName.startsWith('soak')
            ? 18
            : stageName === 'frontal' || stageName === 'well-active'
              ? 32
              : 23;
        };
        apply();
        window.__ignivarTelegraphStage = setInterval(apply, 16);
      },
      fixture,
      name,
    );
    await sleep(name.startsWith('meteor-') ? 250 : 1_200);
    await page.evaluate(() => {
      window.__game.hud?.closeLootSettings?.(false);
      window.__game.hud?.closeOptions?.();
      document.querySelector('#tutorial-greeting')?.remove();
      const dialog = document.querySelector('#loot-settings-window');
      if (dialog instanceof HTMLElement) dialog.style.display = 'none';
      document.querySelector('.gpu-notice-dismiss')?.click();
      const gpuNotice = document.querySelector('#gpu-notice');
      if (gpuNotice instanceof HTMLElement) gpuNotice.hidden = true;
    });
    await sleep(100);
    // The software-rendering probe may mount its toast after world entry. Do
    // one final capture-only removal immediately before the frame grab so a
    // late async mount cannot cover the mechanic being reviewed.
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          window.__game.hud?.closeOptions?.();
          for (const selector of [
            '#gpu-notice',
            '#tutorial-greeting',
            '#loot-settings-window',
            '#options-menu',
          ]) {
            const overlay = document.querySelector(selector);
            if (overlay instanceof HTMLElement) {
              overlay.style.setProperty('display', 'none', 'important');
            }
          }
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
    const output = path.join(outputDirectory, `${graphicsProfile}-${name}.png`);
    await page.screenshot({ path: output });
    const state = await page.evaluate(({ playerId, bossId, conduitId }) => {
      const game = window.__game;
      const player = game.sim.entities.get(playerId);
      const boss = game.sim.entities.get(bossId);
      const playerView = game.renderer.views.get(playerId);
      const bossView = game.renderer.views.get(bossId);
      const soak = playerView?.group?.getObjectByName('varkhulSharedPyreCircle');
      const brand = playerView?.group?.getObjectByName('ignivarBrandCircle');
      const frontal = bossView?.group?.getObjectByName('ignivarFrontalTelegraph');
      const conduitView = game.renderer.views.get(conduitId);
      const activeBeacon = conduitView?.group?.getObjectByName('ignivarWaterActiveBeacon');
      const meteor = game.renderer.mageGroundFx?.meteors?.find((entry) =>
        entry.persistentId?.startsWith(`${bossId}:`),
      );
      const meteorTelegraphCount =
        game.renderer.mageGroundFx?.meteors?.filter(
          (entry) => entry.root?.getObjectByName('mage-meteor-telegraph')?.visible,
        ).length ?? 0;
      const meteorTelegraph = meteor?.root?.getObjectByName('mage-meteor-telegraph');
      let frontalAimDot = null;
      if (frontal && player && boss) {
        frontal.updateWorldMatrix(true, true);
        const tip = frontal.position.clone().set(0, 0, 10);
        frontal.localToWorld(tip);
        const telegraphX = tip.x - bossView.group.position.x;
        const telegraphZ = tip.z - bossView.group.position.z;
        const playerX = player.pos.x - boss.pos.x;
        const playerZ = player.pos.z - boss.pos.z;
        frontalAimDot =
          (telegraphX * playerX + telegraphZ * playerZ) /
          (Math.hypot(telegraphX, telegraphZ) * Math.hypot(playerX, playerZ));
      }
      return {
        brandVisible: brand?.visible ?? false,
        brandOverlapDanger: brand?.userData.overlapDanger ?? false,
        brandFillOpacity: brand?.getObjectByName('ignivarBrandFill')?.material?.opacity ?? null,
        frontalVisible: frontal?.visible ?? false,
        frontalAimDot,
        soakPlayersInside: soak?.userData.playersInside ?? 0,
        soakReady: soak?.userData.ready ?? false,
        soakBeaconVisible: soak?.getObjectByName('ignivarSoakCallInBeacon')?.visible ?? false,
        meteorTelegraphVisible: meteorTelegraph?.visible ?? false,
        meteorTelegraphCount,
        meteorBodyVisible: meteor?.root?.getObjectByName('mage-meteor-body')?.visible ?? false,
        activeWellBeaconVisible: activeBeacon?.visible ?? false,
      };
    }, fixture);
    const frameProfile =
      mobile && (name === 'brand-safe' || name === 'meteor-five')
        ? await page.evaluate(
            () =>
              new Promise((resolve) => {
                const frameTimes = [];
                let previous = performance.now();
                const sample = (now) => {
                  frameTimes.push(now - previous);
                  previous = now;
                  if (frameTimes.length >= 120) {
                    const sorted = [...frameTimes].sort((a, b) => a - b);
                    resolve({
                      samples: frameTimes.length,
                      averageMs:
                        frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length,
                      p95Ms: sorted[Math.floor(sorted.length * 0.95)],
                      maxMs: sorted[sorted.length - 1],
                      over50Ms: frameTimes.filter((value) => value > 50).length,
                    });
                    return;
                  }
                  requestAnimationFrame(sample);
                };
                requestAnimationFrame(sample);
              }),
          )
        : null;
    return { output, state, frameProfile };
  }

  const outputs = {};
  const stageStates = {};
  const frameProfiles = {};
  let compilePendingProbe = null;
  const stages = raidTuningOnly
    ? ['well-active', 'soak-call']
    : [
        'brand-safe',
        'brand-danger',
        'frontal',
        'well-active',
        'meteor-ground',
        'meteor-five',
        'soak-call',
        'soak-ready',
      ];
  if (raidTuningOnly) await sleep(8_000);
  for (const name of stages) {
    const capture = await stage(name);
    outputs[name] = capture.output;
    stageStates[name] = capture.state;
    if (capture.frameProfile) frameProfiles[name] = capture.frameProfile;
    if (name === 'frontal') {
      await page.evaluate(({ bossId }) => {
        const view = window.__game.renderer.views.get(bossId);
        if (!view?.visual) return;
        view.compilePending = true;
        view.visualCompilePending = true;
        view.visual.root.visible = false;
      }, fixture);
      // Wait for the real renderer to process the forced cold-load state. A
      // fixed delay can contain no frames at all under SwiftShader/Ultra and
      // would then be testing browser scheduling rather than the render loop.
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            let remainingFrames = 3;
            const afterFrame = () => {
              remainingFrames--;
              if (remainingFrames <= 0) resolve();
              else requestAnimationFrame(afterFrame);
            };
            requestAnimationFrame(afterFrame);
          }),
      );
      const output = path.join(outputDirectory, `${graphicsProfile}-frontal-compile-pending.png`);
      await page.screenshot({ path: output });
      const state = await page.evaluate(({ bossId }) => {
        const view = window.__game.renderer.views.get(bossId);
        return {
          groupVisible: view?.group.visible ?? false,
          rigVisible: view?.visual?.root.visible ?? false,
          frontalVisible: view?.group.getObjectByName('ignivarFrontalTelegraph')?.visible ?? false,
          compilePending: view?.compilePending ?? false,
          visualCompilePending: view?.visualCompilePending ?? false,
        };
      }, fixture);
      compilePendingProbe = { output, state };
      await page.evaluate(({ bossId }) => {
        const view = window.__game.renderer.views.get(bossId);
        if (!view?.visual) return;
        view.compilePending = false;
        view.visualCompilePending = false;
        view.visual.root.visible = true;
      }, fixture);
    }
  }
  const renderState = await page.evaluate(({ playerId, bossId }) => {
    const playerView = window.__game.renderer.views.get(playerId);
    const bossView = window.__game.renderer.views.get(bossId);
    const soak = playerView?.group?.getObjectByName('varkhulSharedPyreCircle');
    const brand = playerView?.group?.getObjectByName('ignivarBrandCircle');
    const frontal = bossView?.group?.getObjectByName('ignivarFrontalTelegraph');
    return {
      soakVisible: soak?.visible ?? false,
      soakPlayersInside: soak?.userData.playersInside ?? 0,
      soakReady: soak?.userData.ready ?? false,
      brandVisible: brand?.visible ?? false,
      frontalExists: Boolean(frontal),
    };
  }, fixture);

  const fatalConsoleErrors = consoleErrors.filter(
    (entry) =>
      !entry.text.startsWith('Failed to load resource:') &&
      (!raidTuningOnly ||
        (!entry.text.includes('brasscrown_walking_staff.glb') &&
          !entry.text.includes('training_dummy.glb'))),
  );
  if (pageErrors.length || fatalConsoleErrors.length) {
    throw new Error(
      `client errors: ${JSON.stringify({ pageErrors, fatalConsoleErrors }, null, 2)}`,
    );
  }
  if (
    !raidTuningOnly &&
    (!renderState.soakVisible ||
      renderState.soakPlayersInside !== 4 ||
      !renderState.soakReady ||
      !renderState.frontalExists)
  ) {
    throw new Error(`telegraph render contract failed: ${JSON.stringify(renderState)}`);
  }
  if (
    !raidTuningOnly &&
    (!stageStates['brand-safe'].brandVisible ||
      stageStates['brand-safe'].brandOverlapDanger ||
      !stageStates['brand-danger'].brandVisible ||
      !stageStates['brand-danger'].brandOverlapDanger ||
      (stageStates['brand-danger'].brandFillOpacity ?? 0) <=
        (stageStates['brand-safe'].brandFillOpacity ?? Infinity) ||
      !stageStates.frontal.frontalVisible ||
      (stageStates.frontal.frontalAimDot ?? -1) < 0.99 ||
      !stageStates['meteor-ground'].meteorTelegraphVisible ||
      stageStates['meteor-five'].meteorTelegraphCount !== 5 ||
      stageStates['soak-call'].soakPlayersInside !== 1 ||
      stageStates['soak-call'].soakReady ||
      stageStates['soak-ready'].soakPlayersInside !== 4 ||
      !stageStates['soak-ready'].soakReady)
  ) {
    throw new Error(`staged telegraph contract failed: ${JSON.stringify(stageStates)}`);
  }
  if (
    expectRaidTuningVfx &&
    (!stageStates['well-active'].activeWellBeaconVisible ||
      !stageStates['soak-call'].soakBeaconVisible ||
      stageStates['soak-call'].soakReady)
  ) {
    throw new Error(`raid tuning VFX contract failed: ${JSON.stringify(stageStates)}`);
  }
  if (
    !raidTuningOnly &&
    (!compilePendingProbe?.state.groupVisible ||
      compilePendingProbe.state.rigVisible ||
      !compilePendingProbe.state.frontalVisible ||
      !compilePendingProbe.state.compilePending ||
      !compilePendingProbe.state.visualCompilePending)
  ) {
    throw new Error(
      `compile-pending telegraph contract failed: ${JSON.stringify(compilePendingProbe)}`,
    );
  }
  console.log(
    JSON.stringify(
      {
        graphicsProfile,
        viewport,
        outputs,
        stageStates,
        frameProfiles,
        compilePendingProbe,
        renderState,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
