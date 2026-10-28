// Visual proof for the mounted hit-reaction fix: boots the offline game as a
// warrior, rides the Stormfeather griffin, then fires the renderer's landed-hit
// path (Renderer.triggerHit, the hook every damage event drives) on the player
// and shoots mid-flinch. On the pre-fix source the rider stands up on the
// griffin's back for the clip; on the fix the rider stays in the saddle. Shoots
// desktop. Needs `npm run dev`.
//
//   GAME_URL=http://localhost:5199 OUT=tmp/mounted_hit_after node scripts/mounted_hit_shot.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT ?? 'tmp/mounted_hit_shots';
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Desktop only: the fix is a rig pose with no layout part, and a phone-sized frame shows the
// rider too small to read the seat height.
const VIEWPORTS = [{ name: 'desktop', width: 1280, height: 800, isMobile: false, hasTouch: false }];

async function dismissChrome(pg) {
  await pg.evaluate(() => {
    document.querySelector('.camera-prompt-confirm')?.click();
    for (const b of document.querySelectorAll('button')) {
      const t = b.textContent ?? '';
      if (/skip tutorial|understood|dismiss/i.test(t)) b.click();
    }
  });
}

async function shoot(vp) {
  // a fresh browser per viewport: a second game boot in one browser starves under SwiftShader
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: ['--window-size=1280,800', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await page.setViewport({ ...vp, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => {
    try {
      window.localStorage.setItem('woc.cameraModePrompt.shown', '1');
      // Standing capture rule: seed the lowest graphics preset before boot.
      window.localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
    } catch {
      /* private mode: the prompts are dismissed below instead */
    }
  });
  await page.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await page.waitForSelector('#btn-offline', { timeout: 180000 });
  await wait(400);
  await page.evaluate(() => document.querySelector('#btn-offline').click());
  await wait(400);
  await page.type('#char-name', 'Rider');
  await page.evaluate(() => {
    document.querySelector('#offline-select .mini-class[data-class="warrior"]').click();
    document.querySelector('#btn-start-offline').click();
  });
  await page.waitForFunction(() => !!window.__game?.world?.player, { timeout: 240000 });
  // wait out the first-visit arrival cinematic, which owns the camera
  await wait(5200);
  await dismissChrome(page);

  await page.evaluate(() => {
    const sim = window.__game.sim;
    sim.setPlayerLevel(20, sim.playerId);
    sim.addItem('reins_stormfeather_griffin', 1);
    const meta = sim.meta(sim.playerId);
    if (meta) meta.ridingTrained = true; // skip the trainer's gold gate for the shot
  });
  await page.waitForFunction(
    () => {
      const sim = window.__game.sim;
      if (!sim.player.mountKey) window.__game.world.useItem('reins_stormfeather_griffin');
      return sim.player.mountKey === 'stormfeather_griffin';
    },
    { timeout: 10000, polling: 250 },
  );
  await page.waitForFunction(
    () => !!window.__game.renderer?.views?.get(window.__game.sim.playerId)?.mountVisual,
    { timeout: 30000, polling: 300 },
  );
  // The summon settles the rider into the saddle through the Sit_Down one-shot, which would
  // swallow the hit on either source: strike only once the seated loop holds.
  await page.waitForFunction(
    () => {
      const g = window.__game;
      return g.renderer.views.get(g.sim.playerId)?.visual?.current?.getClip?.().name === 'Sit_Idle';
    },
    { timeout: 60000, polling: 250 },
  );
  await dismissChrome(page);
  await page.evaluate(() => {
    const g = window.__game;
    g.input.camDist = 6;
    g.input.camPitch = 0.22;
    g.input.camYaw = g.sim.player.facing + Math.PI / 2; // side-on: the seat height reads clearly
  });
  await wait(1200);
  await dismissChrome(page);
  await wait(300);
  await page.screenshot({ path: `${OUT}/${vp.name}-seated.png` });

  // A landed hit, through the renderer's own damage-event hook, then shoot mid-flinch.
  await page.evaluate(() => window.__game.renderer.triggerHit(window.__game.sim.playerId));
  await wait(220);
  await page.screenshot({ path: `${OUT}/${vp.name}-struck.png` });
  console.log(
    vp.name,
    await page.evaluate(() => {
      const g = window.__game;
      const v = g.renderer.views.get(g.sim.playerId);
      return { mountKey: g.sim.player.mountKey, clip: v?.visual?.current?.getClip?.().name };
    }),
  );
  await browser.close();
}

const only = process.env.VIEWPORT;
for (const vp of VIEWPORTS) if (!only || only === vp.name) await shoot(vp);
console.log(`wrote ${OUT}/`);
