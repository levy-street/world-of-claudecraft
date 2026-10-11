// Shader harvest: the final GLSL of every program the client links, collected
// WITHOUT gameplay, as the input corpus of the Windows compile-cost bench.
//
// On Windows (ANGLE D3D11) a cold program costs about half a second of HLSL
// compile, and nobody has priced our shaders one by one. The final text does
// not exist in the source tree: three assembles it at run time from the
// material, the scene state and our onBeforeCompile patches. So this script
// serves THIS worktree's dev client, enters the OFFLINE world by itself, walks
// a scripted tour (every zone, every dungeon, the dev raids, the battleground,
// every mount ridden a few steps, a dive, every ability VFX) once per graphics profile, and records every
// program text through the page hook in scripts/lib/shader_harvest_hook.mjs.
// No human plays, so two runs on one checkout give the same corpus.
//
//   node scripts/shader_harvest.mjs                       # low + ultra
//   node scripts/shader_harvest.mjs --profiles ultra --steps boot,zones
//
// Flags: --profiles <a,b> (default low,ultra), --steps <a,b> (default all; see
// STEP_IDS), --port <n> (default 5188), --out <dir>, --headed, --angle
// <backend>, --quiet-ms <n> (a step is settled after that long without a new
// link, default 2500), --max-settle-ms <n> (default 45000), --allow-dirty,
// --recheck <dir> (re-run the static completeness check on a corpus on disk),
// --live-programs (arm the client's perf diagnostics, ?perfTrace=1&perf, and
// record every `live-program` event per tour step: a program that linked in a
// live frame outside every compile gate, the defect the hook alone cannot see
// because it cannot tell a held root from a drawn one. Off by default so the
// corpus is harvested from a client in its production configuration).
//
// Output (tmp/shader-harvest-<id>/): corpus.json (programs, shaders, contexts,
// provenance per profile), shaders/<hash>.<vert|frag>.glsl, report.md (programs
// per step and per context, and the authored shader files the tour never met:
// the to-do list of the next tour, not a failure).
//
// The tour is only as complete as its script. The report's unseen list and a
// later diff against production sessions are what expose the gap.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findBrowserPath } from './browser_path_resolve.mjs';
import { dismissEntryOverlays, enterOfflineGame } from './enter_offline_game.mjs';
import {
  classifySites,
  corpusIndex,
  createCorpus,
  foldDrain,
  shaderTokensOf,
} from './lib/shader_harvest_corpus.mjs';
import { installShaderHarvestHook } from './lib/shader_harvest_hook.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VIEWPORT = { width: 1600, height: 900, deviceScaleFactor: 1 };
const STEP_IDS = [
  'boot',
  'zones',
  'dungeons',
  'raids',
  'battleground',
  'mounts',
  'dive',
  'vfx',
  'windows',
];
const SERVED_CHECK = {
  module: '/src/render/program_sources.ts',
  token: 'collectRootProgramSources',
};

function parseArgs(argv) {
  const args = {
    profiles: ['low', 'ultra'],
    steps: STEP_IDS,
    port: 5188,
    out: null,
    headed: false,
    angle: null,
    quietMs: 2500,
    maxSettleMs: 45_000,
    allowDirty: false,
    recheck: null,
    livePrograms: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--profiles') args.profiles = next().split(',');
    else if (a === '--steps') args.steps = next().split(',');
    else if (a === '--port') args.port = Number(next());
    else if (a === '--out') args.out = next();
    else if (a === '--headed') args.headed = true;
    else if (a === '--angle') args.angle = next();
    else if (a === '--quiet-ms') args.quietMs = Number(next());
    else if (a === '--max-settle-ms') args.maxSettleMs = Number(next());
    else if (a === '--allow-dirty') args.allowDirty = true;
    else if (a === '--recheck') args.recheck = next();
    else if (a === '--live-programs') args.livePrograms = true;
    else throw new Error(`unknown flag ${a}`);
  }
  for (const step of args.steps) {
    if (!STEP_IDS.includes(step)) throw new Error(`unknown step ${step}; known: ${STEP_IDS}`);
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function git(argv, fallback) {
  try {
    return execFileSync('git', argv, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// vite (the discipline of scripts/live_program_hunt.mjs: a dev server inside an
// agent worktree never sees edits and its transform cache outlives a restart)
// ---------------------------------------------------------------------------

function killPort(port) {
  try {
    execFileSync('fuser', ['-k', `${port}/tcp`], { stdio: 'ignore' });
  } catch {
    // nothing was listening
  }
}

function startVite(port, logFile) {
  killPort(port);
  for (const dir of ['node_modules/.vite', 'node_modules/.vite-temp']) {
    fs.rmSync(path.join(ROOT, dir), { recursive: true, force: true });
  }
  const log = fs.openSync(logFile, 'w');
  return spawn(
    'npx',
    ['vite', '--force', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: ['ignore', log, log] },
  );
}

async function waitForVite(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error(`vite did not answer on :${port} within ${timeoutMs} ms`);
}

async function verifyServedModule(port) {
  const body = await (await fetch(`http://127.0.0.1:${port}${SERVED_CHECK.module}`)).text();
  if (!body.includes(SERVED_CHECK.token)) {
    throw new Error(`served ${SERVED_CHECK.module} lacks ${SERVED_CHECK.token}`);
  }
}

// ---------------------------------------------------------------------------
// the tour
// ---------------------------------------------------------------------------

async function setStep(page, label) {
  await page.evaluate((label) => {
    window.__shaderHarvest.step = label;
  }, label);
}

/**
 * A step is settled once, for quietMs in a row and counted from the step's own
 * start, no program linked, no asset request is in flight and the renderer's
 * background GPU queue is empty (bounded by maxSettleMs). Counting from the
 * step's start matters: a teleport's work begins with downloads, so "the last
 * link was long ago" is true at the very moment the step has done nothing yet.
 */
async function settle(page, args) {
  const deadline = Date.now() + args.maxSettleMs;
  let quietSince = Date.now();
  let lastLinks = -1;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const h = window.__shaderHarvest;
      const stats = window.__game?.renderer?.perfStats?.();
      // The events ring is bounded, so new ones are lifted at every poll and
      // tagged with the step that was running when they were first seen.
      if (!h.liveSeen) h.liveSeen = new Set();
      if (!h.live) h.live = [];
      for (const e of stats?.gpuPrep?.events?.events ?? []) {
        if (e.kind !== 'live-program') continue;
        const id = `${e.key}|${e.atMs}`;
        if (h.liveSeen.has(id)) continue;
        h.liveSeen.add(id);
        const program = (window.__game.renderer.webgl?.info?.programs ?? []).find(
          (p) => p.cacheKey === e.key,
        );
        h.live.push({
          step: h.step,
          atMs: e.atMs,
          name: program?.name ?? '',
          key: String(e.key).slice(0, 160),
        });
      }
      return { links: h.links, inflight: h.inflight, pending: stats?.gpuQueue?.pending ?? 0 };
    });
    const busy = state.links !== lastLinks || state.inflight > 0 || state.pending > 0;
    lastLinks = state.links;
    if (busy) quietSince = Date.now();
    else if (Date.now() - quietSince >= args.quietMs) return true;
    await sleep(200);
  }
  return false;
}

function dev(page, command) {
  return page.evaluate((command) => {
    window.__game.sim.chat(command);
  }, command);
}

async function keepAlive(page) {
  await page.evaluate(() => {
    const p = window.__game.sim.player;
    p.maxHp = Math.max(p.maxHp, 100000);
    if (!p.dead) p.hp = p.maxHp;
  });
}

/**
 * Hold the forward key for a moment. Some visuals only draw while the rider
 * MOVES (a sled's exhaust plumes, gait dust), and a material that is never
 * drawn never links, so a parked mount hides them from the harvest.
 */
async function rideForward(page, ms) {
  const at = () =>
    page.evaluate(() => {
      const p = window.__game.sim.player.pos;
      return { x: p.x, z: p.z };
    });
  const from = await at();
  await page.keyboard.down('w');
  await sleep(ms);
  await page.keyboard.up('w');
  const to = await at();
  return Math.hypot(to.x - from.x, to.z - from.z);
}

const TOUR = {
  async zones(page, args, log) {
    const zones = await page.evaluate(async () => {
      const { ZONES } = await import('/src/sim/data.ts');
      return ZONES.map((z) => ({
        id: z.id,
        points: [
          { tag: 'hub', x: z.hub.x, z: z.hub.z },
          { tag: 'graveyard', x: z.graveyard.x, z: z.graveyard.z },
          ...z.pois.map((p, i) => ({ tag: `poi${i}`, x: p.x, z: p.z })),
        ],
      }));
    });
    for (const zone of zones) {
      for (const point of zone.points) {
        await setStep(page, `zone:${zone.id}:${point.tag}`);
        await dev(page, `/dev tp ${point.x.toFixed(1)} ${point.z.toFixed(1)}`);
        await keepAlive(page);
        await settle(page, args);
      }
      log(`zone ${zone.id}: ${zone.points.length} points`);
    }
  },

  async dungeons(page, args, log) {
    const ids = await page.evaluate(async () => {
      const { DUNGEONS } = await import('/src/sim/data.ts');
      return Object.keys(DUNGEONS);
    });
    for (const id of ids) {
      for (const difficulty of ['normal', 'heroic']) {
        await setStep(page, `dungeon:${id}:${difficulty}`);
        const entered = await page.evaluate(
          (id, difficulty) => {
            const sim = window.__game.sim;
            try {
              sim.setDungeonDifficulty(difficulty);
              return sim.enterDungeon(id);
            } catch (err) {
              return String(err?.message ?? err);
            }
          },
          id,
          difficulty,
        );
        await keepAlive(page);
        await settle(page, args);
        await page.evaluate(() => {
          try {
            window.__game.sim.leaveDungeon();
          } catch {
            // not inside
          }
        });
        await settle(page, args);
        if (entered !== true) log(`dungeon ${id} ${difficulty}: enterDungeon returned ${entered}`);
      }
      log(`dungeon ${id}`);
    }
  },

  async raids(page, args, log) {
    for (const command of [
      '/dev raid normal',
      '/dev raid heroic',
      '/dev nythraxisraid normal',
      '/dev nythraxisraid heroic',
      '/dev ignivarraid',
      '/dev ignivarraid boss',
      '/dev varkhulraid normal',
      '/dev varkhulraid heroic',
    ]) {
      await setStep(page, `raid:${command.slice(5)}`);
      await dev(page, command);
      await keepAlive(page);
      await settle(page, args);
      await page.evaluate(() => {
        try {
          window.__game.sim.leaveDungeon();
        } catch {
          // not inside
        }
      });
      await settle(page, args);
      log(command);
    }
  },

  async battleground(page, args, log) {
    await setStep(page, 'battleground');
    await dev(page, '/dev bg');
    await keepAlive(page);
    await settle(page, args);
    // Stay through the opening: the field's painted ground, wards and runes
    // come with the match itself, not with the teleport.
    await rideForward(page, 3000);
    await sleep(8000);
    await settle(page, args);
    await dev(page, '/dev bg end');
    await settle(page, args);
    log('battleground');
  },

  async mounts(page, args, log) {
    const catalog = await page.evaluate(async () => {
      const { MOUNT_KEYS } = await import('/src/sim/content/mounts.ts');
      const { MOUNT_SKINS } = await import('/src/sim/content/mount_skins.ts');
      return { keys: [...MOUNT_KEYS], skins: Object.keys(MOUNT_SKINS) };
    });
    // Dev harness convention: write the entity field the renderer reads, so no
    // reins item, riding skill or cast time stands between the tour and the
    // visual. KNOWN GAP: a rider mounted this way does not move under the
    // forward key, and the sim's own summon (useItem on the reins) never
    // completed in the tour either, so visuals that only draw while the rider
    // moves (the goblin rocket sled's exhaust plumes) are still unharvested.
    for (const key of catalog.keys) {
      await setStep(page, `mount:${key}`);
      await page.evaluate((key) => {
        const p = window.__game.sim.player;
        p.mountSkinId = null;
        p.mountKey = key;
      }, key);
      await settle(page, args);
    }
    for (const skin of catalog.skins) {
      await setStep(page, `mountskin:${skin}`);
      await page.evaluate((skin) => {
        // Through the sim's own setter: a skin written straight onto the entity
        // is taken off again by the ownership reconcile before it ever draws.
        window.__game.sim.changeMountSkin(skin);
      }, skin);
      await settle(page, args);
      const moved = await rideForward(page, 1500);
      await settle(page, args);
      const state = await page.evaluate(() => {
        const p = window.__game.sim.player;
        return `${p.mountKey}/${p.mountSkinId}`;
      });
      log(`mountskin ${skin}: rode ${moved.toFixed(1)} yd as ${state}`);
    }
    await page.evaluate(() => {
      const p = window.__game.sim.player;
      p.mountSkinId = null;
      p.mountKey = '';
    });
    log(`mounts: ${catalog.keys.length} keys, ${catalog.skins.length} skins`);
  },

  async dive(page, args, log) {
    // The underwater tint and bubbles sit in a hidden group until the CAMERA is
    // under the waterline, and the boot compile walks visible objects only.
    // Find deep water near a zone hub, go there, and hold the swim-down key.
    const spot = await page.evaluate(async () => {
      const { ZONES } = await import('/src/sim/data.ts');
      const { waterLevelAt, terrainHeight } = await import('/src/sim/world.ts');
      const seed = window.__game.sim.cfg.seed;
      for (const zone of ZONES) {
        for (let radius = 0; radius <= 400; radius += 20) {
          for (let a = 0; a < 16; a++) {
            const x = zone.hub.x + Math.cos((a / 16) * Math.PI * 2) * radius;
            const z = zone.hub.z + Math.sin((a / 16) * Math.PI * 2) * radius;
            const depth = waterLevelAt(x, z, seed) - terrainHeight(x, z, seed);
            if (Number.isFinite(depth) && depth > 6) return { x, z, depth, zone: zone.id };
          }
        }
      }
      return null;
    });
    if (!spot) {
      log('dive: no deep water found near any hub');
      return;
    }
    await setStep(page, `dive:${spot.zone}`);
    await dev(page, `/dev tp ${spot.x.toFixed(1)} ${spot.z.toFixed(1)}`);
    await settle(page, args);
    await page.keyboard.down('ControlLeft');
    await sleep(4000);
    await settle(page, args);
    await page.keyboard.up('ControlLeft');
    log(`dive: ${spot.zone}, ${spot.depth.toFixed(1)} yd deep`);
  },

  async vfx(page, args, log) {
    // The firing recipe of scripts/ability_vfx_probe.mjs: hand the renderer the
    // spellfx event the sim would emit, per authored spec.
    const ids = await page.evaluate(() =>
      Object.keys(window.__game.abilityVfxProbe?.specs ?? {}).sort(),
    );
    await setStep(page, 'vfx');
    for (const id of ids) {
      await page.evaluate((abilityId) => {
        const g = window.__game;
        const spec = g.abilityVfxProbe.specs[abilityId];
        const ab = g.abilityVfxProbe.abilities[abilityId];
        const fx =
          ab?.projectileFx ??
          (ab && ab.castTime > 0
            ? 'projectile'
            : spec.a === 'nova' || spec.a === 'shout'
              ? 'nova'
              : 'tick');
        const p = g.sim.player;
        g.renderer.handleEvent({
          type: 'spellfx',
          sourceId: p.id,
          targetId: p.id,
          school: ab?.school ?? 'nature',
          fx,
          ability: abilityId,
        });
      }, id);
      await sleep(120);
    }
    await settle(page, args);
    log(`vfx: ${ids.length} specs`);
  },

  async windows(page, args, log) {
    // The secondary GL contexts (paperdoll preview, portraits) key the same
    // materials differently, so they are programs of their own.
    await setStep(page, 'windows:character');
    await page.keyboard.press('c');
    await settle(page, args);
    await page.keyboard.press('c');
    await settle(page, args);
    log('windows');
  },
};

// The proof the hook is faithful: every program three holds for the world
// context is read back from the driver (the recipe of programSourcesOfEntry in
// src/game/shader_corpus_slices.ts) and must be a pair the hook recorded. Runs
// once, after the tour, because each readback is a synchronous round trip.
function readbackFidelity() {
  const renderer = window.__game.renderer.webgl;
  const gl = renderer.getContext();
  const out = { checked: 0, matched: 0, unreadable: 0, missing: [] };
  for (const entry of renderer.info.programs ?? []) {
    const program = entry.program;
    const shaders = program ? gl.getAttachedShaders(program) : null;
    if (shaders?.length !== 2) {
      out.unreadable += 1;
      continue;
    }
    let vertex = '';
    let fragment = '';
    for (const shader of shaders) {
      const source = gl.getShaderSource(shader) ?? '';
      if (gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.VERTEX_SHADER) vertex = source;
      else fragment = source;
    }
    out.checked += 1;
    if (window.__shaderHarvest.hasPair(vertex, fragment)) out.matched += 1;
    else if (out.missing.length < 5) out.missing.push(entry.name || entry.cacheKey?.slice(0, 80));
  }
  return out;
}

async function harvestProfile(browser, args, profile, corpus, log) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.evaluateOnNewDocument(installShaderHarvestHook);
  const url = `http://localhost:${args.port}/?gfx=${profile}${args.livePrograms ? '&perfTrace=1&perf' : ''}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const booted = await enterOfflineGame(page, {
    charClass: 'warrior',
    charName: 'Harvester',
    gameBootTimeoutMs: 180_000,
  });
  if (!booted) throw new Error(`profile ${profile}: the offline world never booted`);
  await settle(page, args);
  await dev(page, '/dev level 60');
  await dev(page, '/dev god');
  await dev(page, '/dev noaggro');
  const started = Date.now();
  for (const step of args.steps) {
    if (step === 'boot') continue;
    const t0 = Date.now();
    await dismissEntryOverlays(page).catch(() => undefined);
    await TOUR[step](page, args, (line) => log(`  [${profile}] ${line}`));
    const links = await page.evaluate(() => window.__shaderHarvest.links);
    log(
      `[${profile}] step ${step} done in ${Math.round((Date.now() - t0) / 1000)} s (${links} links so far)`,
    );
  }
  const fidelity = await page.evaluate(readbackFidelity);
  log(
    `[${profile}] fidelity: ${fidelity.matched} of ${fidelity.checked} world programs read back from the driver match a hooked link (${fidelity.unreadable} unreadable)`,
  );
  const drain = await page.evaluate(() => window.__shaderHarvest.drain());
  const livePrograms = await page.evaluate(() => window.__shaderHarvest.live ?? []);
  const tier = await page.evaluate(async () => {
    const { GFX } = await import('/src/render/gfx.ts');
    return {
      tier: GFX.tier,
      standardMaterials: GFX.standardMaterials,
      dynamicShadows: GFX.dynamicShadows,
    };
  });
  const added = foldDrain(corpus, profile, drain);
  await page.close();
  return {
    profile,
    gfx: tier,
    seconds: Math.round((Date.now() - started) / 1000),
    links: drain.links,
    unique: drain.programs.length,
    addedToCorpus: added,
    fidelity,
    livePrograms,
    contexts: drain.contexts,
    pageErrors: errors.slice(0, 20),
  };
}

// ---------------------------------------------------------------------------
// the static completeness check and the report
// ---------------------------------------------------------------------------

function authoredShaderSites() {
  const sites = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) {
        const source = fs.readFileSync(full, 'utf8');
        if (!/ShaderMaterial|onBeforeCompile|gl_FragColor|gl_Position/.test(source)) continue;
        sites.push({ file: path.relative(ROOT, full), tokens: shaderTokensOf(source) });
      }
    }
  };
  walk(path.join(ROOT, 'src', 'render'));
  return sites;
}

function renderReport(meta, corpus, runs, sites) {
  const { seen, unseen, undetermined } = classifySites(corpus, sites);
  const lines = ['# Shader harvest report', ''];
  lines.push(`- commit ${meta.gitSha}${meta.dirty ? ' (dirty)' : ''}, ${meta.browser}`);
  lines.push(`- steps: ${meta.steps.join(', ')}`);
  lines.push(`- corpus: ${corpus.programs.size} programs, ${corpus.shaders.size} shaders`, '');
  lines.push(
    '## Profiles',
    '',
    '| profile | tier | seconds | links | unique programs | new to corpus | contexts |',
    '|---|---|---|---|---|---|---|',
  );
  for (const r of runs) {
    lines.push(
      `| ${r.profile} | ${r.gfx.tier} | ${r.seconds} | ${r.links} | ${r.unique} | ${r.addedToCorpus} | ${r.contexts.length} |`,
    );
  }
  lines.push(
    '',
    '## Programs first met per step group',
    '',
    '| profile | step group | programs |',
    '|---|---|---|',
  );
  for (const r of runs) {
    const groups = new Map();
    for (const program of corpus.programs.values()) {
      const first = program.seen[r.profile]?.steps?.[0];
      if (!first) continue;
      const group = first.split(':').slice(0, 2).join(':');
      groups.set(group, (groups.get(group) ?? 0) + 1);
    }
    for (const [group, count] of [...groups].sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${r.profile} | ${group} | ${count} |`);
    }
  }
  lines.push('', '## GL contexts', '');
  for (const r of runs) {
    for (const c of r.contexts) {
      lines.push(
        `- ${r.profile} context ${c.id}: ${c.canvas}, created at ${c.createdAtStep}, ${c.extensions.length} extensions`,
      );
    }
  }
  if (meta.livePrograms) {
    lines.push('', '## Programs linked in a live frame, outside every gate', '');
    lines.push('| profile | step | programs | names |', '|---|---|---|---|');
    for (const r of runs) {
      const bySteps = new Map();
      for (const e of r.livePrograms ?? []) {
        const list = bySteps.get(e.step) ?? [];
        list.push(e.name || '(unnamed)');
        bySteps.set(e.step, list);
      }
      for (const [step, names] of bySteps) {
        lines.push(
          `| ${r.profile} | ${step} | ${names.length} | ${[...new Set(names)].slice(0, 8).join(', ')} |`,
        );
      }
      if (!bySteps.size) lines.push(`| ${r.profile} | (none) | 0 | |`);
    }
  }
  lines.push('', `## Authored shader files never met (${unseen.length})`, '');
  lines.push(
    'A file is met when a uniform, varying or attribute name that ONLY it declares appears in a harvested text.',
    '',
  );
  for (const site of unseen)
    lines.push(`- \`${site.file}\` (own tokens: ${site.own.slice(0, 4).join(', ')})`);
  lines.push('', `## Met (${seen.length})`, '');
  lines.push(seen.map((site) => `\`${path.basename(site.file)}\``).join(', '));
  lines.push('', `## Undetermined: no token of their own (${undetermined.length})`, '');
  lines.push(undetermined.map((site) => `\`${path.basename(site.file)}\``).join(', '));
  const errors = runs.flatMap((r) => r.pageErrors.map((e) => `${r.profile}: ${e}`));
  if (errors.length) {
    lines.push('', '## Page errors', '');
    for (const e of errors) lines.push(`- ${e}`);
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------

/** Re-run the static check over a corpus already on disk (no browser). */
function recheck(dir) {
  const shaders = new Map();
  for (const name of fs.readdirSync(path.join(dir, 'shaders'))) {
    shaders.set(name, { text: fs.readFileSync(path.join(dir, 'shaders', name), 'utf8') });
  }
  const { seen, unseen, undetermined } = classifySites({ shaders }, authoredShaderSites());
  process.stdout.write(
    `met ${seen.length}, never met ${unseen.length}, undetermined ${undetermined.length}\n`,
  );
  for (const site of unseen)
    process.stdout.write(`never met: ${site.file} (${site.own.slice(0, 4).join(', ')})\n`);
  for (const site of undetermined) process.stdout.write(`undetermined: ${site.file}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.recheck) return recheck(path.resolve(args.recheck));
  const dirty = git(['status', '--porcelain'], '') !== '';
  if (dirty && !args.allowDirty)
    throw new Error('worktree is dirty; pass --allow-dirty to record it explicitly');
  const browserPath = findBrowserPath();
  if (!browserPath) throw new Error('No Chrome/Chromium found; set BROWSER_PATH');
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = args.out ?? path.join(ROOT, 'tmp', `shader-harvest-${id}`);
  fs.mkdirSync(path.join(outDir, 'shaders'), { recursive: true });
  const log = (line) => process.stdout.write(`${line}\n`);

  const vite = startVite(args.port, path.join(outDir, 'vite.log'));
  let browser = null;
  try {
    await waitForVite(args.port, 120_000);
    await verifyServedModule(args.port);
    log(`vite: serving this worktree on :${args.port} (verified)`);
    browser = await puppeteer.launch({
      executablePath: browserPath,
      headless: args.headed ? false : 'new',
      userDataDir: path.join(outDir, 'chrome-profile'),
      defaultViewport: VIEWPORT,
      args: [
        `--window-size=${VIEWPORT.width + 20},${VIEWPORT.height + 60}`,
        '--ignore-gpu-blocklist',
        '--enable-gpu',
        '--disable-backgrounding-occluded-windows',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        ...(args.angle ? [`--use-angle=${args.angle}`] : []),
      ],
    });
    const corpus = createCorpus();
    const runs = [];
    for (const profile of args.profiles) {
      log(`profile ${profile}: starting`);
      runs.push(await harvestProfile(browser, args, profile, corpus, log));
    }
    const meta = {
      gitSha: git(['rev-parse', '--short', 'HEAD'], 'unknown'),
      dirty,
      browser: await browser.version().catch(() => 'unknown'),
      createdAt: new Date().toISOString(),
      steps: args.steps,
      livePrograms: args.livePrograms,
      runs,
    };
    for (const shader of corpus.shaders.values()) {
      fs.writeFileSync(
        path.join(outDir, 'shaders', `${shader.hash}.${shader.stage}.glsl`),
        shader.text,
      );
    }
    fs.writeFileSync(
      path.join(outDir, 'corpus.json'),
      JSON.stringify(corpusIndex(corpus, meta), null, 1),
    );
    const sites = authoredShaderSites();
    fs.writeFileSync(path.join(outDir, 'report.md'), renderReport(meta, corpus, runs, sites));
    log(`corpus: ${corpus.programs.size} programs, ${corpus.shaders.size} shaders`);
    log(`report: ${path.join(outDir, 'report.md')}`);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    vite.kill('SIGTERM');
    killPort(args.port);
    fs.rmSync(path.join(outDir, 'chrome-profile'), { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
