// Hidden-window render-skip probe (desktop presentation lifecycle): proves that
// with the desktop gate active (Electron user agent, so DESKTOP_APP is true) a
// hidden window stops submitting frames while the sim and the network keep
// running, and that refocus resumes rendering with no backlog.
//
// The desktop shell itself pins the Page Visibility API at 'visible'
// (backgroundThrottling:false) and pushes hidden-ness over the bridge instead;
// this rig drives the SAME gate through its document.hidden arm, which is
// faithful because the page here stays actually visible, so rAF keeps firing at
// full rate exactly like the shell. Evidence read through window.__game:
// perf.snapshot().hiddenPresentSkips (new in this change), perf frame sampling,
// renderer draw stats, sim time, and online.lastSnapAt.
//
// Usage: npm run dev (":5173") in one terminal; for the online leg also
// npm run server (":8787") with a reachable database. SKIP_ONLINE=1 runs the
// offline leg only.
//   node scripts/desktop_hidden_skip_probe.mjs
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const HIDDEN_MS = Number(process.env.HIDDEN_MS ?? 5000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (leg, name, ok, detail) => {
  console.log(`[${leg}] ${ok ? 'ok ' : 'FAIL'} ${name} ${detail}`);
  if (!ok) failures.push(`${leg}: ${name} (${detail})`);
};

async function launchDesktopPage() {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    protocolTimeout: 90000,
    args: ['--window-size=1280,760', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1280, height: 760 },
  });
  const page = await browser.newPage();
  const pageerrors = [];
  page.on('pageerror', (e) => pageerrors.push(String(e.message ?? e)));
  // The Electron token makes isElectronRuntime (src/runtime.ts) classify the
  // page as the desktop app, which is what arms the hidden-skip gate.
  const ua = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');
  await page.setUserAgent(`${ua} Electron/43.3.0`);
  return { browser, page, pageerrors };
}

// Shadow document.hidden/visibilityState. Chromium ignores the shadow for its
// own scheduling (rAF keeps firing, matching the shell), but the frame loop's
// gate reads the property every frame.
function setHidden(page, hidden) {
  return page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (h ? 'hidden' : 'visible'),
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

function sample(page) {
  return page.evaluate(() => {
    const g = window.__game;
    if (!g || !g.perf) return null;
    const s = g.perf.snapshot();
    return {
      skips: s.hiddenPresentSkips,
      frames: s.frames,
      draws: s.renderer ? s.renderer.calls : null,
      // Counted DOWNSTREAM of the sync present argument, so a forced present
      // moves it deterministically whatever the GPU speed (phase 4 QA F4).
      presented:
        g.renderer && typeof g.renderer.presentedFrames === 'function'
          ? g.renderer.presentedFrames()
          : null,
      // The sim bucket ring population: hidden frames must record no per-frame
      // perf sample at all (web hidden-tab parity, phase 4 QA F10).
      simSamples: s.mainMs && s.mainMs.sim ? s.mainMs.sim.count : null,
      simTime: g.sim && typeof g.sim.time === 'number' ? g.sim.time : null,
      snapAt: g.online && typeof g.online.lastSnapAt === 'number' ? g.online.lastSnapAt : null,
      entities: g.world && g.world.entities ? g.world.entities.size : null,
    };
  });
}

async function offlineLeg() {
  const { browser, page, pageerrors } = await launchDesktopPage();
  try {
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
    const booted = await enterOfflineGame(page, { settleMs: 3000 });
    if (!booted) throw new Error('offline world did not boot');
    await sleep(1000);
    await setHidden(page, true);
    await sleep(300);
    const s0 = await sample(page);
    await sleep(HIDDEN_MS);
    const s1 = await sample(page);
    await setHidden(page, false);
    await sleep(1500);
    const s2 = await sample(page);
    console.log('[offline] samples', JSON.stringify({ s0, s1, s2 }));
    check(
      'offline',
      'skips climb while hidden',
      s1.skips - s0.skips >= 60,
      `${s0.skips} -> ${s1.skips}`,
    );
    check(
      'offline',
      'perf frames frozen while hidden',
      s1.frames === s0.frames,
      `${s0.frames} -> ${s1.frames}`,
    );
    check(
      'offline',
      'no draws while hidden',
      s1.draws === 0 || s1.draws === s0.draws,
      `draws ${s0.draws} -> ${s1.draws}`,
    );
    check(
      'offline',
      'no presents while hidden',
      s1.presented !== null && s1.presented === s0.presented,
      `presented ${s0.presented} -> ${s1.presented}`,
    );
    check(
      'offline',
      'no perf bucket samples while hidden',
      s0.simSamples !== null && s0.simSamples < 500 && s1.simSamples === s0.simSamples,
      `sim samples ${s0.simSamples} -> ${s1.simSamples}`,
    );
    check(
      'offline',
      'sim time advances while hidden',
      s1.simTime - s0.simTime >= (HIDDEN_MS / 1000) * 0.8,
      `${s0.simTime} -> ${s1.simTime}`,
    );
    check(
      'offline',
      'skips stop on refocus',
      s2.skips <= s1.skips + 2,
      `${s1.skips} -> ${s2.skips}`,
    );
    check(
      'offline',
      'sampling resumes on refocus',
      s2.frames > s1.frames,
      `${s1.frames} -> ${s2.frames}`,
    );
    check('offline', 'draws resume on refocus', s2.draws > 0, `draws ${s2.draws}`);
    check(
      'offline',
      'presents resume on refocus',
      s2.presented > s1.presented,
      `presented ${s1.presented} -> ${s2.presented}`,
    );
    // Kills a sticky setFrameSampling(false): the frozen-while-hidden check
    // above would pass a switch that never re-enables, this one cannot.
    check(
      'offline',
      'perf bucket sampling resumes on refocus',
      s2.simSamples > s1.simSamples,
      `sim samples ${s1.simSamples} -> ${s2.simSamples}`,
    );
    check('offline', 'no page errors', pageerrors.length === 0, JSON.stringify(pageerrors));
  } finally {
    await browser.close();
  }
}

async function onlineLeg() {
  const { browser, page, pageerrors } = await launchDesktopPage();
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1000);
    const uniq = `${Date.now()}`.slice(-7);
    const user = `hsp_${uniq}`;
    // Character names reject digits; map them to letters.
    const charName = `Hsp${uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)])}`;
    await page.evaluate(() => document.querySelector('#btn-online')?.click());
    await sleep(300);
    await page.evaluate(
      (u, pw) => {
        const form = document.querySelector('#login-panel');
        if (form.dataset.authMode !== 'register')
          document.querySelector('#btn-auth-toggle').click();
        const setVal = (sel, v) => {
          const el = document.querySelector(sel);
          el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        setVal('#login-user', u);
        setVal('#login-pass', pw);
        // Register mode reveals a required email field; an empty one makes
        // requestSubmit a silent no-op (native validation).
        setVal('#login-email', `${u}@example.com`);
        form.requestSubmit();
      },
      user,
      'hunter22',
    );
    await page
      .waitForFunction(
        () => {
          const el = document.querySelector('#realm-panel');
          return el && getComputedStyle(el).display !== 'none';
        },
        { timeout: 12000, polling: 200 },
      )
      .catch(() => {});
    await page.evaluate(() => {
      const el = document.querySelector('#realm-panel');
      if (el && getComputedStyle(el).display !== 'none')
        document.querySelector('#realm-list .realm-row')?.click();
    });
    await page.waitForFunction(
      () => {
        const el = document.querySelector('#charcreate-panel');
        return el && getComputedStyle(el).display !== 'none';
      },
      { timeout: 14000, polling: 200 },
    );
    await page.evaluate((name) => {
      const n = document.querySelector('#new-char-name');
      n.value = name;
      n.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#charcreate-panel .mini-class[data-class="warrior"]').click();
      document.querySelector('#btn-create-char').click();
    }, charName);
    await page.waitForFunction(
      (name) =>
        [...document.querySelectorAll('.char-row .char-name')].some((s) => s.textContent === name),
      { timeout: 14000, polling: 200 },
      charName,
    );
    await page.evaluate((name) => {
      const row = [...document.querySelectorAll('.char-row')].find(
        (r) => r.querySelector('.char-name')?.textContent === name,
      );
      row?.querySelector('.enter-world-btn')?.click();
    }, charName);
    await page.waitForFunction(
      () => window.__game?.online && window.__game?.perf && window.__game.world?.entities?.size > 0,
      { timeout: 25000, polling: 300 },
    );
    await sleep(1500);
    await setHidden(page, true);
    await sleep(300);
    const t0 = await sample(page);
    await sleep(HIDDEN_MS);
    const t1 = await sample(page);
    await setHidden(page, false);
    await sleep(1500);
    const t2 = await sample(page);
    console.log('[online] samples', JSON.stringify({ t0, t1, t2 }));
    check(
      'online',
      'skips climb while hidden',
      t1.skips - t0.skips >= 60,
      `${t0.skips} -> ${t1.skips}`,
    );
    check(
      'online',
      'snapshots keep arriving while hidden',
      t1.snapAt > t0.snapAt,
      `lastSnapAt ${t0.snapAt} -> ${t1.snapAt}`,
    );
    check(
      'online',
      'no draws while hidden',
      t1.draws === 0 || t1.draws === t0.draws,
      `draws ${t0.draws} -> ${t1.draws}`,
    );
    check(
      'online',
      'no presents while hidden',
      t1.presented !== null && t1.presented === t0.presented,
      `presented ${t0.presented} -> ${t1.presented}`,
    );
    check(
      'online',
      'no perf bucket samples while hidden',
      t0.simSamples !== null && t0.simSamples < 500 && t1.simSamples === t0.simSamples,
      `sim samples ${t0.simSamples} -> ${t1.simSamples}`,
    );
    check('online', 'world mirror stays live', t2.entities > 0, `entities ${t2.entities}`);
    check(
      'online',
      'sampling resumes on refocus',
      t2.frames > t1.frames,
      `${t1.frames} -> ${t2.frames}`,
    );
    check('online', 'draws resume on refocus', t2.draws > 0, `draws ${t2.draws}`);
    check(
      'online',
      'presents resume on refocus',
      t2.presented > t1.presented,
      `presented ${t1.presented} -> ${t2.presented}`,
    );
    check('online', 'no page errors', pageerrors.length === 0, JSON.stringify(pageerrors));
  } finally {
    await browser.close();
  }
}

await offlineLeg();
if (process.env.SKIP_ONLINE !== '1') await onlineLeg();
if (failures.length) {
  console.error(`FAIL: ${failures.length} check(s) failed`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  'PASS: hidden skip + resume verified' +
    (process.env.SKIP_ONLINE === '1' ? ' (offline leg only)' : ''),
);
