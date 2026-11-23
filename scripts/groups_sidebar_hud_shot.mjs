// Real offline game HUD, party selection and Groups launcher regression capture.
// GAME_URL=http://127.0.0.1:5264 OUT=tmp/groups-sidebar node scripts/groups_sidebar_hud_shot.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';

const out = process.env.OUT ?? 'tmp/groups-sidebar';
const baseline = process.env.BASELINE === '1';
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const results = [];
  const errors = [];
  for (const [name, width, height, mobile, scale] of [
    ['desktop', 1600, 900, false, 1],
    ['desktop-scaled', 1600, 900, false, 1.25],
    ['mobile-landscape', 844, 390, true, 1],
    ['mobile-scaled', 844, 390, true, 1.25],
  ]) {
    if (process.env.CASE && process.env.CASE !== name) continue;
    const page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewport({ width, height, hasTouch: mobile, isMobile: mobile });
    if (mobile)
      await page.setUserAgent(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
      );
    await suppressGpuNotice(page);
    await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5264', {
      waitUntil: 'domcontentloaded',
      timeout: 180000,
    });
    console.log(`Loaded ${name}`);
    assert.equal(
      await enterOfflineGame(page, {
        charClass: 'priest',
        charName: 'Aster',
        selectorTimeoutMs: 180000,
        gameBootTimeoutMs: 180000,
      }),
      true,
      'The real game must boot',
    );
    console.log(`Booted ${name}`);
    await page.evaluate(() => {
      const { sim } = window.__game;
      sim.player.invulnerable = true;
      const friend = sim.addPlayer('warrior', 'Briar');
      const entity = sim.entities.get(friend);
      Object.assign(entity.pos, sim.player.pos, { x: sim.player.pos.x + 3 });
      entity.prevPos = { ...entity.pos };
      sim.partyInvite(friend, sim.playerId);
      sim.partyAccept(friend);
      window.sidebarFriend = friend;
    });
    await page.waitForSelector('#party-frames .party-frame');
    await page.evaluate(() => {
      window.__game.hud.closeAll();
      const toggle = document.querySelector('#party-frames button[aria-expanded="false"]');
      toggle?.click();
    });
    await page
      .waitForSelector('#party-frames .party-frame', { visible: true })
      .catch(async (error) => {
        console.log(
          JSON.stringify(
            await page.evaluate(() => ({
              party: window.__game.sim.partyInfo,
              frames: document.getElementById('party-frames')?.className,
              classes: document.body.className,
            })),
          ),
        );
        await page.screenshot({ path: `${out}/${name}-failure.png` });
        throw error;
      });
    const cdp = await page.createCDPSession();
    let safeAreaChecked = false;
    try {
      await cdp.send('Emulation.setSafeAreaInsetsOverride', {
        insets: mobile ? { top: 0, left: 24, right: 24, bottom: 16 } : {},
      });
      safeAreaChecked = mobile;
    } catch {
      console.log('Safe-area CDP override unavailable; reporting this limitation.');
    }
    await page.evaluate(
      async ({ mobile, scale }) => {
        const { Settings } = await import('/src/game/settings.ts');
        const settings = new Settings();
        settings.set('uiScale', scale);
        document.documentElement.style.setProperty('--ui-scale', String(scale));
        window.__game.hud.reapplySavedGeometry();
        window.__game.hud.closeAll();
        await new Promise((resolve) => setTimeout(resolve, 500));
      },
      { mobile, scale },
    );
    const row = await page.$('#party-frames .party-frame');
    assert.ok(row, 'A real party member frame must be present');
    // Hit the member portrait's upper-left area, where the old floating bell
    // overlaps the first member. A centre click alone misses that regression.
    await row.click({ offset: { x: 12, y: 10 } });
    const selection = await page.evaluate(() => ({
      target: window.__game.sim.player.targetId,
      friend: window.sidebarFriend,
      floating: !!document.getElementById('expedition-hud'),
      music: !!document.getElementById('mm-music'),
      mobile: document.body.classList.contains('mobile-touch'),
      scale: Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')),
    }));
    assert.equal(selection.mobile, mobile, 'The expected native touch bootstrap must be active');
    assert.equal(selection.scale, scale, 'The computed UI scale must match the test');
    assert.equal(selection.floating, baseline, 'The expected bell placement must be present');
    assert.equal(selection.music, baseline, 'The expected music slot state must be present');
    if (!baseline)
      assert.equal(selection.target, selection.friend, 'Party selection must receive the click');
    await page.screenshot({ path: `${out}/${name}-hud.png` });
    if (mobile) {
      await page.evaluate(() => document.getElementById('mobile-more')?.click());
      await page.waitForSelector('#mobile-dfinder', { visible: true });
      await page.click('#mobile-dfinder');
    } else {
      await page.click('#expedition-bell');
    }
    await page.waitForSelector('#dungeon-finder-window', { visible: true });
    await page.screenshot({ path: `${out}/${name}-groups.png` });
    results.push({ name, baseline, scale, safeAreaChecked, ...selection });
    console.log(`Captured ${name}`);
    await page.close();
  }
  assert.deepEqual(errors, [], 'No real-game runtime errors');
  fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
  console.log(`Real HUD screenshots and party selection passed: ${out}`);
} finally {
  await browser.close();
}
