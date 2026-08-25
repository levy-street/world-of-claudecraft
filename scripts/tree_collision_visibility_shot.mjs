// Before/after proof for the Low-graphics invisible-but-solid TREE bug
// (levy-street/world-of-claudecraft#3415, the tree half of the rock fix in
// commit 85a92306c3 / PR #3418, deferred there and closed unfixed).
//
// A collider-eligible tree (sim/colliders.ts gives EVERY tree/tree2 trunk an
// unconditional collider, sim/decoration_dims.ts decorationHasCollider) used
// to be subject to the same hash-based triangle-count trim as pure cosmetic
// dressing on GFX.leanFoliage tiers (src/render/foliage.ts buildTrees), so a
// player on Low graphics could walk into an empty-looking patch of ground and
// be blocked by a tree trunk they cannot see. The fix exempts any decoration
// with a real collider from the trim (src/render/foliage_decimation_core.ts).
//
// Mirrors scripts/rock_collision_visibility_shot.mjs, but for a tree: picks a
// real tree LIVE from the running client's own module graph, isolated enough
// from its forest neighbours that its absence reads as an obvious gap rather
// than being masked by nearby canopies, whose placement hash the pre-fix trim
// actually dropped on Low. Proves via a scene-graph probe (not just a
// screenshot) that its trunk instance is present, then via a straight-line
// walk that the sim's collider blocks the player at the same spot either way
// (pre-fix AND post-fix): the bug is a RENDER-side gap only, never a sim one.
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

const APPROACH_OFFSET = 4; // stand this many yards south of the tree, close enough the gap reads clearly

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
const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Ranger' });
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

// Pick the target tree LIVE, from the exact code and seed the running client
// uses (dynamic import of an already-loaded Vite module URL reuses the
// browser's own module instance), so the picked coordinates are full
// precision and provably match the live world.
const target = await page.evaluate(async () => {
  const worldMod = await import('/src/sim/world.ts');
  const dataMod = await import('/src/sim/data.ts');
  const seed = window.__game.sim.cfg.seed;
  // Duplicates foliage.ts's module-private hashAt (salt 83) and inlines the
  // 0.46 pre-fix keep rate from commit 85a92306c3 (both deleted by this fix's
  // own diff, so nothing live still names them): this picker only needs to
  // reproduce what the PRE-FIX build once did, to find a tree that build
  // would have dropped. If the salt, the formula, or the tier's keep rate
  // ever change again, this stops picking a meaningfully adversarial tree
  // and silently degrades to "any tree", with no test to catch the drift.
  function hashAt(a, b, k) {
    const s = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453123;
    return s - Math.floor(s);
  }
  // Every tree/tree2 carries an unconditional collider on both the pre-fix
  // and post-fix tree (decorationHasCollider's tree arm is unchanged by this
  // fix), so this is safe to inline on both trees rather than importing it.
  const farFromCamps = (x, z) =>
    dataMod.CAMPS.every((c) => Math.hypot(x - c.center.x, z - c.center.z) > c.radius + 40);
  const bounds = { minX: 100, maxX: 260, minZ: -160, maxZ: 40 };
  const allDecos = worldMod.generateDecorationsInBounds(seed, bounds);
  const trees = allDecos.filter((d) => d.kind === 'tree' || d.kind === 'tree2');
  // Isolation radius: a dense forest patch fills the frame with NEIGHBOURING
  // canopies even when the target itself is dropped, so the before/after
  // pair reads as "same forest" rather than "hole appears" unless the target
  // is the only large canopy in view. 9 yards clears a tree's own ~7yd
  // canopy plus the neighbour's, so nothing else overlaps the shot.
  const ISOLATION_RADIUS = 9;
  const isolated = (d) =>
    trees.every((o) => o === d || Math.hypot(o.x - d.x, o.z - d.z) > ISOLATION_RADIUS);
  const candidates = trees
    .filter((d) => farFromCamps(d.x, d.z) && isolated(d))
    .map((d) => ({ ...d, hashDraw: hashAt(d.x, d.z, 83) }))
    // dropped on Low (leanFoliage, non-standardMaterials) pre-fix: keep rate
    // was 0.46 for tree/tree2, so anything at or above that hash was culled.
    .filter((d) => d.hashDraw >= 0.46);
  if (candidates.length === 0) return null;
  const pick = candidates[0];
  return {
    x: pick.x,
    z: pick.z,
    kind: pick.kind,
    scale: pick.scale,
    biome: pick.biome,
    hashDraw: pick.hashDraw,
  };
});
if (!target) throw new Error('no collider-eligible, pre-fix-dropped tree found in the search box');
console.log('target tree:', JSON.stringify(target));

const state = await page.evaluate(
  ({ x, z, treeX, treeZ }) => {
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
    p.facing = Math.atan2(treeX - p.pos.x, treeZ - p.pos.z);
    p.prevFacing = p.facing;
    return { onGround: p.onGround, pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z } };
  },
  { x: target.x, z: target.z + APPROACH_OFFSET, treeX: target.x, treeZ: target.z },
);
console.log('teleported:', JSON.stringify(state));
if (!state.onGround) throw new Error('player never settled onto the ground');

// Ground truth: is a trunk InstancedMesh instance actually present, VISIBLE,
// and undegenerate in the live scene graph at the tree's exact live
// coordinates (tolerance far tighter than the spacing between unrelated
// grass/dressing instances)? Matching on the instance matrix's translation
// columns alone is NOT sufficient proof of visibility: the far-LOD collapse
// (foliage.ts hiddenMatrix) zeroes an instance's SCALE but leaves its
// translation untouched, and a whole bucket mesh can be toggled with
// `mesh.visible = false` with no per-instance matrix change at all. Both
// would let this probe report a false YES for a tree the player cannot
// actually see, exactly the failure mode this probe exists to rule out.
function probeTreeInstance() {
  return page.evaluate(
    ({ treeX, treeZ }) => {
      const scene = window.__game.renderer.scene;
      const TOL = 0.02;
      // A tree species is multiple PARTS (bark + leaves at minimum, each its
      // own InstancedMesh row via extractParts/placeSpecies), so the same
      // (x, z) legitimately matches more than one row; a degenerate slot in
      // one row (a pooled InstancedMesh capacity gap, or a per-row LOD
      // subset this coordinate does not belong to) is expected and does not
      // mean the tree itself is hidden. Collect every match instead of
      // trusting the first one found.
      const all = [];
      scene.traverse((obj) => {
        if (!obj.isInstancedMesh) return;
        const arr = obj.instanceMatrix.array;
        for (let i = 0; i < obj.count; i++) {
          const x = arr[i * 16 + 12];
          const z = arr[i * 16 + 14];
          if (Math.abs(x - treeX) < TOL && Math.abs(z - treeZ) < TOL) {
            let ancestorsVisible = obj.visible;
            for (let p = obj.parent; p; p = p.parent) ancestorsVisible &&= p.visible;
            all.push({
              meshName: obj.name || '(unnamed)',
              x,
              z,
              visible: ancestorsVisible,
              scaleY: arr[i * 16 + 5], // instance matrix col-major: [5] is the Y-scale element
            });
          }
        }
      });
      const drawn = all.filter((m) => m.visible && Math.abs(m.scaleY) > 0.01);
      return { matches: all.length, drawnCount: drawn.length, all, drawn };
    },
    { treeX: target.x, treeZ: target.z },
  );
}

await dismissPerfBanner();
// Back and roughly eye-level, looking at the trunk: a tree is much taller
// than a rock, so a close overhead shot (the rock script's framing) mostly
// shows canopy regardless of whether THIS tree rendered; a wider, lower shot
// reads as open grass to the horizon when the tree is absent and an obvious
// vertical canopy blocking the view when it is present. Bypasses the
// chase-cam yaw/pivot math via the renderer's editorCam escape hatch (same
// path the map editor's free camera uses), so framing is exact and
// reproducible. The isolation filter on the target picker keeps this a
// clean single-tree shot: no neighbour canopy close enough to fill the gap.
// The {pos, target} literals below are plain duck-typed {x,y,z} objects, not
// THREE.Vector3 instances: Renderer.editorCam's consumers only ever read
// .x/.y/.z off them (camera.position.copy / lookAt), which works from a
// page.evaluate context with no THREE import available, so keep it a plain
// object rather than "fixing" it into a real Vector3.
//
// The look-at TARGET is offset TARGET_CLEARANCE off the trunk's own (x, z)
// rather than centered on it: foliage.ts's updateTreeHides treats
// cameraLookAt as "what the camera is looking at" and hides (ghosts, fades
// to 20% opacity) any tree sitting on the eye-to-camera segment so a real
// player's view of their OWN character is never blocked by scenery. Centered
// exactly on the trunk, the look-at point sits INSIDE the tree's own
// pointInsideTree radius every frame, which permanently arms that hide, not
// a bug, just a degenerate use of a real feature: no real camera ever
// targets scenery instead of the player. TARGET_CLEARANCE clears every
// shipped tree's trunk radius (0.55 * scale, scale never exceeds ~2) with
// margin, while staying well inside the frame at this camera distance.
const TARGET_CLEARANCE = 2;
await page.evaluate(
  ({ playerY, treeX, treeZ, targetClearance }) => {
    const r = window.__game.renderer;
    r.editorCam = {
      pos: { x: treeX, y: playerY + 2.2, z: treeZ + 8 },
      target: { x: treeX + targetClearance, y: playerY + 2.5, z: treeZ },
    };
  },
  { playerY: state.pos.y, treeX: target.x, treeZ: target.z, targetClearance: TARGET_CLEARANCE },
);
await frame();
await sleep(200);
await dismissPerfBanner();
// A SEPARATE, pre-existing, working-as-intended system (updateTreeHides in
// foliage.ts) can independently zero-scale a tree's instance and swap in a
// translucent "ghost" stand-in whenever it briefly sits on the eye-to-camera
// segment (so the camera never clips through a trunk blocking the view of
// the player). The fall-settle loop above ran under the ORIGINAL chase
// camera, which could have crossed this exact tree while turning to face
// it, arming that fade. It self-clears once the segment stops crossing the
// tree (occluderFadeSettled, an exponential fade at OCCLUDER_FADE_IN_RATE =
// 6/s), but only after enough REAL elapsed time with the camera clear, not
// merely enough manual sim.tick() calls: give it a full second here so a
// probe taken right after does not read a transient fade-out as the bug
// this script exists to catch.
await sleep(1000);
// Two more forced paints: bucket visibility (culling / LOD windows) resolves
// against the camera position sync() reads each frame, and the editorCam move
// above happens between paints, so the first post-move frame can still show
// last frame's stale visibility flags.
await frame();
await sleep(100);
await frame();
await page.screenshot({ path: `tmp/tree-visibility-${OUT_SLUG}.png` });
console.log(`wrote tmp/tree-visibility-${OUT_SLUG}.png`);

// Probed AFTER the editorCam move, the occluder-fade settle wait, and the
// repaint frames above, so `visible` reflects THIS camera position's
// bucket-window resolution and any transient occlusion fade from the
// fall-settle phase has fully cleared, not a stale flag left over from
// wherever the player's original chase cam last pointed.
const probe = await probeTreeInstance();
console.log(
  `tree instance present in scene: ${
    probe.matches === 0
      ? 'NO'
      : probe.drawnCount > 0
        ? `YES, ${probe.drawnCount}/${probe.matches} part(s) visible and undegenerate: ${JSON.stringify(probe.drawn)}`
        : `FOUND BUT NOT ACTUALLY VISIBLE: all ${probe.matches} matching part(s) are hidden or zero-scale: ${JSON.stringify(probe.all)}`
  }`,
);

// Movement-blocked ground truth, captured LAST (after the visual shot, so
// walking the player up to the trunk cannot perturb the framing above):
// walk the player straight north into the tree's (x, z) and confirm the
// sim's collider actually stops them short of it, independent of whatever
// the renderer draws. This is what makes the bug "invisible AND solid"
// rather than just "invisible" (a purely cosmetic miss would be a lesser
// bug, and this repo's graphics-fairness invariant is specifically about
// collisions a player cannot see).
const walk = await page.evaluate(
  ({ treeX, treeZ }) => {
    const g = window.__game;
    const p = g.sim.player;
    const startDist = Math.hypot(p.pos.x - treeX, p.pos.z - treeZ);
    const forward = {
      forward: true,
      back: false,
      turnLeft: false,
      turnRight: false,
      strafeLeft: false,
      strafeRight: false,
      jump: false,
    };
    for (let i = 0; i < 20 * 6; i++) {
      // 6 seconds of straight-line walking
      Object.assign(g.sim.moveInput, forward);
      g.sim.tick();
    }
    Object.assign(g.sim.moveInput, {
      forward: false,
      back: false,
      turnLeft: false,
      turnRight: false,
      strafeLeft: false,
      strafeRight: false,
      jump: false,
    });
    const endDist = Math.hypot(p.pos.x - treeX, p.pos.z - treeZ);
    return { startDist, endDist };
  },
  { treeX: target.x, treeZ: target.z },
);
console.log(
  'walk-into-tree:',
  JSON.stringify(walk),
  walk.endDist > 0.3 ? '(BLOCKED short of the trunk)' : '(walked through - no collider!)',
);

await browser.close();
