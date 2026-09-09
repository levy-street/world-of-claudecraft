// Before/after proof for the Low-graphics "rocks and bushes vanish at certain
// camera angles" bug (levy-street/world-of-claudecraft#3525, the bucket-cull
// half of the invisible-but-solid class fixed for the decimation trim in PRs
// #3418 and #3526).
//
// On GFX.leanFoliage tiers the rock and dressing InstancedMesh slabs used to be
// culled by comparing the CAMERA's distance to the slab's CENTER against the
// lean rock cap (src/render/foliage_lod.ts bucketVisible). A slab is half the
// world wide (bounding radius ~270-310u) against a cap of ~150-190u, so a
// boulder a stride from the player dropped out, collider and all, whenever the
// camera orbited its slab's center past the cap. The fix measures those rows
// from the slab's NEAR edge and binds their vertex-shader collapse window to
// the same cap (src/render/foliage_frame_windows_core.ts), so the kept slab
// costs vertex early-outs past the cap, not live triangles.
//
// Mirrors scripts/tree_collision_visibility_shot.mjs: picks a collider-bearing
// rock LIVE from the running client's module graph whose slab center is past
// the cap, parks the camera next to it on the far side (camera-to-center is
// then cap + a few strides: the exact orbit angle that popped it), proves via
// a scene-graph probe that the rock instance is drawn (or not), then walks the
// player into it to show the sim's collider blocks either way.
//
// Run once on the fix and once on the pre-fix tree (see the PR body). Needs
// `npm run dev` (override with GAME_URL). Writes to tmp/.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT_SLUG = process.env.SHOT_SLUG ?? 'after';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

// Seed the LOWEST graphics preset before the app boots (GFX.leanFoliage);
// graphicsDefaultApplied keeps main.ts's first-run auto-detect from overriding it.
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
const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Ranger' });
if (!booted) throw new Error('offline world did not boot');
await sleep(800);

async function frame() {
  await page.screenshot({ path: 'tmp/_frame.png' });
}
// The no-GPU banner and the zone greeting dialog both land over the shot.
function dismissPerfBanner() {
  return page.evaluate(() => {
    for (const label of ['Dismiss', 'Understood']) {
      const btn = [...document.querySelectorAll('button')].find(
        (b) => b.textContent.trim() === label,
      );
      btn?.click();
    }
  });
}

// Pick the target rock LIVE. Re-buckets the world the way foliage.ts
// buildTrees() does (two columns split on x < 0, one band per BUCKET_DEPTH
// from WORLD_MIN_Z, bounds over every decoration in the slab) and wants a
// solid, isolated rock whose slab CENTER is past the lean rock cap at the
// Low preset's foliage baseline (LOD_LOW.rockFar * (0.56 + 0.44 * 0.7)), by a
// margin that survives the governor pulling the budget to its floor.
const target = await page.evaluate(async () => {
  const worldMod = await import('/src/sim/world.ts');
  const dataMod = await import('/src/sim/data.ts');
  const dimsMod = await import('/src/sim/decoration_dims.ts');
  const lodMod = await import('/src/render/foliage_lod.ts');
  const seed = window.__game.sim.cfg.seed;
  const BUCKET_DEPTH = 240; // foliage.ts (module-private)
  const CANOPY_MARGIN = 18;
  const decos = worldMod.generateDecorations(seed);
  const slabs = new Map();
  const keyOf = (d) =>
    `${Math.floor((d.z - dataMod.WORLD_MIN_Z) / BUCKET_DEPTH)}:${d.x < 0 ? 0 : 1}`;
  for (const d of decos) {
    const k = keyOf(d);
    let s = slabs.get(k);
    if (!s) {
      s = { minX: d.x, maxX: d.x, minZ: d.z, maxZ: d.z };
      slabs.set(k, s);
    }
    s.minX = Math.min(s.minX, d.x);
    s.maxX = Math.max(s.maxX, d.x);
    s.minZ = Math.min(s.minZ, d.z);
    s.maxZ = Math.max(s.maxZ, d.z);
  }
  const cap = lodMod.LOD_LOW.rockFar * lodMod.foliageDistanceScale(0.7, true);
  const farFromCamps = (x, z) =>
    dataMod.CAMPS.every((c) => Math.hypot(x - c.center.x, z - c.center.z) > c.radius + 40);
  const rocks = decos.filter((d) => d.kind === 'rock');
  const candidates = rocks
    .filter((d) => dimsMod.decorationHasCollider(d) && d.scale >= 1.4 && farFromCamps(d.x, d.z))
    .filter((d) => decos.every((o) => o === d || Math.hypot(o.x - d.x, o.z - d.z) > 7))
    .map((d) => {
      const s = slabs.get(keyOf(d));
      const cx = (s.minX + s.maxX) / 2;
      const cz = (s.minZ + s.maxZ) / 2;
      const radius = Math.hypot(s.maxX - s.minX, s.maxZ - s.minZ) / 2 + CANOPY_MARGIN;
      return { ...d, cx, cz, radius, centerDist: Math.hypot(d.x - cx, d.z - cz) };
    })
    // center past the cap by 30u+ (the camera will stand another ~8u out), but
    // the rock itself well inside the slab so the near-edge rule keeps it
    .filter((d) => d.centerDist > cap + 30 && d.centerDist < d.radius - 30)
    .sort((a, b) => b.scale - a.scale);
  if (candidates.length === 0) return null;
  const pick = candidates[0];
  return {
    x: pick.x,
    z: pick.z,
    scale: pick.scale,
    biome: pick.biome,
    slabCenter: { x: pick.cx, z: pick.cz },
    slabRadius: pick.radius,
    centerDist: pick.centerDist,
    leanRockCap: cap,
  };
});
if (!target) throw new Error('no solid, isolated rock in a slab whose center is past the lean cap');
console.log('target rock:', JSON.stringify(target));

// Unit vector from the slab center through the rock: the camera sits on the
// FAR side of the rock along it, so camera-to-center = centerDist + offset.
const away = {
  x: (target.x - target.slabCenter.x) / target.centerDist,
  z: (target.z - target.slabCenter.z) / target.centerDist,
};
// The player stands BESIDE the rock (perpendicular to the camera line, so
// their own body never sits between the camera and the boulder); the camera
// sits on the far side of the rock along `away`.
const PLAYER_OFFSET = 4;
const CAMERA_OFFSET = 8;
const beside = { x: -away.z, z: away.x };

const state = await page.evaluate(
  ({ x, z, rockX, rockZ }) => {
    const g = window.__game;
    g.sim.setPlayerLevel(60);
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
  {
    x: target.x + beside.x * PLAYER_OFFSET,
    z: target.z + beside.z * PLAYER_OFFSET,
    rockX: target.x,
    rockZ: target.z,
  },
);
console.log('teleported:', JSON.stringify(state));
if (!state.onGround) throw new Error('player never settled onto the ground');

// Ground truth: a rock InstancedMesh instance at the rock's exact live (x, z),
// VISIBLE through every ancestor and undegenerate (the bucket cull flips
// mesh.visible with no per-instance change, so the flag walk is the point).
function probeRockInstance() {
  return page.evaluate(
    ({ rockX, rockZ }) => {
      const scene = window.__game.renderer.scene;
      const TOL = 0.02;
      const all = [];
      scene.traverse((obj) => {
        if (!obj.isInstancedMesh) return;
        const arr = obj.instanceMatrix.array;
        for (let i = 0; i < obj.count; i++) {
          const x = arr[i * 16 + 12];
          const z = arr[i * 16 + 14];
          if (Math.abs(x - rockX) < TOL && Math.abs(z - rockZ) < TOL) {
            let ancestorsVisible = obj.visible;
            for (let p = obj.parent; p; p = p.parent) ancestorsVisible &&= p.visible;
            all.push({ x, z, visible: ancestorsVisible, scaleY: arr[i * 16 + 5] });
          }
        }
      });
      const drawn = all.filter((m) => m.visible && Math.abs(m.scaleY) > 0.01);
      return { matches: all.length, drawnCount: drawn.length, all, drawn };
    },
    { rockX: target.x, rockZ: target.z },
  );
}

await dismissPerfBanner();
// Camera on the far side of the rock, low and close, looking back at it (the
// slab center lies beyond): exactly the orbit position that put camera-to-center
// past the cap. Uses the renderer's editorCam escape hatch for exact framing.
await page.evaluate(
  ({ playerY, rockX, rockZ, camX, camZ }) => {
    const r = window.__game.renderer;
    r.editorCam = {
      pos: { x: camX, y: playerY + 2.4, z: camZ },
      target: { x: rockX, y: playerY + 0.6, z: rockZ },
    };
  },
  {
    playerY: state.pos.y,
    rockX: target.x,
    rockZ: target.z,
    camX: target.x + away.x * CAMERA_OFFSET,
    camZ: target.z + away.z * CAMERA_OFFSET,
  },
);
await frame();
await sleep(200);
await dismissPerfBanner();
await sleep(1000);
await frame();
await sleep(100);
await frame();
await page.screenshot({ path: `tmp/rock-bucket-cull-${OUT_SLUG}.png` });
console.log(`wrote tmp/rock-bucket-cull-${OUT_SLUG}.png`);

const probe = await probeRockInstance();
console.log(
  `camera-to-slab-center ${(target.centerDist + CAMERA_OFFSET).toFixed(1)}u vs lean rock cap ${target.leanRockCap.toFixed(1)}u; slab radius ${target.slabRadius.toFixed(1)}u`,
);
console.log(
  `rock instance present in scene: ${
    probe.matches === 0
      ? 'NO'
      : probe.drawnCount > 0
        ? `YES, ${probe.drawnCount}/${probe.matches} visible and undegenerate: ${JSON.stringify(probe.drawn)}`
        : `FOUND BUT NOT VISIBLE: all ${probe.matches} matching instance(s) hidden or zero-scale: ${JSON.stringify(probe.all)}`
  }`,
);

// Cost accounting at this exact camera pose: the foliage perf counters
// (submitted slabs, draw calls, submitted triangles per LOD row). The
// near-edge cull keeps more rock/dressing slabs alive, so this is the
// before/after number the tradeoff is judged on.
const cost = await page.evaluate(() => {
  const st = window.__game.renderer.foliage.perfStats();
  return {
    modelVisibleBuckets: st.modelVisibleBuckets,
    modelVisibleDraws: st.modelVisibleDraws,
    modelVisibleTriangles: st.modelVisibleTriangles,
    visibleByLod: st.modelVisibleByLod,
    drawsByLod: st.modelVisibleDrawsByLod,
    trianglesByLod: st.modelVisibleTrianglesByLod,
  };
});
console.log('foliage cost at this pose:', JSON.stringify(cost));

// Movement-blocked ground truth, LAST: walk straight into the rock and show
// the sim's collider stops the player short of it whatever the renderer drew.
const walk = await page.evaluate(
  ({ rockX, rockZ }) => {
    const g = window.__game;
    const p = g.sim.player;
    const startDist = Math.hypot(p.pos.x - rockX, p.pos.z - rockZ);
    const forward = {
      forward: true,
      back: false,
      turnLeft: false,
      turnRight: false,
      strafeLeft: false,
      strafeRight: false,
      jump: false,
    };
    for (let i = 0; i < 20 * 4; i++) {
      p.facing = Math.atan2(rockX - p.pos.x, rockZ - p.pos.z);
      Object.assign(g.sim.moveInput, forward);
      g.sim.tick();
    }
    Object.assign(g.sim.moveInput, { ...forward, forward: false });
    const endDist = Math.hypot(p.pos.x - rockX, p.pos.z - rockZ);
    return { startDist, endDist, blocked: endDist > 0.6 };
  },
  { rockX: target.x, rockZ: target.z },
);
console.log(
  `walk into rock: start ${walk.startDist.toFixed(2)}u, end ${walk.endDist.toFixed(2)}u, collider ${walk.blocked ? 'BLOCKED the player (solid)' : 'did NOT block'}`,
);

await browser.close();
