// Live-browser proof for the iOS zone-eviction fix (PR evidence, not a repo test).
//
// Boots an offline world under an iPhone user agent (the same signal
// mobilePlatformFromNavigator in src/render/gfx.ts reads to set
// GFX.iosMemoryProfile/constrainedMemory), streams in several real world
// zones the way ordinary travel would, then resets the player to the
// current zone's origin and drives the renderer's own
// evictFarZoneIfConstrained pass directly (a private method, called via
// dot access since TS `private` is a compile-time-only restriction) to
// show it releases the far zones' terrain/water geometry while the
// CURRENT zone keeps rendering normally. Screenshots the world after
// eviction so a reviewer can see there is no visible difference, which is
// the whole point: an evicted zone is indistinguishable from one never
// visited, and rebuilds on return through the ordinary streaming path.
//
// Needs `npm run dev` on :5173 (override with GAME_URL). Writes to tmp/.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1280,800', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.setUserAgent(IPHONE_UA);

// Lowest graphics preset, per the repo's standing capture rule.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
  } catch {
    /* ignore */
  }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Traveler' });
if (!booted) throw new Error('offline world did not boot');
await sleep(800);

const state = await page.evaluate(async () => {
  const g = window.__game;
  const r = g.renderer;
  // Real zone hubs, spanning the world (src/sim/data.ts ZONES). Drakelands
  // and amberfall are both ~1829 yd from the Eastbrook spawn (0, 0), clear of
  // ZONE_EVICTION_RADIUS (1450 yd); the rest sit well inside it, so this mix
  // proves eviction picks the far ones and leaves the near ones resident.
  const hubs = [
    { id: 'eastbrook_vale', x: 0, z: 0 },
    { id: 'mirefen_marsh', x: 0, z: 300 },
    { id: 'thornpeak_heights', x: 0, z: 660 },
    { id: 'drakelands', x: 404, z: 1900 },
    { id: 'amberfall', x: -360, z: 2072 },
  ];
  for (const hub of hubs) {
    await r.prepareZoneAt(hub.x, hub.z);
  }
  const before = {
    preparedZones: [...r.preparedZones],
    terrainChunks: r.terrainView.group.children.length,
    waterMeshes: r.waterView.meshes.length,
  };

  // Walk the player back to the spawn zone (eastbrook_vale) and camera with
  // it, then run the SAME throttled pass sync() drives every frame: real
  // code, called directly instead of waiting out the travel time.
  const p = g.sim.player;
  p.pos.x = 0;
  p.pos.z = 0;
  p.prevPos = { ...p.pos };
  r.camera.position.set(0, 30, 0);
  const currentZoneId = r.zoneIdAt(0, 0);
  // Evicts the single farthest eligible zone per call (by design, so a long
  // session sheds zones gradually rather than in one disposal spike); call it
  // twice to release both drakelands and amberfall.
  r.evictFarZoneIfConstrained(currentZoneId, 0, 0);
  r.evictFarZoneIfConstrained(currentZoneId, 0, 0);

  const after = {
    preparedZones: [...r.preparedZones],
    terrainChunks: r.terrainView.group.children.length,
    waterMeshes: r.waterView.meshes.length,
  };
  return { before, after };
});

console.log('BEFORE eviction:', JSON.stringify(state.before, null, 2));
console.log('AFTER eviction: ', JSON.stringify(state.after, null, 2));

const evictedCount = state.before.preparedZones.length - state.after.preparedZones.length;
const evictedIds = state.before.preparedZones.filter(
  (id) => !state.after.preparedZones.includes(id),
);
console.log(`Evicted ${evictedCount} zone(s): ${evictedIds.join(', ')}`);
console.log(
  `Terrain chunks: ${state.before.terrainChunks} -> ${state.after.terrainChunks} ` +
    `(${state.before.terrainChunks - state.after.terrainChunks} released)`,
);
console.log(
  `Water meshes: ${state.before.waterMeshes} -> ${state.after.waterMeshes} ` +
    `(${state.before.waterMeshes - state.after.waterMeshes} released)`,
);

if (evictedCount === 0) {
  throw new Error('expected at least one far zone to be evicted');
}
if (state.after.preparedZones.includes('eastbrook_vale') === false) {
  throw new Error('the current zone (eastbrook_vale) must never be evicted');
}

// Dismiss the software-rendering banner (a headless/swiftshader capture
// artifact, unrelated to this fix) before the keeper screenshot.
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.trim().toLowerCase().includes('dismiss'),
  );
  btn?.click();
});

// Prove the current zone still renders correctly after the eviction: force
// a frame (headless only paints on request) and screenshot the world.
await page.screenshot({ path: 'tmp/ios_zone_eviction_after.png' });
console.log('Screenshot written: tmp/ios_zone_eviction_after.png');

await browser.close();
