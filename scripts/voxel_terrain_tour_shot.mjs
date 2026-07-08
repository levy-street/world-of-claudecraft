// Verification tour for the full-world voxel-terrain swap (renderer.ts now
// builds terrain from buildVoxelTerrain instead of the production heightfield
// mesh). Teleports across 20+ spread-out locations covering all three zones
// (vale/marsh/peaks), hubs, ridge passes, the world rim, and every dungeon/delve
// entrance (the instanced interiors themselves stay on the untouched
// dungeon.ts renderer; these confirm the new open-world terrain meets their
// doors cleanly). Needs `npm run dev` running.
//
// Runs with a REAL, hardware-accelerated GPU (never software/swiftshader):
// launches Chrome with ANGLE bound to the system GPU and forces the `ultra`
// graphics tier (?gfx=ultra) so every capture reflects the actual production
// visual quality, not a software-GL fallback. The player is made a GM
// (invulnerable, see sim/combat/damage.ts) so camp mobs never interrupt a
// capture, and the first-spawn intro cinematic (game/spawn_cinematic.ts,
// ~9s camera fly-in) is skipped with the documented Escape-to-skip.
//
// One long-lived session, RELAUNCHED ONLY ON CRASH: a single real-GPU tab
// carrying this map's full triangle count occasionally hits a driver-level
// crash a few captures in (surfaces to Puppeteer as "frame got detached",
// nothing recoverable in that same page). A brand-new browser process per
// shot would dodge that, but the whole-world build this module runs at boot
// is CPU-bound (independent of the GPU) and expensive enough that redoing it
// per shot turns a ~15-minute tour into hours. So: reuse one session across
// consecutive shots, and only pay a fresh boot+rebuild when a capture
// actually throws, retrying that one location on the new session.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const BASE_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}gfx=ultra`;
const OUT = 'docs/screenshots';
fs.mkdirSync(OUT, { recursive: true });

const LAUNCH_ARGS = [
  '--window-size=1600,900',
  // Real GPU, not swiftshader: ANGLE bound to the system's hardware GL.
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
  '--use-gl=angle',
  '--use-angle=gl',
  '--enable-webgl',
  '--no-sandbox',
];

// 22 spread locations: vale/marsh/peaks terrain + hubs + ridge passes + the
// world rim, plus every dungeon doorPos and delve marker (src/sim/content/
// dungeons.ts, zone1.ts/zone3.ts delveMarkers) so the tour also confirms the
// new terrain meets every instance entrance cleanly.
const LOCATIONS = [
  { name: '01_vale_spawn', x: 0, z: 0 },
  { name: '02_vale_hub', x: 20, z: 40 },
  { name: '03_vale_west_hill', x: -120, z: 100 },
  { name: '04_vale_lake', x: -60, z: -80 },
  { name: '05_vale_ridge_pass', x: 0, z: 170 },
  { name: '06_marsh_north', x: 0, z: 250 },
  { name: '07_fenbridge_hub', x: 0, z: 300 },
  { name: '08_marsh_east', x: 130, z: 400 },
  { name: '09_marsh_ridge_pass', x: 0, z: 535 },
  { name: '10_peaks_south', x: -100, z: 600 },
  { name: '11_highwatch_hub', x: 0, z: 660 },
  { name: '12_peaks_center', x: 0, z: 750 },
  { name: '13_peaks_north_rim', x: 0, z: 890 },
  { name: '14_world_rim_edge', x: -170, z: 400 },
  { name: '15_hollow_crypt_door', x: 80, z: 90 },
  { name: '16_collapsed_reliquary_delve', x: -5, z: -52 },
  { name: '17_sunken_bastion_door', x: 45, z: 515 },
  { name: '18_drowned_litany_delve', x: -95, z: 505 },
  { name: '19_sanctum_gate_door', x: 0, z: 858 },
  { name: '20_crypt_of_nythraxis_door', x: -152, z: 610 },
  { name: '21_marsh_swamp_lake', x: 90, z: 300 },
  { name: '22_vale_south_gate', x: 0, z: -160 },
];

let browser = null;
let page = null;

async function openSession() {
  browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: LAUNCH_ARGS,
    defaultViewport: { width: 1600, height: 900 },
  });
  page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('voxel_terrain')) console.log('BROWSER:', t);
  });

  // Turn on the performance overlay (FPS + GPU renderer string visible in
  // every capture) before boot. game/settings.ts `showFps` is the master
  // on/off; ui/perf_overlay's own metrics map defaults fps/frameTime on
  // already, so only `gpu` needs an explicit opt-in
  // (sanitizePerfOverlayConfig merges this partial map onto the defaults).
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('woc_settings', JSON.stringify({ showFps: true }));
    localStorage.setItem('woc_perf_overlay', JSON.stringify({ metrics: { gpu: true } }));
  });
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 90000 });
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'Tour', settleMs: 1500 });

  // Skip the first-spawn intro cinematic (game/spawn_cinematic.ts): desktop
  // skips with Escape. No-op once the cinematic has already landed.
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 200));

  // Make the tour character a GM (sim/combat/damage.ts: `if (target.gm)
  // return` no-ops every damage path), so wandering camp mobs never
  // interrupt a capture. Offline-only: flips the same `gm` field the
  // server sets from an operator role.
  await page.waitForFunction(() => Boolean(window.__game?.sim?.player), { timeout: 60000 });
  await page.evaluate(() => {
    window.__game.sim.player.gm = true;
  });

  // Dismiss the new-player tutorial card so it never clutters a capture.
  await page.evaluate(() => {
    const btn = document.querySelector('.tut-skip');
    if (btn instanceof HTMLElement) btn.click();
  });
  await new Promise((r) => setTimeout(r, 200));
}

async function closeSession() {
  try {
    await browser?.close();
  } catch {
    /* already dead */
  }
  browser = null;
  page = null;
}

async function captureOne(loc) {
  await page.waitForFunction(() => Boolean(window.__game?.sim?.player), { timeout: 20000 });
  await page.evaluate((p) => {
    const g = window.__game;
    const player = g.sim.player;
    player.gm = true; // reassert every hop: immortality must never lapse mid-tour
    player.hp = player.maxHp;
    player.pos.x = p.x;
    player.pos.z = p.z;
    player.facing = 0;
    g.input.camYaw = 0.6;
    g.input.camPitch = -0.35;
  }, loc);
  // The overlay only paints once the FrameMeter has accumulated a frame or
  // two after settings apply; wait for real text instead of guessing.
  await page
    .waitForFunction(
      () => (document.getElementById('perf-overlay')?.textContent ?? '').includes('FPS'),
      { timeout: 15000 },
    )
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: `${OUT}/voxel_tour_${loc.name}.png` });
  console.log('captured', loc.name);
}

await openSession();
for (const loc of LOCATIONS) {
  try {
    await captureOne(loc);
  } catch (e) {
    console.log('CRASH on', loc.name, '-', e.message, '- relaunching session and retrying once');
    await closeSession();
    try {
      await openSession();
      await captureOne(loc);
    } catch (e2) {
      console.log('FAILED', loc.name, e2.message);
      await closeSession();
      await openSession();
    }
  }
}
await closeSession();

console.log('wrote screenshots to', OUT);
