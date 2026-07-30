// In-game PR screenshots for all three wings of The Undermount Descent.
// Run against a Vite dev client with GAME_URL set to the port Vite reports.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { dismissEntryOverlays, enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT_DIR = 'docs/screenshots';
const MIN_PNG_BYTES = 100 * 1024;
const VIEWPORT = { width: 1600, height: 900 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SHOTS = [
  {
    dungeonId: 'undermount_wing1',
    filename: 'undermount-wing1-kiln-keepers.png',
    targetId: 'vosh_the_glazier',
    requiredIds: ['vosh_the_glazier', 'saan_the_stoker'],
    prerequisites: [],
    playerLocal: { x: 0, z: 10 },
    camera: { pitch: 0.28, dist: 20 },
  },
  {
    dungeonId: 'undermount_wing2',
    filename: 'undermount-wing2-odrenn.png',
    targetId: 'odrenn_the_temperer',
    requiredIds: ['odrenn_the_temperer'],
    prerequisites: ['undermount_wing1'],
    playerLocal: { x: 8, z: 11 },
    camera: { pitch: 0.26, dist: 19 },
    pullForMark: true,
  },
  {
    dungeonId: 'undermount_wing3',
    filename: 'undermount-wing3-volzharr.png',
    targetId: 'volzharr_buried_furnace',
    requiredIds: ['volzharr_buried_furnace', 'undermount_cinderling'],
    prerequisites: ['undermount_wing1', 'undermount_wing2'],
    playerLocal: { x: 0, z: 12 },
    camera: { pitch: 0.24, dist: 16 },
  },
];

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: VIEWPORT,
});

const page = await browser.newPage();
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});

async function waitForGameBoot(timeoutMs = 180_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const booted = await page
      .evaluate(() => Boolean(window.__game?.sim?.player))
      .catch(() => false);
    if (booted) return;
    await sleep(1000);
  }
  throw new Error(`offline game did not boot within ${timeoutMs} ms`);
}

async function stageWing(shot) {
  return page.evaluate(async (spec) => {
    const game = window.__game;
    const sim = game.sim;
    const player = sim.player;
    const pid = player.id;
    const { enterDungeon, instanceKeyFor, instanceOriginOf } = await import(
      '/src/sim/instances/dungeons.ts'
    );
    const { groundHeight } = await import('/src/sim/world.ts');
    const resolved = sim.ctx.resolve(pid);
    if (!resolved) throw new Error(`could not resolve player ${pid}`);

    for (const prerequisite of spec.prerequisites) {
      resolved.meta.undermountCleared.add(prerequisite);
    }
    const entered = enterDungeon(sim.ctx, spec.dungeonId, pid);
    if (!entered) throw new Error(`real enterDungeon path refused ${spec.dungeonId}`);

    const claim = sim.instances.find(
      (instance) =>
        instance.dungeonId === spec.dungeonId && instance.partyKey === instanceKeyFor(sim.ctx, pid),
    );
    if (!claim) throw new Error(`no claimed instance for ${spec.dungeonId}`);
    const origin = instanceOriginOf(claim);
    const entities = claim.mobIds.map((id) => sim.entities.get(id)).filter(Boolean);
    const target = entities.find((entity) => entity.templateId === spec.targetId && !entity.dead);
    if (!target) throw new Error(`missing live target ${spec.targetId}`);
    for (const templateId of spec.requiredIds) {
      if (!entities.some((entity) => entity.templateId === templateId && !entity.dead)) {
        throw new Error(`missing required live entity ${templateId}`);
      }
    }

    const x = origin.x + spec.playerLocal.x;
    const z = origin.z + spec.playerLocal.z;
    const y = groundHeight(x, z, sim.cfg.seed);
    player.pos = { x, y, z };
    player.prevPos = { ...player.pos };
    player.maxHp = Math.max(player.maxHp, 999_999);
    player.hp = player.maxHp;
    sim.rebucket(player);

    const yaw = Math.atan2(target.pos.x - player.pos.x, target.pos.z - player.pos.z);
    player.facing = yaw;
    player.prevFacing = yaw;
    game.input.camYaw = yaw;
    game.input.interpFacing = yaw;
    game.input.camPitch = spec.camera.pitch;
    game.input.camDist = spec.camera.dist;
    sim.targetEntity(target.id, pid);

    return {
      dungeonId: spec.dungeonId,
      origin,
      playerDistance: Math.hypot(target.pos.x - player.pos.x, target.pos.z - player.pos.z),
      target: { id: target.id, name: target.name, templateId: target.templateId },
      entities: entities.map((entity) => ({
        id: entity.id,
        name: entity.name,
        templateId: entity.templateId,
        dead: entity.dead,
        inCombat: entity.inCombat,
        x: entity.pos.x - origin.x,
        z: entity.pos.z - origin.z,
      })),
    };
  }, shot);
}

async function pullOdrennForMark() {
  return page.evaluate(() => {
    const sim = window.__game.sim;
    const player = sim.player;
    const boss = [...sim.entities.values()].find(
      (entity) => entity.templateId === 'odrenn_the_temperer' && !entity.dead,
    );
    if (!boss) throw new Error('Odrenn is missing before mark pull');
    sim.dealDamage(player, boss, 1, false, 'physical', 'Pull', 'hit', true);
    return { bossId: boss.id, playerId: player.id };
  });
}

async function resetOdrennAfterCapture() {
  return page.evaluate(async () => {
    const sim = window.__game.sim;
    const { resetOdrennEncounter } = await import('/src/sim/encounters/odrenn.ts');
    const boss = [...sim.entities.values()].find(
      (entity) => entity.templateId === 'odrenn_the_temperer' && !entity.dead,
    );
    if (!boss) throw new Error('Odrenn is missing before encounter reset');
    resetOdrennEncounter(sim.ctx, boss);
    return { bossId: boss.id, playerAuras: sim.player.auras.map((aura) => aura.id) };
  });
}

async function readShotEvidence(shot) {
  return page.evaluate((spec) => {
    const game = window.__game;
    const sim = game.sim;
    const player = sim.player;
    const visible = (selector) => {
      const element = document.querySelector(selector);
      return Boolean(element && getComputedStyle(element).display !== 'none');
    };
    const entities = [...sim.entities.values()].filter(
      (entity) => spec.requiredIds.includes(entity.templateId) && !entity.dead,
    );
    return {
      hudVisible: visible('#ui'),
      introVisible: visible('#intro-logo'),
      tutorialVisible: visible('button.tut-skip'),
      cameraPromptVisible: visible('.camera-prompt-backdrop'),
      gpuNoticeVisible: visible('#gpu-notice'),
      targetId: player.targetId,
      playerAuras: player.auras.map((aura) => ({
        id: aura.id,
        name: aura.name,
        remaining: aura.remaining,
      })),
      entities: entities.map((entity) => ({
        id: entity.id,
        name: entity.name,
        templateId: entity.templateId,
        inCombat: entity.inCombat,
      })),
    };
  }, shot);
}

try {
  console.log(`Loading ${URL}`);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  // SwiftShader can spend well over the shared helper's 30-second selector
  // allowance optimizing the initial client bundle. Wait on the same hook
  // here with the capture recipe's full boot budget before driving entry.
  await page.waitForSelector('#btn-offline', { timeout: 180_000 });
  await page.evaluate(() => document.querySelector('#btn-offline')?.click());
  await page.waitForSelector('#offline-select .mini-class[data-class="warrior"]', {
    visible: true,
    timeout: 180_000,
  });
  const helperBooted = await enterOfflineGame(page, {
    charClass: 'warrior',
    charName: 'Deepdelver',
    settleMs: 3000,
    gameBootTimeoutMs: 120_000,
  });
  if (!helperBooted) await waitForGameBoot();
  await dismissEntryOverlays(page);

  const setup = await page.evaluate(() => {
    const sim = window.__game.sim;
    const pid = sim.player.id;
    sim.setPlayerLevel(20, pid);
    const devCommands = sim.ctx.devCommands === true;
    if (devCommands) {
      sim.chat('/dev kit prot raid', pid);
      sim.chat('/dev god', pid);
    }
    const player = sim.player;
    player.maxHp = Math.max(player.maxHp, 999_999);
    player.hp = player.maxHp;
    return {
      pid,
      level: player.level,
      devCommands,
      devGod: player.devGod === true,
      equipped: Object.values(sim.ctx.resolve(pid).meta.equipment).filter(Boolean).length,
    };
  });
  if (setup.level !== 20) throw new Error(`player level setup failed: ${JSON.stringify(setup)}`);
  console.log(`Player setup: ${JSON.stringify(setup)}`);
  await page.evaluate(() => document.querySelector('.gpu-notice-dismiss')?.click());

  for (const shot of SHOTS) {
    const staged = await stageWing(shot);
    console.log(`Staged ${shot.dungeonId}: ${JSON.stringify(staged)}`);

    // Let the live game loop build the real interior, entity models, nameplates,
    // and molten-floor dressing before any encounter-specific state is armed.
    await sleep(4500);
    if (shot.pullForMark) {
      await pullOdrennForMark();
      await sleep(700);
    }
    await dismissEntryOverlays(page);

    const evidence = await readShotEvidence(shot);
    if (!evidence.hudVisible) throw new Error(`HUD is hidden for ${shot.dungeonId}`);
    if (evidence.introVisible || evidence.tutorialVisible || evidence.cameraPromptVisible) {
      throw new Error(
        `entry overlay is visible for ${shot.dungeonId}: ${JSON.stringify(evidence)}`,
      );
    }
    if (evidence.gpuNoticeVisible) {
      throw new Error(`GPU notice is visible for ${shot.dungeonId}`);
    }
    if (evidence.entities.length < shot.requiredIds.length) {
      throw new Error(`required entities disappeared for ${shot.dungeonId}`);
    }
    if (
      shot.pullForMark &&
      !evidence.playerAuras.some(
        (aura) => aura.id === 'odrenn_scorched' || aura.id === 'odrenn_chilled',
      )
    ) {
      throw new Error(`Odrenn pull did not apply a geography mark: ${JSON.stringify(evidence)}`);
    }

    const outputPath = `${OUT_DIR}/${shot.filename}`;
    await page.screenshot({ path: outputPath, type: 'png' });
    const bytes = fs.statSync(outputPath).size;
    if (bytes <= MIN_PNG_BYTES) {
      throw new Error(`${outputPath} is only ${bytes} bytes, expected more than ${MIN_PNG_BYTES}`);
    }
    console.log(`Captured ${outputPath}: ${bytes} bytes, evidence ${JSON.stringify(evidence)}`);
    if (shot.pullForMark) {
      console.log(`Reset Odrenn after capture: ${JSON.stringify(await resetOdrennAfterCapture())}`);
    }
  }

  if (pageErrors.length > 0) throw new Error(`page errors: ${pageErrors.join(' | ')}`);
  if (consoleErrors.length > 0) {
    console.log(`Console errors observed: ${JSON.stringify(consoleErrors.slice(0, 10))}`);
  }
} finally {
  await browser.close();
}
