// Screenshot check for the wordmark overlay during the first-spawn intro
// cinematic (logo_fade.ts + intro_logo_overlay.ts). Drives a FRESH offline
// character (the intro is seen-once per character, so the spawn intro seen
// flag must NOT be pre-set here, unlike the other mobile_* harnesses) and
// captures the overlay at three points along the pan: mid fade-in, full
// hold, and mid fade-out. Runs once per viewport (desktop, mobile).
//
// Usage: node scripts/intro_logo_fade_shot.mjs   (requires `npm run dev` on :5173)
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.WOC_DEV_URL ?? 'http://localhost:5173/';
const OUT = 'docs/screenshots';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800, isMobile: false, hasTouch: false },
  // Landscape: the game itself gates portrait behind a "Rotate to Landscape"
  // notice (mobile_preflight), so a portrait viewport never reaches gameplay.
  { name: 'mobile', width: 844, height: 390, isMobile: true, hasTouch: true },
];

// Rather than guess a fixed offset from window.__game appearing (the actual
// gap depends on asset prewarm time, which varies by machine), poll the real
// #intro-logo element's live opacity and capture the three points the moment
// they're observed: rising through the fade-in, sitting at the full-opacity
// hold, and falling through the fade-out. Bails with a clear error if the
// overlay never appears (e.g. the intro cinematic did not trigger) instead of
// silently saving blank frames.
const POLL_MS = 60;
const POLL_TIMEOUT_MS = 12000;

async function readOpacity(page) {
  return page.evaluate(() => {
    const el = document.getElementById('intro-logo');
    if (!el) return null;
    if (el.style.display === 'none') return 0;
    const v = Number.parseFloat(el.style.opacity);
    return Number.isFinite(v) ? v : 0;
  });
}

async function waitForOpacity(page, predicate, timeoutMs = POLL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await readOpacity(page);
    if (last !== null && predicate(last)) return last;
    await sleep(POLL_MS);
  }
  throw new Error(`#intro-logo opacity never satisfied predicate (last seen: ${last})`);
}

async function run(viewport) {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    if (viewport.isMobile) {
      const client = await page.target().createCDPSession();
      await client.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'pointer', value: 'coarse' }],
      });
    }
    await page.goto(URL, { waitUntil: 'networkidle2' });

    const charName = `LogoFade${viewport.name}`;
    // Deliberately do NOT set woc_spawn_intro_seen: a fresh character must
    // play the intro cinematic (and its logo fade) on first entry.
    await enterOfflineGame(page, { charClass: 'warrior', charName, settleMs: 0 });

    await page.waitForFunction(() => Boolean(window.__game), { timeout: 15000 });

    // Mid fade-in: any partial opacity strictly between 0 and 1.
    await waitForOpacity(page, (o) => o > 0 && o < 1);
    await page.screenshot({ path: `${OUT}/intro-logo-fade-${viewport.name}-mid-fade-in.png` });
    console.log(`saved intro-logo-fade-${viewport.name}-mid-fade-in.png`);

    // Full hold: opacity pinned at 1.
    await waitForOpacity(page, (o) => o >= 0.999);
    const path = `${OUT}/intro-logo-fade-${viewport.name}-full-hold.png`;
    await page.screenshot({ path });
    console.log(`saved ${path}`);

    // Mid fade-out: back down through a partial opacity after having held at 1.
    await waitForOpacity(page, (o) => o > 0 && o < 1);
    await page.screenshot({ path: `${OUT}/intro-logo-fade-${viewport.name}-mid-fade-out.png` });
    console.log(`saved intro-logo-fade-${viewport.name}-mid-fade-out.png`);
  } finally {
    await browser.close();
  }
}

for (const viewport of VIEWPORTS) {
  await run(viewport);
}
