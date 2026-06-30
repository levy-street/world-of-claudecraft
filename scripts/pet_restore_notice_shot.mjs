// In-game capture for the pet-restore-failed notice (PR #973).
// Boots the offline browser world (the same Sim that ships), then drives the
// REAL Sim.restorePet with a saved pet whose creature template was removed or
// renamed. The unknown-template guard now emits a player notice instead of
// silently emptying the pet slot; the genuine HUD event path localizes it via
// localizeSimText and prints it in the chat log.
// Saves to docs/pr-assets/pet-restore/. Needs `npm run dev` on :5173.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const BASE = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/pr-assets/pet-restore';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});

// Restore a saved pet whose template id no longer exists. restorePet emits
// ctx.notice -> SimEvent{type:'log'}; the main loop drains it into
// hud.handleEvents next frame, which runs the live localize pipeline.
const triggerRestore = (name) => {
  const sim = window.__game.sim;
  sim.restorePet(sim.player, {
    templateId: 'forest_wolf_REMOVED',
    name,
    level: sim.player.level,
    hp: 50,
    dead: false,
    mode: 'defensive',
    autoTaunt: false,
  });
};

async function capture(lang, tag) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log(`[${tag}] PAGEERROR:`, e.message));
  // Locale is selected up front via the ?lang= query the app reads on boot.
  const url = lang === 'en' ? BASE : `${BASE}/?lang=${lang}`;
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.evaluate(() => document.getElementById('btn-offline').click());
  await sleep(400);
  await page.type('#char-name', 'Houndmaster');
  await page.evaluate(() =>
    document.querySelector('#offline-select .mini-class[data-class="hunter"]')?.click(),
  );
  await sleep(200);
  await page.evaluate(() => document.getElementById('btn-start-offline').click());
  await page.waitForFunction(() => !!window.__game?.sim?.player, { timeout: 60000, polling: 500 });
  await sleep(800);
  // Clean saved name: the notice splices the localizable proper noun.
  await page.evaluate(triggerRestore, 'Rex');
  await sleep(800);
  await page.screenshot({
    path: `${OUT}/chatlog-${tag}.png`,
    clip: { x: 4, y: 632, width: 470, height: 260 },
  });
  if (lang === 'en') await page.screenshot({ path: `${OUT}/full-hud-en.png` });
  // Unclean saved name (cleanPetName rejects it): the notice falls back to the
  // generic, name-free sentence, which localizes wholesale (no embedded English).
  await page.evaluate(triggerRestore, '???');
  await sleep(800);
  await page.screenshot({
    path: `${OUT}/chatlog-${tag}-noname.png`,
    clip: { x: 4, y: 632, width: 470, height: 260 },
  });
  console.log(`[${tag}] captured`);
  await page.close();
}

await capture('en', 'en');
await capture('de_DE', 'de');

console.log('done ->', OUT, fs.readdirSync(OUT));
await browser.close();
