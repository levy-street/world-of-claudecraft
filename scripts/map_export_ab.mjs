// A/B: the SAME place, two authoring routes.
//
//   world        the built-in game world, booted the normal offline way.
//   placements   the same place converted to an editor document
//                (src/editor/shipped_maps.ts createShippedMap) and booted
//                through the play-test handoff, so it renders as
//                WorldContent.placements -- the shape an exported map has.
//
// That is the whole question this repo could not answer before: does a map
// built in Studio cost more than the same map hand-authored in the engine? Both
// legs run the same locations, the same settings, the same camera, in separate
// sequential browser launches so they never contend for the GPU.
//
//   node scripts/map_export_ab.mjs
//
// Env:
//   AB_URL      dev server origin (default http://localhost:5260)
//   AB_MAP      shipped map id for the B leg (default overworld)
//   AB_OUT      output json (default tmp/map-ab-<map>.json)
//   AB_ONLY     comma-separated location names
//   AB_LEGS     comma-separated leg labels among world,placements
//   AB_SAMPLE_MS / AB_SETTLE_MS  override the sampling windows
//
// The B leg needs the dev server (it dynamic-imports src/ TypeScript to build
// the document in-page); this is a dev tool and never ships.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const BASE = process.env.AB_URL ?? 'http://localhost:5260';
const MAP_ID = process.env.AB_MAP ?? 'overworld';
const SETTLE_MS = Number(process.env.AB_SETTLE_MS ?? 9000);
const SAMPLE_MS = Number(process.env.AB_SAMPLE_MS ?? 8000);
const ORBIT_RATE = 0.9; // rad/s camera yaw spin for the movement case
const SNAPSHOT_STRIDE = 10; // frames between renderer.perfStats() reads
const PLAYTEST_TOKEN = 'map-export-ab';

const LEGS = [
  { label: 'world', mode: 'builtin' },
  { label: 'placements', mode: 'playtest' },
].filter((l) => !process.env.AB_LEGS || process.env.AB_LEGS.split(',').includes(l.label));

// Locations chosen for render-load spread, and all inside the shipped overworld
// so the built-in leg and the converted-document leg frame the same geometry.
// Matches scripts/fps_ab_compare.mjs so numbers are comparable across harnesses.
const LOCATIONS = [
  { name: 'meadow', x: 15, z: 45, yaw: 1.0, pitch: 0.35, dist: 9 },
  { name: 'town_street', x: 13, z: 15, yaw: 2.45, pitch: -0.2, dist: 12 },
  { name: 'path', x: 40, z: 9.5, yaw: 1.41, pitch: 0.4, dist: 8 },
  { name: 'peaks_boulders', x: 30, z: 700, yaw: 0.5, pitch: 0.3, dist: 8 },
].filter((l) => !process.env.AB_ONLY || process.env.AB_ONLY.split(',').includes(l.name));

const LAUNCH_ARGS = [
  '--window-size=1600,900',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
  '--use-gl=angle',
  '--use-angle=gl',
  '--enable-webgl',
  '--no-sandbox',
];

const ULTRA_SETTINGS = {
  graphicsPreset: 5,
  terrainDetail: 1,
  foliageDensity: 1,
  effectsQuality: 1,
  shadowQuality: 1,
  renderScale: 1,
  browserEffects: 1,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stats(sample) {
  if (!sample) return null;
  // Drop the first 20 frames: rAF warmup + the camera snap.
  const d = sample.deltas.slice(20).sort((a, b) => a - b);
  if (!d.length) return null;
  const avgMs = d.reduce((a, b) => a + b, 0) / d.length;
  const q = (p) => d[Math.min(d.length - 1, Math.floor(d.length * p))];
  const med = (xs) => {
    const s = xs.filter((v) => v > 0).sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  };
  return {
    frames: d.length,
    avgFps: 1000 / avgMs,
    medianMs: q(0.5),
    p95ms: q(0.95),
    onePctLowFps: 1000 / q(0.99),
    worstMs: d[d.length - 1],
    drawCalls: med(sample.calls),
    triangles: med(sample.tris),
    programs: sample.programs,
  };
}

/**
 * Sample rAF deltas plus renderer counters for `ms`.
 *
 * Counters come from renderer.perfStats(), NOT raw webgl.info: on composer
 * tiers three's auto-reset is off and the live counter is monotonic, so a raw
 * read reports the whole session's draw calls. perfStats() serves the
 * accumulated per-frame delta and adds the off-screen water passes back on the
 * profiles that drop them. Sampled every SNAPSHOT_STRIDE frames -- it builds a
 * sizeable object, and per-frame allocation would perturb what we're measuring.
 */
async function measure(page, spin) {
  return await page.evaluate(
    async (ms, rate, stride) => {
      return await new Promise((resolve) => {
        const deltas = [];
        const calls = [];
        const tris = [];
        const g = window.__game;
        const snap = () => (g?.renderer?.perfStats ? g.renderer.perfStats() : null);
        let programs = 0;
        let n = 0;
        let last = performance.now();
        const t0 = last;
        const step = (t) => {
          const dt = t - last;
          deltas.push(dt);
          last = t;
          if (n++ % stride === 0) {
            const s = snap();
            if (s) {
              calls.push(s.calls);
              tris.push(s.triangles);
              programs = s.programs;
            }
          }
          if (rate > 0 && g?.input) g.input.camYaw += (dt / 1000) * rate;
          if (t - t0 < ms) requestAnimationFrame(step);
          else resolve({ deltas, calls, tris, programs });
        };
        requestAnimationFrame(step);
      });
    },
    SAMPLE_MS,
    spin ? ORBIT_RATE : 0,
    SNAPSHOT_STRIDE,
  );
}

/**
 * Build the shipped map as an editor document and stash it as a play-test
 * transfer, exactly the way src/editor/playtest.ts launchPlaytest does (same
 * four payload fields, same RLE rule for a big paint grid). Returns the
 * document's placement count so the report can prove the B leg is not empty.
 */
async function seedPlaytestTransfer(page, mapId, token) {
  await page.goto(`${BASE}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => Boolean(window.__editor), { timeout: 180000 });
  return await page.evaluate(
    async (id, tok) => {
      const shipped = await import('/src/editor/shipped_maps.ts');
      const custom = await import('/src/editor/custom_map.ts');
      const doc = await import('/src/sim/map_doc.ts');
      const map = await shipped.createShippedMap(id, `ab-${id}`, Date.now());
      const world = custom.customMapToWorldContent(map);
      let content = world;
      const bp = world.biomePaint;
      if (bp && Array.isArray(bp.ids) && bp.ids.length >= 4096) {
        const { ids, ...rest } = bp;
        content = { ...world, biomePaint: { ...rest, idsRle: doc.encodeBiomePaintIdsRle(ids) } };
      }
      localStorage.setItem(
        `woc_editor_playtest_transfer:${tok}`,
        JSON.stringify({
          content,
          seed: map.meta.seed,
          playerClass: 'warrior',
          playerName: 'AbProbe',
        }),
      );
      return {
        placements: map.placements.length,
        zones: map.content.zones.length,
        terrainEdits: map.terrainEdits?.length ?? 0,
        propsMode: map.propsMode ?? null,
      };
    },
    mapId,
    token,
  );
}

const results = [];
const summary = [];

for (const leg of LEGS) {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: LAUNCH_ARGS,
    defaultViewport: { width: 1600, height: 900 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
  await page.evaluateOnNewDocument((s) => {
    localStorage.setItem('woc_settings', JSON.stringify(s));
  }, ULTRA_SETTINGS);

  let docInfo = null;
  try {
    if (leg.mode === 'playtest') {
      docInfo = await seedPlaytestTransfer(page, MAP_ID, PLAYTEST_TOKEN);
      console.log(
        `${leg.label}: document has ${docInfo.placements} placements, ` +
          `${docInfo.zones} zones, ${docInfo.terrainEdits} terrain edits`,
      );
      // Boots straight into the world, no start screen (src/main.ts).
      await page.goto(`${BASE}/index.html?editorPlaytest=${PLAYTEST_TOKEN}&gfx=ultra`, {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });
    } else {
      await page.goto(`${BASE}/index.html?gfx=ultra`, {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });
      await enterOfflineGame(page, {
        charClass: 'warrior',
        charName: 'AbProbe',
        settleMs: 2500,
        gameBootTimeoutMs: 180000,
      });
    }
    await page.waitForFunction(() => Boolean(window.__game?.sim?.player), { timeout: 180000 });
  } catch (e) {
    await page.screenshot({ path: `tmp/map-ab-entry-fail-${leg.label}.png` }).catch(() => {});
    results.push({ leg: leg.label, error: `entry failed: ${e.message}`, pageErrors: errors });
    console.error(`${leg.label}: entry failed - ${e.message}`);
    await browser.close();
    continue;
  }

  // How the placement set is actually drawn. A B leg that quietly fell back to
  // cloning would otherwise just look like "instancing did not help much".
  const batchStats = await page
    .evaluate(() => window.__game?.renderer?.placedAssets?.batchStats?.() ?? null)
    .catch(() => null);
  if (batchStats) {
    const worstClones = Object.entries(batchStats.clonedPaths)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    console.log(
      `${leg.label}: ${batchStats.batched} instanced / ${batchStats.cloned} cloned ` +
        `across ${batchStats.batches} batches (${batchStats.instances} live instances)`,
    );
    for (const [path, n] of worstClones) console.log(`    clones x${n}  ${path}`);
  }

  for (const loc of LOCATIONS) {
    await page.evaluate((p) => {
      const g = window.__game;
      g.sim.player.gm = true;
      g.sim.player.hp = g.sim.player.maxHp;
      g.sim.player.pos.x = p.x;
      g.sim.player.pos.z = p.z;
      g.sim.player.prevPos = { ...g.sim.player.pos };
      g.sim.player.facing = p.yaw;
      g.input.camYaw = p.yaw;
      g.input.camPitch = p.pitch;
      g.input.camDist = p.dist;
      if (g.renderer) g.renderer.camDist = p.dist;
    }, loc);
    await sleep(SETTLE_MS);
    const still = stats(await measure(page, false));
    const orbit = stats(await measure(page, true));
    results.push({ leg: leg.label, location: loc.name, doc: docInfo, still, orbit });
    summary.push({ leg: leg.label, location: loc.name, still, orbit });
    console.log(
      `${leg.label.padEnd(11)} ${loc.name.padEnd(15)} ` +
        `still ${still?.avgFps.toFixed(1)}fps / ${still?.drawCalls} calls | ` +
        `orbit ${orbit?.avgFps.toFixed(1)}fps (1%low ${orbit?.onePctLowFps.toFixed(1)}) / ` +
        `${orbit?.drawCalls} calls`,
    );
  }
  if (errors.length) results.push({ leg: leg.label, pageErrors: errors.slice(0, 8) });
  await browser.close();
}

// The comparison is the point: placements vs world, per location.
const byLoc = new Map();
for (const row of summary) {
  if (!byLoc.has(row.location)) byLoc.set(row.location, {});
  byLoc.get(row.location)[row.leg] = row;
}
const deltas = [];
console.log('\n=== placements vs world ===');
for (const [loc, legs] of byLoc) {
  const a = legs.world;
  const b = legs.placements;
  if (!a?.orbit || !b?.orbit) continue;
  const fpsPct = ((b.orbit.avgFps - a.orbit.avgFps) / a.orbit.avgFps) * 100;
  const callRatio = a.orbit.drawCalls ? b.orbit.drawCalls / a.orbit.drawCalls : 0;
  deltas.push({ location: loc, fpsPct, callRatio });
  console.log(
    `${loc.padEnd(15)} fps ${a.orbit.avgFps.toFixed(1)} -> ${b.orbit.avgFps.toFixed(1)} ` +
      `(${fpsPct >= 0 ? '+' : ''}${fpsPct.toFixed(1)}%)  ` +
      `calls ${a.orbit.drawCalls} -> ${b.orbit.drawCalls} (${callRatio.toFixed(2)}x)`,
  );
}

const out = process.env.AB_OUT ?? `tmp/map-ab-${MAP_ID}.json`;
fs.mkdirSync('tmp', { recursive: true });
fs.writeFileSync(out, JSON.stringify({ map: MAP_ID, results, deltas }, null, 2));
console.log(`\nwritten ${out}`);
