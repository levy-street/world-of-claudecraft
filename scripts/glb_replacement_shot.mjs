// Close-up screenshot tour for the 11 procedural -> Tripo-generated GLB
// replacements (PR: feat(render) replace procedural models with
// Tripo-generated GLBs). Each shot is framed tight on the single model with
// the player character standing next to it for scale, at max graphics
// (Ultra preset, terrain/foliage/effects/shadow sliders maxed).
//
// Ambient critters/fish/gather-nodes/mailbox use their real world coordinates
// from src/sim/content/. The three delve-instance props (cracked grave,
// destructible wall, fallback crate) have no fixed overworld spawn: this
// script injects a synthetic ground-object entity with the matching
// `delve_<kind>` templateId directly via ctx.addEntity/rebucket (the
// renderer dispatches purely on `e.kind === 'object' && templateId.startsWith
// ('delve_')`, see src/render/renderer.ts, so no active delve run is needed).
//
// Each shot boots its own fresh browser + offline session (slower, but
// resilient to the host's memory pressure crashing a shared long-lived tab
// mid-tour). Skips a shot if its output file already exists, so a partial
// prior run can resume. Needs `npm run dev` (:5173). Writes PNGs to
// docs/screenshots/glb-model-replacement/.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/glb-model-replacement';
fs.mkdirSync(OUT, { recursive: true });

const MAX_SETTINGS = {
  graphicsPreset: 4, // Ultra
  terrainDetail: 1,
  foliageDensity: 1,
  effectsQuality: 1,
  shadowQuality: 1,
  brightness: 1,
};

async function shotOnce(file, viewport, place) {
  if (fs.existsSync(file)) {
    console.log('skip (exists):', file);
    return true;
  }
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: [
      `--window-size=${viewport.width},${viewport.height}`,
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
    ],
    defaultViewport: viewport,
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
    // Force max graphics before any app script runs: main.ts reads
    // graphicsPreset from localStorage during startup (controls preload).
    await page.evaluateOnNewDocument((settings) => {
      localStorage.setItem('woc_settings', JSON.stringify(settings));
    }, MAX_SETTINGS);
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => document.querySelector('#btn-offline').click());
    await new Promise((r) => setTimeout(r, 200));
    await page.type('#char-name', 'Ranger');
    await page.evaluate(() =>
      document.querySelector('#offline-select .mini-class[data-class="warrior"]').click(),
    );
    await page.evaluate(() => document.querySelector('#btn-start-offline').click());
    await new Promise((r) => setTimeout(r, 800));
    // Mobile-only "Play in Landscape Fullscreen" interstitial blocks boot.
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const cont = btns.find((b) => /continue to game/i.test(b.textContent || ''));
      if (cont) cont.click();
    });
    await page.waitForFunction(() => window.__game && window.__game.sim, { timeout: 25000 });
    // A fresh offline character plays the first-spawn intro cinematic, which
    // overrides input.camYaw/camPitch/camDist every frame until it finishes
    // (src/main.ts introCameraTick). Escape skips it immediately so our own
    // camera placement below isn't clobbered a frame later.
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 1500));
    // Dismiss the new-character tutorial popup so it doesn't cover the shot.
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const skip = btns.find((b) => /skip tutorial/i.test(b.textContent || ''));
      if (skip) skip.click();
    });
    await place(page);
    await page.screenshot({ path: file });
    console.log('wrote', file);
    return true;
  } catch (err) {
    console.log('FAILED', file, String(err && err.message ? err.message : err));
    return false;
  } finally {
    await browser.close().catch(() => {});
  }
}

// Stand the player at a fixed short distance from the model at
// (targetX, targetZ), facing it, with the camera orbited off to one side
// (not directly behind the player's facing) so the character's silhouette
// does not block the model it is standing next to, at a close, zoomed-in
// distance so both dominate the frame.
async function standNextTo(
  page,
  targetX,
  targetZ,
  { standOffX = 3.6, standOffZ = -3.6, yawOffset = 0.6 } = {},
) {
  const x = targetX + standOffX;
  const z = targetZ + standOffZ;
  await page.evaluate(
    (x, z, faceX, faceZ, yawOffset) => {
      const g = window.__game;
      const p = g.sim.player;
      p.pos.x = x;
      p.pos.z = z;
      p.hp = p.maxHp = 999999;
      const facingToTarget = Math.atan2(faceX - x, faceZ - z);
      p.facing = facingToTarget;
      // camYaw drives the camera's orbit angle around the player independent
      // of p.facing (mouse-orbit/free-look): offsetting it from the
      // straight-behind angle gives a 3/4 view where the model sits beside
      // the character in frame instead of directly behind their back.
      g.input.camYaw = facingToTarget + yawOffset;
      // renderer.camPitch/camDist are overwritten from input.camPitch/camDist
      // every frame in main.ts, so the zoom/angle must be set on input, not
      // on the renderer directly (a direct renderer write is clobbered next
      // frame). A slightly elevated pitch (renderer's own default is 0.32)
      // keeps the player's head from filling the frame at close range while
      // still reading as a tight, zoomed-in shot.
      g.input.camPitch = 0.3;
      g.input.camDist = 4.5;
    },
    x,
    z,
    targetX,
    targetZ,
    yawOffset,
  );
  await new Promise((r) => setTimeout(r, 2500));
  // The follow-camera settles camYaw toward the player's facing over several
  // frames whenever facing just changed (src/game/camera_follow.ts
  // updateFollowCameraYaw), which would drag our off-axis orbit back toward
  // "directly behind the player" during the wait above. Re-assert the exact
  // camYaw once more now that facing is no longer changing frame to frame,
  // so nothing pulls it back before the shot.
  await page.evaluate(
    (faceX, faceZ, x, z, yawOffset) => {
      const g = window.__game;
      const facingToTarget = Math.atan2(faceX - x, faceZ - z);
      g.input.camYaw = facingToTarget + yawOffset;
    },
    targetX,
    targetZ,
    x,
    z,
    yawOffset,
  );
  await new Promise((r) => setTimeout(r, 400));
}

// Ambient critters/fish are RENDER-ONLY (src/render/critters.ts, fish.ts): a
// pool that relocates near whichever position the player currently occupies,
// with no fixed sim/world coordinate to target. Rather than guess a world
// spot and hope one has wandered into frame, place the player nearby, let the
// pool relocate, then read back the actual live instance position from the
// renderer's THREE group (each instance is `visible` only while active/in
// range) and target THAT position directly.
async function findNearestVisible(page, rendererField, px, pz, excludeKeys = []) {
  return page.evaluate(
    (rendererField, px, pz, excludeKeys) => {
      const g = window.__game;
      const field = g.renderer[rendererField];
      if (!field || !field.group) return null;
      let best = null;
      let bestD = Infinity;
      for (const child of field.group.children) {
        if (!child.visible) continue;
        const key = `${child.position.x.toFixed(1)},${child.position.z.toFixed(1)}`;
        if (excludeKeys.includes(key)) continue;
        const dx = child.position.x - px;
        const dz = child.position.z - pz;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = { x: child.position.x, z: child.position.z, key };
        }
      }
      return best;
    },
    rendererField,
    px,
    pz,
    excludeKeys,
  );
}

// Park the player at a settle spot, wait for the ambient pool to relocate
// nearby, then poll for a visible instance (fish only surface briefly mid-leap,
// so this retries for a few seconds rather than sampling once).
async function waitForVisibleInstance(page, rendererField, px, pz, excludeKeys = [], tries = 8) {
  for (let i = 0; i < tries; i++) {
    const found = await findNearestVisible(page, rendererField, px, pz, excludeKeys);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

// Inject a synthetic delve-interactable ground object at (x, z) so the
// templateId-driven GLB prop (cracked grave / destructible wall / fallback
// crate) renders without needing a live delve run.
async function spawnDelveProp(page, kind, x, z) {
  await page.evaluate(
    (kind, x, z) => {
      const sim = window.__game.sim;
      const ctx = sim.ctx;
      const id = ctx.nextId++;
      const obj = {
        id,
        kind: 'object',
        templateId: `delve_${kind}`,
        name: kind,
        level: 1,
        pos: { x, y: 0, z },
        prevPos: { x, y: 0, z },
        facing: 0,
        prevFacing: 0,
        vx: 0,
        vz: 0,
        vy: 0,
        onGround: true,
        jumping: false,
        fallStartY: 0,
        hp: kind === 'destructible_wall' ? 80 : 1,
        maxHp: kind === 'destructible_wall' ? 80 : 1,
        resource: 0,
        maxResource: 0,
        resourceType: null,
        overheadEmoteId: null,
        overheadEmoteUntil: 0,
        overheadEmoteSeq: 0,
        stats: { str: 0, agi: 0, sta: 0, int: 0, spi: 0, armor: 0 },
        weapon: { min: 1, max: 2, speed: 2 },
        attackPower: 0,
        rangedPower: 0,
        spellPower: 0,
        meleeHaste: 0,
        rangedHaste: 0,
        spellHaste: 0,
        setProcs: [],
        procReadyAt: {},
        critChance: 0.05,
        critRating: 0,
        hasteRating: 0,
        dodgeChance: 0.05,
        castPushbackReduction: 0,
        knockbackResistance: 0,
        moveSpeed: 7,
        hostile: false,
        targetId: null,
        autoAttack: false,
        swingTimer: 0,
        inCombat: false,
        combatTimer: 99,
        auras: [],
        stealthed: false,
        ccDr: new Map(),
        castingAbility: null,
        castRemaining: 0,
        castTotal: 0,
        castTargetId: null,
        castAim: null,
        channeling: false,
        channelTickTimer: 0,
        channelTickEvery: 0,
        gcdRemaining: 0,
        cooldowns: new Map(),
        dead: false,
        lootable: kind === 'cracked_grave' || kind === 'destructible_wall',
      };
      ctx.entities.set(id, obj);
      ctx.rebucket(obj);
    },
    kind,
    x,
    z,
  );
}

const DESKTOP = { width: 1600, height: 900 };
const MOBILE = { width: 844, height: 390, isMobile: true, hasTouch: true };

// Teleport the player to (x, z) with no camera framing yet, just to trigger
// the ambient critter/fish pool (src/render/critters.ts, fish.ts) to relocate
// near the new position, then give it a moment to do so.
async function settleAt(page, x, z) {
  await page.evaluate(
    (x, z) => {
      const p = window.__game.sim.player;
      p.pos.x = x;
      p.pos.z = z;
      p.hp = p.maxHp = 999999;
    },
    x,
    z,
  );
  await new Promise((r) => setTimeout(r, 2000));
}

// One close-up shot per replaced model. Coordinates for ambient/gather/mailbox
// content are the real overworld spots from src/sim/content/. Delve props are
// injected at a quiet spot away from other content.
// CRITTER_SPOT/FISH_SPOT are settle points (real Eastbrook meadow ground and
// the Eastbrook Vale shoreline respectively), not the model's own position:
// critters and fish are render-only ambient pools that relocate near whatever
// spot the player currently occupies (see findNearestVisible above).
const CRITTER_SPOT = { x: 20, z: 40 };
const FISH_SPOT = { x: -104, z: 300 };
// The actual gather-node/mailbox entity coordinates (src/sim/content/gather_nodes.ts
// ore_eastbrook_1, wood_eastbrook_1, herb_eastbrook_1; src/sim/content/mailboxes.ts
// Eastbrook). An earlier version of this script mistakenly used the CAMERA'S
// stand-near position as the target, which put the actual model off to the
// side out of frame; these are the model's real position.
const ORE_SPOT = { x: 72, z: 8 };
const WOOD_SPOT = { x: -62, z: 8 };
const HERB_SPOT = { x: -86, z: 90 };
const MAILBOX_SPOT = { x: 7, z: -8 };
const DELVE_PROP_SPOT = { x: 40, z: -60 };

// Find up to `count` distinct visible critter/fish instances near a settle
// spot and shoot each at its own real live position.
async function critterShot(page, excludeKeys) {
  await settleAt(page, CRITTER_SPOT.x, CRITTER_SPOT.z);
  const found = await waitForVisibleInstance(
    page,
    'critters',
    CRITTER_SPOT.x,
    CRITTER_SPOT.z,
    excludeKeys,
  );
  // Critters bolt once the player gets within FLEE_DIST (6 units,
  // src/render/critters.ts): standNextTo's default ~5-unit approach distance
  // would spook it mid-settle-wait and it would be gone by the time the
  // shutter fires. Stand just outside the flee radius instead.
  const critterStandOpts = { standOffX: 5, standOffZ: -5, yawOffset: 0.4 };
  if (found) {
    excludeKeys.push(found.key);
    await standNextTo(page, found.x, found.z, critterStandOpts);
  } else {
    // Fallback: no instance turned up (pool empty/culled this run); still
    // frame the settle spot rather than leaving the camera undefined.
    await standNextTo(page, CRITTER_SPOT.x, CRITTER_SPOT.z, critterStandOpts);
  }
}

async function fishShot(page) {
  await settleAt(page, FISH_SPOT.x, FISH_SPOT.z);
  const found = await waitForVisibleInstance(page, 'fish', FISH_SPOT.x, FISH_SPOT.z, [], 10);
  const target = found ?? FISH_SPOT;
  await standNextTo(page, target.x, target.z, { standOffX: 3, standOffZ: 0 });
}

const critterExcludeKeys = [];

const desktopShots = [
  {
    file: 'critter-rabbit-desktop.png',
    place: (p) => critterShot(p, critterExcludeKeys),
  },
  {
    file: 'critter-squirrel-desktop.png',
    place: (p) => critterShot(p, critterExcludeKeys),
  },
  {
    file: 'critter-songbird-desktop.png',
    place: (p) => critterShot(p, critterExcludeKeys),
  },
  {
    file: 'fish-leaping-desktop.png',
    place: (p) => fishShot(p),
  },
  {
    file: 'gather-node-ore-desktop.png',
    place: (p) => standNextTo(p, ORE_SPOT.x, ORE_SPOT.z),
  },
  {
    file: 'gather-node-wood-desktop.png',
    place: (p) => standNextTo(p, WOOD_SPOT.x, WOOD_SPOT.z),
  },
  {
    file: 'gather-node-herb-desktop.png',
    // The default NE stand offset puts the player in Mirror Lake next door;
    // approach from the south instead to stay on dry ground.
    place: (p) => standNextTo(p, HERB_SPOT.x, HERB_SPOT.z, { standOffX: -1, standOffZ: -5 }),
  },
  {
    file: 'mailbox-eastbrook-desktop.png',
    place: (p) =>
      standNextTo(p, MAILBOX_SPOT.x, MAILBOX_SPOT.z, { standOffX: 2.6, standOffZ: -2.6 }),
  },
  {
    file: 'delve-cracked-grave-desktop.png',
    place: async (p) => {
      const x = DELVE_PROP_SPOT.x;
      const z = DELVE_PROP_SPOT.z;
      await spawnDelveProp(p, 'cracked_grave', x, z);
      // The grave prop reads taller/wider up close than the crate does, so
      // the default approach distance put the camera almost inside it.
      await standNextTo(p, x, z, { standOffX: 4.4, standOffZ: -4.4 });
    },
  },
  {
    file: 'delve-destructible-wall-desktop.png',
    place: async (p) => {
      const x = DELVE_PROP_SPOT.x + 8;
      const z = DELVE_PROP_SPOT.z;
      await spawnDelveProp(p, 'destructible_wall', x, z);
      // The wall prop is a wide masonry section: stand back further so the
      // camera clears it instead of clipping through at the default distance.
      await standNextTo(p, x, z, { standOffX: 4.8, standOffZ: -4.8 });
    },
  },
  {
    file: 'delve-fallback-crate-desktop.png',
    place: async (p) => {
      const x = DELVE_PROP_SPOT.x + 16;
      const z = DELVE_PROP_SPOT.z;
      // Any templateId not matched by buildDelveInteractable's switch falls
      // through to the fallback-crate default case (src/render/delve_props.ts).
      await spawnDelveProp(p, 'unmatched_prop_shot', x, z);
      await standNextTo(p, x, z);
    },
  },
];

const mobileShots = [
  {
    file: 'critter-rabbit-mobile.png',
    place: (p) => critterShot(p, []),
  },
  {
    file: 'fish-leaping-mobile.png',
    place: (p) => fishShot(p),
  },
  {
    file: 'mailbox-eastbrook-mobile.png',
    place: (p) =>
      standNextTo(p, MAILBOX_SPOT.x, MAILBOX_SPOT.z, { standOffX: 2.6, standOffZ: -2.6 }),
  },
];

const results = [];
for (const s of desktopShots) {
  const file = path.join(OUT, s.file);
  const ok = await shotOnce(file, DESKTOP, s.place);
  results.push({ file, ok });
}
for (const s of mobileShots) {
  const file = path.join(OUT, s.file);
  const ok = await shotOnce(file, MOBILE, s.place);
  results.push({ file, ok });
}

const okCount = results.filter((r) => r.ok).length;
console.log(`\n${okCount}/${results.length} shots captured`);
for (const r of results) console.log(' -', r.ok ? 'OK  ' : 'FAIL', r.file);
if (okCount < results.length) process.exitCode = 1;
