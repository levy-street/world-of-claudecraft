// Smart-cast E2E (M7B): boots the offline game in headless Edge/Chrome with the
// TOUCH interface forced, then drives the mobile skill smart-cast gesture with
// synthetic touch pointer events and asserts the behavior end to end:
//   - pressing an eligible offensive skill shows the range ring (hold preview);
//   - releasing on the button smart-casts: it acquires the best nearby enemy when
//     you have none, faces it, and dispatches the cast (via the shared castSlot);
//   - releasing with the finger slid OFF the button cancels with no cast;
//   - the range ring is always cleared on release.
// Combat here is target-based (no ground casting), so there is no aiming/reticle.
// Needs `npm run dev` running. Screenshots land in tmp/ for visual inspection.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1180,560', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1180, height: 560 },
});
const page = await browser.newPage();
const errors = [];
// Backend calls (login/stats) 502 when the offline dev server has no API/auth
// process behind it; that noise is unrelated to the client gesture under test.
const BENIGN = /502|Failed to load resource|project stats|ApiError|Failed to fetch|net::ERR/i;
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !BENIGN.test(msg.text())) errors.push(`CONSOLE: ${msg.text()}`);
});

// Force the touch interface before the game boots (Options > Interface Mode).
await page.evaluateOnNewDocument(() => {
  try {
    const stored = JSON.parse(localStorage.getItem('woc_settings') ?? '{}');
    stored.interfaceMode = 2;
    stored.aimAssist = true;
    localStorage.setItem('woc_settings', JSON.stringify(stored));
  } catch {
    localStorage.setItem('woc_settings', JSON.stringify({ interfaceMode: 2, aimAssist: true }));
  }
});

const results = [];
const check = (ok, label) => {
  results.push([ok, label]);
  console.log(ok ? 'ok  ' : 'FAIL', label);
};

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await new Promise((r) => setTimeout(r, 200));
await page.type('#char-name', 'Sparkfist');
// A mage: skill buttons carry ranged offensive nukes (aim-eligible).
await page.click('#offline-select .mini-class[data-class="mage"]');
await page.click('#btn-start-offline');
// Wait for the world to finish loading (window.__game is set in enterWorld),
// which can take a few seconds under software rendering.
await page.waitForFunction('window.__game && window.__game.world && window.__game.hud', {
  timeout: 30000,
});
await new Promise((r) => setTimeout(r, 600));

// Install spies on the render range ring and the cast entry point, and teleport
// next to a hostile so the smart-target acquisition has something to pick.
const setup = await page.evaluate(() => {
  const w = window.__game.world;
  const r = window.__game.renderer;
  window.__aim = [];
  const origAim = r.setAimIndicator.bind(r);
  r.setAimIndicator = (s) => {
    window.__aim.push(s ? { radius: s.radius } : null);
    return origAim(s);
  };
  window.__casts = [];
  const origCast = w.castAbility.bind(w);
  w.castAbility = (id, ...rest) => {
    window.__casts.push(id);
    return origCast(id, ...rest);
  };
  // Teleport onto the nearest hostile so a smart target exists in cast range.
  const mob = [...w.entities.values()].find((e) => e.id !== w.playerId && e.hp > 0 && e.templateId);
  if (mob) {
    w.player.pos.x = mob.pos.x - 4;
    w.player.pos.z = mob.pos.z;
    w.player.targetId = null; // start with NO target so smart-cast must acquire
  }
  return { touch: document.body.classList.contains('mobile-touch'), hasMob: !!mob };
});
check(setup.touch, 'touch interface active');
check(setup.hasMob, 'a hostile is present to target');
await new Promise((r) => setTimeout(r, 400)); // let the teleport settle over a few ticks

// Synthetic touch pointer helper. Returns the button's screen rect so the caller
// can aim releases on or off the button.
async function pointer(selector, type, dx = 0, dy = 0) {
  return page.evaluate(
    (sel, t, ox, oy) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2 + ox;
      const y = rect.top + rect.height / 2 + oy;
      el.dispatchEvent(
        new PointerEvent(t, {
          pointerId: 1,
          pointerType: 'touch',
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        }),
      );
      return { w: rect.width, h: rect.height };
    },
    selector,
    type,
    dx,
    dy,
  );
}

// Find the first cluster skill button that ARMS the range ring on press (i.e. an
// aim-eligible offensive ability), so the test is class-kit agnostic.
let skillSel = null;
for (const role of ['skill1', 'skill2', 'skill3', 'utility']) {
  const sel = `#mobile-cluster .mcl-${role}`;
  await page.evaluate(() => {
    window.__aim.length = 0;
  });
  await pointer(sel, 'pointerdown');
  const armed = await page.evaluate(() => window.__aim.some((s) => s && s.radius > 0));
  await pointer(sel, 'pointercancel'); // abort the probe without casting
  if (armed) {
    skillSel = sel;
    break;
  }
}
check(skillSel !== null, `found an eligible skill button (${skillSel})`);

if (skillSel) {
  // 1. Hold shows the range ring.
  await page.evaluate(() => {
    window.__aim.length = 0;
    window.__casts.length = 0;
  });
  await pointer(skillSel, 'pointerdown');
  const held = await page.evaluate(() => ({
    ringShown: window.__aim.length > 0 && window.__aim.at(-1) && window.__aim.at(-1).radius > 0,
    noCastYet: window.__casts.length === 0,
  }));
  check(held.ringShown, 'press shows the range ring');
  check(held.noCastYet, 'no cast fires on press (only on release)');
  await page.screenshot({ path: 'tmp/sc_01_ring.png' });

  // 2. Release ON the button smart-casts and clears the ring.
  await pointer(skillSel, 'pointerup');
  await new Promise((r) => setTimeout(r, 250)); // let facing apply over the next tick
  const cast = await page.evaluate(() => ({
    dispatched: window.__casts.length === 1,
    ringCleared: window.__aim.at(-1) === null,
    targetAcquired: window.__game.world.player.targetId !== null,
  }));
  check(cast.dispatched, 'release on the button dispatches exactly one cast');
  check(cast.ringCleared, 'range ring cleared on release');
  check(cast.targetAcquired, 'smart target acquired (no manual select needed)');
  await page.screenshot({ path: 'tmp/sc_02_cast.png' });

  // 3. Release OFF the button cancels: press, then lift far above the button.
  await new Promise((r) => setTimeout(r, 1700)); // clear the global cooldown
  await page.evaluate(() => {
    window.__aim.length = 0;
    window.__casts.length = 0;
  });
  await pointer(skillSel, 'pointerdown');
  const rect = await pointer(skillSel, 'pointermove', 0, -200);
  await pointer(skillSel, 'pointerup', 0, -(200 + (rect?.h ?? 60))); // well past the top edge
  const cancelled = await page.evaluate(() => ({
    noCast: window.__casts.length === 0,
    ringCleared: window.__aim.at(-1) === null,
  }));
  check(cancelled.noCast, 'release off the button casts nothing (cancel)');
  check(cancelled.ringCleared, 'range ring cleared after a cancel');
  await page.screenshot({ path: 'tmp/sc_03_cancel.png' });
}

if (errors.length) {
  console.log('\n=== PAGE ERRORS ===');
  for (const e of errors.slice(0, 20)) console.log(e);
}
const failed = results.filter(([ok]) => !ok).length;
console.log(
  failed === 0 && errors.length === 0 ? 'SMART-CAST OK' : `SMART-CAST FAILURES: ${failed}`,
);
await browser.close();
process.exit(failed === 0 && errors.length === 0 ? 0 : 1);
