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
// Cold SwiftShader boots (the offline entry's asset build) can exceed two
// minutes on a busy machine; the cap is generous because a genuine hang is
// caught by the per-scene watchdog anyway.
const WORLD_BOOT_TIMEOUT_MS = 300_000;
const SCENE_START_TIMEOUT_MS = 10_000;
const POLL_MS = 250;
const WORLD_SEED_FALLBACK = 20061;

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
  return `t${String(index).padStart(4, '0')}_${formatSeconds(seconds).replace('.', '_')}s.png`;
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
  return page.evaluate(async () => {
    const game = window.__game;
    const scenes = game.scenes ?? (await import('/src/sim/scenes/scenes.ts'));
    const harbors = await import('/src/sim/harbor_layout.ts');
    const current = game.sim.player.pos;
    const pointKey = (point) => `${point.x.toFixed(3)}:${point.z.toFixed(3)}`;

    return scenes.registeredSceneIds().map((id) => {
      const def = scenes.sceneById(id);
      if (!def) throw new Error(`Registered scene ${id} has no definition.`);
      const cameraCuts = [];
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
        cameraCuts,
        expectsLetterbox: def.ops.some((op) => op.kind === 'letterbox' && op.on && op.at <= 0.05),
        preparePoints: [...preparePoints.values()],
        stagePoint,
      };
    });
  });
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
  const started = await page.evaluate(async (sceneId) => {
    const game = window.__game;
    // The game-instance entry point avoids Vite's dual-module trap (a bare
    // dynamic import gets a second, empty scene registry after HMR).
    const scenes = game.scenes?.playSceneForPlayer
      ? game.scenes
      : await import('/src/sim/scenes/scenes.ts');
    document.body.classList.add('reduce-motion');
    return {
      ok: scenes.playSceneForPlayer(game.sim.ctx, game.sim.playerId, sceneId),
      seed: game.sim.cfg.seed,
    };
  }, scene.id);
  if (!started.ok) throw new Error(`Scene ${scene.id} refused to start.`);
  return started.seed ?? WORLD_SEED_FALLBACK;
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

async function captureScene(browser, scene, outDir) {
  await mkdir(outDir, { recursive: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
    console.error(`[pageerror] ${String(error.message).slice(0, 400)}`);
  });
  try {
    await bootOfflineWorld(page);
    await stageScene(page, scene);
    const seed = await startScene(page, scene);
    await page.waitForFunction(
      (sceneId) =>
        [...window.__game.sim.scenePlaybacks.values()].some(
          (playback) => playback.sceneId === sceneId,
        ) && document.body.classList.contains('cinematic-mode'),
      { polling: 50, timeout: SCENE_START_TIMEOUT_MS },
      scene.id,
    );

    // Greedy sampling: under software rendering a screenshot costs one to two
    // seconds of REAL scene time, so exact-time sampling is impossible (the
    // game loop is rAF-driven; virtual time does not drive rAF). Every frame
    // is instead labeled with the MEASURED scene clock read just before the
    // shot, and each camera cut is attributed to the first frame at or after
    // it. The natural cadence lands near the two-second review target.
    const cuts = [...scene.cameraCuts].sort((left, right) => left - right);
    const frames = [];
    let previous = -1;
    while (true) {
      const state = await sceneClock(page, scene.id);
      if (state.elapsed === null) break;
      const reasons = [];
      for (const cut of cuts) {
        if (cut > previous && cut <= state.elapsed) reasons.push(`cut at ${formatSeconds(cut)}s`);
      }
      if (reasons.length === 0) reasons.push('cadence');
      const file = frameFileName(frames.length, state.elapsed);
      await takeFrame(page, path.join(outDir, file));
      frames.push({ time: state.elapsed, reasons: new Set(reasons), file });
      console.log(
        `[${scene.id}] captured ${formatSeconds(state.elapsed)}s (${reasons.join(', ')})`,
      );
      previous = state.elapsed;
      await sleep(150);
    }

    // The scene is over: prove the teardown, then the restored HUD.
    const endFile = frameFileName(frames.length, scene.duration);
    await takeFrame(page, path.join(outDir, endFile));
    frames.push({ time: scene.duration, reasons: new Set(['after scene end']), file: endFile });
    await page.waitForFunction(() => !document.body.classList.contains('cinematic-mode'), {
      polling: 50,
      timeout: 15_000,
    });
    await sleep(1000);
    const hudFile = frameFileName(frames.length, scene.duration + 1);
    await takeFrame(page, path.join(outDir, hudFile));
    frames.push({
      time: scene.duration + 1,
      reasons: new Set(['HUD restored']),
      file: hudFile,
    });

    if (pageErrors.length > 0) {
      throw new Error(`Page errors observed: ${pageErrors.join(' | ')}`);
    }
    await writeFile(path.join(outDir, 'index.html'), renderIndex(scene, seed, frames), 'utf8');
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
