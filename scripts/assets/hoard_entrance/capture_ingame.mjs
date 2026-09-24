// Matched world entrance evidence: rarity, day/night, desktop Ultra and phone Low.
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from '../../browser_path.mjs';
import { enterOfflineGame } from '../../enter_offline_game.mjs';
import { suppressGpuNotice } from '../../lib/gpu_notice_suppress.mjs';

const out = 'docs/screenshots/buried-hoard-entrance';
const prefix = process.env.SHOT_PREFIX ?? 'before';
const url = process.env.GAME_URL ?? 'http://127.0.0.1:5182';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
mkdirSync(out, { recursive: true });
for (const mobile of [false, true]) {
  if (process.env.DESKTOP_ONLY && mobile) continue;
  if (process.env.MOBILE_ONLY && !mobile) continue;
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: true,
    args: [],
    defaultViewport: { width: mobile ? 844 : 1600, height: mobile ? 390 : 900 },
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (error) => console.error(error.message));
    await suppressGpuNotice(page);
    if (mobile)
      await page.emulate({
        viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
        userAgent:
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
      });
    await page.evaluateOnNewDocument((low) => {
      localStorage.setItem(
        'woc_settings',
        JSON.stringify({ graphicsPreset: low ? 1 : 4, graphicsDefaultApplied: true }),
      );
    }, mobile);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
    if (
      !(await enterOfflineGame(page, {
        charName: 'Hoardseer',
        selectorTimeoutMs: 90000,
        gameBootTimeoutMs: 120000,
      }))
    )
      throw new Error('World did not boot');
    await page.waitForFunction(
      () => getComputedStyle(document.querySelector('#loading-screen')).display === 'none',
      { timeout: 180000 },
    );
    await page.evaluate(() => {
      const s = window.__game.sim;
      s.devCommands = true;
      s.chat('/dev level 20');
      s.chat('/dev god');
      s.chat('/dev noaggro');
    });
    for (const rarity of (process.env.RARITIES ?? 'common,rare,epic,legendary').split(',')) {
      const state = await page.evaluate(async (quality) => {
        const g = window.__game;
        const s = g.sim;
        s.chat(`/dev map ${quality}`);
        const { TREASURE_SITES, TREASURE_SITES_BY_ID } = await import(
          '/src/sim/content/treasure_maps.ts'
        );
        const { Rng } = await import('/src/sim/rng.ts');
        const sites = {
          common: 'site_amberfall_leaf_ring',
          rare: 'site_willowfen_dry_hummock',
          epic: 'site_nightbloom_gloamfield',
          legendary: 'site_frostveil_flat_snow',
        };
        const siteIndex = TREASURE_SITES.findIndex((site) => site.id === sites[quality]);
        if (siteIndex < 0) throw new Error('Missing capture site');
        // Reproduce the same map roll across hosts regardless of loading tick count.
        let seed = 1;
        while (new Rng(seed).int(0, TREASURE_SITES.length - 1) !== siteIndex) seed++;
        s.rng.s = seed;
        s.useItem(`treasure_map_${quality}`);
        const site = TREASURE_SITES_BY_ID[s.treasureMap.siteId];
        s.chat('/dev map site');
        s.chat(`/dev tp ${site.x} ${site.z}`);
        s.player.facing = 0;
        s.useItem(`treasure_map_${quality}`);
        const entrance = [...s.entities.values()].find(
          (e) => e.templateId === 'hoard_entrance' && e.vaultRarity === quality,
        );
        if (!entrance) throw new Error('Entrance did not spawn');
        const { x, y, z } = entrance.pos;
        const vector = (a, b, c) => g.renderer.camera.position.clone().set(a, b, c);
        g.renderer.editorCam = {
          pos: quality === 'rare' ? vector(x - 7, y + 9, z + 10) : vector(x + 7, y + 7, z - 10),
          target: vector(x, y + 0.8, z),
        };
        document.querySelector('#treasure-map-window')?.querySelector('[data-close]')?.click();
        return { id: entrance.id, site: site.id, rarity: entrance.vaultRarity };
      }, rarity);
      await delay(6000);
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('#loading-screen')).display === 'none',
        { timeout: 180000 },
      );
      for (const phase of ['day', 'night']) {
        await page.evaluate((p) => {
          const input = document.querySelector('#chat-input');
          input.value = `/daynight ${p}`;
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          input.blur();
        }, phase);
        await delay(2000);
        const file = `${out}/${prefix}-${rarity}-${phase}-${mobile ? 'landscape-phone-low' : 'desktop-ultra'}.png`;
        await page.screenshot({ path: file });
        console.log(JSON.stringify({ file, ...state }));
      }
    }
  } finally {
    await browser.close();
  }
}
