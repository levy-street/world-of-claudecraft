// Full-body stills of every NPC, and every mob drawn on a character body, rendered by the
// REAL game renderer for the wiki info box. The Guide's model viewer (the creature stills,
// render_model_stills.mjs) draws an NPC as a bare class body; this tool builds each body
// with the game's own createCharacterVisual inside the live offline client, so the authored
// look (src/render/characters/npc_looks.ts: face, hair, size, kit, held props) is drawn.
//
// A quest caravan (isQuestCaravanEntity) is drawn as the world draws it, as its freight
// wagon with horses and the seated driver (buildMovingWorldQuestFreightWagon), not as the
// class body its visual key names.
//
// Flow: start this worktree's Vite dev server (or use GAME_URL), boot the offline client
// headless and enter the world (so the WOC entry preload is resident), import
// character_stills_page.js through Vite (sharing the game's module instances and asset
// caches), then render each target in its own transparent scene and encode it the way the
// creature stills are encoded (400 px WebP with alpha, blank-alpha check).
//
// Output: public/encyclopedia-stills/{npc,mob}__<templateId>.webp and the lookup
// scripts/mediawiki/entity_stills_characters.json { "npc/<id>": url, "mob/<id>": url }.
// A run MERGES into the existing lookup, so ONLY=npc/a,mob/b rerenders a few.
//
// Run (PowerShell on Windows; Chrome fails to start from Git Bash here):
//   $env:REAL_GPU='1'; node scripts/wiki/render_character_stills.mjs
//   ONLY=npc/a,mob/b   restrict to these ids     GAME_URL=...   reuse a running client
//   STILL_PX=400       shipped size               ATTACK_PORT=5241   Vite port
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { BROWSER_PATH } from '../browser_path.mjs';
import { enterOfflineGame } from '../enter_offline_game.mjs';
import { suppressGpuNotice } from '../lib/gpu_notice_suppress.mjs';

const root = process.cwd();
const OUT_DIR = 'encyclopedia-stills';
const outDir = path.join(root, 'public', OUT_DIR);
const lookupPath = path.join(root, 'scripts', 'mediawiki', 'entity_stills_characters.json');
const OUT_PX = Number(process.env.STILL_PX || 400);
const PORT = Number(process.env.ATTACK_PORT || 5241);
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(outDir, { recursive: true });

let vite = null;
let gameUrl = process.env.GAME_URL;
if (!gameUrl) {
  const { createServer } = await import('vite');
  vite = await createServer({
    server: { port: PORT, strictPort: true, host: '127.0.0.1' },
    logLevel: 'silent',
  });
  await vite.listen();
  gameUrl = `http://127.0.0.1:${PORT}`;
}

const lookup = existsSync(lookupPath) ? JSON.parse(readFileSync(lookupPath, 'utf8')) : {};
const failed = [];
let ok = 0;
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=960,640',
    ...(process.env.REAL_GPU
      ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
  ],
  defaultViewport: { width: 960, height: 640, deviceScaleFactor: 1 },
  protocolTimeout: 600_000,
});
try {
  const page = await browser.newPage();
  let pageErr = 0;
  page.on('pageerror', (e) => {
    pageErr++;
    console.error('PAGEERR', e.message.slice(0, 300));
  });
  await suppressGpuNotice(page);
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('woc_unsupported_browser_dismissed', '1');
    localStorage.setItem('woc.cameraModePrompt.shown', '1');
  });
  await page.goto(`${gameUrl}?gfx=high`, { waitUntil: 'domcontentloaded', timeout: 600_000 });
  // #btn-offline is static HTML: on a cold dev server an early click is lost, so keep
  // clicking until the class picker opens (render_attack_snapshots.mjs has the same loop).
  const pickerUntil = Date.now() + 900_000;
  for (;;) {
    const open = await page
      .evaluate(() => {
        document.querySelector('#btn-offline')?.click();
        const card = document.querySelector('#offline-select .mini-class');
        return Boolean(card && card.getBoundingClientRect().width > 0);
      })
      .catch(() => false);
    if (open) break;
    if (Date.now() > pickerUntil) throw new Error('class picker never opened');
    await sleep(5000);
  }
  const booted = await enterOfflineGame(page, {
    charName: 'Stillmaker',
    settleMs: 2000,
    gameBootTimeoutMs: 600_000,
    selectorTimeoutMs: 600_000,
  });
  if (!booted) throw new Error('offline world did not boot');
  // The helper, through Vite: same module graph as the running game.
  await page.evaluate(async () => {
    window.__stills = await import('/scripts/wiki/character_stills_page.js');
  });
  const targets = await page.evaluate(() => window.__stills.characterTargets());
  const jobs = targets.filter((t) => !only || only.has(t.id));
  console.log(
    `${targets.length} character-bodied entities (${targets.filter((t) => t.kind === 'npc').length} NPCs); rendering ${jobs.length}`,
  );
  for (const t of jobs) {
    const file = `${t.kind}__${t.templateId}.webp`;
    try {
      const res = await page.evaluate((job) => window.__stills.renderCharacterStill(job), t);
      const png = Buffer.from(res.url.split(',')[1], 'base64');
      // A body that drew nothing still encodes a valid, fully transparent PNG.
      const alpha = (await sharp(png).stats()).channels[3];
      if (!alpha || alpha.max < 8) throw new Error(`blank render (alpha max ${alpha?.max})`);
      // A wagon is long and low, so its bounding sphere leaves a wide empty band: trim the
      // transparent margin and pad it back evenly so the team and driver fill the frame.
      const PAD = Math.round(OUT_PX * 0.04);
      const source = t.caravan
        ? await sharp(await sharp(png).trim({ threshold: 1 }).toBuffer())
            .resize(OUT_PX - 2 * PAD, OUT_PX - 2 * PAD, {
              fit: 'inside',
            })
            .extend({
              top: PAD,
              bottom: PAD,
              left: PAD,
              right: PAD,
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .png()
            .toBuffer()
        : png;
      const webp = await sharp(source)
        .resize(OUT_PX, OUT_PX, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: 90, alphaQuality: 100, effort: 6 })
        .toBuffer();
      writeFileSync(path.join(outDir, file), webp);
      lookup[t.id] = `/${OUT_DIR}/${file}`;
      ok++;
      const what = t.caravan ? `wagon${res.driver ? ' + seated driver' : ', NO driver'}` : t.key;
      console.log(`ok ${t.id} [${what}] (${(webp.length / 1024).toFixed(1)} KB)`);
    } catch (e) {
      failed.push({ id: t.id, key: t.key, why: e.message.slice(0, 200) });
      console.error(`FAILED ${t.id} [${t.key}]: ${e.message.slice(0, 200)}`);
    }
  }
  console.log(`pageErrors=${pageErr}`);
} finally {
  await browser.close();
  if (vite) await vite.close();
}

const sorted = {};
for (const k of Object.keys(lookup).sort()) sorted[k] = lookup[k];
writeFileSync(lookupPath, `${JSON.stringify(sorted, null, 2)}\n`);
mkdirSync(path.join(root, 'tmp', 'stills'), { recursive: true });
writeFileSync(
  path.join(root, 'tmp', 'stills', 'failed.json'),
  `${JSON.stringify(failed, null, 2)}\n`,
);
console.log(`\nrendered ${ok}, failed ${failed.length}; lookup: ${lookupPath}`);
