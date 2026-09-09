import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from '../../browser_path.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const stageIndex = process.argv.indexOf('--stage');
const stage = stageIndex >= 0 ? process.argv[stageIndex + 1] : 'material';
const glbPath = path.join(
  ROOT,
  'tmp/asset_src/goblin_rocket_sled',
  `goblin_rocket_sled-${stage}.glb`,
);
const outputDir = path.join(ROOT, 'docs/screenshots/goblin-rocket-sled/authoring', stage);
const { outputFiles } = await esbuild.build({
  entryPoints: [path.join(HERE, 'lookdev_entry.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
  logLevel: 'silent',
});
const html = `<!doctype html><html><body><script>${outputFiles[0].text}</script></body></html>`;
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
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 20_000 });
  const b64 = readFileSync(glbPath).toString('base64');
  mkdirSync(outputDir, { recursive: true });
  for (const mode of ['neutral', 'grazing', 'reference-match']) {
    const dataUrl = await page.evaluate(
      (data, selectedMode) => window.renderSledLookdev(data, selectedMode),
      b64,
      mode,
    );
    const output = path.join(outputDir, `lookdev-${mode}.png`);
    writeFileSync(output, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(path.relative(ROOT, output));
  }
} finally {
  await browser.close();
}
