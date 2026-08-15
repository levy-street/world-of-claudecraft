// Reproducible procedural banker-chest authoring and export.
//
// Usage:
//   node scripts/assets/banker_chest/export_banker_chest.mjs
//   node scripts/assets/banker_chest/export_banker_chest.mjs --no-preview
//   node scripts/assets/banker_chest/export_banker_chest.mjs --raw-only
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from '../../browser_path.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const ENTRY = path.join(HERE, 'export_entry.js');
const RAW_OUT = path.join(ROOT, 'tmp/asset_src/banker_chest/banker_chest.glb');
const PREVIEW_DIR = path.join(ROOT, 'tmp/banker_chest_preview');
const SPEC = path.join(ROOT, 'scripts/assets/specs/banker_chest.json');
const BUILD_ASSETS = path.join(ROOT, 'scripts/assets/build_assets.mjs');
const noPreview = process.argv.includes('--no-preview');
const rawOnly = process.argv.includes('--raw-only');

const { outputFiles } = await esbuild.build({
  entryPoints: [ENTRY],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
  logLevel: 'silent',
});
const bundle = outputFiles[0].text;
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${bundle}</script></body></html>`;

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
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
  await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => console.error('PAGEERR', error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('CONSOLE', message.text());
  });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });

  const result = await page.evaluate(() => window.exportBankerChest());
  mkdirSync(path.dirname(RAW_OUT), { recursive: true });
  writeFileSync(RAW_OUT, Buffer.from(result.b64, 'base64'));
  console.log(`raw: ${path.relative(ROOT, RAW_OUT)}`);
  console.log(`authoring stats: ${JSON.stringify(result.stats)}`);

  if (!noPreview) {
    mkdirSync(PREVIEW_DIR, { recursive: true });
    for (const view of ['threeQuarter', 'front', 'side', 'grazing']) {
      await page.evaluate((name) => window.renderBankerChestPreview(name), view);
      const canvas = await page.$('canvas');
      if (!canvas) throw new Error('preview canvas was not created');
      const out = path.join(PREVIEW_DIR, `${view}.png`);
      await canvas.screenshot({ path: out });
      console.log(`preview: ${path.relative(ROOT, out)}`);
    }
  }
} finally {
  await browser.close();
}

if (!rawOnly) {
  const pipeline = spawnSync(process.execPath, [BUILD_ASSETS, SPEC], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (pipeline.status !== 0) process.exit(pipeline.status ?? 1);
}
