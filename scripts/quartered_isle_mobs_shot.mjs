// Quartered Isle mob bodies in the live offline client: for each isle mob with a new or
// changed body, an idle frame, two frames into its fight and its death. Needs a running
// Vite dev client (offline dev commands work there). Seeds the lowest graphics preset.
//
//   GAME_URL=http://localhost:5173 SHOT_DIR=docs/screenshots/quartered-isle-mobs \
//     SHOT_PREFIX=after-desktop node scripts/quartered_isle_mobs_shot.mjs
//
// SHOT_W / SHOT_H set the viewport (mobile is landscape-only in game, e.g. 932x430);
// SHOT_PHASES=idle limits the run to the idle frames.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { dismissEntryOverlays, enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOT_DIR ?? 'tmp/quartered-isle-mobs';
const PREFIX = process.env.SHOT_PREFIX ?? 'after-desktop';
const PHASES = new Set((process.env.SHOT_PHASES ?? 'idle,fight,death').split(','));
const MOBS = (
  process.env.SHOT_MOBS ??
  'warden_of_the_quench,the_glassfield_brute,heaved_shardling,veinback_burrower,heatsworn_ember,cinderscar_caller'
).split(',');
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await puppeteer.launch({
  executablePath: process.env.BROWSER_PATH || BROWSER_PATH,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: {
    width: Number(process.env.SHOT_W ?? 1280),
    height: Number(process.env.SHOT_H ?? 760),
  },
  protocolTimeout: 240000,
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  try {
    window.localStorage.setItem('woc.cameraModePrompt.shown', '1');
    window.localStorage.setItem(
      'woc_settings',
      JSON.stringify({ graphicsPreset: 1, graphicsDefaultApplied: true }),
    );
  } catch {
    // Private contexts can reject localStorage; shot() also dismisses the prompt.
  }
});
page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function tick(frames = 6) {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
  }, frames);
}
async function shot(name) {
  await page
    .waitForFunction(
      () => !document.querySelector('#loading-screen')?.classList.contains('visible'),
      { timeout: 60000 },
    )
    .catch(() => {});
  await dismissEntryOverlays(page);
  await page.evaluate(() => {
    document.querySelector('.camera-prompt-confirm')?.click();
    const gpuNotice = document.getElementById('gpu-notice');
    if (gpuNotice) gpuNotice.hidden = true;
  });
  await tick(5);
  await page.screenshot({ path: `${OUT}/${PREFIX}-${name}.png` });
  console.log('shot', `${PREFIX}-${name}`);
}
const chat = (cmd) =>
  page.evaluate((c) => window.__game.world.chat(c, window.__game.world.player.id), cmd);

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
// A cold dev server can take a while to wire the homepage handlers: keep poking the
// offline trigger until its panel opens, then hand over to the shared entry flow.
await page.waitForSelector('#btn-offline', { timeout: 60000 });
for (let i = 0; i < 60; i++) {
  await page.evaluate(() => document.querySelector('#btn-offline')?.click());
  await sleep(3000);
  const open = await page.evaluate(
    () => getComputedStyle(document.querySelector('#offline-select')).display !== 'none',
  );
  if (open) break;
}
await enterOfflineGame(page, { charName: 'Isleward', settleMs: 2500, gameBootTimeoutMs: 180000 });
const booted = await page
  .waitForFunction(() => !!window.__game?.world?.player, { timeout: 240000, polling: 500 })
  .then(() => true)
  .catch(() => false);
if (!booted) {
  await page.screenshot({ path: `${OUT}/boot-failed.png` });
  throw new Error(`offline world did not boot (see ${OUT}/boot-failed.png)`);
}
await chat('/dev level 20');
await chat('/dev god');
// Daylight: the offline sky answers /daynight through the chat box's dev hook.
await page.evaluate(() => {
  const input = document.getElementById('chat-input');
  input.value = '/daynight day';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});
// Hide the HUD: these frames are about the bodies.
await page.evaluate(() => {
  const ui = document.getElementById('ui');
  if (ui) ui.style.visibility = 'hidden';
});
// Camera distance per body, so each one fills a similar share of the frame.
const CAM = {
  warden_of_the_quench: 10,
  the_glassfield_brute: 14,
  heaved_shardling: 5.5,
  veinback_burrower: 9,
  heatsworn_ember: 5.5,
  cinderscar_caller: 8,
};
// The Embers sit in the Burnways' dips: look down into them over the near rim.
const PITCH = { heatsworn_ember: 0.5, veinback_burrower: 0.45 };

for (const templateId of MOBS) {
  await chat('/dev noaggro');
  const found = await page.evaluate(
    ([id, camDist, camPitch]) => {
      const world = window.__game.world;
      const mob = [...world.entities.values()].find((e) => e.templateId === id && !e.dead);
      if (!mob) return false;
      // Clear the camp's other mobs out of frame so one body reads at a time.
      for (const e of world.entities.values()) {
        if (e === mob || e.kind !== 'mob') continue;
        const dx = e.pos.x - mob.pos.x;
        const dz = e.pos.z - mob.pos.z;
        if (dx * dx + dz * dz < 40 * 40) {
          e.pos = { x: e.pos.x + 200, y: e.pos.y, z: e.pos.z + 200 };
          e.prevPos = { ...e.pos };
          world.rebucket(e);
        }
      }
      const dist = Math.max(6, (mob.scale ?? 1) * 5);
      // Stand off to one side so the mob is not hidden behind the player.
      world.player.pos = { x: mob.pos.x + dist * 0.55, y: mob.pos.y, z: mob.pos.z - dist };
      world.player.prevPos = { ...world.player.pos };
      world.player.facing = 0;
      world.rebucket(world.player);
      mob.facing = Math.PI;
      const input = window.__game.input;
      input.camYaw = 0;
      input.camPitch = camPitch;
      input.camDist = camDist;
      world.targetEntity(mob.id);
      return true;
    },
    [templateId, CAM[templateId] ?? 8, PITCH[templateId] ?? 0.18],
  );
  if (!found) {
    console.log('MISSING', templateId);
    continue;
  }
  await sleep(2500);
  if (PHASES.has('idle')) await shot(`${templateId}-idle`);
  await chat('/dev noaggro');
  if (PHASES.has('fight')) {
    await sleep(3000);
    await shot(`${templateId}-fight-1`);
    await sleep(500);
    await shot(`${templateId}-fight-2`);
  }
  if (PHASES.has('death')) {
    await page.evaluate((id) => {
      const world = window.__game.world;
      const mob = [...world.entities.values()].find((e) => e.templateId === id && !e.dead);
      if (mob) world.targetEntity(mob.id);
    }, templateId);
    await chat('/dev killtarget');
    await sleep(2500);
    await shot(`${templateId}-death`);
  }
}

console.log(
  errors.length ? `PAGE ERRORS (${errors.length}):\n${errors.join('\n')}` : 'no page errors',
);
await browser.close();
