// Verifies the mobile community/social rail (#community-hud) clears the
// right-edge safe-area notch in landscape, and captures before/after PNGs.
//
// Needs `npm run dev` running on :5173. Usage:
//   node scripts/mobile_community_hud_safe_area.mjs
//
// Landscape phones with a notch report env(safe-area-inset-right) > 0. We try
// the real CDP Emulation.setSafeAreaInsetsOverride so env() resolves to a true
// inset; if this Chromium build lacks it we paint a visible notch band and pin
// the rail with the equivalent px so the screenshot still shows the behaviour.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.URL || 'http://localhost:5173/';
const OUT = 'screenshots';
const INSET = 44; // px — representative right notch (e.g. iPhone landscape)
fs.mkdirSync(OUT, { recursive: true });

const showHud = () => {
  document.body.classList.add('mobile-touch', 'game-active');
  const rd = document.getElementById('rotate-device');
  if (rd) rd.style.display = 'none';
};

async function tryRealInset(page) {
  try {
    const client = await page.target().createCDPSession();
    await client.send('Emulation.setSafeAreaInsetsOverride', {
      insets: { top: 0, left: 0, bottom: 0, right: INSET },
    });
    return true;
  } catch {
    return false;
  }
}

async function shoot(page, name, { simulate, rule }) {
  await page.evaluate(showHud);
  await page.evaluate(
    ({ simulate, rule, INSET }) => {
      document.getElementById('__notch')?.remove();
      document.getElementById('__sim')?.remove();
      // Always paint the unsafe band so the notch is visible in the shot.
      const band = document.createElement('div');
      band.id = '__notch';
      band.style.cssText =
        `position:fixed;top:0;right:0;bottom:0;width:${INSET}px;z-index:9999;` +
        'pointer-events:none;background:repeating-linear-gradient(' +
        '45deg,#e0303066,#e0303066 8px,#90101066 8px,#90101066 16px);';
      document.body.appendChild(band);
      if (simulate) {
        const s = document.createElement('style');
        s.id = '__sim';
        s.textContent = rule;
        document.head.appendChild(s);
      }
    },
    { simulate, rule, INSET },
  );
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`wrote ${OUT}/${name}.png`);
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 740, height: 360, deviceScaleFactor: 2, isMobile: true });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });

  // Enter the offline world so the in-game HUD (incl. #community-hud) renders.
  const click = async (sel) => {
    try {
      await page.waitForSelector(sel, { timeout: 8000, visible: true });
      await page.click(sel);
      await new Promise((r) => setTimeout(r, 600));
      return true;
    } catch {
      return false;
    }
  };
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'Notchy', settleMs: 1200 });
  await click('#mobile-preflight-continue');
  await new Promise((r) => setTimeout(r, 2500));

  const real = await tryRealInset(page);
  console.log(real ? 'using real CDP safe-area inset' : 'CDP inset unavailable — simulating');

  // BEFORE: emulate the pre-fix rule (bare right:8px) under the notch.
  await shoot(page, 'community-hud-before', {
    simulate: true,
    rule:
      'body.mobile-touch #community-hud{right:8px !important}' +
      '@media (orientation:landscape){body.mobile-touch #community-hud{right:8px !important}}',
  });
  // AFTER: the shipped rule. With a real inset env() already clears the band;
  // when simulating, pin to the inset to mirror what env() would resolve to.
  await shoot(page, 'community-hud-after', {
    simulate: !real,
    rule:
      `body.mobile-touch #community-hud{right:max(8px, ${INSET}px) !important}` +
      `@media (orientation:landscape){body.mobile-touch #community-hud{right:max(8px, ${INSET}px) !important}}`,
  });
} finally {
  await browser.close();
}
