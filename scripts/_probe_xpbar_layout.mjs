// Probe: XP bar sits UNDER the action bars, pinned to the bottom of the screen,
// for every class and desktop viewport size; on mobile-touch the bar stays
// hidden (XP ring on the player frame instead). Logs in with a real account,
// enters the world with one character per class, and measures the live DOM.
// Needs `npm run dev` (:5173) and `npm run server` (:8787).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const USER = process.env.WOC_USER ?? 'Aelwyn';
const PASS = process.env.WOC_PASS ?? 'correct-horse';
const CLASSES = (process.env.WOC_CLASSES ?? 'warrior,mage,hunter').split(',');
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
];
// #bottom-bar is anchored 6px off the viewport bottom; the xpbar rect adds its
// own 1px border, so "stuck to the bottom" means a gap of ~7px, 12 max.
const MAX_BOTTOM_GAP = 12;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp', { recursive: true });

let fail = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` ${extra}` : ''}`);
  if (!cond) fail += 1;
};

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 120000,
  args: ['--window-size=1920,1080', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1920, height: 1080 },
});

const isVisible = (sel) => {
  const el = document.querySelector(sel);
  return !!el && !el.hidden && getComputedStyle(el).display !== 'none';
};

// Drive the pre-game shell to the character screen (login if asked, click
// through the realm list), from any starting state.
async function toCharSelect(page) {
  const deadline = Date.now() + 30000;
  let loggedIn = false;
  for (;;) {
    const state = await page.evaluate(
      (vis, user, pass, doLogin) => {
        const seen = new Function('sel', `return (${vis})(sel)`);
        if (seen('#charselect-panel') || seen('#charcreate-panel')) return 'chars';
        const row = document.querySelector('#realm-list .realm-row');
        if (row && seen('#realm-panel')) {
          row.click();
          return 'realm-clicked';
        }
        if (doLogin && seen('#login-panel')) {
          const set = (id, v) => {
            const el = document.querySelector(id);
            el.value = v;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          };
          set('#login-user', user);
          set('#login-pass', pass);
          document.querySelector('#btn-login')?.click();
          return 'login-submitted';
        }
        document.querySelector('#btn-online')?.click();
        document.querySelector('#mobile-preflight-continue')?.click();
        return 'waiting';
      },
      isVisible.toString(),
      USER,
      PASS,
      !loggedIn,
    );
    if (state === 'chars') return;
    if (state === 'login-submitted') loggedIn = true;
    if (Date.now() > deadline) throw new Error(`stuck before character screen (${state})`);
    await sleep(400);
  }
}

async function rosterClasses(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('#char-list .char-row')].map((r) => r.dataset.class),
  );
}

async function createCharacter(page, cls) {
  const alpha = Date.now()
    .toString(36)
    .slice(-6)
    .replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
  const name = `Xpp${cls.slice(0, 6)}${alpha}`.replace(/[^A-Za-z]/g, '').slice(0, 16);
  await page.evaluate(
    (vis, cls2, name2) => {
      const seen = new Function('sel', `return (${vis})(sel)`);
      if (!seen('#charcreate-panel')) document.querySelector('#btn-new-character')?.click();
      setTimeout(() => {
        const input = document.querySelector('#new-char-name');
        input.value = name2;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector(`#charcreate-panel .mini-class[data-class="${cls2}"]`)?.click();
        document.querySelector('#btn-create-char')?.click();
      }, 300);
    },
    isVisible.toString(),
    cls,
    name,
  );
  await sleep(1500);
  console.log(`created ${cls} character ${name}`);
}

// Click the row's Enter World / Take Over button. Deferred click: running the
// world boot synchronously inside evaluate wedges the protocol on SwiftShader.
async function enterWorld(page, cls) {
  // The roster rows render async after the panel shows; wait for the row.
  await page.waitForFunction(
    (cls2) => !!document.querySelector(`#char-list .char-row[data-class="${cls2}"]`),
    { timeout: 15000, polling: 300 },
    cls,
  );
  await page.evaluate((cls2) => {
    const row = document.querySelector(`#char-list .char-row[data-class="${cls2}"]`);
    if (!row) throw new Error(`no ${cls2} row`);
    const btn = row.querySelector('.enter-world-btn') ?? row.querySelector('.take-over-btn');
    if (!btn) throw new Error(`no enter button on ${cls2} row`);
    setTimeout(() => btn.click(), 0);
  }, cls);
  // Mobile-touch hides the desktop #actionbar (the action ring replaces it),
  // so world entry is detected by game-active alone there.
  await page.waitForFunction(
    () => {
      // Phone hardware shows the install-to-home-screen preflight at world
      // entry; dismiss it from inside the poll.
      const preflight = document.getElementById('mobile-preflight');
      if (preflight && getComputedStyle(preflight).display !== 'none')
        document.getElementById('mobile-preflight-continue')?.click();
      if (!document.body.classList.contains('game-active')) return false;
      if (document.body.classList.contains('mobile-touch')) return true;
      const bar = document.querySelector('#actionbar');
      return (
        !!bar && getComputedStyle(bar).display !== 'none' && bar.getBoundingClientRect().height > 0
      );
    },
    { timeout: 45000, polling: 500 },
  );
  await sleep(1200);
  // First-run camera prompt backdrop swallows all input until dismissed.
  await page.evaluate(() => document.querySelector('.camera-prompt-confirm')?.click());
  await sleep(300);
}

function measure() {
  const rect = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      display: cs.display,
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      width: r.width,
      height: r.height,
    };
  };
  return {
    viewportH: window.innerHeight,
    xpbar: rect('#xpbar'),
    actionbar: rect('#actionbar'),
    actionbar2: rect('#actionbar2'),
    playerFrame: rect('#player-frame'),
    petbar: rect('#petbar'),
    stancebar: rect('#stancebar'),
    actionbar3: rect('#actionbar3'),
  };
}

async function validateDesktopClass(page, cls) {
  for (const vp of VIEWPORTS) {
    await page.setViewport(vp);
    await sleep(700);
    const m = await page.evaluate(measure);
    const tag = `${cls} ${vp.width}x${vp.height}`;
    check(`${tag}: xpbar visible`, !!m.xpbar && m.xpbar.display !== 'none' && m.xpbar.width > 0);
    if (!m.xpbar || !m.actionbar) continue;
    check(
      `${tag}: xpbar below action bar`,
      m.xpbar.top >= m.actionbar.bottom,
      `(xp top ${m.xpbar.top.toFixed(1)} vs bar bottom ${m.actionbar.bottom.toFixed(1)})`,
    );
    const gap = m.viewportH - m.xpbar.bottom;
    check(
      `${tag}: xpbar stuck to bottom`,
      gap >= 0 && gap <= MAX_BOTTOM_GAP,
      `(gap ${gap.toFixed(1)}px)`,
    );
    if (m.playerFrame && m.playerFrame.display !== 'none' && m.playerFrame.height > 0) {
      check(
        `${tag}: player frame clear of xpbar`,
        m.playerFrame.bottom <= m.xpbar.top,
        `(frame bottom ${m.playerFrame.bottom.toFixed(1)})`,
      );
    }
    if (m.actionbar2 && m.actionbar2.display !== 'none' && m.actionbar2.height > 0) {
      check(`${tag}: second bar above xpbar`, m.actionbar2.bottom <= m.xpbar.top);
    }
    if (m.actionbar3 && m.actionbar3.display !== 'none' && m.actionbar3.height > 0) {
      check(`${tag}: third bar above xpbar`, m.actionbar3.bottom <= m.xpbar.top);
    }
    if (m.stancebar && m.stancebar.display !== 'none' && m.stancebar.height > 0) {
      check(
        `${tag}: stance bar above xpbar`,
        m.stancebar.bottom <= m.xpbar.top,
        `(stance bottom ${m.stancebar.bottom.toFixed(1)})`,
      );
    }
    await page.screenshot({ path: `tmp/xpbar_${cls}_${vp.width}x${vp.height}.png` });
  }
}

const SKIP_DESKTOP = process.env.WOC_SKIP_DESKTOP === '1';
const SKIP_MOBILE = process.env.WOC_SKIP_MOBILE === '1';

if (!SKIP_DESKTOP)
  for (const cls of CLASSES) {
    const page = await browser.newPage();
    page.on('dialog', (d) => void d.accept()); // take-over confirm
    page.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 200)));
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(900);
    await toCharSelect(page);
    const roster = await rosterClasses(page);
    console.log(`roster: ${roster.join(', ') || '(empty)'}`);
    if (!roster.includes(cls)) {
      await createCharacter(page, cls);
      await toCharSelect(page);
    }
    await enterWorld(page, cls);
    console.log(`in world as ${cls}`);
    await validateDesktopClass(page, cls);
    await page.close();
    await sleep(800); // let the server notice the leave before the next login
  }

// Optional secondary action bar (Interface > Show Secondary Action Bar adds
// body.show-actionbar2): the xpbar must sit below BOTH bars.
if (process.env.WOC_CHECK_BAR2 === '1') {
  const page = await browser.newPage();
  page.on('dialog', (d) => void d.accept()); // take-over confirm
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(900);
  await toCharSelect(page);
  await enterWorld(page, CLASSES[0]);
  await page.evaluate(() => document.body.classList.add('show-actionbar2'));
  await sleep(500);
  const m = await page.evaluate(measure);
  check('bar2: second action bar visible', !!m.actionbar2 && m.actionbar2.height > 0);
  if (m.actionbar2 && m.xpbar) {
    check(
      'bar2: xpbar below both bars',
      m.xpbar.top >= m.actionbar.bottom && m.xpbar.top >= m.actionbar2.bottom,
      `(xp top ${m.xpbar.top.toFixed(1)}, bar2 bottom ${m.actionbar2.bottom.toFixed(1)})`,
    );
    const gap = m.viewportH - m.xpbar.bottom;
    check(
      'bar2: xpbar stuck to bottom',
      gap >= 0 && gap <= MAX_BOTTOM_GAP,
      `(gap ${gap.toFixed(1)}px)`,
    );
  }
  await page.screenshot({ path: 'tmp/xpbar_bar2_1920x1080.png' });
  await page.close();
  await sleep(800);
}

// Mobile-touch: the bar must stay hidden (the XP ring on the player frame is
// the mobile presentation); the reorder must not resurrect it.
if (!SKIP_MOBILE) {
  const page = await browser.newPage();
  page.on('dialog', (d) => void d.accept()); // take-over confirm
  // Landscape: mobile play orientation (portrait shows the rotate-device gate).
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(900);
  await toCharSelect(page);
  await enterWorld(page, CLASSES[0]);
  const readMobile = () => ({
    mobileTouch: document.body.classList.contains('mobile-touch'),
    xpbarDisplay: getComputedStyle(document.querySelector('#xpbar')).display,
    xpFillVar: document.querySelector('#player-frame')?.style.getPropertyValue('--xp-fill') ?? '',
  });
  let m = await page.evaluate(readMobile);
  // The painter mirrors --xp-fill on the HUD tick; give it a few seconds.
  for (let i = 0; i < 10 && m.xpFillVar === ''; i += 1) {
    await sleep(500);
    m = await page.evaluate(readMobile);
  }
  check('mobile: body.mobile-touch active', m.mobileTouch);
  check('mobile: xpbar hidden', m.xpbarDisplay === 'none', `(display ${m.xpbarDisplay})`);
  check(
    'mobile: xp ring var present on player frame',
    m.xpFillVar !== '',
    `(--xp-fill ${m.xpFillVar})`,
  );
  await page.screenshot({ path: 'tmp/xpbar_mobile_844x390.png' });
  await page.close();
}

await browser.close();
console.log(fail > 0 ? `${fail} check(s) FAILED` : 'all checks passed');
process.exit(fail > 0 ? 1 : 0);
