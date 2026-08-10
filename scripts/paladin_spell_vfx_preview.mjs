// Paladin spell visual preview.
//
// Usage:
//   npm run dev
//   node scripts/paladin_spell_vfx_preview.mjs --mode=holy --time=0.12
//   node scripts/paladin_spell_vfx_preview.mjs --mode=sunward --time=0.43
//   node scripts/paladin_spell_vfx_preview.mjs --mode=bastion --time=0.32
//   node scripts/paladin_spell_vfx_preview.mjs --mode=dawnfall --time=0.34 --mobile
//   node scripts/paladin_spell_vfx_preview.mjs --mode=consecration --time=0.35
//   node scripts/paladin_spell_vfx_preview.mjs --interactive
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const BASE = process.env.WOC_DEV_BASE ?? 'http://127.0.0.1:5173';
const interactive = process.argv.includes('--interactive');
const mobile = process.argv.includes('--mobile');
const mode = process.argv.find((argument) => argument.startsWith('--mode='))?.slice(7) ?? 'holy';
const fallbackTime =
  mode === 'sunward'
    ? 0.43
    : mode === 'bastion'
      ? 0.32
      : mode === 'dawnfall'
        ? 0.34
        : mode === 'consecration'
          ? 0.35
          : 0.12;
const time = Number(
  process.argv.find((argument) => argument.startsWith('--time='))?.slice(7) ?? fallbackTime,
);
if (!['holy', 'sunward', 'bastion', 'dawnfall', 'consecration'].includes(mode))
  throw new Error(`Unknown preview mode: ${mode}`);
fs.mkdirSync('tmp', { recursive: true });

const viewport = mobile
  ? { width: 390, height: 844, deviceScaleFactor: 1 }
  : { width: 1600, height: 900, deviceScaleFactor: 1 };
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: !interactive,
  args: [
    `--window-size=${viewport.width},${viewport.height}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: viewport,
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  const value = message.text();
  if (value.includes('502') || value.includes('Failed to fetch project stats')) return;
  errors.push(`CONSOLE: ${value}`);
});

await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 45_000 });
await page.evaluate(async () => {
  const previewModule = await import('/src/render/paladin_spell_vfx_preview.ts');
  window.__paladinSpellVfxPreview = await previewModule.mountPaladinSpellVfxPreview();
});

if (interactive) {
  console.log(
    'Paladin VFX preview ready. Press H for Solar Invocation, S for Sunward, B for Bastion Sweep, D for Dawnfall, or C for Consecration.',
  );
  await new Promise((resolve) => browser.on('disconnected', resolve));
} else {
  await page.evaluate(
    ({ selectedMode, seconds }) => window.__paladinSpellVfxPreview.pauseAt(selectedMode, seconds),
    { selectedMode: mode, seconds: time },
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  const suffix = mobile ? '_mobile' : '';
  const screenshot = `tmp/paladin_${mode}_vfx_${time.toFixed(2)}${suffix}.png`;
  await page.screenshot({ path: screenshot });
  if (errors.length > 0) throw new Error(errors.join('\n'));
  console.log(`${mode} VFX captured at ${time.toFixed(2)} s: ${screenshot}`);
  await browser.close();
}
