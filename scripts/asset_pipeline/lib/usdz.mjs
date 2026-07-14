// GLB -> USDZ converter for the export flow. macOS Quick Look / Preview render
// glTF textures poorly (they show bare chrome), but render USDZ natively, so a
// USDZ companion lets an operator preview the exported asset with textures on
// their Mac. Uses three.js USDZExporter inside headless Chrome (a real browser
// context, needed for the exporter's canvas/image work): the same puppeteer +
// esbuild + swiftshader approach as preview.mjs. The page is launched lazily and
// reused across conversions.
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { REPO_ROOT } from './env.mjs';

let pagePromise = null;

async function launch() {
  const esbuild = await import('esbuild');
  const puppeteer = (await import('puppeteer-core')).default;
  const { BROWSER_PATH } = await import(resolve(REPO_ROOT, 'scripts/browser_path.mjs'));

  const bundlePath = join(tmpdir(), `asset_pipeline_usdz_${process.pid}.js`);
  await esbuild.build({
    entryPoints: [resolve(REPO_ROOT, 'scripts/asset_pipeline/usdz_entry.js')],
    bundle: true,
    format: 'iife',
    outfile: bundlePath,
    logLevel: 'silent',
  });

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
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[usdz page error]', e.message));
  await page.setContent(
    `<!doctype html><html><body><script>${readFileSync(bundlePath, 'utf8')}</script></body></html>`,
  );
  await page.waitForFunction('window.__ready === true', { timeout: 30000 });
  return { browser, page };
}

/** Convert a GLB file to a textured USDZ file for macOS Quick Look. */
export async function glbToUsdz(glbPath, usdzPath) {
  if (!pagePromise) pagePromise = launch();
  const { page } = await pagePromise;
  const glbB64 = readFileSync(glbPath).toString('base64');
  const outB64 = await page.evaluate((b) => window.toUsdz(b), glbB64);
  writeFileSync(usdzPath, Buffer.from(outB64, 'base64'));
  return usdzPath;
}

/** Close the shared headless browser (best-effort). */
export async function closeUsdz() {
  if (!pagePromise) return;
  const p = pagePromise;
  pagePromise = null;
  try {
    const { browser } = await p;
    await browser.close();
  } catch {
    // nothing to clean up
  }
}
