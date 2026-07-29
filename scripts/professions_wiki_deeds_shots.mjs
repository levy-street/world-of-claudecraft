// Evidence screenshots: the rewritten professions wiki (overview,
// one craft page, the fishing page; desktop 1600x900 dsf1 plus one mobile
// portrait 390x844 dsf3: the guide is a content surface and allows portrait),
// the Book of Deeds progression tab showing the new profession deeds, and the
// master-dialog locked-quest hint row at Smith Haldren.
//
// MODE=after (default) or MODE=before names the output files; the before run
// expects the working tree to hold the BASE src/ (the git checkout <base> --
// src/ recipe) with HEAD tooling. New-in-branch surfaces degrade honestly on
// the before run (missing pages and rows are captured as-is, or skipped when
// the route itself does not resolve; skips are logged).
//
// Needs `npm run dev` (GAME_URL, default http://localhost:5199). Writes PNGs
// to SHOTS_DIR (default docs/screenshots/professions-2-phase-15/).
//   BROWSER_PATH=... GAME_URL=http://localhost:5199 node scripts/professions_wiki_deeds_shots.mjs

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const MODE = process.env.MODE === 'before' ? 'before' : 'after';
const BASE = process.env.GAME_URL ?? 'http://localhost:5199';
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/professions-2-phase-15';
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

// --- Wiki pages -------------------------------------------------------------
const WIKI_PAGES = [
  { name: 'wiki-overview', path: '/wiki/professions' },
  { name: 'wiki-craft-leatherworking', path: '/wiki/professions/leatherworking' },
  { name: 'wiki-fishing', path: '/wiki/professions/fishing' },
];
{
  const page = await browser.newPage();
  const cdp = await metrics(page, 1600, 900, 1);
  for (const w of WIKI_PAGES) {
    await page.goto(`${BASE}${w.path}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(800);
    const resolved = await page.evaluate(
      // string-form body: this script may run under tsx (keepNames trap)
      `(() => (document.querySelector('main, .guide-page, #guide-root') ?? document.body).textContent.length > 200)()`,
    );
    if (!resolved && MODE === 'before') {
      console.log(`skip ${w.name}: route does not resolve on the base tree (expected)`);
      continue;
    }
    log(resolved, `${w.path} renders content`);
    await shoot(cdp, w.name);
  }
  // one mobile portrait shot of the overview (content surface, portrait ok)
  await metrics(page, 390, 844, 3);
  await page.goto(`${BASE}/wiki/professions`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(800);
  await shoot(await metrics(page, 390, 844, 3), 'wiki-overview-mobile');
  await page.close();
}

// --- Game surfaces: deeds window + Haldren hint row -------------------------
{
  const page = await browser.newPage();
  const cdp = await metrics(page, 1600, 900, 1);
  // The caller navigates BEFORE enterOfflineGame (its contract) and clears the
  // gpu notice plus the camera prompt, which eat clicks on fresh profiles.
  await page.goto(`${BASE}/?gfx=low`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(
    `(() => { document.querySelector('#gpu-notice')?.remove(); document.querySelector('#camera-prompt-backdrop')?.remove(); })()`,
  );
  await enterOfflineGame(page);
  await sleep(1200);
  // The camera prompt appears AFTER world entry on fresh profiles and eats
  // every input: confirm it through its real button, then clear the gpu
  // notice again (it can render post-boot).
  await page.evaluate(
    `(() => {
      const confirm = [...document.querySelectorAll('button')].find(
        (b) => b.textContent.trim().toLowerCase() === 'confirm' && b.offsetParent !== null,
      );
      confirm?.click();
      document.querySelector('#camera-prompt-backdrop')?.remove();
      document.querySelector('#gpu-notice')?.remove();
    })()`,
  );
  await sleep(800);

  // Book of Deeds, progression tab (Shift+KeyZ is the shipped binding;
  // keyboard.press first, synthetic KeyboardEvent fallback, the
  // deeds_screenshots.mjs idiom).
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyZ');
  await page.keyboard.up('Shift');
  await sleep(700);
  let deedsOpen = await page.evaluate(
    `(() => document.querySelector('#deeds-window')?.style.display === 'flex')()`,
  );
  if (!deedsOpen) {
    await page.evaluate(
      `(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', shiftKey: true, bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyZ', shiftKey: true, bubbles: true }));
      })()`,
    );
    await sleep(700);
    deedsOpen = await page.evaluate(
      `(() => document.querySelector('#deeds-window')?.style.display === 'flex')()`,
    );
  }
  if (deedsOpen) {
    await page.evaluate(
      `(() => {
        const w = document.querySelector('#deeds-window');
        for (const b of w.querySelectorAll('[data-cat]')) {
          if (b.getAttribute('data-cat') === 'progression') b.click();
        }
        const target = [...w.querySelectorAll('*')].find(
          (r) => r.children.length === 0 && r.textContent.trim() === 'Craftsworn',
        );
        target?.scrollIntoView({ block: 'center' });
      })()`,
    );
  }
  log(deedsOpen, 'Book of Deeds opens on Shift+KeyZ (progression tab)');
  await sleep(400);
  await shoot(cdp, 'deeds-progression');
  await page.evaluate(
    `(() => { const w = document.querySelector('#deeds-window'); if (w) w.style.display = 'none'; })()`,
  );

  // Haldren hint row: move the player beside the smith (content position
  // 7, 16.5 in zone1.ts; direct pos write, p.pos.x and p.pos.z per the probe
  // recipe) in one evaluate, then the REAL KeyF interact via keyboard.press.
  const moved = await page.evaluate(
    `(() => {
      const g = window.__game;
      const p = g && g.sim && g.sim.player;
      if (!p || !p.pos) return false;
      p.pos.x = 8.5;
      p.pos.z = 16.5;
      return true;
    })()`,
  );
  log(moved, 'player moved beside Smith Haldren');
  await sleep(400);
  await page.keyboard.press('KeyF');
  await sleep(900);
  let probe = await page.evaluate(
    `(() => {
      const dlg = document.querySelector('#quest-dialog, .quest-dialog, .qd-root, #gossip-window');
      const visible = dlg && dlg.offsetParent !== null;
      const hint = document.querySelector('[data-prof-intro-hint]');
      return { dialog: !!visible, hint: !!hint };
    })()`,
  );
  if (!probe.dialog) {
    await page.evaluate(
      `(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', key: 'f', bubbles: true }));
      })()`,
    );
    await sleep(900);
    probe = await page.evaluate(
      `(() => {
        const dlg = document.querySelector('#quest-dialog, .quest-dialog, .qd-root, #gossip-window');
        const visible = dlg && dlg.offsetParent !== null;
        const hint = document.querySelector('[data-prof-intro-hint]');
        return { dialog: !!visible, hint: !!hint };
      })()`,
    );
  }
  const dialogOk = probe.dialog;
  const hintOk = probe.hint;
  log(dialogOk, 'Haldren dialog opens after teleport-and-interact');
  if (MODE === 'after') log(hintOk, 'the locked-quest hint row is present pre-q_prof_intro');
  else console.log(`before-run hint presence (expected false): ${hintOk}`);
  await shoot(cdp, 'haldren-dialog');
  await page.close();
}

await browser.close();
if (fails.length) {
  console.error(`\n${fails.length} FAILED checks:\n${fails.join('\n')}`);
  process.exit(1);
}
console.log('\nall shots captured');
