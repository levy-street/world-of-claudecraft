// Predefined gate/portal exit facing: before this fix, leaveDungeon left the
// player facing whatever direction they last walked inside the instance
// (here simulated with an arbitrary interior facing) instead of a predefined
// outward direction. Shoots the Hollow Crypt door exterior plus the minimap's
// player-facing arrow, immediately after leaveDungeon.
//   OUT=tmp/after.png MAP_OUT=tmp/after_map.png node scripts/dungeon_exit_facing_shot.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT ?? 'tmp/dungeon_exit_facing.png';
const MAP_OUT = process.env.MAP_OUT ?? null;
// Mobile is landscape-only in-game (pr-screenshots skill): a phone-width
// landscape viewport via real CDP device metrics, not just a narrow window.
const MOBILE = process.env.MOBILE === '1';
const VIEWPORT = MOBILE ? { width: 844, height: 390 } : { width: 1280, height: 800 };
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 60000,
  args: [
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--disable-setuid-sandbox',
  ],
  defaultViewport: VIEWPORT,
});
const page = await browser.newPage();
if (MOBILE) {
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
}
await page.evaluateOnNewDocument(
  "localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1, graphicsDefaultApplied: true }));",
);
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Wayfarer',
  settleMs: 4000,
  gameBootTimeoutMs: 60000,
});
console.log('booted:', booted);

const result = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const door = [...sim.entities.values()].find(
    (e) => e.templateId === 'dungeon_door' && e.dungeonId === 'hollow_crypt',
  );
  if (!door) return { ok: false, reason: 'no hollow_crypt door in this world' };
  // God mode: the door exterior can sit near an overworld patrol, and combat
  // keeps ticking while the loading curtain streams in a fresh zone. Level 60
  // gives recalcPlayerStats a large real maxHp so nothing later clamps it back down.
  sim.setPlayerLevel(60);
  sim.player.maxHp = sim.player.hp = 999999;
  sim.enterDungeon('hollow_crypt');
  // Simulate an arbitrary interior facing picked up while exploring, before
  // walking back to the exit portal (mirrors the "whatever direction they
  // came from" report): unrelated to the door's own orientation outside.
  sim.player.facing = 0.6;
  sim.player.prevFacing = 0.6;
  sim.leaveDungeon();
  sim.player.maxHp = sim.player.hp = 999999;
  g.input.camYaw = 0; // fixed orbit offset so the shot compares apples to apples
  return {
    ok: true,
    facing: sim.player.facing,
    pos: { x: sim.player.pos.x, z: sim.player.pos.z },
    door: { x: door.pos.x, z: door.pos.z },
  };
});
console.log('result:', JSON.stringify(result));
if (!result.ok) throw new Error(result.reason);

// The teleport can raise the loading curtain again a beat after the sim-side
// jump (the render loop reacts to it on its own next frame), so give that a
// moment to happen before waiting for it to clear; then wait it out (SwiftShader
// software rendering is slow to warm up a fresh zone's shaders: up to 3 minutes).
await new Promise((r) => setTimeout(r, 2000));
const curtainGone = await page
  .waitForFunction(
    () => !document.getElementById('loading-screen')?.classList.contains('visible'),
    { timeout: 180000, polling: 1000 },
  )
  .then(() => true)
  .catch(() => false);
console.log('curtain gone:', curtainGone);
await page
  .evaluate(() => {
    document.querySelector('button.tut-skip')?.click();
    document.querySelector('.gpu-notice-dismiss')?.click();
    document.getElementById('gpu-notice')?.remove();
    // Safety net: whatever the cause, a death screen defeats the purpose of
    // this shot (proving a FACING, not a combat outcome), so force alive.
    const g = window.__game;
    const p = g.sim.player;
    if (p.dead || p.ghost) {
      p.dead = false;
      p.ghost = false;
      p.hp = p.maxHp;
    }
  })
  .catch(() => {});
await new Promise((r) => setTimeout(r, 300));
// Wait for the minimap widget to actually be laid out before clipping it.
let mapReady = false;
for (let i = 0; i < 20; i++) {
  mapReady = await page.evaluate(() => {
    const el = document.getElementById('minimap-wrap');
    const r = el?.getBoundingClientRect();
    return !!r && r.width > 0 && r.height > 0;
  });
  if (mapReady) break;
  await new Promise((r) => setTimeout(r, 500));
}
console.log('minimap ready:', mapReady);
await new Promise((r) => setTimeout(r, 800));

await page.screenshot({ path: OUT });
console.log('wrote', OUT);

if (MAP_OUT) {
  const clip = await page.evaluate(() => {
    const el = document.getElementById('minimap-wrap') ?? document.querySelector('#minimap-wrap');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (clip && clip.width > 0 && clip.height > 0) {
    await page.screenshot({ path: MAP_OUT, clip });
    console.log('wrote', MAP_OUT);
  } else {
    console.log('no #minimap-wrap clip available, skipped', MAP_OUT);
  }
}

await browser.close();
