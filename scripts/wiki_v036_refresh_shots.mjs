// Evidence screenshots for the v0.36 wiki refresh: the five new pages (Rifts,
// Mounts & Riding, Interface & HUD, Slash Commands, World Editor), the World page
// whose zone cards stopped keying their copy and DOM ids off a shared biome, the
// Talents page whose model was rewritten, and the restructured sidebar.
//
// MODE=after (default) or MODE=before names the output files. On a before run the
// five new routes do not resolve at all, so they are skipped and logged; the World,
// Talents, and sidebar shots are the meaningful comparison.
//
// Needs `npm run dev` (GAME_URL, default http://localhost:5173). Writes PNGs to
// SHOTS_DIR (default docs/screenshots/wiki-v036-refresh/).
//   BROWSER_PATH=... GAME_URL=http://localhost:5173 node scripts/wiki_v036_refresh_shots.mjs

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';

const MODE = process.env.MODE === 'before' ? 'before' : 'after';
const BASE = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/wiki-v036-refresh';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const log = (ok, m) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${m}`);
  if (!ok) fails.push(m);
};

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  defaultViewport: null,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
});

async function metrics(page, w, h, dsf) {
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: w,
    height: h,
    deviceScaleFactor: dsf,
    mobile: dsf > 1,
    screenWidth: w,
    screenHeight: h,
  });
  return cdp;
}

async function shoot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${OUT}/${MODE}-${name}.png`, Buffer.from(data, 'base64'));
  console.log(`shot ${MODE}-${name}.png`);
}

// New in this branch: absent on a before run, so a missing route there is expected.
const NEW_PAGES = [
  { name: 'rifts', path: '/wiki/rifts' },
  { name: 'mounts', path: '/wiki/mounts' },
  { name: 'interface', path: '/wiki/reference/interface' },
  { name: 'commands', path: '/wiki/reference/commands' },
  { name: 'editor', path: '/wiki/reference/editor' },
];
// Changed in this branch: the real before/after comparison.
const CHANGED_PAGES = [
  { name: 'world', path: '/wiki/world' },
  { name: 'talents', path: '/wiki/reference/talents' },
  { name: 'gear', path: '/wiki/gear' },
  { name: 'social', path: '/wiki/social' },
];

const page = await browser.newPage();
let cdp = await metrics(page, 1600, 1000, 1);

async function capture(w, newInBranch) {
  await page.goto(`${BASE}${w.path}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(700);
  const resolved = await page.evaluate(
    // string-form body: this script may run under tsx (keepNames trap)
    `(() => {
      const root = document.querySelector('main, .guide-main, #guide-root') ?? document.body;
      const h1 = root.querySelector('h1');
      return { len: root.textContent.length, h1: h1 ? h1.textContent.trim() : '' };
    })()`,
  );
  const ok = resolved.len > 400 && resolved.h1.length > 0;
  if (!ok && MODE === 'before' && newInBranch) {
    console.log(`skip ${w.name}: route does not exist on the base tree (expected)`);
    return;
  }
  log(ok, `${w.path} renders (h1 "${resolved.h1}", ${resolved.len} chars)`);
  await shoot(cdp, w.name);
}

for (const w of NEW_PAGES) await capture(w, true);
for (const w of CHANGED_PAGES) await capture(w, false);

// The sidebar restructure: the single Compendium group split into four. Shot from an
// INNER page at a tall viewport (the /wiki landing is the marketing hero and carries no
// sidebar) so the whole nav column is in frame.
cdp = await metrics(page, 1280, 1600, 1);
await page.goto(`${BASE}/wiki/reference/glossary`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(700);
const groups = await page.evaluate(
  `(() => [...document.querySelectorAll('.guide-sidebar h2, .guide-sidebar h3, nav h2, nav h3')]
      .map((n) => n.textContent.trim()).filter(Boolean))()`,
);
console.log('sidebar groups:', JSON.stringify(groups));
await shoot(cdp, 'sidebar');

// Mobile portrait: the guide is a content surface, so portrait is the right frame.
cdp = await metrics(page, 390, 844, 3);
for (const w of [
  { name: 'rifts-mobile', path: '/wiki/rifts', newInBranch: true },
  { name: 'world-mobile', path: '/wiki/world', newInBranch: false },
]) {
  await page.goto(`${BASE}${w.path}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(700);
  const len = await page.evaluate(`(() => document.body.textContent.length)()`);
  if (len < 400 && MODE === 'before' && w.newInBranch) {
    console.log(`skip ${w.name}: route does not exist on the base tree (expected)`);
    continue;
  }
  await shoot(cdp, w.name);
}

await page.close();
await browser.close();
if (fails.length) {
  console.error(`\n${fails.length} check(s) failed:`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nall checks passed');
