// Render the procedural soundtrack themes from src/game/music.ts to WAV files
// so they can be auditioned outside the game. Drives a headless browser
// (puppeteer-core + system Chrome via browser_path.mjs) running an esbuild
// bundle of scripts/music_render_entry.ts; the page renders each theme through
// an OfflineAudioContext with the exact in-game synth voices and mix chain.
//
// Run:
//   node scripts/render_music.mjs [outDir=tmp/music_renders] [theme ...]
// With no theme args it renders every theme in buildMusicThemes().
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const OUT = process.argv[2] || 'tmp/music_renders';
const ONLY = process.argv.slice(3);
mkdirSync(OUT, { recursive: true });

const BUNDLE = 'tmp/music_render_bundle.js';
execFileSync(
  'npx',
  ['esbuild', 'scripts/music_render_entry.ts', '--bundle', '--format=iife', `--outfile=${BUNDLE}`],
  { stdio: 'inherit' },
);
if (!existsSync(BUNDLE)) {
  console.error(`missing ${BUNDLE} after esbuild`);
  process.exit(1);
}

function wavFromPcm16(b64, sampleRate) {
  const pcm = Buffer.from(b64, 'base64');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const html = '<!doctype html><html><head><meta charset="utf8"></head><body></body></html>';
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('PAGEERR', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('CONSOLE', m.text());
  });
  await page.setContent(html, { waitUntil: 'load' });
  await page.addScriptTag({ path: BUNDLE });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });

  const names = ONLY.length > 0 ? ONLY : await page.evaluate(() => window.musicThemeNames);
  for (const name of names) {
    const res = await page.evaluate((n) => window.renderMusicTheme(n), name);
    const wav = wavFromPcm16(res.pcm16, res.sampleRate);
    const file = path.join(OUT, `${name}.wav`);
    writeFileSync(file, wav);
    const peakDb = res.peak > 0 ? (20 * Math.log10(res.peak)).toFixed(1) : '-inf';
    console.log(
      `${name}: ${res.seconds.toFixed(1)}s (${res.loops} loops of ${res.loopSeconds.toFixed(1)}s @ ${res.bpm}bpm), peak ${peakDb} dBFS -> ${file}`,
    );
  }
} finally {
  await browser.close();
}
