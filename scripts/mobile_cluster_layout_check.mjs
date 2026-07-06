// Geometric regression gate for the mobile HUD thumb clusters (the combat arc,
// the Target swap / Use hollow seats, the page-toggle satellite, the left
// utility cluster, and the bottom-centre Chat/More pair).
//
// Per device profile it measures REAL rendered getBoundingClientRect geometry
// (never CSS text) and asserts:
//   1. every touch control is fully on-screen (the pre-redesign arc clipped
//      its outer buttons up to ~65px past the right edge);
//   2. no two interactive controls overlap, with a minimum edge gap;
//   3. the combat cluster stays clear of the top-right minimap / daily-chest
//      neighbours;
//   4. every control holds the 40x40 touch floor;
//   5. the responsive tier class matches the profile.
// Extra passes on the canonical phone profile: left-handed mirror, the opt-in
// camera joystick, the joystick/button size-setting extremes, and (where the
// Chromium build supports Emulation.setSafeAreaInsetsOverride) a real env()
// safe-area inset pass.
//
// Needs `npm run dev` running. URL= overrides the target. Writes one PNG per
// profile to tmp/. Exit 1 on any violation.
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.URL || 'http://localhost:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The offline dev server (no game server) 502s the homepage project-stats fetch;
// that console error is expected noise, everything else is a real failure.
const IGNORED_CONSOLE = /502|Bad Gateway|fetch project stats/i;

const CONTROL_IDS = [
  'mobile-action-attack',
  'mobile-target-cycle',
  'mobile-action-page-toggle',
  'mobile-autorun',
  'mobile-interact',
  'mobile-jump',
  'mobile-chat',
  'mobile-more',
];
const NEIGHBOR_IDS = ['minimap-wrap', 'side-buttons'];
const TOUCH_FLOOR = 40;
const MIN_GAP = 4; // px edge distance between any two interactive controls

const PROFILES = [
  { name: 'iphone-13-landscape', w: 844, h: 390, dsf: 3, tier: 'hud-mobile-compact' },
  { name: 'iphone-pro-max-landscape', w: 932, h: 430, dsf: 3, tier: 'hud-mobile-compact' },
  { name: 'pixel-7-landscape', w: 915, h: 412, dsf: 2.625, tier: 'hud-mobile-compact' },
  { name: 'galaxy-s8-landscape', w: 740, h: 360, dsf: 3, tier: 'hud-mobile-compact' },
  { name: 'small-laptop-720p', w: 1280, h: 720, dsf: 1, tier: 'hud-mobile-standard' },
  { name: 'tablet-4-3', w: 1024, h: 768, dsf: 2, tier: 'hud-mobile-tablet' },
  { name: 'fhd-1080p', w: 1920, h: 1080, dsf: 1, tier: 'hud-mobile-tablet' },
];

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.error(`FAIL ${msg}`);
};

function collectRects(page) {
  return page.evaluate(
    (ids, neighborIds) => {
      const grab = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return null;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return null;
        return {
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          w: r.width,
          h: r.height,
        };
      };
      const out = { controls: {}, neighbors: {}, vw: window.innerWidth, vh: window.innerHeight };
      for (const id of ids) out.controls[id] = grab(document.getElementById(id));
      document.querySelectorAll('.mobile-action-slot').forEach((el) => {
        out.controls[`slot-${el.dataset.mobileIndex}`] = grab(el);
      });
      for (const id of neighborIds) out.neighbors[id] = grab(document.getElementById(id));
      out.tierClass = ['hud-mobile-compact', 'hud-mobile-standard', 'hud-mobile-tablet'].find((c) =>
        document.body.classList.contains(c),
      );
      out.moveZone = grab(document.getElementById('mobile-move-zone'));
      out.cameraJoystick = grab(document.getElementById('mobile-camera-joystick'));
      return out;
    },
    CONTROL_IDS,
    NEIGHBOR_IDS,
  );
}

// Edge distance between two rects: positive = separated, negative = overlap depth.
function edgeGap(a, b) {
  const dx = Math.max(a.left - b.right, b.left - a.right);
  const dy = Math.max(a.top - b.bottom, b.top - a.bottom);
  return Math.max(dx, dy);
}

// The ring controls are true circles (border-radius: 50% also clips pointer
// hit-testing), so the mis-tap distance between two of them is centre distance
// minus both radii, NOT bounding-box separation (adjacent arc boxes overlap at
// the corners by design while the circles keep a >=10px gap).
const CIRCLE_IDS = new Set([
  'mobile-action-attack',
  'mobile-target-cycle',
  'mobile-interact',
  'mobile-action-page-toggle',
  'slot-0',
  'slot-1',
  'slot-2',
  'slot-3',
  'slot-4',
]);

function circleOf(r) {
  return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, r: Math.min(r.w, r.h) / 2 };
}

// Distance from a circle's edge to a rect's edge (negative = overlap depth).
function circleRectGap(c, rect) {
  const px = Math.min(Math.max(c.x, rect.left), rect.right);
  const py = Math.min(Math.max(c.y, rect.top), rect.bottom);
  const inside = px === c.x && py === c.y;
  const d = Math.hypot(c.x - px, c.y - py);
  return inside ? -c.r : d - c.r;
}

function controlGap(idA, a, idB, b) {
  const aCircle = CIRCLE_IDS.has(idA);
  const bCircle = CIRCLE_IDS.has(idB);
  if (aCircle && bCircle) {
    const ca = circleOf(a);
    const cb = circleOf(b);
    return Math.hypot(ca.x - cb.x, ca.y - cb.y) - ca.r - cb.r;
  }
  if (aCircle) return circleRectGap(circleOf(a), b);
  if (bCircle) return circleRectGap(circleOf(b), a);
  return edgeGap(a, b);
}

function checkGeometry(tag, g, { tier, minimapClear = true } = {}) {
  const entries = Object.entries(g.controls).filter(([, r]) => r);
  const expectedCount = CONTROL_IDS.length + 5;
  if (entries.length !== expectedCount) {
    const missing = [
      ...CONTROL_IDS.filter((id) => !g.controls[id]),
      ...[0, 1, 2, 3, 4].filter((i) => !g.controls[`slot-${i}`]).map((i) => `slot-${i}`),
    ];
    fail(
      `${tag}: ${entries.length}/${expectedCount} controls visible (missing: ${missing.join(', ')})`,
    );
  }
  for (const [id, r] of entries) {
    if (r.left < -0.5 || r.top < -0.5 || r.right > g.vw + 0.5 || r.bottom > g.vh + 0.5) {
      fail(
        `${tag}: #${id} leaves the viewport (l=${r.left.toFixed(1)} t=${r.top.toFixed(1)} r=${r.right.toFixed(1)} b=${r.bottom.toFixed(1)} vs ${g.vw}x${g.vh})`,
      );
    }
    if (r.w < TOUCH_FLOOR - 0.5 || r.h < TOUCH_FLOOR - 0.5) {
      fail(
        `${tag}: #${id} below the ${TOUCH_FLOOR}px touch floor (${r.w.toFixed(1)}x${r.h.toFixed(1)})`,
      );
    }
  }
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const gap = controlGap(entries[i][0], entries[i][1], entries[j][0], entries[j][1]);
      if (gap < MIN_GAP) {
        fail(
          `${tag}: #${entries[i][0]} vs #${entries[j][0]} gap ${gap.toFixed(1)}px < ${MIN_GAP}px`,
        );
      }
    }
  }
  if (minimapClear) {
    for (const [nid, nr] of Object.entries(g.neighbors)) {
      if (!nr) continue;
      for (const [id, r] of entries) {
        const gap = CIRCLE_IDS.has(id) ? circleRectGap(circleOf(r), nr) : edgeGap(r, nr);
        if (gap < 0) fail(`${tag}: #${id} overlaps neighbour #${nid}`);
      }
    }
  }
  if (tier && g.tierClass !== tier) fail(`${tag}: tier class ${g.tierClass} (expected ${tier})`);
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  mkdirSync('tmp', { recursive: true });
  const page = await browser.newPage();
  // Surface page crashes as first-class failures (house convention): without
  // this a runtime JS error shows up only as a confusing downstream geometry
  // miss ("controls never settled") instead of its root cause.
  page.on('pageerror', (err) => fail(`pageerror: ${String(err).slice(0, 200)}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !IGNORED_CONSOLE.test(msg.text())) {
      fail(`console error: ${msg.text().slice(0, 200)}`);
    }
  });
  // Boot on a desktop viewport first (the headless mobile-emulated boot can hang
  // on asset init, see ios_hud_scroll_check.mjs), then flip per profile.
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'Adventurer', settleMs: 1500 });

  // Headless Chromium is a fine-pointer device; emulate a coarse no-hover one so
  // PHONE_TOUCH_QUERY matches and the runtime itself activates the touch UI and
  // the tier applier (we still add the classes as a belt-and-braces backstop).
  // Raw CDP, not page.emulateMediaFeatures: puppeteer's wrapper rejects the
  // pointer/hover feature names (same approach as mobile_input_zoom_check.mjs).
  const media = await page.createCDPSession();
  await media.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'pointer', value: 'coarse' },
      { name: 'hover', value: 'none' },
    ],
  });
  await media.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  // Deterministic viewport flip: resize, nudge the runtime's own listeners, and
  // wait until the tier applier has stamped the expected class rather than
  // sleeping a guessed interval (the resize handlers re-run on a 250/800ms
  // retry cadence, so a fixed sleep races them). Chromium's mobile emulation
  // can leave a stale page scale when deviceScaleFactor changes on a live page
  // (window.innerWidth then reports the OLD viewport), so re-apply the metrics
  // until the page really reports the requested CSS viewport.
  async function flipViewport(w, h, dsf, expectedTier) {
    for (let attempt = 0; attempt < 4; attempt++) {
      // Raw CDP with an explicit screenWidth/screenHeight: puppeteer's
      // setViewport omits them, and headless then fit-scales any viewport
      // NARROWER than the previous one (innerWidth keeps reporting the old
      // width, which mis-tiers the layout under test).
      await media.send('Emulation.setDeviceMetricsOverride', {
        width: w,
        height: h,
        deviceScaleFactor: dsf,
        mobile: true,
        screenWidth: w,
        screenHeight: h,
        positionX: 0,
        positionY: 0,
      });
      await media.send('Emulation.resetPageScaleFactor').catch(() => {});
      await sleep(150);
      const inner = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
      if (Math.abs(inner[0] - w) <= 2 && Math.abs(inner[1] - h) <= 2) break;
      if (attempt === 3) fail(`flipViewport(${w}x${h}): page reports ${inner[0]}x${inner[1]}`);
    }
    await page.evaluate(() => {
      document.body.classList.add('mobile-touch', 'game-active');
      window.dispatchEvent(new Event('resize'));
    });
    // The runtime's own listeners (mq change, resize retries) can churn the
    // body classes for a beat; wait until the tier class AND a laid-out
    // control are both real before measuring, re-asserting the classes once.
    await sleep(400);
    await page.evaluate(() => document.body.classList.add('mobile-touch', 'game-active'));
    const settled = await page
      .waitForFunction(
        (tier) => {
          if (!document.body.classList.contains(tier)) return false;
          const attack = document.getElementById('mobile-action-attack');
          return !!attack && attack.getBoundingClientRect().width > 0;
        },
        // Generous: the FIRST touch-UI activation does one-off work (tutorial
        // injection, icon paints) that can hold the layout for several seconds.
        { timeout: 12000 },
        expectedTier,
      )
      .then(
        () => true,
        () => false,
      );
    if (!settled) fail(`flipViewport: tier/${expectedTier} or controls never settled`);
    await sleep(250); // one layout/paint after the class lands
  }

  for (const p of PROFILES) {
    await flipViewport(p.w, p.h, p.dsf, p.tier);
    const g = await collectRects(page);
    checkGeometry(p.name, g, { tier: p.tier });
    if (process.env.DEBUG_RECTS) {
      console.log(p.name, JSON.stringify({ neighbors: g.neighbors, controls: g.controls }));
    }
    await page.screenshot({ path: `tmp/cluster_${p.name}.png` });
    console.log(`checked ${p.name} (${p.w}x${p.h}, ${g.tierClass})`);
  }

  // The canonical phone profile hosts the state-variant passes.
  await flipViewport(844, 390, 3, 'hud-mobile-compact');

  // Left-handed mirror: everything still on-screen, disjoint, and actually mirrored.
  await page.evaluate(() => document.body.classList.add('mobile-left-handed'));
  await sleep(300);
  const lh = await collectRects(page);
  checkGeometry('left-handed-844x390', lh, { tier: 'hud-mobile-compact' });
  const lhAttack = lh.controls['mobile-action-attack'];
  if (lhAttack && lhAttack.left > lh.vw / 2) {
    fail(`left-handed: attack button did not mirror left (left=${lhAttack.left.toFixed(1)})`);
  }
  await page.screenshot({ path: 'tmp/cluster_left_handed.png' });
  await page.evaluate(() => document.body.classList.remove('mobile-left-handed'));

  // Opt-in camera joystick must not collide with the utility cluster.
  await page.evaluate(() => document.body.classList.add('mobile-camera-joystick-on'));
  await sleep(300);
  const cj = await collectRects(page);
  if (cj.cameraJoystick) {
    for (const id of ['mobile-autorun', 'mobile-jump']) {
      const r = cj.controls[id];
      if (r && edgeGap(r, cj.cameraJoystick) < 0) fail(`camera-joystick overlaps #${id}`);
    }
  } else {
    fail(
      'camera-joystick pass: #mobile-camera-joystick not visible under mobile-camera-joystick-on',
    );
  }
  await page.evaluate(() => document.body.classList.remove('mobile-camera-joystick-on'));

  // Size-setting extremes, BOTH ends of the joystickScale range (0.7 min and
  // 1.3 max, what applySetting writes for joystickScale / actionButtonScale):
  // at max the grown joystick must not slide under the cluster; at min the
  // cluster's floored offset must keep every button clear of the FIXED
  // #mobile-move-zone capture area, or a movement thumb would trigger Jump.
  for (const joyScale of ['0.7', '1.3']) {
    await page.evaluate((v) => {
      const c = document.getElementById('mobile-controls');
      c?.style.setProperty('--joy-scale', v);
      c?.style.setProperty('--btn-scale', v === '1.3' ? '1.3' : '1');
    }, joyScale);
    await sleep(300);
    const ext = await collectRects(page);
    if (ext.moveZone) {
      for (const id of ['mobile-jump', 'mobile-autorun']) {
        const r = ext.controls[id];
        if (r && edgeGap(r, ext.moveZone) < 0) {
          fail(`joy-scale ${joyScale}: #${id} overlaps the move capture zone`);
        }
      }
    } else {
      fail(`joy-scale ${joyScale}: #mobile-move-zone not measurable`);
    }
  }
  await sleep(100);
  const sc = await collectRects(page);
  const joy = await page.evaluate(() => {
    const r = document.getElementById('mobile-move-joystick')?.getBoundingClientRect();
    return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
  });
  if (joy) {
    for (const id of ['mobile-jump', 'mobile-autorun']) {
      const r = sc.controls[id];
      if (r && edgeGap(r, joy) < 0) fail(`joy-scale 1.3: joystick overlaps #${id}`);
    }
  }
  await page.evaluate(() => {
    const c = document.getElementById('mobile-controls');
    c?.style.setProperty('--joy-scale', '1');
    c?.style.setProperty('--btn-scale', '1');
  });

  // Real safe-area inset pass, where this Chromium exposes the CDP override.
  const cdp = await page.createCDPSession();
  let safeAreaChecked = false;
  try {
    await cdp.send('Emulation.setSafeAreaInsetsOverride', {
      insets: { top: 0, left: 59, right: 59, bottom: 21 },
    });
    safeAreaChecked = true;
  } catch {
    console.log(
      'safe-area: Emulation.setSafeAreaInsetsOverride unsupported here, skipping env() pass',
    );
  }
  if (safeAreaChecked) {
    await sleep(500);
    const sa = await collectRects(page);
    checkGeometry('safe-area-59px', sa, { tier: 'hud-mobile-compact' });
    const attack = sa.controls['mobile-action-attack'];
    if (attack && attack.right > sa.vw - 59 + 0.5) {
      fail(
        `safe-area: attack button under the right notch band (right=${attack.right.toFixed(1)})`,
      );
    }
    const jump = sa.controls['mobile-jump'];
    if (jump && jump.left < 59 - 0.5) {
      fail(`safe-area: jump button under the left notch band (left=${jump.left.toFixed(1)})`);
    }
    await page.screenshot({ path: 'tmp/cluster_safe_area.png' });
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: {} }).catch(() => {});
  }

  if (failures.length) {
    console.error(`\n${failures.length} violation(s).`);
    process.exit(1);
  }
  console.log('\nAll mobile cluster layout checks passed.');
} finally {
  await browser.close();
}
