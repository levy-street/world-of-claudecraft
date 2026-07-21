// Live geometry check: the bank window's transactional buy row stays fully
// visible inside the window border on short landscape phones, in the 50/50
// touch pairing, WITH items in the vault (the full search/chips toolbar only
// mounts on a non-empty vault, which is exactly the state an empty-vault
// walkthrough misses) and in both deposit-status states (the transient
// "Materials deposited" line borrows grid height while it shows).
//
// Guards the @media (max-height: 480px) grid-floor yield in
// src/styles/hud.mobile.css. Runs the offline flow (no server/Postgres);
// needs `npm run dev` (default :5173, override GAME_URL).

import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const BASE = (process.env.GAME_URL ?? 'http://localhost:5173') + '/';
const CHAR_NAME = 'Proberton';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log('PASS', name);
  } else {
    fail++;
    console.log('FAIL', name, extra);
  }
}

const PROFILES = [
  { name: '740x360', width: 740, height: 360 },
  { name: '844x390', width: 844, height: 390 },
  { name: '915x412', width: 915, height: 412 },
];

for (const profile of PROFILES) {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: [
      `--window-size=${profile.width + 80},${profile.height + 120}`,
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
    defaultViewport: {
      width: profile.width,
      height: profile.height,
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  const cdp = await page.target().createCDPSession();
  // Satisfy PHONE_TOUCH_QUERY: (pointer: coarse) / no hover.
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'pointer', value: 'coarse' },
      { name: 'hover', value: 'none' },
    ],
  });
  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 60000 });
  // Skip the first-spawn intro cinematic (it inline-hides #ui while it runs).
  await page.evaluate((name) => {
    localStorage.setItem(`woc_spawn_intro_seen:offline:warrior:${name}`, '1');
  }, CHAR_NAME);
  await enterOfflineGame(page, { charClass: 'warrior', charName: CHAR_NAME, settleMs: 3000 });

  // Arrange: god-mode, depositable material stacks, coin for the buy row, then
  // teleport to Bursar Fernando (zone1 {x:13, z:8}).
  await page.evaluate(() => {
    const sim = window.__game.sim;
    const p = sim.player;
    p.maxHp = 99999;
    p.hp = 99999;
    for (const [id, n] of [
      ['bone_fragments', 12],
      ['wolf_fang', 9],
      ['linen_scrap', 10],
      ['amber_hide', 6],
    ])
      sim.addItem(id, n);
    sim.players.get(p.id).copper = 123456;
    p.pos.x = 13;
    p.pos.y = 1.5;
    p.pos.z = 6.2;
    document.querySelector('.tut-skip')?.click();
  });
  await wait(1000);

  // Act: the REAL touch interact opens the bank; deposit-all mounts the status
  // line and fills the vault (which mounts the full toolbar).
  await page.evaluate(() => document.querySelector('#mobile-interact')?.click());
  await page.waitForSelector('#bank-window', { visible: true, timeout: 5000 });
  await wait(400);
  await page.evaluate(() => document.querySelector('#bank-window .bank-deposit-all')?.click());
  await wait(700);

  const measure = () =>
    page.evaluate(() => {
      const win = document.querySelector('#bank-window');
      const winB = win.getBoundingClientRect();
      const buy = win.querySelector('.bank-buy-row');
      const buyB = buy ? buy.getBoundingClientRect() : null;
      const scroll = win.querySelector('.bank-scroll');
      return {
        hasStatus: !!win.querySelector('.bank-status'),
        winBottom: winB.bottom,
        buyBottom: buyB ? buyB.bottom : null,
        buyHeight: buyB ? buyB.height : 0,
        scrollable: !!scroll && getComputedStyle(scroll).overflowY === 'auto',
      };
    });

  // The buy row must sit fully inside the window border with a little
  // clearance (it may eat into the window's bottom padding, never past it).
  const CLEARANCE = 2;
  const withStatus = await measure();
  check(
    `${profile.name} status line mounted after deposit-all`,
    withStatus.hasStatus,
    JSON.stringify(withStatus),
  );
  check(
    `${profile.name} buy row visible WITH status line`,
    withStatus.buyBottom !== null &&
      withStatus.buyHeight > 0 &&
      withStatus.buyBottom <= withStatus.winBottom - CLEARANCE,
    JSON.stringify(withStatus),
  );

  // The status line auto-clears (DEPOSIT_STATUS_MS); the grid floor grows back.
  await wait(4500);
  const afterStatus = await measure();
  check(`${profile.name} status line cleared`, !afterStatus.hasStatus, JSON.stringify(afterStatus));
  check(
    `${profile.name} buy row visible WITHOUT status line`,
    afterStatus.buyBottom !== null &&
      afterStatus.buyHeight > 0 &&
      afterStatus.buyBottom <= afterStatus.winBottom - CLEARANCE,
    JSON.stringify(afterStatus),
  );
  check(`${profile.name} grid region stays scrollable`, afterStatus.scrollable);
  check(`${profile.name} no page errors`, errors.length === 0, errors.join(' | '));

  await browser.close();
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
