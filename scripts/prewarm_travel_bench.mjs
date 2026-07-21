// Prewarm travel benchmark: boots the real browser renderer, lets the startup
// prewarm finish, then teleports an observer across every biome and into every
// dungeon interior while recording (a) WebGL program-cache growth and (b) browser
// long tasks, each attributed to the waypoint that triggered it.
//
// The signal is tier-independent: webgl.info.programs.length only grows when a
// material needs a NEW shader program. After prewarm it should be a high-water
// mark; any growth while travelling is content the prewarm missed (a live shader
// compile == a freeze on a real GPU). Long tasks additionally catch CPU-side
// geometry builds (terrain LOD, grass/foliage chunk streaming) that hitch even
// without a shader compile.
//
// We force ?gfx=ultra so the heavy PBR/composer materials actually exist even on
// swiftshader, and ?perfTrace=1 to turn on render diagnostics (newMaterials +
// per-frame programDelta + worst-frame stall attribution). Offline mode is used
// on purpose: the renderer + prewarm are host-agnostic (identical online), and
// offline lets us teleport instantly across the whole world and call
// enterDungeon/leaveDungeon directly. The crowd/diverse-skins path is validated
// separately against the live server.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from './browser_path.mjs';

const BASE_URL = process.env.GAME_URL ?? 'http://localhost:5173';
const GFX = process.env.PERF_GFX ?? 'ultra';
const KLASS = process.env.PERF_CLASS ?? 'warrior';
const SETTLE_MS = Number(process.env.PERF_SETTLE_MS ?? 2200);
const BOOT_TIMEOUT_MS = Number(process.env.PERF_BOOT_TIMEOUT_MS ?? 120000);
const NAV_TIMEOUT_MS = Number(process.env.PERF_NAV_TIMEOUT_MS ?? 30000);
const LONGTASK_MS = Number(process.env.PERF_LONGTASK_MS ?? 50);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUTPUT = process.env.PERF_OUT ?? path.join('tmp', `prewarm-travel-${stamp}.json`);
const LABEL = process.env.PERF_LABEL ?? 'baseline';

// Open-world route: cover all three biomes, lateral spread, and the POIs the
// prior on-GPU tour flagged as residual freezes (Fallen Chapel, deep Zone3).
const WAYPOINTS = [
  { label: 'vale.town', x: 0, z: 0 },
  { label: 'vale.south', x: 0, z: -120 },
  { label: 'vale.west', x: -130, z: 20 },
  { label: 'vale.east', x: 130, z: 20 },
  { label: 'vale.chapel-ruin', x: 80, z: 90 },
  { label: 'vale.north-edge', x: 0, z: 165 },
  { label: 'marsh.entry', x: 0, z: 220 },
  { label: 'marsh.fenbridge', x: 0, z: 300 },
  { label: 'marsh.west', x: -130, z: 360 },
  { label: 'marsh.east', x: 130, z: 360 },
  { label: 'marsh.drowned-keep', x: 45, z: 515 },
  { label: 'marsh.north-edge', x: 0, z: 525 },
  { label: 'peaks.entry', x: 0, z: 580 },
  { label: 'peaks.highwatch', x: 0, z: 660 },
  { label: 'peaks.west', x: -130, z: 720 },
  { label: 'peaks.east', x: 130, z: 720 },
  { label: 'peaks.nythraxis-door', x: -152, z: 610 },
  { label: 'peaks.sanctum-approach', x: 0, z: 880 },
  { label: 'peaks.far-north', x: 0, z: 895 },
];

// One dungeon per distinct interior (+ a couple of crypt re-uses to confirm dedup).
const DUNGEONS = [
  'hollow_crypt', // interior: crypt
  'sunken_bastion', // interior: crypt (re-use)
  'gravewyrm_sanctum', // interior: sanctum
  'drowned_temple', // interior: temple
  'nythraxis_crypt', // interior: crypt (re-use)
  'nythraxis_boss_arena', // interior: nythraxis
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bootUrl() {
  const url = new URL(BASE_URL);
  url.searchParams.set('perf', '');
  url.searchParams.set('perfTrace', '1');
  url.searchParams.set('gfx', GFX);
  return url.toString();
}

async function installObserver(page) {
  // Runs before any document script so it catches boot long tasks too.
  await page.evaluateOnNewDocument(() => {
    window.__bench = { label: 'boot', longtasks: [] };
    try {
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__bench.longtasks.push({
            dur: Math.round(e.duration),
            start: Math.round(e.startTime),
            label: window.__bench.label,
          });
        }
      });
      po.observe({ entryTypes: ['longtask'] });
    } catch {
      // longtask API unavailable; program-count deltas still work.
    }
  });
}

async function boot(page) {
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
  await page.goto(bootUrl(), { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  await page.waitForSelector('#btn-offline', { timeout: 30000 });
  await page.$eval('#btn-offline', (el) => el.click());
  await page.waitForSelector('#char-name', { timeout: 30000 });
  await page.$eval('#char-name', (el) => {
    el.value = 'PrewarmBench';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.$eval(`#offline-select .mini-class[data-class="${KLASS}"]`, (el) => el.click());
  await page.$eval('#btn-start-offline', (el) => el.click());
  await page.waitForFunction(
    () => Boolean(window.__game?.sim?.player && window.__game?.perf?.report),
    { timeout: BOOT_TIMEOUT_MS },
  );
  // Let the renderer settle and prewarm record its stats.
  await sleep(2500);
}

async function probe(page) {
  return page.evaluate(() => {
    const g = window.__game;
    const r = g.renderer;
    const info = r.webgl.info;
    const rep = g.perf.report();
    const rd = rep.renderer?.renderDiagnostics ?? null;
    // Distinct LOGICAL material names currently in the scene graph. A name that
    // is absent at spawn but appears while travelling is genuinely-lazy content
    // the prewarm missed (GPU-independent; unlike raw program count, which
    // swiftshader inflates because its compileAsync does not truly pre-link).
    const matNames = new Set();
    r.scene.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh)) return;
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) matNames.add(m.name || m.type);
    });
    return {
      programs: info.programs?.length ?? 0,
      textures: info.memory?.textures ?? 0,
      geometries: info.memory?.geometries ?? 0,
      calls: info.render?.calls ?? 0,
      triangles: info.render?.triangles ?? 0,
      tier: rep.renderer?.tier ?? null,
      biome: rep.renderer?.lastFrame?.biome ?? null,
      pos: { x: Math.round(g.sim.player.pos.x), z: Math.round(g.sim.player.pos.z) },
      ltMax: rep.browser?.longTasks?.max ?? 0,
      ltCount: rep.browser?.longTasks?.count ?? 0,
      diagEnabled: rd?.enabled ?? false,
      newMaterials: rd?.newMaterials ?? [],
      programDelta: rd?.programDelta ?? 0,
      matNames: [...matNames],
    };
  });
}

async function readPrewarm(page) {
  return page.evaluate(() => {
    const p = window.__game.perf.report().renderer?.prewarm;
    if (!p) return null;
    return {
      elapsedMs: p.elapsedMs,
      maxMs: p.maxMs,
      compileMode: p.compileMode,
      compileMs: p.compileMs,
      compileTimedOut: p.compileTimedOut,
      timedOut: p.timedOut,
      programsBefore: p.programsBefore,
      programsAfter: p.programsAfter,
      texturesBefore: p.texturesBefore,
      texturesAfter: p.texturesAfter,
      manifestCompleted: p.manifestCompleted,
      manifestPlanned: p.manifestPlanned,
      manifestTimedOut: p.manifestTimedOut,
      manifestFailed: p.manifestFailed,
      timedOutEntryIds: p.timedOutEntryIds,
      failedEntryIds: p.failedEntryIds,
      entries: (p.manifestEntries ?? []).map((e) => ({
        id: e.id,
        category: e.category,
        status: e.status,
        elapsedMs: e.elapsedMs,
        programDelta: e.programDelta,
        textureDelta: e.textureDelta,
        detail: e.detail,
      })),
    };
  });
}

async function collectLongtasks(page, label) {
  return page.evaluate((label) => {
    const all = window.__bench?.longtasks ?? [];
    const mine = all.filter((t) => t.label === label);
    return {
      count: mine.length,
      max: mine.reduce((m, t) => Math.max(m, t.dur), 0),
      total: mine.reduce((s, t) => s + t.dur, 0),
      tasks: mine.sort((a, b) => b.dur - a.dur).slice(0, 5),
    };
  }, label);
}

async function setLabel(page, label) {
  await page.evaluate((label) => {
    window.__bench.label = label;
  }, label);
}

async function teleport(page, x, z) {
  await page.evaluate(
    ({ x, z }) => {
      const p = window.__game.sim.player;
      p.pos.x = x;
      p.pos.z = z;
      if (p.vel) {
        p.vel.x = 0;
        p.vel.z = 0;
      }
    },
    { x, z },
  );
}

async function run() {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (!t.includes('/api/') && !t.includes('project stats') && !t.includes('502')) {
        errors.push(`CONSOLE: ${t}`);
      }
    }
  });

  const samples = [];
  try {
    await installObserver(page);
    await boot(page);

    const prewarm = await readPrewarm(page);

    // Decisive experiment: PERF_FORCE_SYNC_COMPILE=1 forces a synchronous
    // webgl.compile(scene,camera) after prewarm. Any program it links was
    // already IN-SCENE (so on a real GPU compileAsync would have covered it; a
    // swiftshader-only artifact). Anything that still compiles while travelling
    // afterwards is GENUINELY LAZY (not in scene at prewarm).
    let syncCompileProgs = null;
    if (process.env.PERF_FORCE_SYNC_COMPILE === '1') {
      const before = (await probe(page)).programs;
      await page.evaluate(() => {
        const r = window.__game.renderer;
        r.webgl.compile(r.scene, r.camera);
      });
      await sleep(400);
      syncCompileProgs = { before, after: (await probe(page)).programs };
    }

    const baseline = await probe(page);
    const baseProgs = baseline.programs;
    // Material names present at spawn (after prewarm). Anything new during travel
    // is genuinely-lazy content. Track first-appearance so each name reports once.
    const spawnNames = new Set(baseline.matNames);
    const seenNames = new Set(spawnNames);

    // Open-world tour.
    let prevProgs = baseProgs;
    for (const wp of WAYPOINTS) {
      await setLabel(page, wp.label);
      await teleport(page, wp.x, wp.z);
      await sleep(SETTLE_MS);
      const after = await probe(page);
      const lt = await collectLongtasks(page, wp.label);
      const newNames = after.matNames.filter((n) => !seenNames.has(n));
      for (const n of newNames) seenNames.add(n);
      samples.push({
        kind: 'waypoint',
        label: wp.label,
        target: { x: wp.x, z: wp.z },
        biome: after.biome,
        programs: after.programs,
        progFromBaseline: after.programs - baseProgs,
        progFromPrev: after.programs - prevProgs,
        textures: after.textures,
        geometries: after.geometries,
        triangles: after.triangles,
        calls: after.calls,
        newMaterials: after.newMaterials,
        newMatNames: newNames,
        longtask: lt,
      });
      prevProgs = after.programs;
    }

    // Dungeon tour: enter each, settle, measure, leave.
    for (const id of DUNGEONS) {
      const label = `dungeon:${id}`;
      await setLabel(page, label);
      const entered = await page.evaluate((id) => {
        try {
          window.__game.sim.enterDungeon(id);
          return true;
        } catch (e) {
          return String(e?.message ?? e);
        }
      }, id);
      await sleep(SETTLE_MS);
      const after = await probe(page);
      const lt = await collectLongtasks(page, label);
      const newNames = after.matNames.filter((n) => !seenNames.has(n));
      for (const n of newNames) seenNames.add(n);
      samples.push({
        kind: 'dungeon',
        label,
        entered,
        biome: after.biome,
        programs: after.programs,
        progFromBaseline: after.programs - baseProgs,
        progFromPrev: after.programs - prevProgs,
        textures: after.textures,
        geometries: after.geometries,
        triangles: after.triangles,
        calls: after.calls,
        newMaterials: after.newMaterials,
        newMatNames: newNames,
        longtask: lt,
      });
      prevProgs = after.programs;
      await page.evaluate(() => {
        try {
          window.__game.sim.leaveDungeon();
        } catch {}
      });
      await sleep(800);
    }

    const finalProbe = await probe(page);
    const devTrace = await page.evaluate(() => {
      const dt = window.__game.perf.report().devTrace;
      if (!dt?.frames) return null;
      return dt.frames
        .filter((f) => f.frameMs >= 40)
        .slice(0, 12)
        .map((f) => ({
          frameMs: Math.round(f.frameMs),
          reasons: f.reasons,
          stall: f.stallAttribution
            ? {
                submitMs: Math.round(f.stallAttribution.submitMs ?? 0),
                programDelta: f.stallAttribution.programDelta,
                textureDelta: f.stallAttribution.textureDelta,
                biome: f.stallAttribution.biome,
                newMaterials: f.stallAttribution.diagnostics?.newMaterials ?? [],
              }
            : null,
        }));
    });

    const artifact = {
      generatedAt: stamp,
      runLabel: LABEL,
      url: bootUrl(),
      gfx: GFX,
      class: KLASS,
      settleMs: SETTLE_MS,
      tier: baseline.tier,
      prewarm,
      syncCompileProgs,
      baselinePrograms: baseProgs,
      finalPrograms: finalProbe.programs,
      programGrowthTotal: finalProbe.programs - baseProgs,
      samples,
      devTraceWorstFrames: devTrace,
      errors,
    };
    fs.writeFileSync(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`);

    // Console summary.
    console.log(`\n=== prewarm travel bench (${LABEL}) tier=${baseline.tier} gfx=${GFX} ===`);
    if (prewarm) {
      console.log(
        `prewarm: ${prewarm.elapsedMs}/${prewarm.maxMs}ms compile=${prewarm.compileMode} ${prewarm.compileMs}ms timedOut=${prewarm.compileTimedOut} progs ${prewarm.programsBefore}->${prewarm.programsAfter} entries ${prewarm.manifestCompleted}/${prewarm.manifestPlanned} fail=${prewarm.manifestFailed} timeout=${prewarm.manifestTimedOut}`,
      );
    }
    if (syncCompileProgs) {
      console.log(
        `sync compile after prewarm: ${syncCompileProgs.before} -> ${syncCompileProgs.after} (+${syncCompileProgs.after - syncCompileProgs.before} in-scene programs async missed)`,
      );
    }
    console.log(
      `baseline programs after prewarm: ${baseProgs}; distinct material names at spawn: ${spawnNames.size}`,
    );
    console.log(
      `\n-- GENUINELY-LAZY (material NAMES absent at spawn, appear while travelling = real cross-GPU gap) --`,
    );
    let nameGaps = 0;
    for (const s of samples) {
      if (s.newMatNames?.length) {
        nameGaps++;
        console.log(
          `  ${s.kind === 'dungeon' ? '[DUNGEON] ' : ''}${s.label}: ${s.newMatNames.join(', ')}`,
        );
      }
    }
    if (!nameGaps) console.log('  none: every material name was already present at spawn');

    console.log(
      `\n-- PROGRAM GROWTH (swiftshader inflates this via compileAsync not pre-linking; use as secondary signal) --`,
    );
    for (const s of samples) {
      const hitch = s.longtask.max >= LONGTASK_MS;
      if (s.progFromPrev > 0 || hitch) {
        const mats = s.newMaterials?.length
          ? ` mats=[${s.newMaterials.slice(0, 4).join(',')}]`
          : '';
        console.log(
          `  ${s.kind === 'dungeon' ? '[DUNGEON] ' : ''}${s.label} biome=${s.biome} +${s.progFromPrev} progs (total +${s.progFromBaseline}) longtask max=${s.longtask.max}ms x${s.longtask.count}${mats}`,
        );
      }
    }
    console.log(`\ntotal program growth across full tour: +${finalProbe.programs - baseProgs}`);
    console.log(`wrote ${OUTPUT}`);
    if (errors.length) {
      console.error(`\n${errors.length} page errors:\n${errors.slice(0, 10).join('\n')}`);
    }
  } finally {
    await page.close();
    await browser.close();
  }
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
