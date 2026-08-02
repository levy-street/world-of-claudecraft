// Look-dev harness for the Tank mount's material pass.
//
// The turntable previews the exporter writes prove the asset loads and animates;
// they are framed too wide to judge a surface. This renders the shots the
// object-sculpt spec's screenshotReview asks for instead: a readability shot
// under a key/fill/rim rig, a raking grazing-light close-up (the one that
// exposes flat normals, uniform roughness, plastic highlights and tiling), and a
// flat neutral shot that shows the albedo and vertex bake with no lighting to
// hide behind.
//
// Usage:
//   node scripts/assets/terrorspark_groundshaker/lookdev_terrorspark_groundshaker.mjs
//   node scripts/assets/terrorspark_groundshaker/lookdev_terrorspark_groundshaker.mjs --glb tmp/x.glb --out tmp/look
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from '../../browser_path.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const ENTRY = path.join(HERE, 'lookdev_entry.js');

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const glbPath = path.resolve(
  ROOT,
  optionValue('--glb', 'public/models/mounts/terrorspark_groundshaker.glb'),
);
const outDir = path.resolve(
  ROOT,
  optionValue('--out', 'docs/screenshots/terrorspark-groundshaker/authoring/material'),
);
const size = Number(optionValue('--size', '1024'));

const SHOTS = Object.freeze([
  {
    name: 'lookdev-studio',
    rig: 'studio',
    yaw: -0.72,
    pitch: 0.34,
    zoom: 1,
    lookUp: 0,
    exposure: 1,
  },
  {
    name: 'lookdev-grazing-hull',
    rig: 'grazing',
    yaw: -0.55,
    pitch: 0.16,
    zoom: 2.5,
    lookUp: 0.18,
    exposure: 1.05,
  },
  {
    name: 'lookdev-grazing-saddle',
    rig: 'grazing',
    yaw: 2.55,
    pitch: 0.5,
    zoom: 2.7,
    lookUp: 0.52,
    exposure: 1.15,
  },
  {
    name: 'lookdev-neutral',
    rig: 'neutral',
    yaw: -0.72,
    pitch: 0.24,
    zoom: 1.35,
    lookUp: 0.05,
    exposure: 1,
  },
]);

const { outputFiles } = await esbuild.build({
  entryPoints: [ENTRY],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
  logLevel: 'silent',
});
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${outputFiles[0].text}</script></body></html>`;

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  args: [
    '--use-angle=swiftshader',
    '--use-gl=angle',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
    '--enable-webgl',
  ],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.error('PAGEERR', error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('CONSOLE', message.text());
  });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 30_000 });
  const shots = await page.evaluate(
    (base64, requested) => window.renderTankLookdev(base64, requested),
    readFileSync(glbPath).toString('base64'),
    SHOTS.map((shot) => ({ ...shot, size })),
  );
  mkdirSync(outDir, { recursive: true });
  for (const shot of shots) {
    const dest = path.join(outDir, `${shot.name}.png`);
    writeFileSync(dest, Buffer.from(shot.dataUrl.split(',')[1], 'base64'));
    console.log(`lookdev: ${path.relative(ROOT, dest)}`);
  }
} finally {
  await browser.close();
}
