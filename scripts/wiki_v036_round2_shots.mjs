// Evidence screenshots for the v0.36 wiki round-two accuracy pass. Every page this
// branch touches is a COPY change on a route that already exists, so unlike the
// refresh pass there is nothing to skip on a before run: the same seven routes render
// on both trees and the diff is the prose.
//
// MODE=after (default) or MODE=before names the output files. Capture after on the
// branch, revert src/ui/i18n.catalog/guide.ts + the resolved slices to the base, capture
// before, restore. Full-page shots, because most of the corrected sentences sit well
// below the fold.
//
// Needs `npm run dev` (GAME_URL, default http://localhost:5173). Writes PNGs to
// SHOTS_DIR (default docs/screenshots/wiki-v036-round2/).
//   BROWSER_PATH=... node scripts/wiki_v036_round2_shots.mjs

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';

const MODE = process.env.MODE === 'before' ? 'before' : 'after';
const BASE = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/wiki-v036-round2';
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

// The routes whose prose this branch corrects.
const PAGES = [
  { name: 'rifts', path: '/wiki/rifts' },
  { name: 'mounts', path: '/wiki/mounts' },
  { name: 'interface', path: '/wiki/reference/interface' },
  { name: 'dungeons', path: '/wiki/dungeons' },
  { name: 'delves', path: '/wiki/delves' },
  { name: 'editor', path: '/wiki/reference/editor' },
  { name: 'combat', path: '/wiki/reference/combat' },
  { name: 'how-to-play', path: '/wiki/how-to-play' },
  { name: 'world', path: '/wiki/world' },
  { name: 'gear', path: '/wiki/gear' },
];

const page = await browser.newPage();

// Sizing goes through puppeteer's own setViewport, NOT a raw CDP metrics override.
// fullPage capture sets its own metrics override to reach the whole document and
// restores puppeteer's tracked viewport afterwards, so a hand-rolled CDP override is
// silently wiped by the first shot: every later page then renders at the real window
// size. Set once per size group, then land it on a document before the first capture
// navigates, so the guide's responsive mount reads the size we meant.
// deviceScaleFactor stays 1 even for the phone frame. These guide pages run to several
// thousand CSS pixels, and a fullPage capture of one at DPR 2 tiles and stitches, which
// repeats a chunk of the article inside the PNG: a screenshot that looks plausible and
// is not what the page renders. Width is what the responsive layout keys on, so the
// phone frame is honest at DPR 1.
async function useMetrics(width, height, mobile) {
  await page.setViewport({
    width,
    height,
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
  });
  await page.goto(`${BASE}/wiki`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(400);
}

async function capture(w, { suffix, expectWidth }) {
  await page.goto(`${BASE}${w.path}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(700);
  const resolved = await page.evaluate(
    // string-form body: this script may run under tsx (keepNames trap)
    `(() => {
      const root = document.querySelector('main, .guide-main, #guide-root') ?? document.body;
      const h1 = root.querySelector('h1');
      // An unresolved t() key renders as its own dotted id, which is the one failure
      // a prose-only diff can actually introduce.
      const raw = (root.textContent.match(/\\bguide\\.[a-zA-Z0-9_.]+/g) ?? []).length;
      return { len: root.textContent.length, h1: h1 ? h1.textContent.trim() : '', raw, iw: innerWidth };
    })()`,
  );
  // Assert the width the page actually LAID OUT at, not a layout symptom: the first run
  // shipped a desktop shot rendered at the narrow breakpoint, and innerWidth is the input
  // the breakpoint reads. (Sidebar presence is the wrong probe here: the guide keeps the
  // sidebar on mobile as a stacked Topics disclosure, so it is wide at 390px too.)
  const widthOk = resolved.iw === expectWidth;
  const ok = resolved.len > 400 && resolved.h1.length > 0 && resolved.raw === 0 && widthOk;
  log(
    ok,
    `${w.path}${suffix} renders (h1 "${resolved.h1}", ${resolved.len} chars, ${resolved.raw} unresolved keys, laid out at ${resolved.iw}px)`,
  );
  await page.screenshot({ path: `${OUT}/${MODE}-${w.name}${suffix}.png`, fullPage: true });
  console.log(`shot ${MODE}-${w.name}${suffix}.png`);
}

await useMetrics(1400, 1000, false);
for (const w of PAGES) await capture(w, { suffix: '', expectWidth: 1400 });

// Mobile portrait: the guide is a content surface, so portrait is the right frame.
await useMetrics(390, 844, true);
for (const w of PAGES.filter((p) => ['rifts', 'dungeons', 'interface'].includes(p.name))) {
  await capture(w, { suffix: '-mobile', expectWidth: 390 });
}

await page.close();
await browser.close();
if (fails.length) {
  console.error(`\n${fails.length} check(s) failed:`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nall checks passed');
