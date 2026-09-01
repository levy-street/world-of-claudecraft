// Live-browser proof for the knockback wall-pin fix (PR evidence, not a repo
// test). Teleports the offline player to the EXACT old zero-clearance
// boundary next to a real well collider (farshore.ts: {x:305,z:71,r:1.5}),
// deterministically reproducing the end state a repeated Tectonic Heave
// shove used to land the player at (well radius 1.5 + player body radius
// 0.5 = 2.0yd from the well center), then holds the away-from-the-well
// direction for two seconds and reports the net displacement. On the bug
// this is 0 (frozen in every direction, including away); on the fix it is a
// real walk-away distance.
//
//   node scripts/knockback_wall_pin_shot.mjs <before|after>
//
// Env: BROWSER_PATH, SHOT_PORT (5189).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const LABEL = process.argv[2];
if (LABEL !== 'before' && LABEL !== 'after') {
  throw new Error('usage: node scripts/knockback_wall_pin_shot.mjs <before|after>');
}
const PORT = Number(process.env.SHOT_PORT ?? 5189);
const OUT_DIR = path.join('docs', 'screenshots', 'knockback-wall-pin');
fs.mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WELL_X = 305;
const WELL_Z = 71;
const TP_X = 307; // exactly 2.0yd from the well center: well r 1.5 + body r 0.5
const TP_Z = 71;

async function startVite() {
  const vite = spawn(
    process.execPath,
    [path.join('node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  vite.stdout.on('data', (chunk) => (output += chunk));
  vite.stderr.on('data', (chunk) => (output += chunk));
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error(`vite exited before ready:\n${output}`);
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) return vite;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  vite.kill('SIGTERM');
  throw new Error(`vite not ready on :${PORT} within 30s:\n${output}`);
}

async function overlayText(page, text) {
  await page.evaluate((t) => {
    let el = document.getElementById('kb-shot-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'kb-shot-overlay';
      el.style.cssText =
        'position:fixed;left:12px;top:12px;z-index:999999;background:rgba(0,0,0,0.75);' +
        'color:#fff;font:16px monospace;padding:10px 14px;border-radius:6px;white-space:pre;';
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

async function main() {
  const vite = await startVite();
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: ['--window-size=1280,800', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1280, height: 800 },
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
      } catch {
        /* ignore */
      }
    });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0', timeout: 30000 });
    const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'KB Pin Test' });
    if (!booted) throw new Error('offline world did not boot');
    await sleep(500);

    // Dismiss the new-character NPC greeting and tutorial popup so they
    // don't clutter the shot; harmless no-op if either is already gone.
    await page.evaluate(() => {
      for (const btn of document.querySelectorAll('button')) {
        const t = btn.textContent?.trim();
        if (t === 'Understood' || t === 'Skip Tutorial') btn.click();
      }
    });
    await sleep(200);

    await page.evaluate((x, z) => window.__game.world.chat(`/dev tp ${x} ${z}`), TP_X, TP_Z);
    await sleep(400);
    // Wait out any transient movement-suspend window (e.g. a lingering
    // teleport/UI flag) before driving real input: input.debugState()
    // reports the client's live gate, not just the sim position.
    await page
      .waitForFunction(() => window.__game.input.debugState().suspendMovement === false, {
        timeout: 5000,
        polling: 50,
      })
      .catch(() => {});

    const before = await page.evaluate(() => {
      const p = window.__game.world.player;
      return { x: p.pos.x, z: p.pos.z };
    });
    const distToWell0 = Math.hypot(before.x - WELL_X, before.z - WELL_Z);
    await page.evaluate(() => {
      for (const btn of document.querySelectorAll('button')) {
        if (btn.textContent?.trim() === 'Dismiss') btn.click();
      }
    });
    await overlayText(
      page,
      `${LABEL}\npos: (${before.x.toFixed(3)}, ${before.z.toFixed(3)})\ndist to well: ${distToWell0.toFixed(4)}yd`,
    );
    await sleep(100);
    await page.screenshot({ path: path.join(OUT_DIR, `${LABEL}-1-positioned.png`) });

    // Hold "back" for 2s: calibrated against this exact spawn/teleport facing
    // (a fixed function of position, identical on both branches), the
    // direction that walks away from the well (+x). Not "forward": that
    // faces roughly toward the well here, where a hit is correctly refused
    // on both branches, so it would prove nothing about the fix.
    await page.keyboard.down('s');
    await sleep(2000);
    await page.keyboard.up('s');
    await sleep(200);

    const after = await page.evaluate(() => {
      const p = window.__game.world.player;
      return { x: p.pos.x, z: p.pos.z };
    });
    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    const distToWell1 = Math.hypot(after.x - WELL_X, after.z - WELL_Z);
    console.log(
      `${LABEL}: start=(${before.x.toFixed(4)},${before.z.toFixed(4)}) ` +
        `end=(${after.x.toFixed(4)},${after.z.toFixed(4)}) moved=${moved.toFixed(4)}yd ` +
        `distToWell: ${distToWell0.toFixed(4)} -> ${distToWell1.toFixed(4)}`,
    );
    await overlayText(
      page,
      `${LABEL}: held move-away 2s\nstart: (${before.x.toFixed(3)}, ${before.z.toFixed(3)})\n` +
        `end:   (${after.x.toFixed(3)}, ${after.z.toFixed(3)})\nmoved: ${moved.toFixed(4)}yd`,
    );
    await sleep(100);
    await page.screenshot({ path: path.join(OUT_DIR, `${LABEL}-2-after-hold.png`) });
  } finally {
    await browser.close().catch(() => {});
    vite.kill('SIGTERM');
  }
}

await main();
