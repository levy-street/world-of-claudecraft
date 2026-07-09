// Live drift probe for the mobile touch controls (PR 1525 follow-up).
// Emulates a phone (touch + pointer events via CDP), drives the joystick and
// canvas with HUMAN-SCALE timing, and measures whether movement/camera intent
// actually stops when the finger lifts. Needs `npm run dev` on :5173.
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.URL || 'http://localhost:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` :: ${extra}` : ''}`);
  if (!cond) fail++;
};

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
  await page.setViewport({
    width: 844,
    height: 390,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  page.on('pageerror', (e) => check('no pageerror', false, String(e).slice(0, 160)));
  await page.goto(URL, { waitUntil: 'networkidle2' });
  // Mark the tutorial done BEFORE entering: its step cards spawn on their own
  // schedule, advance as the probe moves, and swallow whatever touches land on
  // them, which made runs nondeterministic (src/ui/tutorial.ts STORAGE_KEY).
  await page.evaluate(() => localStorage.setItem('woc.tutorial.v1', 'done'));
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'DriftProbe', settleMs: 2500 });

  const cdp = await page.createCDPSession();
  const touch = {
    start: (pts) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts }),
    move: (pts) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts }),
    end: (pts = []) => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: pts }),
    cancel: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }),
  };

  const state = () =>
    page.evaluate(() => {
      const g = window.__game;
      const p = g.sim.player;
      const tm = g.input['touchMove'];
      return {
        pos: { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 },
        move: { f: !!tm.forward, b: !!tm.back, l: !!tm.strafeLeft, r: !!tm.strafeRight },
        yaw: Math.round(g.input.camYaw * 1000) / 1000,
        bodyClass: document.body.className,
        hp: p.hp,
        dead: !!p.dead,
      };
    });

  const rect = async (sel) =>
    page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        cx: r.x + r.width / 2,
        cy: r.y + r.height / 2,
      };
    }, sel);

  // A fresh character plays the spawn intro, which inline-hides #mobile-controls.
  // Skip it (any keydown) and wait for the move zone to gain real geometry.
  await page.keyboard.press('Space');
  await page
    .waitForFunction(
      () => {
        const z = document.querySelector('#mobile-move-zone');
        return z && z.getBoundingClientRect().width > 0;
      },
      { timeout: 20000 },
    )
    .catch(() => {});

  // Belt and braces: the pre-entry localStorage marker suppresses the
  // tutorial, but dismiss any card that slipped through anyway.
  await page.evaluate(() => document.querySelector('.tut-skip')?.click());
  await sleep(200);
  check('no tutorial card', await page.evaluate(() => !document.querySelector('.tut-card')));

  // Probe god mode (the visual_tour.mjs idiom): the scenarios blindly walk the
  // character around the spawn plaza, and on some runs the camp wolves killed
  // it mid-probe; death then (correctly) clears movement intent, which read as
  // a bogus drift failure.
  await page.evaluate(() => {
    const p = window.__game.sim.player;
    p.maxHp = 99999;
    p.hp = 99999;
  });

  // Prove the CDP touch -> pointer event pipeline is alive before testing logic.
  await page.evaluate(() => {
    window.__probeEvents = { pd: 0, ts: 0 };
    window.addEventListener('pointerdown', () => window.__probeEvents.pd++, true);
    window.addEventListener('touchstart', () => window.__probeEvents.ts++, true);
  });
  await touch.start([{ x: 400, y: 200, id: 9 }]);
  await sleep(60);
  await touch.end();
  await sleep(100);
  const probeEvents = await page.evaluate(() => window.__probeEvents);
  check('CDP touch produces touchstart', probeEvents.ts > 0, JSON.stringify(probeEvents));
  check('CDP touch produces pointerdown', probeEvents.pd > 0, JSON.stringify(probeEvents));

  const zone = (await rect('#mobile-move-zone')) || (await rect('#mobile-move-joystick'));
  check('move zone present with geometry', !!zone && zone.w > 0, JSON.stringify(zone));
  const s0 = await state();
  check('mobile-touch body class', /mobile-touch/.test(s0.bodyClass), s0.bodyClass);

  // Human-scale drag helper: ~60Hz move events.
  async function drag(id, from, to, ms) {
    const steps = Math.max(2, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const x = from.x + ((to.x - from.x) * i) / steps;
      const y = from.y + ((to.y - from.y) * i) / steps;
      await touch.move([{ x, y, id }]);
      await sleep(16);
    }
  }

  // --- Scenario 0: OFF-CENTER touchdown must not move the character.
  // The v0.22.0 clamp pinned the floating origin into the capture zone (too
  // small for the wheel), so a touchdown near the zone's corner instantly
  // walked the character before any drag (the issue #1229 drift).
  {
    await touch.start([{ x: 20, y: 375, id: 1 }]);
    await sleep(200);
    const down = await state();
    check(
      'S0 off-center touchdown produces no intent',
      !down.move.f && !down.move.b && !down.move.l && !down.move.r,
      JSON.stringify(down.move),
    );
    const wheel = await rect('#mobile-move-joystick');
    if (wheel) {
      const off = Math.hypot(wheel.cx - 20, wheel.cy - 375);
      check('S0 wheel spawns centered under the thumb', off < 2, `off by ${off.toFixed(1)}px`);
    }
    await touch.end();
    await sleep(150);
  }

  // --- Scenario 1: plain press, drag, hold, release: movement must stop.
  {
    const at = { x: zone.cx, y: zone.cy };
    await touch.start([{ x: at.x, y: at.y, id: 1 }]);
    await sleep(80);
    await drag(1, at, { x: at.x, y: at.y - 70 }, 700); // push up = forward
    const during = await state();
    check('S1 forward intent while held', during.move.f, JSON.stringify(during.move));
    await sleep(800); // hold still
    await touch.end();
    await sleep(150);
    const justAfter = await state();
    check(
      'S1 intent cleared on release',
      !justAfter.move.f && !justAfter.move.b && !justAfter.move.l && !justAfter.move.r,
      JSON.stringify(justAfter.move),
    );
    const p1 = (await state()).pos;
    await sleep(1000);
    const p2 = (await state()).pos;
    const drift = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    check('S1 no positional drift after release', drift < 0.05, `drift=${drift.toFixed(3)}`);
  }

  // --- Scenario 2: drag far OUTSIDE the zone, release there.
  {
    const at = { x: zone.cx, y: zone.cy };
    await touch.start([{ x: at.x, y: at.y, id: 1 }]);
    await sleep(60);
    await drag(1, at, { x: at.x + 250, y: at.y - 120 }, 900); // way off the zone
    const during = await state();
    check(
      'S2 intent while held outside zone',
      during.move.f || during.move.r,
      JSON.stringify(during.move),
    );
    await touch.end();
    await sleep(150);
    const after = await state();
    check(
      'S2 intent cleared on outside release',
      !after.move.f && !after.move.b && !after.move.l && !after.move.r,
      JSON.stringify(after.move),
    );
  }

  // --- Scenario 3: multi-touch: steer + tap Jump with a second finger.
  {
    const jump = await rect('#mobile-jump');
    check('jump button present', !!jump);
    const at = { x: zone.cx, y: zone.cy };
    await touch.start([{ x: at.x, y: at.y, id: 1 }]);
    await sleep(60);
    await drag(1, at, { x: at.x, y: at.y - 70 }, 500);
    // second finger taps jump while first keeps steering
    // (CDP touchEnd releases the LISTED points, so list finger 2 to lift it)
    await touch.start([
      { x: at.x, y: at.y - 70, id: 1 },
      { x: jump.cx, y: jump.cy, id: 2 },
    ]);
    await sleep(120);
    await touch.end([{ x: jump.cx, y: jump.cy, id: 2 }]); // lift finger 2 only
    await sleep(200);
    const during = await state();
    check(
      'S3 move survives second-finger tap',
      during.move.f,
      `${JSON.stringify(during.move)} hp=${during.hp} dead=${during.dead} body=${during.bodyClass}`,
    );
    await touch.end();
    await sleep(150);
    const after = await state();
    check(
      'S3 intent cleared after both lifted',
      !after.move.f && !after.move.b && !after.move.l && !after.move.r,
      JSON.stringify(after.move),
    );
  }

  // --- Scenario 4: modal steals the touch: open More while steering, then lift.
  {
    const more = await rect('#mobile-more');
    check('more button present', !!more);
    const at = { x: zone.cx, y: zone.cy };
    await touch.start([{ x: at.x, y: at.y, id: 1 }]);
    await drag(1, at, { x: at.x, y: at.y - 70 }, 400);
    await touch.start([
      { x: at.x, y: at.y - 70, id: 1 },
      { x: more.cx, y: more.cy, id: 2 },
    ]);
    await sleep(120);
    await touch.end([{ x: more.cx, y: more.cy, id: 2 }]); // lift the More finger only
    await sleep(400);
    const modalOpen = await page.evaluate(() =>
      document.body.classList.contains('mobile-more-open'),
    );
    // The whole point of the touch-tap binding fix: a SECOND finger's tap
    // must actually work while the first steers (a bare click binding never
    // fires for a non-primary pointer, which left every button dead mid-move).
    check('S4 second-finger tap opens the More modal', modalOpen);
    await touch.end();
    await sleep(200);
    const after = await state();
    check(
      'S4 intent cleared after modal open + lift',
      !after.move.f && !after.move.b && !after.move.l && !after.move.r,
      `modalOpen=${modalOpen} move=${JSON.stringify(after.move)}`,
    );
    // close the modal (tap outside: (150,150) is clear of the centred dialog,
    // whose 440px width spans ~202..642 on this profile, and of every control)
    if (modalOpen) {
      await touch.start([{ x: 150, y: 150, id: 3 }]);
      await touch.end();
      await sleep(300);
      check(
        'S4 tap outside closes the More modal',
        await page.evaluate(() => !document.body.classList.contains('mobile-more-open')),
      );
    }
  }

  // --- Scenario 5: swipe-look camera: yaw must stop changing on release.
  // (Start low mid-right: the tutorial card overlays the upper middle and
  //  legitimately owns touches that land on it.)
  {
    const before = await state();
    await touch.start([{ x: 600, y: 250, id: 1 }]);
    await sleep(60);
    await drag(1, { x: 600, y: 250 }, { x: 750, y: 250 }, 600);
    await touch.end();
    await sleep(300);
    const a = await state();
    await sleep(700);
    const b = await state();
    check(
      'S5 swipe-look changed yaw',
      Math.abs(a.yaw - before.yaw) > 0.01,
      `yaw ${before.yaw} -> ${a.yaw}`,
    );
    check(
      'S5 yaw stable after release',
      Math.abs(b.yaw - a.yaw) < 0.005,
      `yaw ${a.yaw} -> ${b.yaw}`,
    );
  }

  // --- Scenario 6: viewport resize (orientation-ish) mid-touch, then release.
  {
    const at = { x: zone.cx, y: zone.cy };
    await touch.start([{ x: at.x, y: at.y, id: 1 }]);
    await drag(1, at, { x: at.x, y: at.y - 70 }, 400);
    await page.setViewport({
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await sleep(500);
    await touch.end().catch(() => {});
    await sleep(300);
    const after = await state();
    check(
      'S6 intent cleared after resize mid-touch',
      !after.move.f && !after.move.b && !after.move.l && !after.move.r,
      JSON.stringify(after.move),
    );
    await page.setViewport({
      width: 844,
      height: 390,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await sleep(400);
  }

  console.log(fail === 0 ? 'ALL DRIFT PROBES PASSED' : `${fail} PROBE(S) FAILED`);
  process.exitCode = fail === 0 ? 0 : 1;
} finally {
  await browser.close();
}
