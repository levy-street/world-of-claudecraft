#!/usr/bin/env node
// In-place WebGL context loss and restore, measured on a real GL context.
//
// Drives the offline world in headless Chromium (needs `npm run dev`) as an
// offline Warrior that casts once before the loss and once after, counts
// the GL links and texture uploads per animation frame around a
// WEBGL_lose_context loss + restore, reads the renderer's gpu-prep events
// (`live-program`: a program linked inside a live frame; `context-restore`: the
// restore hold's outcome), and checks that the world is not left dark: the
// mean luminance of a screenshot before the loss against one taken after the
// restore settled, plus a pixel readback of the render targets a restore
// empties (the prefiltered environment map, the grass ground bake).
//
// Usage: PORT=5196 node scripts/context_restore_probe.mjs <out-dir> [label]
// Env: GFX=<tier> forces a tier, ANGLE=<backend> picks the ANGLE backend,
// LOST_MS (default 1500) is how long the context stays lost, AFTER_MS (default
// 17000) how long the restore window is recorded.
// Writes <out-dir>/<label>.json and two screenshots; prints the summary.

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import puppeteer from 'puppeteer-core';
import { findBrowserPath } from './browser_path_resolve.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const PORT = Number(process.env.PORT ?? 5196);
const OUT = process.argv[2];
const LABEL = process.argv[3] ?? 'run';
const LOST_MS = Number(process.env.LOST_MS ?? 1500);
const AFTER_MS = Number(process.env.AFTER_MS ?? 17_000);
if (!OUT) {
  console.error('usage: node scripts/context_restore_probe.mjs <out-dir> [label]');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs in the page before any script: wraps the GL entry points the restore
// pays for and buckets them per animation frame.
function instrument() {
  const proto = WebGL2RenderingContext.prototype;
  const counts = { link: 0, tex: 0, compressed: 0, storage: 0 };
  const rec = { counts, frames: [], recording: false, t0: 0 };
  window.__restoreProbe = rec;
  const wrap = (name, key) => {
    const original = proto[name];
    if (!original) return;
    proto[name] = function (...args) {
      counts[key]++;
      return original.apply(this, args);
    };
  };
  wrap('linkProgram', 'link');
  for (const name of ['texImage2D', 'texImage3D', 'texSubImage2D', 'texSubImage3D']) {
    wrap(name, 'tex');
  }
  for (const name of ['compressedTexImage2D', 'compressedTexSubImage2D']) wrap(name, 'compressed');
  for (const name of ['texStorage2D', 'texStorage3D']) wrap(name, 'storage');
  let previous = null;
  let last = performance.now();
  const tick = (ts) => {
    if (rec.recording) {
      const snap = { ...counts };
      if (previous) {
        const frame = { t: ts - rec.t0, dt: ts - last };
        for (const key in snap) frame[key] = snap[key] - previous[key];
        rec.frames.push(frame);
      }
      previous = snap;
    } else {
      previous = null;
    }
    last = ts;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function startRecording() {
  const rec = window.__restoreProbe;
  rec.frames = [];
  rec.t0 = performance.now();
  rec.recording = true;
}

function stopRecording() {
  const rec = window.__restoreProbe;
  rec.recording = false;
  const frames = rec.frames;
  const sum = (key) => frames.reduce((total, frame) => total + frame[key], 0);
  const worst = [...frames].sort((a, b) => b.dt - a.dt)[0] ?? null;
  const stats = window.__game.renderer.perfStats();
  const events = (stats.gpuPrep?.events?.events ?? []).filter((event) => event.atMs >= rec.t0 - 50);
  return {
    frames: frames.length,
    links: sum('link'),
    uploads: sum('tex') + sum('compressed'),
    over50: frames.filter((frame) => frame.dt > 50).length,
    over100: frames.filter((frame) => frame.dt > 100).length,
    slowMsOver33: Math.round(
      frames.filter((frame) => frame.dt > 33).reduce((total, frame) => total + frame.dt, 0),
    ),
    worstFrameMs: worst ? Math.round(worst.dt) : 0,
    worstFrameLinks: worst ? worst.link : 0,
    livePrograms: events.filter((event) => event.kind === 'live-program').length,
    restoreEvents: events
      .filter((event) => event.kind === 'context-restore')
      .map((event) => ({
        end: event.key,
        holdMs: Math.round(event.ageMs),
        settled: event.readyRoots,
        submitted: event.totalRoots,
        resets: event.units,
      })),
    worstFrames: [...frames]
      .sort((a, b) => b.dt - a.dt)
      .slice(0, 6)
      .map((frame) => ({
        atMs: Math.round(frame.t),
        ms: Math.round(frame.dt),
        links: frame.link,
        uploads: frame.tex + frame.compressed,
        allocations: frame.storage,
      })),
    slowestQueueUnits: (stats.gpuQueue?.slowest ?? []).slice(0, 6).map((unit) => ({
      label: unit.label,
      syncMs: unit.syncMs,
      atMs: Math.round(unit.atMs - rec.t0),
    })),
    programs: window.__game.renderer.webgl.info.programs?.length ?? 0,
    textures: window.__game.renderer.webgl.info.memory.textures,
  };
}

// Mean of the non-zero-alpha texels of a render target, normalised to [0, 1]
// per channel sum; 0 means the target came back empty.
async function renderTargetReadback() {
  const renderer = window.__game.renderer;
  const webgl = renderer.webgl;
  const meanOf = (rt, type) => {
    if (!rt) return null;
    const w = Math.min(64, rt.width);
    const h = Math.min(64, rt.height);
    const buffer = type === 'half' ? new Uint16Array(w * h * 4) : new Uint8Array(w * h * 4);
    webgl.readRenderTargetPixels(rt, 0, 0, w, h, buffer);
    let total = 0;
    for (let i = 0; i < buffer.length; i += 4) total += buffer[i] + buffer[i + 1] + buffer[i + 2];
    return Math.round((total / (w * h)) * 100) / 100;
  };
  const grass = (await import('/src/render/grass_ground_bake.ts')).getGrassGroundBake();
  const env = renderer.scene.environment?.renderTarget ?? null;
  return {
    environmentMap: meanOf(env, 'half'),
    grassBake: meanOf(grass?.texture?.renderTarget ?? null, 'byte'),
  };
}

function screenshotLuminance(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  let total = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    total += 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
  }
  return Math.round((total / (png.width * png.height)) * 10) / 10;
}

const browser = await puppeteer.launch({
  executablePath: findBrowserPath(),
  headless: 'new',
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
  args: [
    '--window-size=1620,960',
    '--ignore-gpu-blocklist',
    '--enable-gpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    ...(process.env.ANGLE ? [`--use-angle=${process.env.ANGLE}`] : []),
  ],
});
try {
  const page = (await browser.pages())[0];
  await page.evaluateOnNewDocument(instrument);
  const gfx = process.env.GFX ? `&gfx=${process.env.GFX}` : '';
  await page.goto(`http://localhost:${PORT}/?perfTrace=1&perf${gfx}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  });
  const booted = await enterOfflineGame(page, {
    charClass: 'warrior',
    charName: 'perfprobe',
    settleMs: 3000,
    gameBootTimeoutMs: 120_000,
  });
  if (!booted) throw new Error('the offline world did not boot');
  // Let the reveal and the post-entry resume lane drain before measuring.
  await sleep(25_000);
  await page.evaluate(startRecording);
  await sleep(8000);
  const baseline = await page.evaluate(stopRecording);
  const before = path.join(OUT, `${LABEL}_before_loss.png`);
  await page.screenshot({ path: before });
  const readbackBefore = await page.evaluate(renderTargetReadback);

  // One self-cast before the loss, so its effect is "prepared" when the
  // context goes, and one after the restore: the first cast of a family is
  // where a stale ready bit linked its programs in a live frame.
  const cast = () =>
    page.evaluate(() => {
      const sim = window.__game.sim;
      if ('rage' in sim.player) sim.player.rage = 100;
      sim.castAbility('battle_shout');
    });
  await cast();
  await sleep(3000);
  await page.evaluate(startRecording);
  const loss = await page.evaluate(async (lostMs) => {
    const renderer = window.__game.renderer;
    const gl = renderer.webgl.getContext();
    const ext = gl.getExtension('WEBGL_lose_context');
    const programsBefore = renderer.webgl.info.programs?.length ?? 0;
    ext.loseContext();
    await new Promise((resolve) => setTimeout(resolve, lostMs));
    const restored = new Promise((resolve) =>
      renderer.webgl.domElement.addEventListener(
        'webglcontextrestored',
        () => resolve(performance.now()),
        { once: true },
      ),
    );
    ext.restoreContext();
    const at = await restored;
    return { programsBefore, restoredAtMs: Math.round(at - window.__restoreProbe.t0) };
  }, LOST_MS);
  await sleep(2500);
  await cast();
  await sleep(Math.max(0, AFTER_MS - 2500));
  const after = path.join(OUT, `${LABEL}_after_restore.png`);
  await page.screenshot({ path: after });
  const restore = await page.evaluate(stopRecording);
  const readbackAfter = await page.evaluate(renderTargetReadback);
  const summary = {
    label: LABEL,
    loss,
    baseline,
    restore,
    luminance: { before: screenshotLuminance(before), after: screenshotLuminance(after) },
    renderTargets: { before: readbackBefore, after: readbackAfter },
  };
  fs.writeFileSync(path.join(OUT, `${LABEL}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
}
