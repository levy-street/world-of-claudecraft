// env-combined v0.34 PR capture set: the after-shots for the combined environment
// branch (Willowfen seam, shore water tearing, near-grass ring, night lighting,
// dusk sprite lighting, sunset grade). Needs a dev server for THIS worktree
// (GAME_URL, default :5174).
//
// Run one batch at a time, selected by TIME (day | night | 0.28 | 0.75), because
// the day/night grade lerps in over seconds and re-setting it per shot is both
// slow and flaky. GFX picks the tier: medium plus leanFoliage for anything that
// does not need impostors (SwiftShader hangs on the high-tier impostor bake),
// ultra for the vista/sprite shots.
//
//   GAME_URL=http://localhost:5174 TIME=day GFX=medium \
//     node scripts/env_combined_v034_shots.mjs
//
// ONLY=name,name limits the batch. PROBE=1 dumps candidate world coordinates
// (town hubs, lamp sites) instead of shooting. GODRAYS=off re-shoots the sunset
// frame with the god ray sprites hidden, for the A/B.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const BASE = process.env.GAME_URL ?? 'http://localhost:5174';
const GFX = process.env.GFX ?? 'medium';
const TIME = process.env.TIME ?? 'day';
const OUT = process.env.OUT ?? 'tmp/env034';
const ONLY = (process.env.ONLY ?? '').split(',').filter(Boolean);
const BOOT_MS = Number(process.env.BOOT_MS ?? 150000);
const PROBE = process.env.PROBE === '1';
const GODRAYS = process.env.GODRAYS ?? 'on';

// leanFoliage keeps the impostor bake out of the boot path; the high tiers bake
// it eagerly and SwiftShader stalls there for minutes.
// LEAN=0 for the grass shots: leanFoliage is exactly what thins the painted
// meadow, so a grass-paint capture taken under it proves nothing.
const LEAN = process.env.LEAN !== '0';
const QUERY = GFX === 'ultra' ? '?gfx=ultra' : `?gfx=${GFX}${LEAN ? '&gfxo=leanFoliage:1' : ''}`;
const URL = BASE + QUERY;

// Every shot: name, world spot, camera, and which time-of-day batch owns it.
const SHOTS = [
  // --- daylight ---------------------------------------------------------
  // Willowfen/Eastbrook border cliff from a clifftop vantage looking north
  // along the face: the seam fix means no straight bright/dark line on it.
  // The border cliff rises sheer just east of the x=180 z=178 inlet: stand back
  // on the open ground and look ACROSS the face, so the whole wall is in frame
  // rather than the camera being wedged against it.
  // x=152 z=178 is the y=15 clifftop bench; x=180 z=178 is the inlet floor 20
  // yards below it, where the camera can only ever be inside the rock.
  {
    name: 'willowfen-seam',
    time: 'day',
    x: 152,
    z: 178,
    facing: 1.15,
    camPitch: 0.16,
    camDist: 11,
  },
  // Shore water tearing: low grazing camera along four beaches that showed
  // foam shards sitting on dry sand.
  {
    name: 'water-tear-a',
    time: 'day',
    x: -100,
    z: 345,
    facing: Math.PI,
    camPitch: 0.02,
    camDist: 7,
  },
  {
    name: 'water-tear-b',
    time: 'day',
    x: -272,
    z: 367,
    facing: -Math.PI / 2,
    camPitch: 0.02,
    camDist: 7,
  },
  {
    name: 'water-tear-c',
    time: 'day',
    x: -158,
    z: 1250,
    facing: Math.PI,
    camPitch: 0.02,
    camDist: 7,
  },
  {
    name: 'water-tear-d',
    time: 'day',
    x: 245,
    z: 720,
    facing: Math.PI / 2,
    camPitch: 0.02,
    camDist: 7,
  },
  // The open channel: does a straight heave-vs-flat water line still show?
  { name: 'gap-line', time: 'day', x: 180, z: 1963, facing: Math.PI, camPitch: 0.08, camDist: 8 },
  // Waterline softness: top-down over a sandy beach, water thinning over sand.
  {
    name: 'waterline-soft',
    time: 'day',
    x: -100,
    z: 349,
    facing: Math.PI,
    camPitch: 1.15,
    camDist: 14,
  },
  // Near-grass ring: plain turf underfoot, painted meadow beyond, no white ground.
  {
    name: 'grass-ring-vale-chase',
    time: 'day',
    x: 22,
    z: 44,
    facing: 0.6,
    camPitch: 0.14,
    camDist: 8,
  },
  {
    name: 'grass-ring-vale-top',
    time: 'day',
    x: 22,
    z: 44,
    facing: 0.6,
    camPitch: 1.25,
    camDist: 16,
  },
  { name: 'grass-ring-town', time: 'day', x: 13, z: 15, facing: 1.9, camPitch: 0.18, camDist: 9 },

  // --- night ------------------------------------------------------------
  { name: 'night-town', time: 'night', x: 13, z: 15, facing: 1.9, camPitch: 0.16, camDist: 10 },
  { name: 'night-road', time: 'night', x: 58, z: 78, facing: 2.4, camPitch: 0.12, camDist: 9 },
  { name: 'night-forest', time: 'night', x: 150, z: 205, facing: 0.9, camPitch: 0.12, camDist: 9 },

  // --- dusk / sunset (impostors + vista, ultra tier) ---------------------
  // Coast at dusk: the sprite lighting fix means sprites keep their colour
  // instead of blowing out to white.
  // z=-186 and beyond is already open sea (the client starts nagging you to swim
  // back), so these sit up on the sand at z=-172. Facing PI/2 is WEST here, which
  // is where the setting sun actually is: facing south just shoots empty sky.
  {
    name: 'dusk-sprites',
    time: '0.28',
    x: -40,
    z: -172,
    facing: Math.PI / 2,
    camPitch: 0.06,
    camDist: 10,
  },
  // Sunset over water: deep amber, no clipped white sky bands.
  {
    name: 'sunset-crossing',
    time: '0.65',
    x: -40,
    z: -155,
    facing: Math.PI / 2,
    camPitch: 0.1,
    camDist: 10,
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const problems = [];
page.on('pageerror', (e) => {
  problems.push(`PAGEERROR ${e.message.slice(0, 300)}`);
});
page.on('console', (m) => {
  const t = m.text();
  if (/failed to compile|THREE\.WebGLProgram|WebGL context lost/i.test(t)) {
    problems.push(`CONSOLE ${t.slice(0, 300)}`);
  }
});

// SwiftShader stalls the boot outright maybe one run in two on this machine, so
// a single attempt makes the whole harness look broken. Reload and try again.
console.log(`[boot] ${URL} (tier ${GFX}, batch ${TIME})`);
let booted = false;
for (let attempt = 1; attempt <= 3 && !booted; attempt++) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: BOOT_MS });
  booted = await enterOfflineGame(page, {
    charName: 'Surveyor',
    settleMs: 3000,
    gameBootTimeoutMs: BOOT_MS,
    selectorTimeoutMs: 60000,
  }).catch(() => false);
  if (!booted) console.log(`[boot] attempt ${attempt} stalled, retrying`);
}
if (!booted) {
  console.log('BOOT-FAILED: window.__game never appeared after 3 attempts');
  await browser.close();
  process.exit(3);
}

// enterOfflineGame leaves the Game Menu open headless (the Escape it presses to
// skip the intro cinematic lands on the options window instead). Close it, and
// verify, rather than blind-toggling it back open.
for (let i = 0; i < 3; i++) {
  const open = await page.evaluate(() => {
    const g = window.__game;
    g.hud?.closeOptions?.();
    return !!document.querySelector('.window.options, #options-window:not([hidden])');
  });
  if (!open) break;
  await page.evaluate(() => window.__game.hud?.toggleOptionsMenu?.());
  await sleep(300);
}
await sleep(500);

// A dead player paints the death overlay and a red grade over the whole frame,
// which is useless as a lighting capture. Two things kill the survey character:
// camp mobs, and the long drop we use to land them on real terrain. Top the HP up
// and keep resetting fallStartY, which is what player_motion.ts measures the fall
// against, so the landing never registers as a drop.
await page.evaluate(() => {
  if (window.__shotKeepAlive) return;
  window.__shotKeepAlive = setInterval(() => {
    const p = window.__game?.sim?.player;
    if (!p) return;
    p.maxHp = 999999;
    p.hp = 999999;
    p.fallStartY = p.pos.y;
  }, 100);
});

// SCAN=cx,cz,radius,step prints the terrain height grid around a point, by
// walking the player over it and reading back the height the sim resolves. Used
// to find a real clifftop instead of guessing a vantage and shooting rock.
if (process.env.SCAN) {
  const [cx, cz, rad, step] = process.env.SCAN.split(',').map(Number);
  const rows = [];
  for (let z = cz - rad; z <= cz + rad; z += step) {
    const row = [];
    for (let x = cx - rad; x <= cx + rad; x += step) {
      const y = await page.evaluate(
        (px, pz) => {
          const p = window.__game.sim.player;
          p.pos.x = px;
          p.pos.z = pz;
          p.prevPos = { ...p.pos };
          return null;
        },
        x,
        z,
      );
      void y;
      await sleep(160);
      const h = await page.evaluate(() => window.__game.sim.player.pos.y);
      row.push(`${x}:${h.toFixed(1)}`);
    }
    rows.push(`z=${z}  ${row.join('  ')}`);
  }
  console.log(rows.join('\n'));
  await browser.close();
  process.exit(0);
}

if (PROBE) {
  const probe = await page.evaluate(() => {
    const g = window.__game;
    const w = g.sim?.world ?? g.sim;
    const out = { keys: Object.keys(g), towns: null, zones: null, biome: null };
    try {
      out.towns = (w.zones ?? w.getZones?.() ?? []).slice(0, 12).map((z) => ({
        id: z.id,
        name: z.name,
        x: z.hub?.x ?? z.center?.x,
        z: z.hub?.z ?? z.center?.z,
      }));
    } catch (e) {
      out.towns = String(e);
    }
    try {
      const r = g.renderer;
      out.biome = { godRays: Array.isArray(r?.godRays) ? r.godRays.length : typeof r?.godRays };
    } catch (e) {
      out.biome = String(e);
    }
    return out;
  });
  console.log(JSON.stringify(probe, null, 2));
  await browser.close();
  process.exit(0);
}

/** Drive the /daynight dev command through a REAL click plus a real Enter, and
 *  confirm the command actually landed by watching the chat log grow. Dispatching
 *  a synthetic Enter at an unfocused input silently no-ops. */
async function setTimeOfDay(arg) {
  const marker = `time of day set to ${arg}`;
  const before = await page.evaluate(
    (m) => (document.querySelector('#chatlog')?.textContent ?? '').split(m).length - 1,
    marker,
  );
  // The chat input is collapsed until chat is opened, so it has no clickable
  // point yet: press Enter on the canvas first (the player's own gesture), then
  // click the now-visible input so the Enter that submits lands on a focused field.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Enter');
  await sleep(500);
  await page.click('#chat-input').catch(async () => {
    await page.focus('#chat-input');
  });
  await sleep(200);
  await page.evaluate((a) => {
    const c = document.querySelector('#chat-input');
    c.value = `/daynight ${a}`;
    c.dispatchEvent(new Event('input', { bubbles: true }));
  }, arg);
  await page.keyboard.press('Enter');
  const took = await page
    .waitForFunction(
      (m, n) => (document.querySelector('#chatlog')?.textContent ?? '').split(m).length - 1 > n,
      { timeout: 15000 },
      marker,
      before,
    )
    .then(() => true)
    .catch(() => false);
  if (!took) throw new Error(`/daynight ${arg} did not register in #chatlog`);
  await page.evaluate(() => document.querySelector('#chat-input')?.blur());
  console.log(`[time] /daynight ${arg} confirmed`);
  await sleep(12000); // the grade lerps in
}

const loaderUp = () =>
  page.evaluate(() => {
    const el = document.querySelector('#loading-screen');
    if (!el) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.01;
  });

/** Block until the streaming loading screen is down. Returns false (and records
 *  the shot as skipped) when it never clears, so a splash frame never ships. */
async function waitLoaderGone(name) {
  const gone = await page
    .waitForFunction(
      () => {
        const el = document.querySelector('#loading-screen');
        if (!el) return true;
        const cs = getComputedStyle(el);
        return cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) <= 0.01;
      },
      { timeout: 240000, polling: 500 },
    )
    .then(() => true)
    .catch(() => false);
  if (!gone) {
    problems.push(`LOADER-STUCK ${name}: #loading-screen never cleared`);
    console.log(`[warn] ${name}: loading screen never cleared, skipping`);
  }
  return gone;
}

/** Put the player at the vantage. Safe to call twice: a long teleport can rebuild
 *  the world (and replace window.__game), which resets position and camera. */
async function place(shot) {
  await page.evaluate((s) => {
    const g = window.__game;
    const p = g.sim.player;
    p.maxHp = 99999;
    p.hp = 99999;
    p.pos.x = s.x;
    p.pos.z = s.z;
    p.prevPos = { ...p.pos };
    p.facing = s.facing ?? 0;
    g.input.camYaw = s.facing ?? 0;
    if (s.camPitch !== undefined) g.input.camPitch = s.camPitch;
    if (s.camDist !== undefined && 'camDist' in g.input) g.input.camDist = s.camDist;
  }, shot);
}

/** Walk to the vantage in short hops instead of one long teleport.
 *
 *  A single far jump lands on a chunk the sim has not streamed yet, so it
 *  resolves a FALLBACK ground height while the renderer draws the real terrain:
 *  the camera ends up buried inside a cliff, with the player reporting a height
 *  that has nothing to do with what is on screen. Hopping keeps every step inside
 *  loaded terrain, which is the only way the sim's ground stays truthful. */
async function hopTo(shot, stepYd = 40) {
  for (let i = 0; i < 400; i++) {
    const arrived = await page.evaluate(
      (s, step) => {
        const p = window.__game?.sim?.player;
        if (!p) return false;
        const dx = s.x - p.pos.x;
        const dz = s.z - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.0) return true;
        const k = Math.min(step, d) / d;
        p.pos.x += dx * k;
        p.pos.z += dz * k;
        p.prevPos = { ...p.pos };
        return false;
      },
      shot,
      stepYd,
    );
    if (arrived) return true;
    await sleep(220);
  }
  problems.push(`NO-ARRIVAL ${shot.name}: hop walk never reached the vantage`);
  return false;
}

async function shoot(shot) {
  await hopTo(shot);
  // A long teleport raises the streaming loading screen a beat LATER, so waiting
  // for "hidden" straight away passes before the loader is even up and the frame
  // lands on the splash art. Give it a grace period to appear, then wait it out.
  await sleep(2500);
  if (!(await waitLoaderGone(shot.name))) return;
  // Crossing that many zones can rebuild the world and replace window.__game, in
  // which case the teleport we just did is gone with it: wait for the new world,
  // then put the camera back where the shot wants it.
  const back = await page
    .waitForFunction(() => window.__game?.sim?.player, { timeout: 90000, polling: 500 })
    .then(() => true)
    .catch(() => false);
  if (!back) {
    problems.push(`NO-WORLD ${shot.name}: window.__game never came back after the load`);
    console.log(`[warn] ${shot.name}: world hook never returned, skipping`);
    return;
  }
  // A rebuilt world is a fresh renderer, so it comes back at the default time of
  // day and the batch's grade has to be re-asserted (and re-verified).
  const rebuilt = await page.evaluate(() => {
    const same = window.__shotGame === window.__game;
    window.__shotGame = window.__game;
    return !same;
  });
  if (rebuilt) {
    console.log(`[warn] ${shot.name}: world was rebuilt, re-asserting /daynight ${TIME}`);
    await setTimeOfDay(TIME);
  }
  // A rebuild teleports the player home, so re-walk before aiming.
  if (rebuilt) await hopTo(shot);
  await place(shot);
  // Terrain and water stream in around the new position; give them real time.
  await sleep(shot.settleMs ?? 6000);
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      const t = (b.textContent ?? '').trim().toLowerCase();
      if (t === 'confirm' || t === 'skip tutorial' || t === 'dismiss') b.click();
    }
    document.querySelector('.tut-skip')?.click();
    for (const el of document.querySelectorAll('.mail-banner, .toast, .announce')) el.remove();
  });
  await sleep(800);
  // Last gate before the shutter: the loader can come back up mid-settle.
  if (await loaderUp()) {
    if (!(await waitLoaderGone(shot.name))) return;
    await sleep(4000);
  }
  // Never commit a frame shot through the death overlay's red grade.
  // #death-overlay lives in the DOM permanently and is toggled by display, so
  // presence proves nothing: read the computed style.
  const dead = await page.evaluate(() => {
    const el = document.querySelector('#death-overlay');
    const shown = !!el && getComputedStyle(el).display !== 'none';
    return !!window.__game.sim.player.dead || shown;
  });
  if (dead) {
    problems.push(`DEAD ${shot.name}: player died at the vantage, frame not usable`);
    console.log(`[warn] ${shot.name}: player dead, skipping`);
    return;
  }
  const suffix = GODRAYS === 'off' ? '-norays' : '';
  const file = `${OUT}/${shot.name}${suffix}.png`;
  await page.screenshot({ path: file });
  const state = await page.evaluate(() => {
    const p = window.__game.sim.player;
    return `${p.pos.x.toFixed(1)},${p.pos.y.toFixed(2)},${p.pos.z.toFixed(1)}`;
  });
  console.log(`[shot] ${file}  player=${state}`);
}

const batch = SHOTS.filter((s) => s.time === TIME).filter(
  (s) => ONLY.length === 0 || ONLY.includes(s.name),
);
if (batch.length === 0) {
  console.log(`no shots match TIME=${TIME} ONLY=${ONLY.join(',')}`);
  await browser.close();
  process.exit(2);
}

await page.evaluate(() => {
  window.__shotGame = window.__game;
});
await setTimeOfDay(TIME);

if (GODRAYS === 'off') {
  const hidden = await page.evaluate(() => {
    const r = window.__game.renderer;
    let n = 0;
    if (Array.isArray(r.godRays)) {
      for (const sp of r.godRays) {
        sp.visible = false;
        n++;
      }
    } else if (r.godRays && 'visible' in r.godRays) {
      r.godRays.visible = false;
      n = 1;
    }
    return n;
  });
  console.log(`[godrays] hid ${hidden} sprite(s)`);
  if (hidden === 0) problems.push('GODRAYS: nothing hidden, renderer.godRays not reachable');
}

for (const shot of batch) {
  await shoot(shot);
  // GODRAYS=both shoots the A/B pair inside ONE session. Across two runs the sea
  // surface animates independently, so a pixel diff of two separate boots is
  // dominated by waves and says nothing about the god rays.
  if (GODRAYS === 'both') {
    const hidden = await page.evaluate(() => {
      const r = window.__game.renderer;
      let n = 0;
      if (Array.isArray(r.godRays)) {
        for (const sp of r.godRays) {
          sp.visible = false;
          n++;
        }
      } else if (r.godRays && 'visible' in r.godRays) {
        r.godRays.visible = false;
        n = 1;
      }
      return n;
    });
    console.log(`[godrays] hid ${hidden} sprite(s) for the A/B`);
    await sleep(1500);
    await page.screenshot({ path: `${OUT}/${shot.name}-norays.png` });
    console.log(`[shot] ${OUT}/${shot.name}-norays.png`);
    await page.evaluate(() => {
      const r = window.__game.renderer;
      if (Array.isArray(r.godRays)) for (const sp of r.godRays) sp.visible = true;
      else if (r.godRays && 'visible' in r.godRays) r.godRays.visible = true;
    });
  }
}

if (problems.length) {
  console.log('--- problems ---');
  for (const p of [...new Set(problems)].slice(0, 15)) console.log(p);
}
await browser.close();
