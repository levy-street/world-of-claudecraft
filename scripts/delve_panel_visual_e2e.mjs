// VISUAL / scene-graph end-to-end for the visibility-related Drowned Litany
// (Heroic) fixes. Offline only; needs `npm run dev` (:5173). Like
// scripts/drowned_litany_shots.mjs it walks all 7 Drowned Litany modules and
// screenshots each, but instead of only eyeballing it ASSERTS against the live
// three.js scene graph (window.__game.renderer). It pins three regressions:
//
//   (a) NO GIANT UNTEXTURED QUADS floating in a room interior. Scans the scene
//       for a large flat plane / near-degenerate box that uses an untextured
//       plain-color material and floats off the floor inside the active
//       module's world footprint. The authored Blackwater pool overlays sit
//       flush at the floor (y ~0.1 to 0.16) and are excluded; a regression that
//       re-introduces a big unanchored fallback quad flips this red.
//   (b) FLOOR PANEL FINDABILITY. For every module that gates progression on a
//       walk-on / pull interactable (sluice valves, grave tablets, corpse
//       candles, bell ropes) the corresponding render view must exist, sit at
//       the interior floor height at its x,z, land inside the module bounds,
//       and carry a real material (not the missing-asset fallback crate). A
//       per-module screenshot lands in tmp/ for the maintainer to eyeball.
//   (c) HAZARD TELEGRAPHS MATCH THE SIM. Every authored Blackwater hazard zone
//       for the active module (read from the layout data in-page) must have a
//       visible pool telegraph in the scene whose world position lands inside
//       the hazard radius, AND no telegraph pool may float where no hazard
//       exists. This pins the exact bug from the report: a lethal sim zone with
//       no visual (and its inverse, a visual with no zone).
//
// Discipline: scene-graph positions/materials/visibility are the source of
// truth; screenshots are human evidence only, never asserted on by pixel color.
// The camera is placed with wide offsets and clear sightlines before each shot.
//
// NOTE (concurrent repair): the floor-panel fix (b) is being repaired in the
// tree as this runs. The (b) assertions are written against the INTENDED
// behavior. If (b) is red on the current tree the orchestrator re-runs after
// the repair lands; (a) and (c) are expected green now.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync('tmp', { recursive: true });

const ALL_MODULES = [
  'litany_sluice',
  'litany_ledger',
  'litany_ring',
  'litany_baptistry',
  'litany_choir_loft',
  'litany_causeway',
  'litany_apse',
];

let pass = 0,
  fail = 0;
const check = (name, cond, extra = '') => {
  cond
    ? (pass++, console.log(`  PASS ${name}${extra ? `: ${extra}` : ''}`))
    : (fail++, console.log(`  FAIL ${name}${extra ? `: ${extra}` : ''}`));
};

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 60000,
  userDataDir: `C:/Users/Sud0S/AppData/Local/Temp/woc-litany-visual-e2e-${Date.now()}`,
  args: [
    '--window-size=1280,820',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-first-run',
    '--no-default-browser-check',
    // __game is published behind a setTimeout(LOADING_FADE_MS) after the loading
    // fade; an occluded headless page freezes timers, so keep the page active.
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
  defaultViewport: { width: 1280, height: 820 },
});
const page = await browser.newPage();
const errors = [];
// Offline `npm run dev` has no server, so the homepage's /api project-stats fetch
// 502s, unrelated to these fixes. Ignore that one known-benign noise.
const benign = (t) => /502|Bad Gateway|project stats/i.test(t);
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !benign(m.text())) errors.push(`CONSOLE: ${m.text()}`);
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
// Settle before clicking so the boot handlers are attached (clicking the moment
// the node exists in the DOM is a no-op and stalls the boot).
await sleep(2500);
await page.evaluate(() => {
  document.querySelector('.server-select-option[data-mode="offline"]')?.click();
  document.querySelector('#btn-play')?.click();
});
await sleep(1200);
await page.evaluate(() => {
  const name = document.querySelector('#char-name');
  if (name) name.value = 'Visualcheck';
  document.querySelector('#offline-select .mini-class[data-class="warrior"]')?.click();
  document.querySelector('#btn-start-offline')?.click();
});
await page.waitForFunction(() => window.__game?.sim?.player?.pos, { timeout: 30000, polling: 200 });
await sleep(1500);

// Publish the litany layout helpers into the page from the TS source (through the
// vite dev server). Pure data/geometry accessors only.
await page.evaluate(async () => {
  const lay = await import('/src/sim/delve_litany_layout.ts');
  const data = await import('/src/sim/data.ts');
  const world = await import('/src/sim/world.ts');
  window.__litanyGeometry = lay.litanyModuleGeometry;
  window.__litanyBounds = lay.litanyModuleBounds;
  window.__delveModuleZOffset = data.delveModuleZOffset;
  window.__groundHeight = world.groundHeight;
});

// Enter the delve and force the full ordered module list so we can walk all 7.
await page.evaluate((mods) => {
  const sim = window.__game.sim;
  const p = sim.player;
  const prev = sim.delveRunForPlayer(p.id);
  if (prev) {
    sim.leaveDelve();
    sim.freeDelveRun(prev);
  }
  sim.setPlayerLevel(14);
  sim.enterDelve('drowned_litany', 'heroic');
  const run = sim.delveRunForPlayer(sim.playerId);
  if (!run) throw new Error('no delve run after enterDelve');
  run.modules = mods.slice();
}, ALL_MODULES);
await sleep(2200);

// Puzzle interactable slots per module (mirrors DROWNED_LITANY_MODULES
// interactableSlots so the (b) check can name which modules gate progression on
// a floor panel). templateIds map: sluice_valve -> delve_sluice_valve, etc.; a
// pulled/lit/open suffix appears once triggered, all handled by prefix match.
const PUZZLE_TEMPLATE_PREFIXES = [
  'delve_pressure_plate',
  'delve_sluice_valve',
  'delve_grave_tablet',
  'delve_corpse_candle',
  'delve_bell_rope',
];

// Deterministically pin the run to module index `target`, (re)spawn that
// module's contents, CLOSE the exit portal, and park the player at the entry end
// well clear of both the exit portal and the puzzle plates. This is the crux of
// making the probe reproducible: the live game loop keeps ticking updateDelveRuns
// between our evaluate calls, and with an OPEN exit portal + the player near it,
// tickDelveModuleExit auto-advances the module out from under the probe (which
// is what made an early version read the next room's objects under this room's
// header). Forcing moduleIndex + respawn + exitPortalOpen=false + an entry park
// removes every auto-advance and puzzle-trigger path during the wait.
//
// Camera / sightline discipline: parking at the entry end facing +z gives the
// chase cam a clear look up the room over the water for the screenshot.
async function pinAndParkModule(target) {
  await page.evaluate((t) => {
    const sim = window.__game.sim;
    const run = sim.delveRunForPlayer(sim.playerId);
    run.moduleIndex = t;
    // Respawn the target module's mobs + interactables so run.objectIds is this
    // module's set (spawnDelveModule clears the prior module's objects first).
    sim.spawnDelveModule(run);
    run.exitPortalOpen = false;
    const b = window.__litanyBounds(run.modules[t]);
    const zBase = window.__delveModuleZOffset(run.modules, t);
    const p = sim.player;
    p.pos.x = run.origin.x;
    p.pos.z = run.origin.z + zBase + b.zMin + 8;
    p.pos.y = 0;
    p.prevPos = { ...p.pos };
    p.facing = 0; // look up-room (+z)
  }, target);
  // The renderer schedules interior builds off the player position / run state;
  // give it real time to build the KayKit kit, dressing, and pool overlays, and
  // to build the entity views for the parked module's interactables.
  await sleep(2600);
  // Re-park + hold the exit closed once more: any tick during the sleep may have
  // nudged the player or re-opened the portal (a fully-cleared puzzle set opens
  // it). Freeze the state we probe against.
  await page.evaluate((t) => {
    const sim = window.__game.sim;
    const run = sim.delveRunForPlayer(sim.playerId);
    if (run.moduleIndex !== t) {
      run.moduleIndex = t;
      sim.spawnDelveModule(run);
    }
    run.exitPortalOpen = false;
    const b = window.__litanyBounds(run.modules[t]);
    const zBase = window.__delveModuleZOffset(run.modules, t);
    const p = sim.player;
    p.pos.x = run.origin.x;
    p.pos.z = run.origin.z + zBase + b.zMin + 8;
    p.pos.y = 0;
    p.prevPos = { ...p.pos };
    p.facing = 0;
  }, target);
  // Let the renderer build the (re)spawned interior and swing the cam for the
  // screenshot the caller takes right after this returns.
  await sleep(1600);
}

// Move the player to the module CENTRE so every interactable lands inside the
// renderer's ENTITY_DRAW_RANGE (80yd) view-create band, then wait until each
// puzzle view is built. The entry-end park used for the screenshot leaves the
// far-end panels (e.g. the ledger tablet at local z=76, ~87yd from the entry)
// OUTSIDE the create range, so their views never build and (b) would falsely
// fail on interest culling rather than a real hidden-panel bug. From the centre
// the room half-diagonal (~47yd for a 110x50 room) is comfortably in range.
// Bounded poll so a GENUINELY missing/mis-placed view (the (b) bug class) still
// surfaces as a failure instead of hanging.
async function centerForProbe(target) {
  await page.evaluate((t) => {
    const sim = window.__game.sim;
    const run = sim.delveRunForPlayer(sim.playerId);
    run.moduleIndex = t;
    run.exitPortalOpen = false;
    const b = window.__litanyBounds(run.modules[t]);
    const zBase = window.__delveModuleZOffset(run.modules, t);
    const p = sim.player;
    p.pos.x = run.origin.x;
    p.pos.z = run.origin.z + zBase + (b.zMin + b.zMax) / 2;
    p.pos.y = 0;
    p.prevPos = { ...p.pos };
    p.facing = 0;
  }, target);
  await sleep(1200);
  await page
    .waitForFunction(
      (prefixes) => {
        const sim = window.__game.sim;
        const run = sim.delveRunForPlayer(sim.playerId);
        const views = window.__game.renderer.views;
        const puzzleIds = run.objectIds.filter((id) => {
          const e = sim.entities.get(id);
          return e && prefixes.some((pre) => (e.templateId || '').startsWith(pre));
        });
        if (puzzleIds.length === 0) return true; // no panels in this module
        return puzzleIds.every((id) => views.has(id));
      },
      { timeout: 6000, polling: 300 },
      PUZZLE_TEMPLATE_PREFIXES,
    )
    .catch(() => {
      // Timed out: leave it to the (b) assertions to report the missing view.
    });
}

// The scene-graph probe for one module. Returns everything the checks assert on.
// All geometry math runs in-page against window.__game.renderer's live scene.
async function probeModule(moduleId) {
  return page.evaluate(
    ({ moduleId, prefixes }) => {
      const sim = window.__game.sim;
      const renderer = window.__game.renderer;
      const run = sim.delveRunForPlayer(sim.playerId);
      const scene = renderer.scene;
      const views = renderer.views;

      const geo = window.__litanyGeometry(moduleId);
      const bounds = window.__litanyBounds(moduleId);
      const zBase = window.__delveModuleZOffset(run.modules, run.moduleIndex);
      const ox = run.origin.x;
      const oz = run.origin.z + zBase;

      // Module world footprint (with a small margin so a mesh straddling the
      // wall still counts as "in the room interior").
      const worldBounds = {
        xMin: ox + bounds.minX - 2,
        xMax: ox + bounds.maxX + 2,
        zMin: oz + bounds.zMin - 2,
        zMax: oz + bounds.zMax + 2,
      };
      const inModuleXZ = (x, z) =>
        x >= worldBounds.xMin &&
        x <= worldBounds.xMax &&
        z >= worldBounds.zMin &&
        z <= worldBounds.zMax;

      // Floor height the interior renders at (flat delve floor). Sample it from
      // the SAME groundHeight the sim/render share, at the module centre.
      const floorY = window.__groundHeight(ox, oz + (bounds.zMin + bounds.zMax) / 2, sim.cfg.seed);

      // ---- gather scene meshes with world geometry -------------------------
      // We walk the whole scene once, capturing per-mesh: world-space center,
      // an approximate largest planar face area, whether the material is a
      // plain untextured color, and whether it is (roughly) axis-flat. The
      // meshes already expose real THREE geometry.boundingBox / boundingSphere
      // (Box3 / Sphere with .clone()/.applyMatrix4()) and mesh.matrixWorld
      // (Matrix4), so no `three` import is needed in-page.
      const worldCenter = (mesh) => {
        const g = mesh.geometry;
        if (!g) return null;
        if (!g.boundingSphere) g.computeBoundingSphere();
        const c = g.boundingSphere.center.clone();
        mesh.updateWorldMatrix(true, false);
        c.applyMatrix4(mesh.matrixWorld);
        return { x: c.x, y: c.y, z: c.z };
      };

      // World-space AABB size for a mesh (accounts for the group offset + any
      // baked geometry translate).
      const worldSize = (mesh) => {
        const g = mesh.geometry;
        if (!g) return null;
        if (!g.boundingBox) g.computeBoundingBox();
        mesh.updateWorldMatrix(true, false);
        const bb = g.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
        return {
          x: bb.max.x - bb.min.x,
          y: bb.max.y - bb.min.y,
          z: bb.max.z - bb.min.z,
          min: { x: bb.min.x, y: bb.min.y, z: bb.min.z },
          max: { x: bb.max.x, y: bb.max.y, z: bb.max.z },
        };
      };

      // Is the material a plain, untextured single-color material (no map of any
      // kind)? A fallback quad uses exactly this; a real floor/prop is textured.
      const isUntexturedPlain = (mat) => {
        if (!mat) return false;
        const m = Array.isArray(mat) ? mat[0] : mat;
        if (!m) return false;
        const mapKeys = [
          'map',
          'normalMap',
          'roughnessMap',
          'metalnessMap',
          'aoMap',
          'emissiveMap',
          'alphaMap',
          'bumpMap',
          'displacementMap',
        ];
        for (const k of mapKeys) if (m[k]) return false;
        return true;
      };

      // ---- (a) giant untextured floating quads -----------------------------
      // Threshold: a flat mesh whose largest planar face is bigger than a sane
      // room-prop cap AND that floats clearly off the floor AND is inside the
      // room. The Blackwater pool overlays are flush at the floor (y<=~0.2) so
      // they never qualify; a re-introduced fallback panel would.
      const GIANT_FACE_AREA = 220; // yd^2: bigger than any legit floor-flush pool overlay face at this scale
      const FLAT_THICKNESS = 0.6; // a "quad" is near-flat on one axis
      const FLOOR_EPS = 0.9; // meshes within this of the floor count as anchored
      const giantQuads = [];
      let meshCount = 0;
      scene.traverse((obj) => {
        if (!obj.isMesh) return;
        const size = worldSize(obj);
        if (!size) return;
        const c = worldCenter(obj);
        if (!c) return;
        if (!inModuleXZ(c.x, c.z)) return;
        meshCount++;
        // Which axis is flat? Compute the two largest extents (the face).
        const ext = [size.x, size.y, size.z];
        const flatAxis = ext.indexOf(Math.min(...ext));
        if (ext[flatAxis] > FLAT_THICKNESS) return; // not flat enough to be a quad
        const face = ext.filter((_, i) => i !== flatAxis);
        const faceArea = face[0] * face[1];
        if (faceArea < GIANT_FACE_AREA) return;
        if (!isUntexturedPlain(obj.material)) return; // textured big surfaces are legit (floor, water)
        // Floating? Its lowest point sits clearly above the floor.
        const floats = size.min.y > floorY + FLOOR_EPS;
        if (!floats) return;
        giantQuads.push({
          faceArea: Math.round(faceArea),
          y: Number(c.y.toFixed(2)),
          minY: Number(size.min.y.toFixed(2)),
          size: {
            x: Number(size.x.toFixed(1)),
            y: Number(size.y.toFixed(1)),
            z: Number(size.z.toFixed(1)),
          },
          matType: (Array.isArray(obj.material) ? obj.material[0] : obj.material)?.type,
        });
      });

      // ---- (c) hazard telegraphs -------------------------------------------
      // Collect the floor-flush, untextured, single-color pool overlay meshes
      // (CircleGeometry / RingGeometry) inside the room. These are the telegraph
      // visuals placeMarshBlackwaterPools builds. Group them into clusters by
      // world x,z so a pool (fill + rim + edge, several meshes at one centre)
      // reads as ONE telegraph.
      const poolMeshes = [];
      scene.traverse((obj) => {
        if (!obj.isMesh) return;
        const g = obj.geometry;
        if (!g) return;
        const type = g.type || '';
        if (type !== 'CircleGeometry' && type !== 'RingGeometry') return;
        const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
        if (!mat || mat.type !== 'MeshBasicMaterial') return;
        if (mat.map) return; // the additive glow decal is textured; exclude it
        const c = worldCenter(obj);
        if (!c) return;
        if (!inModuleXZ(c.x, c.z)) return;
        // Pool overlays sit flush at the floor (y ~0.1 to 0.16). Exclude any
        // stray elevated ring (e.g. a triggered-plate glow inset).
        if (c.y > floorY + 0.5) return;
        poolMeshes.push({ x: c.x, z: c.z });
      });
      // Cluster the pool meshes into telegraph centres (2yd link radius).
      const clusters = [];
      for (const m of poolMeshes) {
        let hit = null;
        for (const cl of clusters) {
          if (Math.hypot(cl.x - m.x, cl.z - m.z) <= 3) {
            hit = cl;
            break;
          }
        }
        if (hit) {
          hit.x = (hit.x * hit.n + m.x) / (hit.n + 1);
          hit.z = (hit.z * hit.n + m.z) / (hit.n + 1);
          hit.n++;
        } else {
          clusters.push({ x: m.x, z: m.z, n: 1 });
        }
      }

      // For each authored hazard, is there a telegraph cluster whose centre
      // lands within that hazard's radius (world coords)? Deep + shallow of a
      // concentric pair share a centre, so one cluster can cover both.
      const hazards = geo ? geo.hazards : [];
      const hazardWorld = hazards.map((h) => ({
        x: ox + h.x,
        z: oz + h.z,
        rx: h.rx ?? h.r,
        rz: h.rz ?? h.r,
        tier: h.tier ?? 'deep',
      }));
      const hazardCovered = hazardWorld.map((h) => {
        // Point-in-ellipse (with a small tolerance) for any cluster centre.
        return clusters.some((cl) => {
          const dx = cl.x - h.x;
          const dz = cl.z - h.z;
          const tolx = h.rx + 1.5;
          const tolz = h.rz + 1.5;
          return (dx * dx) / (tolx * tolx) + (dz * dz) / (tolz * tolz) <= 1;
        });
      });
      const uncoveredHazards = hazardWorld.filter((_, i) => !hazardCovered[i]);

      // Phantom telegraph: a cluster centre that lands inside NO authored hazard
      // (allowing the same radius tolerance). Concentric pairs make many
      // clusters legitimately land inside a hazard; a phantom is one that does
      // not match any zone at all.
      const phantomClusters = clusters.filter((cl) => {
        return !hazardWorld.some((h) => {
          const dx = cl.x - h.x;
          const dz = cl.z - h.z;
          const tolx = h.rx + 2.5;
          const tolz = h.rz + 2.5;
          return (dx * dx) / (tolx * tolx) + (dz * dz) / (tolz * tolz) <= 1;
        });
      });

      // ---- (b) floor panel findability -------------------------------------
      // The progression interactables for this module: their sim entities, then
      // their render views.
      const puzzleEntities = [];
      for (const id of run.objectIds) {
        const e = sim.entities.get(id);
        if (!e) continue;
        if (!prefixes.some((pre) => (e.templateId || '').startsWith(pre))) continue;
        puzzleEntities.push(e);
      }
      const panels = puzzleEntities.map((e) => {
        const v = views.get(e.id);
        let viewY = null;
        let hasRealMaterial = false;
        let isFallbackCrate = false;
        const matTypes = [];
        if (v && v.group) {
          v.group.updateWorldMatrix(true, false);
          viewY = v.group.position.y;
          // Walk the view's meshes: a real prop uses surfaceMat (Standard /
          // Lambert / Basic with intended color) or emissive runes; the missing
          // -asset fallback is a 1x0.9x1 wood BoxGeometry crate with iron bands.
          let boxCount = 0;
          let crateSizedBox = false;
          v.group.traverse((o) => {
            if (!o.isMesh) return;
            const mat = Array.isArray(o.material) ? o.material[0] : o.material;
            if (mat) {
              matTypes.push(mat.type);
              if (
                mat.type === 'MeshStandardMaterial' ||
                mat.type === 'MeshLambertMaterial' ||
                mat.type === 'MeshBasicMaterial' ||
                mat.type === 'MeshPhongMaterial'
              )
                hasRealMaterial = true;
            }
            const g = o.geometry;
            if (g && g.type === 'BoxGeometry') {
              boxCount++;
              const params = g.parameters || {};
              // buildFallbackCrate body is exactly 1.0 x 0.9 x 1.0.
              if (
                Math.abs((params.width ?? 0) - 1.0) < 0.01 &&
                Math.abs((params.height ?? 0) - 0.9) < 0.01 &&
                Math.abs((params.depth ?? 0) - 1.0) < 0.01
              )
                crateSizedBox = true;
            }
          });
          // The fallback crate is a body box + 2 iron band boxes and nothing
          // else; require both the tell-tale body size AND the low box count.
          isFallbackCrate = crateSizedBox && boxCount <= 3 && matTypes.length <= 4;
        }
        const localX = e.pos.x - ox;
        const localZ = e.pos.z - oz;
        return {
          id: e.id,
          templateId: e.templateId,
          hasView: !!v,
          viewY: viewY == null ? null : Number(viewY.toFixed(3)),
          floorY: Number(floorY.toFixed(3)),
          atFloor: viewY != null && Math.abs(viewY - floorY) <= 0.25,
          inBounds: inModuleXZ(e.pos.x, e.pos.z),
          localX: Number(localX.toFixed(1)),
          localZ: Number(localZ.toFixed(1)),
          hasRealMaterial,
          isFallbackCrate,
          matTypes,
        };
      });

      return {
        moduleId,
        activeModuleId: run.modules[run.moduleIndex],
        meshCount,
        floorY: Number(floorY.toFixed(3)),
        worldBounds,
        // (a)
        giantQuads,
        // (c)
        hazardCount: hazards.length,
        clusterCount: clusters.length,
        clusters: clusters.map((c) => ({
          x: Number(c.x.toFixed(1)),
          z: Number(c.z.toFixed(1)),
          n: c.n,
        })),
        uncoveredHazards: uncoveredHazards.map((h) => ({
          x: Number(h.x.toFixed(1)),
          z: Number(h.z.toFixed(1)),
          tier: h.tier,
        })),
        phantomClusters: phantomClusters.map((c) => ({
          x: Number(c.x.toFixed(1)),
          z: Number(c.z.toFixed(1)),
        })),
        // (b)
        panelCount: panels.length,
        panels,
      };
    },
    { moduleId, prefixes: PUZZLE_TEMPLATE_PREFIXES },
  );
}

// ---------------------------------------------------------------------------
// Walk every module: advance, place camera, screenshot, probe, assert.
// ---------------------------------------------------------------------------
const summaries = [];
for (let mi = 0; mi < ALL_MODULES.length; mi++) {
  const moduleId = ALL_MODULES[mi];
  const label = moduleId.replace('litany_', '');
  await pinAndParkModule(mi);
  // Screenshot from the entry vantage (clear up-room sightline over the water).
  await page.screenshot({ path: `tmp/litany_visual_${mi}_${label}.png` });
  // Then move to the module centre so every interactable is inside the renderer's
  // view-create range before the (b) findability probe reads the scene views.
  await centerForProbe(mi);

  const probe = await probeModule(moduleId);
  summaries.push(probe);
  console.log(
    `\n[${mi}] ${moduleId} (active=${probe.activeModuleId}) meshes=${probe.meshCount} floorY=${probe.floorY}`,
  );
  console.log(
    `    hazards=${probe.hazardCount} telegraphClusters=${probe.clusterCount} panels=${probe.panelCount} giantQuads=${probe.giantQuads.length}`,
  );

  // Guard: the renderer must actually have built the module this iteration.
  check(
    `[${label}] renderer positioned on the active module`,
    probe.activeModuleId === moduleId && probe.meshCount > 0,
    `active=${probe.activeModuleId} meshes=${probe.meshCount}`,
  );

  // ---- (a) no giant untextured floating quads ----
  check(
    `[${label}] (a) no giant untextured quad floating in the interior`,
    probe.giantQuads.length === 0,
    probe.giantQuads.length ? JSON.stringify(probe.giantQuads) : 'none',
  );

  // ---- (c) telegraphs match the sim hazards ----
  if (probe.hazardCount > 0) {
    check(
      `[${label}] (c) a telegraph pool exists at every authored hazard`,
      probe.uncoveredHazards.length === 0,
      probe.uncoveredHazards.length
        ? `uncovered ${JSON.stringify(probe.uncoveredHazards)} (clusters ${JSON.stringify(probe.clusters)})`
        : `${probe.hazardCount} hazards covered by ${probe.clusterCount} clusters`,
    );
    check(
      `[${label}] (c) no phantom telegraph where no hazard exists`,
      probe.phantomClusters.length === 0,
      probe.phantomClusters.length ? JSON.stringify(probe.phantomClusters) : 'none',
    );
  } else {
    // Modules with no authored hazard should show no floor-flush pool telegraph
    // either (a phantom would be a bug just the same).
    check(
      `[${label}] (c) no telegraph pool in a hazard-free module`,
      probe.phantomClusters.length === 0,
      probe.phantomClusters.length ? JSON.stringify(probe.phantomClusters) : 'none',
    );
  }

  // ---- (b) floor panel findability (only modules that gate on a panel) ----
  if (probe.panelCount > 0) {
    const allFound = probe.panels.every((p) => p.hasView);
    const allAtFloor = probe.panels.every((p) => p.atFloor);
    const allInBounds = probe.panels.every((p) => p.inBounds);
    const allRealMat = probe.panels.every((p) => p.hasRealMaterial && !p.isFallbackCrate);
    check(
      `[${label}] (b) every progression panel has a render view`,
      allFound,
      allFound
        ? `${probe.panelCount} panels`
        : JSON.stringify(probe.panels.map((p) => ({ id: p.id, hasView: p.hasView }))),
    );
    check(
      `[${label}] (b) every panel sits at interior floor height`,
      allAtFloor,
      allAtFloor
        ? `floorY=${probe.floorY}`
        : JSON.stringify(
            probe.panels.map((p) => ({
              id: p.id,
              viewY: p.viewY,
              floorY: p.floorY,
              atFloor: p.atFloor,
            })),
          ),
    );
    check(
      `[${label}] (b) every panel is inside the module bounds`,
      allInBounds,
      allInBounds
        ? 'ok'
        : JSON.stringify(
            probe.panels.map((p) => ({
              id: p.id,
              localX: p.localX,
              localZ: p.localZ,
              inBounds: p.inBounds,
            })),
          ),
    );
    check(
      `[${label}] (b) every panel has a real material (not a missing-asset fallback crate)`,
      allRealMat,
      allRealMat
        ? 'ok'
        : JSON.stringify(
            probe.panels.map((p) => ({
              id: p.id,
              hasRealMaterial: p.hasRealMaterial,
              isFallbackCrate: p.isFallbackCrate,
              matTypes: p.matTypes,
            })),
          ),
    );
  } else {
    console.log(`    (b) no progression panel authored in ${label}; skipped`);
  }
}

// A cross-module sanity floor: check (b) must have actually exercised at least
// the four panel-gated modules, or the whole (b) arm silently passed on nothing.
const panelModules = summaries.filter((s) => s.panelCount > 0).map((s) => s.moduleId);
check(
  '(b) exercised the panel-gated modules (sluice/ledger/ring/choir_loft)',
  panelModules.length >= 4,
  `panel modules: ${panelModules.join(', ') || 'none'}`,
);
// And check (c) must have exercised real hazards in the marsh modules.
const hazardModules = summaries.filter((s) => s.hazardCount > 0).map((s) => s.moduleId);
check(
  '(c) exercised authored hazards in the marsh modules',
  hazardModules.length >= 5,
  `hazard modules: ${hazardModules.join(', ') || 'none'}`,
);

console.log(`\nerrors: ${errors.length ? errors.slice(0, 6).join(' | ') : 'none'}`);
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
await browser.close();
process.exit(fail > 0 || errors.length > 0 ? 1 : 0);
