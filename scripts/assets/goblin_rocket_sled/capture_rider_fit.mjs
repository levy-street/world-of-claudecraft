// Mount-owned interaction evidence: the real player_warrior GLB posed in its
// shipped Sit_Floor_Idle clip at the proposed rider socket.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as esbuild from 'esbuild';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from '../../browser_path.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const stageIndex = process.argv.indexOf('--stage');
const stage = stageIndex >= 0 ? process.argv[stageIndex + 1] : 'blockout';
const riderSource = path.join(ROOT, 'public/models/chars/players/knight.glb');
const outputDir = path.join(ROOT, 'docs/screenshots/goblin-rocket-sled/authoring', stage);

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});
const document = await io.read(riderSource);
for (const texture of document.getRoot().listTextures()) texture.dispose();
const riderBytes = await io.writeBinary(document);

const { outputFiles } = await esbuild.build({
  entryPoints: [path.join(HERE, 'rider_fit_entry.js')],
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
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist', '--no-sandbox', '--enable-webgl'],
});
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 20_000 });
  mkdirSync(outputDir, { recursive: true });
  for (const view of ['hero', 'right', 'top']) {
    const result = await page.evaluate(
      (b64, selectedStage, selectedView) =>
        window.renderGoblinRocketSledRiderFit(b64, selectedStage, selectedView),
      Buffer.from(riderBytes).toString('base64'),
      stage,
      view,
    );
    writeFileSync(path.join(outputDir, `rider-fit-${view}.png`), Buffer.from(result.dataUrl.split(',')[1], 'base64'));
    console.log(`${view}: ${JSON.stringify({ riderBounds: result.riderBounds, seatedLandmarks: result.seatedLandmarks, overlaps: result.overlaps })}`);
  }
} finally {
  await browser.close();
}
