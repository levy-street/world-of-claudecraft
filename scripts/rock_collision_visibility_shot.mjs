// Before/after proof for the Low-graphics invisible-but-solid rock bug.
//
// A collider-eligible scatter rock (sim/colliders.ts gives every rock at or
// above ROCK_COLLIDER_MIN_SCALE a real collider, sim/decoration_dims.ts) used
// to be subject to the SAME hash-based triangle-count trim as pure decorative
// dressing on GFX.leanFoliage tiers (src/render/foliage.ts buildTrees), so a
// player on Low graphics could walk up to an empty patch of ground and be
// blocked by a rock they cannot see. Root CLAUDE.md's graphics-fairness
// invariant forbids a preset from hiding anything a player acts on, and a
// collision you cannot see is the sharpest version of that: the fix exempts
// any rock with a real collider from the trim (src/render/foliage_decimation_core.ts).
//
// Boots an offline warrior at the LOWEST graphics preset (matching the
// maintainer's standing capture rule), then picks its target rock LIVE from
// the running client's own module graph (dynamic import of the same
// /src/sim/world.ts URL the app already loaded), rather than a hardcoded
// coordinate: it queries the real WORLD_SEED, finds a decoration that is
// kind 'rock', decorationHasCollider() says is solid, in the open field away
// from any authored camp/mine content, and whose own placement hash the
// pre-fix trim actually drops on Low. That keeps the script self-verifying
// (it fails loudly if no such rock exists on the live seed, rather than
// silently shooting empty grass) and immune to float-rounding drift between
// a hardcoded constant and the generator's full-precision coordinates.
//
// A scene-graph probe (does an InstancedMesh instance exist at the EXACT
// live coordinates, within a tolerance far tighter than the spacing between
// unrelated grass/dressing instances) prints ground truth before each shot,
// so the screenshot pairs with a verifiable, non-visual assertion rather than
// a human eyeballing pixels.
//
// Run once on the fix and once on the pre-fix tree (see the PR body for the
// exact before/after commands) to get the pair. Needs `npm run dev`
// (override with GAME_URL). Writes to tmp/.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT_SLUG = process.env.SHOT_SLUG ?? 'after';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const APPROACH_OFFSET = 4; // stand this many yards south of the rock, close enough the gap reads clearly

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

// Seed the LOWEST graphics preset before the app boots: this is where
// GFX.leanFoliage triggers the trim the fix scopes. graphicsDefaultApplied
// must be seeded true too, or main.ts's first-run device auto-detection
// (firstRunGraphicsPreset) overwrites this the moment the world boots.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem(
      'woc_settings',
      JSON.stringify({ graphicsPreset: 1, graphicsDefaultApplied: true }),
    );
  } catch {
    /* ignore */
  }
});

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Prospector' });
if (!booted) throw new Error('offline world did not boot');
await sleep(800);

async function frame() {
  await page.screenshot({ path: 'tmp/_frame.png' });
}

function dismissPerfBanner() {
  return page.evaluate(() => {
    const dismiss = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Dismiss',
    );
    dismiss?.click();
  });
}

// Pick the target rock LIVE, from the exact code and seed the running client
// uses (dynamic import of an already-loaded Vite module URL reuses the
// browser's own module instance, not a fresh reimplementation), so the
// picked coordinates are full precision and provably match the live world.
const target = await page.evaluate(async () => {
  const worldMod = await import('/src/sim/world.ts');
  const dimsMod = await import('/src/sim/decoration_dims.ts');
  const dataMod = await import('/src/sim/data.ts');
  const seed = window.__game.sim.cfg.seed;
  function hashAt(a, b, k) {
    const s = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453123;
    return s - Math.floor(s);
  }
  // Inlined rather than calling dimsMod.decorationHasCollider: this script's
  // own before/after protocol runs it once on the pre-fix tree, where that
  // export does not exist yet (it is what the fix adds). ROCK_COLLIDER_MIN_SCALE
  // itself is unchanged by the fix, so this is safe to inline on both trees.
  const hasCollider = (d) => d.kind !== 'rock' || d.scale >= dimsMod.ROCK_COLLIDER_MIN_SCALE;
  // Clear of any mob camp's aggro range (a hostile skeleton wandering into
  // frame, or the character taking damage mid-capture, would make the shot
  // ambiguous about what it is proving), away from Eastbrook's mine complex
  // (authored boulder props would sit in frame and make it ambiguous which
  // rock is which), and flat Vale ground rather than the Gale's cliffs
  // (confirmed clear by a one-off diagnostic query against the live seed;
  // the box is deliberately tight around that known-good spot rather than
  // wide, since a wide box risks landing back on a cliff edge or camp).
  const farFromCamps = (x, z) =>
    dataMod.CAMPS.every((c) => Math.hypot(x - c.center.x, z - c.center.z) > c.radius + 40);
  const candidates = worldMod
    .generateDecorationsInBounds(seed, { minX: 140, maxX: 220, minZ: -80, maxZ: 0 })
    .filter((d) => d.kind === 'rock' && hasCollider(d) && farFromCamps(d.x, d.z))
    .map((d) => ({ ...d, hashDraw: hashAt(d.x, d.z, 83) }))
    .filter((d) => d.hashDraw >= 0.55); // dropped on Low (leanFoliage, non-standardMaterials) pre-fix
  if (candidates.length === 0) return null;
  const pick = candidates[0];
  return { x: pick.x, z: pick.z, scale: pick.scale, biome: pick.biome, hashDraw: pick.hashDraw };
});
if (!target) throw new Error('no collider-eligible, pre-fix-dropped rock found in the search box');
console.log('target rock:', JSON.stringify(target));

const state = await page.evaluate(
  ({ x, z, rockX, rockZ }) => {
    const g = window.__game;
    g.sim.setPlayerLevel(60); // a stray roadside mob must not decide a capture
    const p = g.sim.player;
    const idle = {
      forward: false,
      back: false,
      turnLeft: false,
      turnRight: false,
      strafeLeft: false,
      strafeRight: false,
      jump: false,
    };
    p.pos.x = x;
    p.pos.z = z;
    p.pos.y += 15;
    p.prevPos = { ...p.pos };
    p.fallStartY = p.pos.y;
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.onGround = false;
    p.jumping = false;
    for (let i = 0; i < 200 && !p.onGround; i++) {
      p.fallStartY = p.pos.y;
      Object.assign(g.sim.moveInput, idle);
      g.sim.tick();
    }
    p.facing = Math.atan2(rockX - p.pos.x, rockZ - p.pos.z);
    p.prevFacing = p.facing;
    return { onGround: p.onGround, pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z } };
  },
  { x: target.x, z: target.z + APPROACH_OFFSET, rockX: target.x, rockZ: target.z },
);
console.log('teleported:', JSON.stringify(state));
if (!state.onGround) throw new Error('player never settled onto the ground');

// Ground truth: is the rock's InstancedMesh instance actually present in the
// live scene graph? Matched at a tolerance (2cm) far tighter than the spacing
// between distinct decorations or dressing instances, against the exact live
// coordinates above (not a rounded constant), so a match cannot be an
// unrelated grass/dressing instance that happens to sit nearby. (Read the raw
// instanceMatrix floats rather than THREE's own Matrix4/Vector3 classes,
// which are not importable as a bare "three" specifier from a page.evaluate
// callback outside Vite's module graph.)
const probe = await page.evaluate(
  ({ rockX, rockZ }) => {
    const scene = window.__game.renderer.scene;
    const TOL = 0.02;
    let found = null;
    let matches = 0;
    scene.traverse((obj) => {
      if (!obj.isInstancedMesh) return;
      const arr = obj.instanceMatrix.array;
      for (let i = 0; i < obj.count; i++) {
        const x = arr[i * 16 + 12];
        const z = arr[i * 16 + 14];
        if (Math.abs(x - rockX) < TOL && Math.abs(z - rockZ) < TOL) {
          matches++;
          found ??= { meshName: obj.name || '(unnamed)', x, z, visible: obj.visible };
        }
      }
    });
    return { found, matches };
  },
  { rockX: target.x, rockZ: target.z },
);
console.log(
  `rock instance present in scene: ${probe.found ? `YES (${probe.matches} match(es)) ${JSON.stringify(probe.found)}` : 'NO'}`,
);

await dismissPerfBanner();
// Close and elevated, looking down at the rock: the ground right around it
// fills most of the frame regardless of what the surrounding terrain and
// biome happen to look like (open field, coastline, cliff), which a
// grazing eye-level shot is NOT robust to (the picked coordinate is
// data-driven, not hand-placed, so the framing has to tolerate whatever
// terrain the live seed hands it). Bypasses the chase-cam yaw/pivot math
// entirely (fiddly to aim deterministically from a cold teleport) via the
// renderer's editorCam escape hatch: when set, updateCamera() copies it
// verbatim every frame and returns early (same path the map editor's free
// camera uses), so framing is exact and reproducible.
await page.evaluate(
  ({ playerY, rockX, rockZ, camX, camZ }) => {
    const r = window.__game.renderer;
    r.editorCam = {
      pos: { x: camX, y: playerY + 4.5, z: camZ },
      target: { x: rockX, y: playerY + 0.2, z: rockZ },
    };
  },
  {
    playerY: state.pos.y,
    rockX: target.x,
    rockZ: target.z,
    camX: target.x,
    camZ: target.z + 2.5,
  },
);
await frame();
await sleep(200);
await dismissPerfBanner();
// Two more forced paints: bucket visibility (culling / LOD windows) resolves
// against the camera position sync() reads each frame, and the editorCam move
// above happens between paints, so the first post-move frame can still show
// last frame's stale visibility flags.
await frame();
await sleep(100);
await frame();
await page.screenshot({ path: `tmp/rock-visibility-${OUT_SLUG}.png` });
console.log(`wrote tmp/rock-visibility-${OUT_SLUG}.png`);

await browser.close();
