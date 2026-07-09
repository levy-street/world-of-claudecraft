// Visual verification for the relocated mobile HUD clusters: top trio,
// joystick satellites, centred More dialog, and the castbar's new seat.
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
  const social = await rect('#mobile-social');
  const more = await rect('#mobile-more');
  check('trio visible', !!chat && !!social && !!more);
  if (chat && social && more) {
    check(
      'trio anchored top-left',
      chat.l < 20 && chat.t < 20,
      `l=${chat.l.toFixed(1)} t=${chat.t.toFixed(1)}`,
    );
    check(
      'trio clears the target-frame seat (top+72)',
      more.b <= 72,
      `bottom=${more.b.toFixed(1)}`,
    );
    check('order chat < social < more', chat.l < social.l && social.l < more.l);
  }
  check('community rail hidden on mobile', !(await rect('#community-hud')));
  const jump = await rect('#mobile-jump');
  const autorun = await rect('#mobile-autorun');
  const joy = await rect('#mobile-move-joystick');
  const attack = await rect('#mobile-action-attack');
  check('jump/autorun/joystick/attack visible', !!jump && !!autorun && !!joy && !!attack);
  if (jump && autorun && joy && attack) {
    const jc = { x: (joy.l + joy.r) / 2, y: (joy.t + joy.b) / 2 };
    const jumpC = { x: (jump.l + jump.r) / 2, y: (jump.t + jump.b) / 2 };
    const autoC = { x: (autorun.l + autorun.r) / 2, y: (autorun.t + autorun.b) / 2 };
    const attackC = { x: (attack.l + attack.r) / 2, y: (attack.t + attack.b) / 2 };
    check(
      'autorun due right of joystick centre',
      Math.abs(autoC.y - jc.y) < 3 && autoC.x > jc.x,
      `dy=${(autoC.y - jc.y).toFixed(1)}`,
    );
    check(
      'jump in the ring hollow (right thumb, due left of Attack)',
      Math.abs(jumpC.y - attackC.y) < 3 && jumpC.x > vw / 2 && jumpC.x < attackC.x,
      `jump=(${jumpC.x.toFixed(0)},${jumpC.y.toFixed(0)}) attack=(${attackC.x.toFixed(0)},${attackC.y.toFixed(0)})`,
    );
    // Size parity with the ring's Target secondary.
    const target = await rect('#mobile-target-cycle');
    if (target) {
      check(
        'jump/autorun same size as Target',
        Math.abs(jump.w - target.w) < 1 && Math.abs(autorun.w - target.w) < 1,
        `jump=${jump.w.toFixed(1)} autorun=${autorun.w.toFixed(1)} target=${target.w.toFixed(1)}`,
      );
    }
    // Jump must clear the (compact-nudged) player frame and the castbar.
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

  // Open the More dialog: it must be centred on screen.
  await page.evaluate(() => document.getElementById('mobile-more')?.click());
  await sleep(400);
  const modal = await rect('#mobile-extra-controls');
  check('More dialog opens', !!modal);
  if (modal) {
    const cx = Math.abs((modal.l + modal.r) / 2 - vw / 2);
    const cy = Math.abs((modal.t + modal.b) / 2 - 390 / 2);
    check('More dialog centred', cx < 2 && cy < 8, `off by (${cx.toFixed(1)}, ${cy.toFixed(1)})`);
  }
  await page.screenshot({ path: 'tmp/layout_more_dialog.png' });
  await page.evaluate(() => document.getElementById('mobile-more-close')?.click());
  await sleep(300);

  console.log(fail === 0 ? 'ALL LAYOUT VISUAL CHECKS PASSED' : `${fail} CHECK(S) FAILED`);
  process.exitCode = fail === 0 ? 0 : 1;
} finally {
  await browser.close();
}
