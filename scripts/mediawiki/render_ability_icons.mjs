// Refresh the wiki's static copies of the ability icons the HUD paints on canvas.
// Run from the repository root when a procedural ability recipe changes.
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { BROWSER_PATH } from '../browser_path.mjs';

const { outputFiles } = await build({
  stdin: {
    contents: `
    import { ABILITY_ART_PENDING, iconCanvas } from './src/ui/icons';
    window.wikiProceduralIcons = () => [...ABILITY_ART_PENDING].map(id =>
      [id, iconCanvas('ability', id).toDataURL('image/png').split(',')[1]]);
  `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'iife',
  define: { 'import.meta.env': '{ "PROD": true, "DEV": false }' },
});
const browser = await puppeteer.launch({ executablePath: BROWSER_PATH, headless: true });
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: outputFiles[0].text });
  const snapshots = await page.evaluate(() => window.wikiProceduralIcons());
  const dir = 'public/ui/encyclopedia/abilities';
  await mkdir(dir, { recursive: true });
  for (const [id, png] of snapshots) {
    await sharp(Buffer.from(png, 'base64'))
      .webp({ lossless: true })
      .toFile(dir + '/' + id + '.webp');
    console.log('Wrote ' + id + ' from its action-bar recipe.');
  }
} finally {
  await browser.close();
}
