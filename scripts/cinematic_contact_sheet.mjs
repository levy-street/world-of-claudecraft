#!/usr/bin/env node

import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';

import { WORLD_SEED } from '../src/world_seed.mjs';
import { dismissEntryOverlays } from './enter_offline_game.mjs';
import { renderContactSheetHtml } from './lib/cinematic_contact_sheet_html_core.mjs';
import {
  contactSheetIntentAt,
  formatContactSheetSeconds,
  planContactSheet,
} from './lib/cinematic_contact_sheet_plan_core.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_OUT_ROOT = path.join(REPO_ROOT, 'docs/screenshots/cinematics');
const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const VIEWPORT = { width: 1280, height: 720, deviceScaleFactor: 1 };
// Cold SwiftShader boots (the offline entry's asset build) can exceed two
// minutes on a busy machine; the cap is generous because a genuine hang is
// caught by the per-scene watchdog anyway.
const WORLD_BOOT_TIMEOUT_MS = 300_000;
const SCENE_START_TIMEOUT_MS = 10_000;
const POLL_MS = 250;
const REGISTRY_HMR_REMEDIATION =
  'window.__game.scenes is unavailable or empty. Fully reload the dev client to clear Vite HMR state, then rerun the contact sheet capture.';

function usage() {
  return [
    'Usage:',
    '  node scripts/cinematic_contact_sheet.mjs --scene <sceneId> [--out <dir>]',
    '  node scripts/cinematic_contact_sheet.mjs --all [--out <rootDir>]',
  ].join('\n');
}

function parseArgs(argv) {
  const parsed = { all: false, help: false, out: null, scene: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--all') {
      parsed.all = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--scene' || arg === '--out') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.\n${usage()}`);
      if (arg === '--scene') parsed.scene = value;
      else parsed.out = path.resolve(process.cwd(), value);
    } else {
      throw new Error(`Unknown argument: ${arg}\n${usage()}`);
    }
  }
  if (!parsed.help && parsed.all === (parsed.scene !== null)) {
    throw new Error(`Choose exactly one of --scene <sceneId> or --all.\n${usage()}`);
  }
  return parsed;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function assertDevServer() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(GAME_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The dev client is not answering at ${GAME_URL} (${detail}). Start it with "npm run dev" before running this script.`,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function pollClickOffline(page) {
  await page.waitForSelector('#btn-offline', { timeout: 30_000 });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const opened = await page.evaluate(() => {
      document.querySelector('#btn-offline')?.click();
      const panel = document.querySelector('#offline-select');
      return (
        panel instanceof HTMLElement && !panel.hidden && getComputedStyle(panel).display !== 'none'
      );
    });
    if (opened) return;
    await sleep(POLL_MS);
  }
  throw new Error(
    'The marketing shell loaded, but #btn-offline never opened the offline selector. The client handlers may not have bound.',
  );
}

async function bootOfflineWorld(page) {
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await pollClickOffline(page);

  const card = '#offline-select .mini-class[data-class="warrior"]';
  await page.waitForSelector(card, { visible: true, timeout: 15_000 });
  await page.evaluate((selector) => {
    const name = document.querySelector('#char-name');
    if (name instanceof HTMLInputElement) {
      name.value = 'CinematicReview';
      name.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.querySelector(selector)?.click();
    document.querySelector('#btn-start-offline')?.click();
  }, card);

  const startedAt = Date.now();
  while (Date.now() - startedAt < WORLD_BOOT_TIMEOUT_MS) {
    const ready = await page.evaluate(() => {
      const mobileContinue = document.querySelector('#mobile-preflight-continue');
      if (
        mobileContinue instanceof HTMLButtonElement &&
        getComputedStyle(mobileContinue).display !== 'none'
      ) {
        mobileContinue.click();
      }
      const welcomeContinue = document.querySelector('#ws-continue');
      if (
        welcomeContinue instanceof HTMLButtonElement &&
        !welcomeContinue.disabled &&
        getComputedStyle(welcomeContinue).display !== 'none'
      ) {
        welcomeContinue.click();
      }
      return Boolean(window.__game?.sim?.player && window.__game?.renderer && window.__game?.hud);
    });
    if (ready) {
      await dismissEntryOverlays(page);
      await page.evaluate(() => {
        const dismiss = document.querySelector('#gpu-notice .gpu-notice-dismiss');
        if (
          dismiss instanceof HTMLButtonElement &&
          dismiss.getClientRects().length > 0 &&
          getComputedStyle(dismiss).visibility !== 'hidden'
        ) {
          dismiss.click();
        }
      });
      await sleep(750);
      return;
    }
    await sleep(POLL_MS);
  }
  throw new Error(
    `The offline entry flow did not expose window.__game within ${WORLD_BOOT_TIMEOUT_MS / 1000} seconds.`,
  );
}

async function readSceneRegistry(page) {
  return page.evaluate(async (hmrRemediation) => {
    const game = window.__game;
    const scenes = game?.scenes;
    if (
      !scenes ||
      typeof scenes.registeredSceneIds !== 'function' ||
      typeof scenes.sceneById !== 'function' ||
      typeof scenes.playSceneForPlayer !== 'function'
    ) {
      throw new Error(hmrRemediation);
    }
    const sceneIds = scenes.registeredSceneIds();
    if (!Array.isArray(sceneIds) || sceneIds.length === 0) {
      throw new Error(hmrRemediation);
    }
    const harbors = await import('/src/sim/harbor_layout.ts');
    const cinematicProps = await import('/src/sim/content/last_bell_cinematics.ts');
    const current = game.sim.player.pos;
    const pointKey = (point) => `${point.x.toFixed(3)}:${point.z.toFixed(3)}`;

    return sceneIds.map((id) => {
      const def = scenes.sceneById(id);
      if (!def) throw new Error(`Registered scene ${id} has no definition.`);
      const preparePoints = new Map();
      let firstCameraPoint = null;
      let walkTarget = null;
      const addPoint = (point) => {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return;
        const flat = { x: point.x, z: point.z };
        firstCameraPoint ??= flat;
        preparePoints.set(pointKey(flat), flat);
      };

      for (const op of def.ops) {
        if (op.kind === 'playerWalk') walkTarget = op.to;
        if (op.kind !== 'camera') continue;
        const shot = op.shot;
        if (shot.kind === 'focus') {
          addPoint({ x: shot.x, z: shot.z });
        } else if (shot.kind === 'dolly') {
          for (const point of shot.points) addPoint(point);
          if (shot.lookAt.kind === 'point') addPoint(shot.lookAt.point);
          if (shot.lookAt.kind === 'spline') {
            for (const point of shot.lookAt.points) addPoint(point);
          }
          if (shot.lookAt.kind === 'subject') addPoint(shot.lookAt.fallback);
        } else if (shot.kind === 'attach') {
          addPoint(shot.fallbackFrame.point);
        }
      }

      let stagePoint = firstCameraPoint ?? { x: current.x, z: current.z };
      // Stage where the fare flow leaves the rider: the destination ship's
      // deck arrival point, where the scene starts its gangplank walk.
      const arrivalHarbor = harbors.HARBORS.find(
        (harbor) =>
          walkTarget && harbor.gangplank.x === walkTarget.x && harbor.gangplank.z === walkTarget.z,
      );
      if (arrivalHarbor) {
        stagePoint = {
          x: arrivalHarbor.deckArrival.x,
          z: arrivalHarbor.deckArrival.z,
        };
      }
      preparePoints.set(pointKey(stagePoint), stagePoint);

      return {
        id,
        duration: def.duration,
        expectsLetterbox: def.ops.some((op) => op.kind === 'letterbox' && op.on && op.at <= 0.05),
        ops: def.ops.map((op) => {
          if (op.kind !== 'prop') return op;
          const segment = cinematicProps.LAST_BELL_PROP_PATH_SEGMENTS[op.cue];
          return { ...op, dur: segment?.duration ?? 0 };
        }),
        preparePoints: [...preparePoints.values()],
        stagePoint,
      };
    });
  }, REGISTRY_HMR_REMEDIATION);
}

async function stageScene(page, scene) {
  // Warmup lap: dwell the live renderer at every capture location first, so
  // chunk/prop generation happens NOW and not mid-scene. A cold zone under
  // SwiftShader stalls frames for seconds, and the sim then repays the rAF
  // backlog in one clock burst that can leap past the scene end.
  for (const point of scene.preparePoints) {
    await page.evaluate((p) => {
      window.__game.sim.chat(`/dev tp ${p.x} ${p.z}`);
    }, point);
    await sleep(1200);
  }
  await page.evaluate(async (metadata) => {
    const game = window.__game;
    game.sim.chat(`/dev tp ${metadata.stagePoint.x} ${metadata.stagePoint.z}`);
    for (const point of metadata.preparePoints) {
      await game.renderer.prepareZoneAt(point.x, point.z);
    }
  }, scene);
  await page.waitForFunction(
    (point) => {
      const player = window.__game?.sim?.player;
      return (
        player &&
        Math.hypot(player.pos.x - point.x, player.pos.z - point.z) <= 1 &&
        window.__game.sim.scenePlaybacks.size === 0
      );
    },
    { polling: POLL_MS, timeout: 10_000 },
    scene.stagePoint,
  );
  await sleep(750);
}

async function startScene(page, scene) {
  const started = await page.evaluate(
    ({ sceneId, hmrRemediation }) => {
      const game = window.__game;
      const scenes = game?.scenes;
      if (!scenes || typeof scenes.playSceneForPlayer !== 'function') {
        throw new Error(hmrRemediation);
      }
      document.body.classList.add('reduce-motion');
      return {
        ok: scenes.playSceneForPlayer(game.sim.ctx, game.sim.playerId, sceneId),
        seed: game.sim.cfg.seed,
      };
    },
    { sceneId: scene.id, hmrRemediation: REGISTRY_HMR_REMEDIATION },
  );
  if (!started.ok) throw new Error(`Scene ${scene.id} refused to start.`);
  return started.seed ?? WORLD_SEED;
}

async function takeFrame(page, filePath) {
  await page.screenshot({
    path: filePath,
    type: 'png',
    captureBeyondViewport: false,
  });
  const png = await readFile(filePath);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== VIEWPORT.width || height !== VIEWPORT.height) {
    throw new Error(`Expected a 1280x720 PNG, got ${width}x${height}: ${filePath}`);
  }
}

async function sceneClock(page, sceneId) {
  return page.evaluate((id) => {
    const sim = window.__game.sim;
    const playback = [...sim.scenePlaybacks.values()].find((c) => c.sceneId === id);
    return {
      elapsed: playback ? sim.time - playback.startedAt : null,
      cinematic: document.body.classList.contains('cinematic-mode'),
    };
  }, sceneId);
}

async function resetGeneratedOutput(outDir) {
  await mkdir(outDir, { recursive: true });
  const generatedName =
    /^(?:index\.html|frame_(?:\d{4}_target_[\d_]+s|after_scene_end|hud_restored)\.png|t\d{4}_[\d_]+s\.png)$/;
  for (const entry of await readdir(outDir, { withFileTypes: true })) {
    if (entry.isFile() && generatedName.test(entry.name)) {
      await unlink(path.join(outDir, entry.name));
    }
  }
}

async function waitForSceneTarget(page, scene, targetTime) {
  const timeout = Math.max(30_000, Math.ceil((scene.duration + 10) * 3000));
  await page.waitForFunction(
    ({ sceneId, target }) => {
      const sim = window.__game.sim;
      const playback = [...sim.scenePlaybacks.values()].find(
        (candidate) => candidate.sceneId === sceneId,
      );
      return !playback || sim.time - playback.startedAt >= target;
    },
    { polling: 50, timeout },
    { sceneId: scene.id, target: targetTime },
  );
  return sceneClock(page, scene.id);
}

async function finishScenePass(page, scene) {
  await page.evaluate(() => {
    if (window.__game.sim.scenePlaybacks.size > 0) window.__game.sim.sceneSkip();
  });
  await page.waitForFunction(
    (sceneId) =>
      ![...window.__game.sim.scenePlaybacks.values()].some(
        (playback) => playback.sceneId === sceneId,
      ),
    { polling: 50, timeout: 15_000 },
    scene.id,
  );
}

async function captureScene(browser, scene, outDir) {
  await resetGeneratedOutput(outDir);
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
    console.error(`[pageerror] ${String(error.message).slice(0, 400)}`);
  });
  try {
    await bootOfflineWorld(page);
    let seed = null;
    let plan = null;
    let pending = null;
    let pass = 0;
    const captured = new Map();

    while (pending === null || pending.length > 0) {
      pass += 1;
      await stageScene(page, scene);
      const passSeed = await startScene(page, scene);
      if (seed !== null && passSeed !== seed) {
        throw new Error(`Scene ${scene.id} changed seed between capture passes.`);
      }
      seed = passSeed;
      plan ??= planContactSheet({
        sceneId: scene.id,
        seed,
        duration: scene.duration,
        ops: scene.ops,
      });
      pending ??= [...plan.stills];

      await page.waitForFunction(
        ({ sceneId, expectsLetterbox }) => {
          const playing = [...window.__game.sim.scenePlaybacks.values()].some(
            (playback) => playback.sceneId === sceneId,
          );
          return (
            playing && (!expectsLetterbox || document.body.classList.contains('cinematic-mode'))
          );
        },
        { polling: 50, timeout: SCENE_START_TIMEOUT_MS },
        { sceneId: scene.id, expectsLetterbox: scene.expectsLetterbox },
      );

      // A SwiftShader screenshot advances real scene time. Capture planned
      // authored-cut targets greedily, then replay only windows skipped by a
      // long capture. This keeps the normal path to one playback while making
      // the tail cut an explicit required result.
      const missed = [];
      for (const still of pending) {
        const state = await waitForSceneTarget(page, scene, still.targetTime);
        if (state.elapsed === null || state.elapsed >= still.windowEnd) {
          missed.push(still);
          continue;
        }
        const measuredTime = Number(state.elapsed.toFixed(3));
        const intent = contactSheetIntentAt(scene.ops, measuredTime);
        const frame = { ...still, ...intent, measuredTime };
        await takeFrame(page, path.join(outDir, frame.file));
        captured.set(still.index, frame);
        console.log(
          `[${scene.id}] captured target ${formatContactSheetSeconds(still.targetTime)}s at measured ${formatContactSheetSeconds(measuredTime)}s`,
        );
      }

      await finishScenePass(page, scene);
      pending = missed;
      if (pending.length > 0) {
        await page.waitForFunction(() => !document.body.classList.contains('cinematic-mode'), {
          polling: 50,
          timeout: 15_000,
        });
        if (pass >= plan.stills.length + 1) {
          throw new Error(
            `Scene ${scene.id} could not capture these authored cut windows: ${pending
              .map(
                (still) =>
                  `${formatContactSheetSeconds(still.windowStart)}s to ${formatContactSheetSeconds(still.windowEnd)}s`,
              )
              .join(', ')}.`,
          );
        }
      }
    }

    const frames = [...captured.values()].sort((left, right) => left.index - right.index);
    const emptyIntent = { expectedSubjects: [], expectedTextKeys: [] };
    const endFile = 'frame_after_scene_end.png';
    await takeFrame(page, path.join(outDir, endFile));
    frames.push({
      file: endFile,
      targetTime: plan.duration,
      measuredTime: null,
      windowStart: plan.duration,
      windowEnd: plan.duration,
      reasons: ['after scene end'],
      ...emptyIntent,
    });
    await page.waitForFunction(() => !document.body.classList.contains('cinematic-mode'), {
      polling: 50,
      timeout: 15_000,
    });
    await sleep(1000);
    const hudFile = 'frame_hud_restored.png';
    await takeFrame(page, path.join(outDir, hudFile));
    frames.push({
      file: hudFile,
      targetTime: plan.duration + 1,
      measuredTime: null,
      windowStart: plan.duration + 1,
      windowEnd: plan.duration + 1,
      reasons: ['HUD restored'],
      ...emptyIntent,
    });

    if (pageErrors.length > 0) {
      throw new Error(`Page errors observed: ${pageErrors.join(' | ')}`);
    }
    await writeFile(
      path.join(outDir, 'index.html'),
      renderContactSheetHtml({ sceneId: scene.id, seed, frames }),
      'utf8',
    );
    return { frameCount: frames.length, outDir, seed };
  } finally {
    await page.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  await assertDevServer();
  const { BROWSER_PATH } = await import('./browser_path.mjs');
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    // Software rendering can hold a single evaluate past puppeteer's 180s
    // default while the offline world builds; the boot cap governs failure.
    protocolTimeout: 360_000,
    args: [
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--mute-audio',
    ],
    defaultViewport: VIEWPORT,
  });

  try {
    console.log(`Opening ${GAME_URL}`);
    // One boot to read the registry; each capture then boots its own page so
    // virtual-time state never leaks between scenes.
    const registryPage = await browser.newPage();
    let registry;
    try {
      await bootOfflineWorld(registryPage);
      registry = await readSceneRegistry(registryPage);
    } finally {
      await registryPage.close();
    }
    const selected = args.all ? registry : registry.filter((scene) => scene.id === args.scene);
    if (selected.length === 0) {
      throw new Error(
        `Unknown scene "${args.scene}". Registered scenes: ${registry.map((scene) => scene.id).join(', ')}`,
      );
    }

    const results = [];
    for (const scene of selected) {
      const outDir = args.all
        ? path.join(args.out ?? DEFAULT_OUT_ROOT, scene.id)
        : (args.out ?? path.join(DEFAULT_OUT_ROOT, scene.id));
      results.push(await captureScene(browser, scene, outDir));
    }

    for (const result of results) {
      console.log(
        `Wrote ${result.frameCount} frames and index.html to ${path.relative(REPO_ROOT, result.outDir) || '.'} (seed ${result.seed}).`,
      );
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`Contact sheet capture failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
