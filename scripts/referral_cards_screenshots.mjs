// Real browser evidence for the referral controller with authoritative-shape fixtures.
// Requires Vite (GAME_URL, default localhost:5173). No server or dev commands.
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const base = process.env.GAME_URL ?? 'http://localhost:5173';
const output = path.resolve('docs/screenshots/referral-cards');
const fixture = path.resolve('tmp/referral-cards-preview.html');
await fs.mkdir(path.dirname(fixture), { recursive: true });
await fs.mkdir(output, { recursive: true });
await fs.writeFile(
  fixture,
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="game-active"><div id="ui"><button id="mm-social"></button><div id="prompt-stack"></div></div><script type="module">
import '/src/styles/index.css';
import {createReferralCardsHud} from '/src/ui/hud/referral_cards/referral_cards_hud_controller.ts';
import {createReferralCard} from '/src/sim/referral_cards.ts';
import {FocusManager} from '/src/ui/focus_manager.ts';
import {makeWindowFocus} from '/src/ui/window_focus.ts';
const card = createReferralCard(8, 10, 20);
card.status = 'active';
Object.assign(card.participants[0], {characterId:100, characterName:'Aster', credited:7, redeemed:3});
Object.assign(card.participants[1], {characterId:200, characterName:'Briar', credited:3, redeemed:3});
const snapshot = {revision:1, accountId:10, characterId:100, characterName:'Aster', inviteUrl:'https://example.test/?ref=invite-example', links:[{card,friendName:'Briar',canMove:false,summonRemainingSeconds:0}],completedFriends:2,rewardedTiers:[1,2],notices:[],nextCursor:8,titleOwned:true,readyCount:1};
const actions=[];
const focus=new FocusManager();
const controller=createReferralCardsHud({world:()=>({referralCardsSnapshot:()=>snapshot,referralCardsAction:a=>actions.push(a)}),focus:makeWindowFocus(focus,()=>document.getElementById('referral-cards-window')),focusFirst:root=>focus.focusFirst(root),closeOthers:()=>{},visibilityChanged:()=>{},snapshotChanged:()=>{}});
controller.update();
document.getElementById('mm-referral-cards').focus();
controller.open();
window.referralFixture={controller,snapshot,actions};
</script></body></html>`,
);

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/tmp/referral-cards-preview.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.referralFixture);
  await page.waitForFunction(() => document.activeElement?.closest('#referral-cards-window'));
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  await page.waitForFunction(() => document.activeElement?.closest('#referral-cards-window'));
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.activeElement?.closest('#referral-cards-window'));
  for (const [name, width, height, touch] of [
    ['desktop', 1440, 1000, false],
    ['mobile-portrait', 390, 844, true],
    ['mobile-landscape', 844, 390, true],
  ]) {
    await page.setViewport({
      width,
      height,
      deviceScaleFactor: 1,
      hasTouch: touch,
      isMobile: touch,
    });
    await page.evaluate(
      ({ width, height, touch }) => {
        document.body.classList.toggle('mobile-touch', touch);
        document.documentElement.style.setProperty('--app-vw', `${width}px`);
        document.documentElement.style.setProperty('--app-vh', `${height}px`);
      },
      { width, height, touch },
    );
    await page.waitForFunction(
      () => document.querySelector('[data-referral-action="redeem"]')?.disabled === false,
    );
    const result = await page.evaluate(() => {
      const root = document.getElementById('referral-cards-window');
      const box = root.getBoundingClientRect();
      const clipped =
        box.left < 0 || box.right > innerWidth + 1 || box.top < 0 || box.bottom > innerHeight + 1;
      const undersized = [...root.querySelectorAll('button')]
        .filter((button) => {
          const rect = button.getBoundingClientRect();
          return rect.width > 0 && (rect.width < 40 || rect.height < 40);
        })
        .map((button) => button.textContent);
      return { clipped, undersized, actions: window.referralFixture.actions };
    });
    if (result.clipped || (touch && result.undersized.length))
      throw new Error(`${name}: ${JSON.stringify(result)}`);
    if (result.actions.some((action) => action.type === 'redeem'))
      throw new Error('Opening or animating a stamp sent a reward action');
    await page.screenshot({ path: path.join(output, `${name}.png`) });
    console.log(
      `${name}: fits viewport; ${touch ? '40px touch targets; ' : ''}no automatic redemption`,
    );
  }
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { left: 44, right: 44, top: 0, bottom: 21 },
  });
  await page.evaluate(() => document.documentElement.style.setProperty('--ui-scale', '1.25'));
  const safe = await page.$eval('#referral-cards-window', (el) => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      right: r.right,
      bottom: r.bottom,
      width: innerWidth,
      height: innerHeight,
    };
  });
  if (safe.left < 43 || safe.right > safe.width - 43 || safe.bottom > safe.height - 20)
    throw new Error(`Scaled safe areas: ${JSON.stringify(safe)}`);
  await page.screenshot({ path: path.join(output, 'mobile-safe-area-scaled.png') });
  console.log('Landscape safe areas and 125% UI scale: controls remain inside screen insets.');
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: {} });
  await page.evaluate(() => document.documentElement.style.removeProperty('--ui-scale'));
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.evaluate(() => {
    document.body.classList.remove('mobile-touch');
    document.documentElement.style.setProperty('--app-vw', '1440px');
    document.documentElement.style.setProperty('--app-vh', '1000px');
    const fixture = window.referralFixture;
    fixture.snapshot.links[0].card.revision++;
    fixture.snapshot.links[0].card.lockConfirmation = { accountId: 10, revision: 1, stage: 1 };
    fixture.snapshot.revision++;
    fixture.controller.update();
  });
  await page.waitForFunction(() => !document.querySelector('[data-animate="true"]'));
  await page.screenshot({ path: path.join(output, 'lock-confirmation.png') });
  await page.evaluate(() => {
    window.referralFixture.snapshot.revision++;
    window.referralFixture.controller.update();
  });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.closest('#referral-cards-window'));
  await page.evaluate(() => window.referralFixture.controller.close());
  await page.waitForFunction(() => document.activeElement?.id === 'mm-referral-cards');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Keyboard close returns focus to the launcher; no browser errors.');
  if (process.argv.includes('--real-hud')) {
    const snapshot = await page.evaluate(() => {
      const value = structuredClone(window.referralFixture.snapshot);
      delete value.links[0].card.lockConfirmation;
      return value;
    });
    await page.close();
    const game = await browser.newPage();
    await game.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await game.goto(`${base}/?gfx=low`, { waitUntil: 'domcontentloaded' });
    if (
      !(await enterOfflineGame(game, {
        charName: 'Aster',
        gameBootTimeoutMs: 90000,
        selectorTimeoutMs: 60000,
      }))
    )
      throw new Error('Offline game failed to boot');
    await game.evaluate(() => document.querySelector('.gpu-notice-dismiss')?.click());
    const offlineHidden = await game.$eval('#mm-referral-cards', (el) => el.hidden);
    if (!offlineHidden) throw new Error('Referral launcher must be hidden offline');
    await game.screenshot({ path: path.join(output, 'game-offline-before.png') });
    await game.evaluate((snapshot) => {
      const world = window.__game.world ?? window.__game.sim;
      world.referralCardsSnapshot = () => snapshot;
      world.referralCardsAction = () => {};
    }, snapshot);
    await game.waitForFunction(() => !document.getElementById('mm-referral-cards').hidden);
    await game.screenshot({ path: path.join(output, 'game-launcher-after.png') });
    await game.$eval('#mm-referral-cards', (el) => el.click());
    await game.waitForSelector('#referral-cards-window', { visible: true });
    await game.waitForFunction(() => !document.querySelector('[data-animate="true"]'));
    await game.screenshot({ path: path.join(output, 'game-card-after.png') });
    console.log(
      'Real game HUD: launcher hidden offline, snapshot reveals launcher, actual launcher opens card.',
    );
    await game.close();
    const mobile = await browser.newPage();
    await mobile.setViewport({
      width: 844,
      height: 390,
      deviceScaleFactor: 1,
      hasTouch: true,
      isMobile: true,
    });
    await mobile.goto(`${base}/?gfx=low`, { waitUntil: 'domcontentloaded' });
    if (
      !(await enterOfflineGame(mobile, {
        charName: 'Aster',
        gameBootTimeoutMs: 90000,
        selectorTimeoutMs: 60000,
      }))
    )
      throw new Error('Touch game failed to boot');
    await mobile.evaluate((snapshot) => {
      document.querySelector('.gpu-notice-dismiss')?.click();
      const world = window.__game.world ?? window.__game.sim;
      world.referralCardsSnapshot = () => snapshot;
      world.referralCardsAction = () => {};
      // Drive the snapshot's cold-chrome update even if the touch boot is paused.
      window.__game.hud.referralCards.update();
    }, snapshot);
    await mobile.waitForFunction(() => !document.getElementById('mobile-referral-cards').hidden);
    await mobile.evaluate(() => {
      document.getElementById('mobile-more').click();
    });
    await mobile.waitForSelector('#mobile-extra-controls', { visible: true });
    await mobile.$eval('#mobile-referral-cards', (el) => el.scrollIntoView({ block: 'nearest' }));
    await mobile.screenshot({ path: path.join(output, 'game-mobile-more.png') });
    await mobile.tap('#mobile-referral-cards');
    await mobile.waitForSelector('#referral-cards-window', { visible: true });
    await mobile.waitForFunction(() => !document.body.classList.contains('mobile-more-open'));
    await mobile.screenshot({ path: path.join(output, 'game-mobile-card-after.png') });
    console.log('Real game touch layout: More tray launcher opens the shared stamp card window.');
  }
} finally {
  await browser.close();
  await fs.unlink(fixture);
}
