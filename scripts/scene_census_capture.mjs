// Scene census capture: boots the OFFLINE world at a forced gfx tier, teleports
// to a fixed spot, idles, runs the on-demand scene census (the ?perf overlay's
// census button, driven via window.__game), and writes the JSON + a screenshot
// per (tier, spot). Draw calls / triangles / program counts are
// machine-independent, so a headless SwiftShader run still measures the real
// submission bill; only wall-clock timings are software-GL noise.
//
// Needs `npm run dev` running (default http://localhost:5173; override with
// GAME_URL when 5173 belongs to another worktree).
//
// Usage:
//   node scripts/scene_census_capture.mjs \
//     [--tiers=low,medium,high,ultra] [--spots=town,forest,cliff] \
//     [--idle=20] [--out=census_out]

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5173';

// The three fixed representative spots (record these in the PR so every
// measurement is reproducible): coordinates are sim-space (x, z), facing is
// the player yaw the camera follows, pitch/dist stage the view.
const SPOTS = {
  town: {
    label: 'Eastbrook town center',
    x: 0,
    z: -14,
    facing: 0,
    pitch: 0.32,
    dist: 10,
  },
  forest: {
    label: 'Vale dense forest (west of Wolf Run)',
    x: -40,
    z: 60,
    facing: 0.6,
    pitch: 0.25,
    dist: 10,
  },
  cliff: {
    label: 'Highwatch peaks vista (looking south over the zones)',
    x: 0,
    z: 615,
    facing: Math.PI,
    pitch: 0.5,
    dist: 12,
  },
};

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const tiers = arg('tiers', 'low,medium,high,ultra').split(',');
const spots = arg('spots', 'town,forest,cliff').split(',');
const idleSec = Number(arg('idle', '20'));
const outDir = arg('out', 'census_out');

fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function captureRun(tier, spotId) {
  const spot = SPOTS[spotId];
  if (!spot) throw new Error(`unknown spot ${spotId}`);
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: ['--window-size=1620,960', '--hide-scrollbars'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 900 });
    await suppressGpuNotice(page);
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem('woc_spawn_intro_seen:offline:warrior:Adventurer', '1');
      } catch {}
    });
    await page.goto(`${GAME_URL}/?perf&gfx=${tier}`, { waitUntil: 'domcontentloaded' });
    // Generous boot timeout: a loaded machine (parallel vitest runs) can push
    // the offline world entry well past the 30 s default.
    const booted = await enterOfflineGame(page, { settleMs: 3000, gameBootTimeoutMs: 90000 });
    if (!booted) throw new Error(`world boot timed out (tier ${tier}, spot ${spotId})`);

    // Teleport and stage the camera, then let streaming/view-building settle.
    await page.evaluate((s) => {
      const g = window.__game;
      g.sim.player.pos.x = s.x;
      g.sim.player.pos.z = s.z;
      g.sim.player.facing = s.facing;
      g.input.camYaw = s.facing;
      g.input.camPitch = s.pitch;
      g.input.camDist = s.dist;
    }, spot);
    await sleep(12_000);

    // Idle window for the hitch tracker (program-delta correlation), then census.
    await sleep(Math.max(0, idleSec - 12) * 1000);
    const result = await page.evaluate(() => {
      const g = window.__game;
      // Live stats FIRST: the census burst ends by zeroing the draw counters,
      // so a synchronous post-census read would report an empty live frame.
      const report = g.perf.report();
      const census = g.perf.runSceneCensus();
      const r = report.renderer;
      return {
        census,
        hitches: report.hitches ?? null,
        live: r
          ? {
              tier: r.tier,
              calls: r.calls,
              triangles: r.triangles,
              programs: r.programs,
              textures: r.textures,
              geometries: r.geometries,
              views: r.views,
              glRenderer: r.glRenderer,
              effectiveRenderScale: r.effectiveRenderScale,
            }
          : null,
        fps: report.fps,
        frameMs: report.frameMs,
        seconds: report.seconds,
      };
    });
    const record = {
      tier,
      spot: spotId,
      spotLabel: spot.label,
      coordinates: { x: spot.x, z: spot.z, facing: spot.facing },
      idleSec,
      capturedAt: new Date().toISOString(),
      ...result,
    };
    const slug = `${tier}-${spotId}`;
    fs.writeFileSync(path.join(outDir, `${slug}.json`), JSON.stringify(record, null, 2));
    await sleep(1200); // let the overlay repaint with the census table
    await page.screenshot({ path: path.join(outDir, `${slug}.png`) });
    console.log(
      `[census] ${slug}: calls ${record.census?.baseline.calls} tris ${record.census?.baseline.triangles} prog ${record.census?.programs}`,
    );
  } finally {
    await browser.close();
  }
}

for (const tier of tiers) {
  for (const spotId of spots) {
    await captureRun(tier.trim(), spotId.trim());
  }
}
console.log(`[census] done, results in ${outDir}/`);
