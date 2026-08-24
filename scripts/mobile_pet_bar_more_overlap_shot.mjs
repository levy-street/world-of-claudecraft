// Before/after capture for the mobile "#petbar covers #mobile-more" bug fix.
//
// Gives the offline player the widest realistic pet command bar (a melee_tank
// demon with a special ability, on a non-warlock owner, so the commands group
// renders all 4 optional buttons: Attack/special/Taunt/Feed), then screenshots
// the top-left corner at the narrowest supported landscape phone profile
// (Galaxy S8, 740x360) where the crowding is most visible.
//
// Both the AFTER shot (the live, fixed src/styles/hud.mobile.css rule) and the
// BEFORE shot (the pre-fix rule: left:50%, no clearance) come from the SAME
// page session, in that order: AFTER is measured/shot first, straight off the
// natural boot; only THEN does an inline `!important` override on #petbar
// reproduce the pre-fix rule for the BEFORE shot. Doing it in the other order
// (mutate-then-remove before measuring AFTER) was observed to occasionally
// leave mobile_hud_layout_applier.ts's responsive tier a step behind (it
// stayed on `hud-mobile-tablet` instead of re-settling on `hud-mobile-compact`
// for this viewport), which skews --mobile-chrome-scale and everything that
// reads it; measuring the untouched natural state first avoids ever perturbing
// that tier detection before it matters.
//
// USAGE (needs `npm run dev`):
//   node scripts/mobile_pet_bar_more_overlap_shot.mjs
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL || 'http://localhost:5173/';
const OUT_BEFORE = process.env.OUT_BEFORE || 'tmp/mobile_pet_bar_more_overlap_before.png';
const OUT_AFTER = process.env.OUT_AFTER || 'tmp/mobile_pet_bar_more_overlap_after.png';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)));
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.evaluate(() => localStorage.setItem('woc.tutorial.v1', 'done')).catch(() => {});
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'PetTapper', settleMs: 1500 });

  const media = await page.createCDPSession();
  await media.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'pointer', value: 'coarse' },
      { name: 'hover', value: 'none' },
    ],
  });
  await media.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.evaluate(() => document.querySelector('.tut-skip')?.click());

  // The worst-case (widest) collapsed #petbar: a melee_tank demon with a
  // special ability (Abyssal Chain) on a non-warlock owner renders Attack +
  // special + Taunt + Feed (4 commands) plus the 1-button stance toggle.
  // createDemonPet is TS-`private` on Sim but callable at runtime, same as
  // scripts/greyjaw_pet_tap_shot.mjs.
  const gave = await page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    const pet = sim.createDemonPet(p, 'gloomshade', false);
    if (pet) {
      pet.pos = { ...p.pos };
      pet.prevPos = { ...p.pos };
    }
    return { ok: !!pet, id: pet?.id, templateId: pet?.templateId };
  });
  if (!gave.ok) {
    console.log('FAIL: worst-case pet was not created');
    await browser.close();
    process.exit(1);
  }

  await media.send('Emulation.setDeviceMetricsOverride', {
    width: 740,
    height: 360,
    deviceScaleFactor: 3,
    mobile: true,
    screenWidth: 740,
    screenHeight: 360,
    positionX: 0,
    positionY: 0,
  });
  await sleep(150);
  await page.evaluate(() => {
    document.body.classList.add('mobile-touch', 'game-active');
    window.dispatchEvent(new Event('resize'));
  });
  await sleep(600);
  await page.evaluate(() => window.__game.hud?.update?.(0.05));
  await sleep(200);

  const measure = () =>
    page.evaluate(() => {
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      const cs = getComputedStyle(document.documentElement);
      return {
        petbar: box(document.getElementById('petbar')),
        more: box(document.getElementById('mobile-more')),
        chromeScale: cs.getPropertyValue('--mobile-chrome-scale'),
        btnScale: cs.getPropertyValue('--btn-scale'),
        uiScale: cs.getPropertyValue('--ui-scale'),
        tier: [...document.body.classList].filter((c) => c.startsWith('hud-mobile-')),
      };
    });
  const overlapOf = (rects) =>
    rects.petbar && rects.more
      ? Math.min(rects.petbar.right, rects.more.right) -
        Math.max(rects.petbar.left, rects.more.left)
      : null;

  // AFTER: the live (fixed) stylesheet rule, as booted.
  const after = await measure();
  console.log('AFTER rects:', JSON.stringify(after));
  console.log(
    `AFTER petbar/more horizontal overlap: ${overlapOf(after)}px (negative/null = clear)`,
  );
  await page.screenshot({ path: OUT_AFTER });
  console.log(`shot: ${OUT_AFTER}`);

  // BEFORE: reproduce the pre-fix rule (`left: 50%; transform: translateX(-50%);`,
  // no clearance) with an inline !important override on the live #petbar, so this
  // capture reflects the exact reported bug without a second page/browser.
  await page.evaluate(() => {
    const bar = document.getElementById('petbar');
    bar.style.setProperty('left', '50%', 'important');
    bar.style.setProperty('transform', 'translateX(-50%)', 'important');
  });
  await sleep(200);
  const before = await measure();
  console.log('BEFORE rects:', JSON.stringify(before));
  console.log(
    `BEFORE petbar/more horizontal overlap: ${overlapOf(before)}px (negative/null = clear)`,
  );
  await page.screenshot({ path: OUT_BEFORE });
  console.log(`shot: ${OUT_BEFORE}`);
} finally {
  await browser.close();
}
