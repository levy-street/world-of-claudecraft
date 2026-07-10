// Visual verification for the compact mobile HUD: top menu, joystick-owned
// Autorun, two-row action pad, centred More dialog, and player-frame bars.
// Needs `npm run dev`. Writes PNGs to tmp/.
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
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
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
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'LayoutVerify', settleMs: 2000 });
  await page.keyboard.press('Space');
  await page.waitForFunction(
    () => {
      const z = document.querySelector('#mobile-move-zone');
      return z && z.getBoundingClientRect().width > 0;
    },
    { timeout: 20000 },
  );
  // Dismiss the tutorial card so the top band is visible.
  await page.evaluate(() => document.querySelector('.tut-skip')?.click());
  await sleep(400);

  const rect = (sel) =>
    page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (st.display === 'none' || (r.width === 0 && r.height === 0)) return null;
      return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
    }, sel);

  const vw = 844;
  const chat = await rect('#mobile-chat');
  const quest = await rect('#mobile-quest');
  const more = await rect('#mobile-more');
  check('compact Chat/Quests/More visible', !!chat && !!quest && !!more);
  if (chat && quest && more) {
    check(
      'compact menu anchored top-right',
      more.r > vw - 20 && chat.t < 20,
      `right=${more.r.toFixed(1)} top=${chat.t.toFixed(1)}`,
    );
    check('order Chat < Quests < More', chat.l < quest.l && quest.l < more.l);
  }
  check('Social moved into closed More', !(await rect('#mobile-social')));
  check('Settings moved into closed More', !(await rect('#mobile-menu')));
  check('community rail hidden on mobile', !(await rect('#community-hud')));
  const jump = await rect('#mobile-jump');
  const autorun = await rect('#mobile-autorun-target');
  const joy = await rect('#mobile-move-joystick');
  const attack = await rect('#mobile-action-attack');
  check('jump/autorun target/joystick/attack measurable', !!jump && !!autorun && !!joy && !!attack);
  if (jump && autorun && joy && attack) {
    const jc = { x: (joy.l + joy.r) / 2, y: (joy.t + joy.b) / 2 };
    const jumpC = { x: (jump.l + jump.r) / 2, y: (jump.t + jump.b) / 2 };
    const autoC = { x: (autorun.l + autorun.r) / 2, y: (autorun.t + autorun.b) / 2 };
    const attackC = { x: (attack.l + attack.r) / 2, y: (attack.t + attack.b) / 2 };
    check(
      'Autorun target centred above movement',
      Math.abs(autoC.x - jc.x) < 3 && autoC.y < jc.y,
      `dx=${(autoC.x - jc.x).toFixed(1)} dy=${(autoC.y - jc.y).toFixed(1)}`,
    );
    check(
      'Jump is the action pad primary nearest the right thumb',
      jumpC.x > attackC.x && jumpC.y > attackC.y && jumpC.x > vw / 2,
      `jump=(${jumpC.x.toFixed(0)},${jumpC.y.toFixed(0)}) attack=(${attackC.x.toFixed(0)},${attackC.y.toFixed(0)})`,
    );
    // Jump is primary; the non-interactive Autorun target matches secondary
    // face scale without becoming another gameplay button.
    const target = await rect('#mobile-target-cycle');
    if (target) {
      check(
        'Jump is largest and hidden Autorun target is visually recessed',
        jump.w > target.w && autorun.w < target.w,
        `jump=${jump.w.toFixed(1)} autorun=${autorun.w.toFixed(1)} target=${target.w.toFixed(1)}`,
      );
    }
    // Jump must clear the centred player frame.
    const frame = await rect('#player-frame');
    if (frame) {
      check(
        'jump clears the player frame',
        jump.l >= frame.r + 2 || jump.b <= frame.t,
        `jump.l=${jump.l.toFixed(1)} frame.r=${frame.r.toFixed(1)}`,
      );
    }
  }
  // Castbar seat: force it visible for a beat and measure.
  const castbar = await page.evaluate(() => {
    const el = document.getElementById('castbar');
    if (!el) return null;
    el.style.display = 'block';
    const r = el.getBoundingClientRect();
    el.style.display = '';
    return { l: r.left, t: r.top, r: r.right, b: r.bottom };
  });
  const frame = await rect('#player-frame');
  check('castbar measurable', !!castbar);
  if (castbar && frame) {
    // Centre-aligned with the player frame.
    const off = Math.abs((castbar.l + castbar.r) / 2 - (frame.l + frame.r) / 2);
    check('castbar centred over the player frame', off < 8, `offset ${off.toFixed(1)}px`);
    check(
      'castbar above the player frame',
      castbar.b <= frame.t + 1,
      `castbar.b=${castbar.b.toFixed(1)} frame.t=${frame.t.toFixed(1)}`,
    );
  }
  await page.screenshot({ path: 'tmp/layout_top_trio.png' });

  // Open the More dialog: landscape centres it horizontally and top-anchors it
  // above the bottom action row so a tall utility inventory cannot cover play.
  await page.evaluate(() => document.getElementById('mobile-more')?.click());
  await sleep(400);
  const modal = await rect('#mobile-extra-controls');
  check('More dialog opens', !!modal);
  if (modal) {
    const cx = Math.abs((modal.l + modal.r) / 2 - vw / 2);
    const actionPad = await rect('#mobile-action-ring');
    check(
      'More dialog centred horizontally and clear of the action pad',
      cx < 2 && modal.t < 20 && (!actionPad || modal.b <= actionPad.t),
      `x offset ${cx.toFixed(1)}px, top=${modal.t.toFixed(1)} bottom=${modal.b.toFixed(1)}`,
    );
  }
  await page.screenshot({ path: 'tmp/layout_more_dialog.png' });
  await page.evaluate(() => document.getElementById('mobile-more-close')?.click());
  await sleep(300);

  console.log(fail === 0 ? 'ALL LAYOUT VISUAL CHECKS PASSED' : `${fail} CHECK(S) FAILED`);
  process.exitCode = fail === 0 ? 0 : 1;
} finally {
  await browser.close();
}
