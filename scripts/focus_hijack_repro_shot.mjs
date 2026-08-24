// Before/after visual proof for the "potion/action-bar/chat item keeps
// stealing Space" fix. Boots the offline game, opens bags, TRUSTED-clicks a
// potion row (a real puppeteer mouse click, not a synthetic dispatch, so the
// browser's native click-on-keyup replay is the real mechanism under test),
// then presses a TRUSTED Space and captures the chat log + bag row before and
// after. On the broken tree: the potion is drunk a second time (duplicate
// chat line, stack drops by 2) and no jump is requested. On the fixed tree:
// one chat line, the stack drops by 1, and Space reaches the jump key.
//   SHOT_LABEL=before node scripts/focus_hijack_repro_shot.mjs
//   SHOT_LABEL=after node scripts/focus_hijack_repro_shot.mjs
// Requires `npm run dev` on :5173 unless GAME_URL points elsewhere.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT_DIR ?? 'docs/screenshots/hud-focus-hijack-remaining-gaps';
const LABEL = process.env.SHOT_LABEL ?? 'before';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1200,800', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1200, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 120000 });
await enterOfflineGame(page, { charClass: 'priest', charName: 'Focusbane', settleMs: 2000 });
// Let any welcome-package mail/auto-claim settle before seeding a clean,
// dedicated test item, so the stack this script tracks is not entangled with
// starting inventory.
await wait(1000);

await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.addItem('spring_water', 5, sim.player.id);
});

await page.keyboard.press('b');
await wait(500);

const potionSelector = '#bags .bag-item[data-focus-key="bag:spring_water:0"]';
await page.waitForSelector(potionSelector, { timeout: 10000 });

async function stackCount() {
  return page
    .$eval(potionSelector, (el) => {
      const badge = el.querySelector('.bi-count');
      return badge ? badge.textContent.trim() : '(gone)';
    })
    .catch(() => '(gone)');
}

async function chatLines() {
  return page.evaluate(() =>
    [...document.querySelectorAll('#chatlog > div')].map((n) => n.textContent.trim()),
  );
}

console.log('before click: stack =', await stackCount());

// A REAL, trusted mouse click (via CDP), matching the exact input that leaves
// the browser's native focus on the row: a page.evaluate(el.click()) would be
// synthetic (detail 0) and never reproduce the bug. The bags window can
// rebuild between resolving the selector and clicking it (a background
// repaint), so retry a couple of times against a freshly-read box rather than
// racing a single stale ElementHandle.
async function clickRow(selector, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      const box = await page.$eval(selector, (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await page.mouse.click(box.x, box.y);
      return;
    } catch (e) {
      if (i === attempts - 1) throw e;
      await wait(150);
    }
  }
}
await clickRow(potionSelector);
await wait(200);
const countAfterClick = await stackCount();
const linesAfterClick = await chatLines();
console.log('after click: stack =', countAfterClick, 'chat lines =', linesAfterClick.length);

const activeBefore = await page.evaluate(() => ({
  tag: document.activeElement?.tagName,
  key: document.activeElement?.dataset?.focusKey,
}));
console.log('document.activeElement before Space:', JSON.stringify(activeBefore));

// A REAL, trusted Space key press (CDP), the same event class Input.onKeyDown
// and the browser's own native click-on-keyup semantics respond to.
await page.keyboard.down('Space');
await wait(40);
// Raw held-key state, checked immediately: whether the keydown actually
// reached Input.onKeyDown (true) or was swallowed upstream by a stale-focused
// control's own stopPropagation (false). readMoveInput()'s 150ms tap latch
// would still read true for a while even after a swallowed press because the
// real game loop's own earlier presses can leave it warm, so this is the
// honest signal.
const jumpHeldDuringPress = await page.evaluate(
  () => window.__game.input.debugState().movementHeld.jump,
);
await page.keyboard.up('Space');
await wait(250);

const countAfterSpace = await stackCount();
const linesAfterSpace = await chatLines();
console.log('after Space: stack =', countAfterSpace, 'chat lines =', linesAfterSpace.length);
console.log('chat log tail:', JSON.stringify(linesAfterSpace.slice(-4)));
console.log('movementHeld.jump while Space was down:', jumpHeldDuringPress);

await page.screenshot({ path: `${OUT}/${LABEL}-desktop.png` });
console.log('wrote', `${OUT}/${LABEL}-desktop.png`);

await browser.close();
