#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';

import { dismissEntryOverlays } from './enter_offline_game.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_OUT_ROOT = path.join(REPO_ROOT, 'docs/screenshots/cinematics');
const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const VIEWPORT = { width: 1280, height: 720, deviceScaleFactor: 1 };
const WORLD_BOOT_TIMEOUT_MS = 120_000;
const SCENE_START_TIMEOUT_MS = 10_000;
const POLL_MS = 250;
const WORLD_SEED_FALLBACK = 20061;
const END_FRAME_EPSILON_SEC = 0.1;

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

function htmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatSeconds(seconds) {
  return Number(seconds.toFixed(3)).toString();
}

function frameFileName(index, seconds) {
  return `t${String(index).padStart(4, '0')}_${formatSeconds(seconds)}s.png`;
}

function addCapture(captures, time, reason) {
  const milliseconds = Math.round(time * 1000);
  const current = captures.get(milliseconds);
  if (current) current.reasons.add(reason);
  else captures.set(milliseconds, { time: milliseconds / 1000, reasons: new Set([reason]) });
}

function capturePlan(scene) {
  const captures = new Map();
  for (let time = 0; time < scene.duration; time += 2) {
    addCapture(captures, time, '2 second cadence');
  }
  for (const time of scene.cameraCuts) addCapture(captures, time, 'camera cut');
  addCapture(captures, scene.duration, 'scene end');
  addCapture(captures, scene.duration + 1, 'HUD restored');
  return [...captures.values()].sort((a, b) => a.time - b.time);
}

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
  return page.evaluate(async () => {
    const scenes = await import('/src/sim/scenes/scenes.ts');
    const harbors = await import('/src/sim/harbor_layout.ts');
    const game = window.__game;
    const current = game.sim.player.pos;
    const pointKey = (point) => `${point.x.toFixed(3)}:${point.z.toFixed(3)}`;

    return scenes.registeredSceneIds().map((id) => {
      const def = scenes.sceneById(id);
      if (!def) throw new Error(`Registered scene ${id} has no definition.`);
      const cameraCuts = [];
      const preparePoints = new Map();
      let firstCameraPoint = null;
      let harborShipTarget = null;
      const addPoint = (point) => {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return;
        const flat = { x: point.x, z: point.z };
        firstCameraPoint ??= flat;
        preparePoints.set(pointKey(flat), flat);
      };

      for (const op of def.ops) {
        if (op.kind === 'prop' && op.target.startsWith('harbor_ship_')) {
          harborShipTarget ??= op.target;
        }
        if (op.kind !== 'camera') continue;
        cameraCuts.push(op.at);
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
      if (harborShipTarget === 'harbor_ship_mainland') {
        stagePoint = {
          x: harbors.GULLHAVEN_HARBOR.boarding.x,
          z: harbors.GULLHAVEN_HARBOR.boarding.z,
        };
      } else if (harborShipTarget === 'harbor_ship_gullhaven') {
        stagePoint = {
          x: harbors.MAINLAND_HARBOR.boarding.x,
          z: harbors.MAINLAND_HARBOR.boarding.z,
        };
      }
      preparePoints.set(pointKey(stagePoint), stagePoint);

      return {
        id,
        duration: def.duration,
        cameraCuts,
        expectsLetterbox: def.ops.some((op) => op.kind === 'letterbox' && op.on && op.at <= 0.05),
        preparePoints: [...preparePoints.values()],
        stagePoint,
      };
    });
  });
}

async function stageScene(page, scene) {
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
  const started = await page.evaluate(async (sceneId) => {
    const scenes = await import('/src/sim/scenes/scenes.ts');
    const game = window.__game;
    document.body.classList.add('reduce-motion');
    return {
      ok: scenes.playSceneForPlayer(game.sim.ctx, game.sim.playerId, sceneId),
      seed: game.sim.cfg.seed,
    };
  }, scene.id);
  if (!started.ok) throw new Error(`Scene ${scene.id} refused to start.`);

  await page.waitForFunction(
    (sceneId) =>
      document.body.classList.contains('cinematic-mode') &&
      [...window.__game.sim.scenePlaybacks.values()].some(
        (playback) => playback.sceneId === sceneId,
      ),
    { polling: 50, timeout: SCENE_START_TIMEOUT_MS },
    scene.id,
  );
  if (scene.expectsLetterbox) {
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.scene-letterbox')].some((bar) =>
          bar.classList.contains('on'),
        ),
      { polling: 50, timeout: SCENE_START_TIMEOUT_MS },
    );
  }
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  return started.seed ?? WORLD_SEED_FALLBACK;
}

async function waitForSceneTime(page, scene, targetTime) {
  // Sample the authored end just before teardown, then use the +1s frame to prove HUD restore.
  const threshold =
    targetTime === scene.duration
      ? Math.max(0, scene.duration - END_FRAME_EPSILON_SEC)
      : targetTime;
  await page.waitForFunction(
    ({ sceneId, thresholdSec }) => {
      const sim = window.__game?.sim;
      const playback = sim
        ? [...sim.scenePlaybacks.values()].find((candidate) => candidate.sceneId === sceneId)
        : null;
      return playback ? sim.time - playback.startedAt >= thresholdSec : false;
    },
    { polling: 25, timeout: Math.max(10_000, (scene.duration + 5) * 1000) },
    { sceneId: scene.id, thresholdSec: threshold },
  );
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
}

async function waitForHudRestore(page, scene) {
  await page.waitForFunction(
    (sceneId) =>
      !document.body.classList.contains('cinematic-mode') &&
      ![...window.__game.sim.scenePlaybacks.values()].some(
        (playback) => playback.sceneId === sceneId,
      ),
    { polling: 25, timeout: Math.max(10_000, (scene.duration + 5) * 1000) },
    scene.id,
  );
  await sleep(1000);
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

function renderIndex(scene, seed, frames) {
  const sceneId = htmlEscape(scene.id);
  const cards = frames
    .map((frame) => {
      const file = htmlEscape(frame.file);
      const label = `${formatSeconds(frame.time)}s`;
      const reasons = htmlEscape([...frame.reasons].join(', '));
      return `<figure>
        <a href="${file}"><img src="${file}" alt="${sceneId} at ${label}" loading="lazy"></a>
        <figcaption><strong>${label}</strong><span>${reasons}</span></figcaption>
      </figure>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${sceneId} contact sheet</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #111; color: #eee; }
    body { margin: 0; padding: 24px; }
    header { margin-bottom: 20px; }
    h1 { margin: 0 0 6px; font-size: 24px; }
    p { margin: 4px 0; color: #bbb; }
    main { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
    figure { margin: 0; overflow: hidden; border: 1px solid #333; border-radius: 6px; background: #1a1a1a; }
    a { display: block; }
    img { display: block; width: 100%; height: auto; aspect-ratio: 16 / 9; object-fit: contain; background: #000; }
    figcaption { display: flex; justify-content: space-between; gap: 12px; padding: 9px 11px; font-size: 13px; }
    figcaption span { color: #aaa; text-align: right; }
  </style>
</head>
<body>
  <header>
    <h1>${sceneId}</h1>
    <p>Offline world seed: ${htmlEscape(seed)}</p>
    <p>Seeded offline captures should be near-identical across runs on the same browser and graphics stack.</p>
  </header>
  <main>
${cards}
  </main>
</body>
</html>
`;
}

async function captureScene(page, scene, outDir) {
  await mkdir(outDir, { recursive: true });
  await stageScene(page, scene);
  const plan = capturePlan(scene);
  const seed = await startScene(page, scene);
  const frames = [];

  for (const [index, capture] of plan.entries()) {
    if (capture.reasons.has('HUD restored')) await waitForHudRestore(page, scene);
    else await waitForSceneTime(page, scene, capture.time);
    const file = frameFileName(index, capture.time);
    await takeFrame(page, path.join(outDir, file));
    frames.push({ ...capture, file });
    console.log(
      `[${scene.id}] captured ${formatSeconds(capture.time)}s (${[...capture.reasons].join(', ')})`,
    );
  }

  await writeFile(path.join(outDir, 'index.html'), renderIndex(scene, seed, frames), 'utf8');
  return { frameCount: frames.length, outDir, seed };
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
    args: [
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--mute-audio',
    ],
    defaultViewport: VIEWPORT,
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    console.log(`Opening ${GAME_URL}`);
    await bootOfflineWorld(page);
    const registry = await readSceneRegistry(page);
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
      results.push(await captureScene(page, scene, outDir));
    }

    for (const result of results) {
      console.log(
        `Wrote ${result.frameCount} frames and index.html to ${path.relative(REPO_ROOT, result.outDir) || '.'} (seed ${result.seed}).`,
      );
    }
    if (pageErrors.length > 0) {
      console.warn(`Page errors observed: ${pageErrors.join(' | ')}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`Contact sheet capture failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
