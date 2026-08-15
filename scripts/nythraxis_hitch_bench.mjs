// Nythraxis hitch A/B: measures interior attach, geared-player arrival, the
// walk-in first sight of Nythraxis, the live 70% Aldric NPC spawn, and a forced
// Soul Rend material flip in the boss arena. The walk-in is not just staging:
// the arena entry pad sits outside the server's mob interest radius, so the
// boss reaches the client only once the observer moves in, and that first sight
// is a hitch of its own. Same roster and program counters as
// geared_arrival_bench.mjs; the
// scene is Nythraxis instead of Eastbrook. Same-checkout A/B uses
// ?encounterPrewarm=0 for the cold leg. Aldric is spawned by dropping the boss
// through the real phase-two HP gate (spawnNythraxisAldric -> createNpc), not
// by /dev spawn.
//
// Both legs are parked in an Aldric-free start zone first (ALDRIC_FREE_PARK_POS):
// world entry prewarms the spawn zone's static NPC models, and the zones a leg
// would otherwise start in (Eastbrook fresh, the crypt door after a disconnect)
// all place a brother_aldric on the same npc_aldric key, which would leave the
// aldric row comparing a model both legs already had.
//
//   npm run db:up
//   DATABASE_URL=... ALLOW_DEV_COMMANDS=1 npm run server
//   node scripts/nythraxis_hitch_bench.mjs
//
// Default runs cold then warm against this checkout and prints the table.
// BENCH_LEGS=cold or BENCH_LEGS=warm for a single headed launch (worktree A/B).
//   node scripts/nythraxis_hitch_bench.mjs --compare tmp/cold.json tmp/warm.json
//
// Env: BENCH_PORT (5199), BENCH_BOTS (6), BENCH_LABEL, BENCH_OUT, BENCH_GFX,
//      BENCH_LEGS, SERVER_URL, DATABASE_URL, BROWSER_PATH,
//      BENCH_BOOT_TIMEOUT_MS, BENCH_ENTRY_MS, BENCH_WAVE_MS.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';
import { BROWSER_PATH } from './browser_path.mjs';
import { dismissEntryOverlays } from './enter_offline_game.mjs';
import { assertLoopbackDatabaseUrl, assertLoopbackUrl } from './lib/loopback_guard.mjs';
import {
  ALDRIC_FREE_PARK_POS,
  aldricSpawnStandingPos,
  attributeHitchGaps,
  compareNythraxisHitchLegs,
  formatHitchGapAttribution,
  formatNythraxisHitchCompare,
  isInsideNythraxisArena,
  MOB_INTEREST_RADIUS,
  NYTHRAXIS_ALDRIC_SPAWN_DIST,
  NYTHRAXIS_ALDRIC_TEMPLATE_ID,
  NYTHRAXIS_ALDRIC_VISUAL_KEY,
  NYTHRAXIS_BOSS_TEMPLATE_ID,
  NYTHRAXIS_DUNGEON_ID,
  NYTHRAXIS_PHASE_TWO_HP_PERCENT,
  nythraxisBossSpawnFromEntry,
  nythraxisHitchObserverUrl,
  parseNythraxisHitchLegs,
  planarDistance,
} from './lib/nythraxis_hitch_bench.mjs';
import { chatCommandMessage, worldAuthMessage } from './lib/world_auth.mjs';
import { requireOnlineProfilerCapability } from './profiler/capability.mjs';
import {
  createGearedObserverFixture,
  GEARED_ARRIVAL_PEN,
  GearedArrivalRoster,
} from './profiler/geared_arrival_roster.mjs';
import { enterOnlineProfilerCharacter, profilerBrowserLaunchOptions } from './profiler/harness.mjs';

const PORT = Number(process.env.BENCH_PORT ?? 5199);
const LABEL = process.env.BENCH_LABEL ?? 'run';
const GFX = process.env.BENCH_GFX ?? 'insane';
const SERVER = process.env.SERVER_URL ?? 'http://localhost:8787';
const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://eastbrook:change-me@127.0.0.1:5433/eastbrook';
const BOOT_TIMEOUT_MS = Number(process.env.BENCH_BOOT_TIMEOUT_MS ?? 240000);
const ENTRY_MS = Number(process.env.BENCH_ENTRY_MS ?? 15000);
const WAVE_MS = Number(process.env.BENCH_WAVE_MS ?? 12000);
const OBSERVER_CLASS = 'warrior';
const OBSERVER_XFF = '172.19.31.1';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = process.env.BENCH_OUT ?? path.join('tmp', `nythraxis-hitch-${LABEL}-${stamp}.json`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function gitOutput(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
const headSha = gitOutput(['rev-parse', 'HEAD']);
const dirty = (gitOutput(['status', '--porcelain']) ?? '') !== '';

function printCompare(cold, warm) {
  const compare = compareNythraxisHitchLegs(cold, warm);
  console.log(`\n${formatNythraxisHitchCompare(compare)}`);
  return compare;
}

function evidenceLeg(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (raw.phases) return raw.phases;
  if (raw.legs?.cold && !raw.legs?.warm) return raw.legs.cold;
  if (raw.legs?.warm && !raw.legs?.cold) return raw.legs.warm;
  throw new Error(`${file} has no single hitch leg (phases or one of legs.cold/legs.warm)`);
}

if (process.argv[2] === '--compare') {
  const a = process.argv[3];
  const b = process.argv[4];
  if (!a || !b) {
    throw new Error('usage: node scripts/nythraxis_hitch_bench.mjs --compare cold.json warm.json');
  }
  printCompare(evidenceLeg(a), evidenceLeg(b));
  process.exit(0);
}

async function startVite() {
  const vite = spawn(
    process.execPath,
    [path.join('node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  vite.stdout.on('data', (chunk) => {
    output += chunk;
  });
  vite.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) {
      throw new Error(`vite exited before ready (port ${PORT} busy?):\n${output}`);
    }
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) return vite;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  vite.kill('SIGTERM');
  throw new Error(`vite not ready on :${PORT} within 30s:\n${output}`);
}

async function createObserverCharacter(fixture) {
  const response = await fetch(`${SERVER.replace(/\/+$/, '')}/api/characters`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${fixture.token}`,
      'X-Forwarded-For': OBSERVER_XFF,
    },
    body: JSON.stringify({ name: fixture.characterName, class: OBSERVER_CLASS }),
  });
  const body = await response.json().catch(() => ({}));
  const id = body?.id ?? body?.character?.id;
  if (!Number.isInteger(id)) {
    throw new Error(
      `observer character create failed (${response.status}): ${JSON.stringify(body)}`,
    );
  }
  return id;
}

// Parks the observer in an Aldric-free zone between legs, over the game's own
// dev command rather than a DB write, so the leg that follows enters the world
// with npc_aldric genuinely cold. Resuming a linkdead session works the same
// way: being inside an instance is positional (dungeonAt reads pos.x), so the
// teleport really leaves the arena, and the next leg opens with /dev raid reset.
async function parkObserver(fixture, pos) {
  const wsUrl = `${SERVER.replace(/^http/, 'ws').replace(/\/+$/, '')}/ws`;
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let helloSeen = false;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* already closing */
      }
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error('observer park: join timeout')), 25000);
    socket.on('open', () =>
      socket.send(JSON.stringify(worldAuthMessage(fixture.token, fixture.characterId))),
    );
    socket.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      if (message.t === 'error' && !helloSeen) {
        finish(new Error(`observer park refused: ${message.error ?? 'world auth failed'}`));
        return;
      }
      if (message.t !== 'hello' || helloSeen) return;
      helloSeen = true;
      socket.send(JSON.stringify(chatCommandMessage(`/dev tp ${pos.x} ${pos.z}`)));
      setTimeout(() => {
        try {
          socket.send(JSON.stringify({ t: 'logout' }));
        } catch {
          /* the close below still settles */
        }
        setTimeout(() => finish(), 800);
      }, 1500);
    });
    socket.on('error', (error) => finish(error));
    socket.on('close', () =>
      finish(helloSeen ? undefined : new Error('observer park: closed before hello')),
    );
  });
  console.log(`observer parked at ${pos.x}, ${pos.z} (Aldric-free start zone)`);
}

function godRoster(roster) {
  for (const bot of roster.bots) {
    bot.socket?.send(JSON.stringify(chatCommandMessage('/dev god')));
  }
}

// Installed before any page script so a gap can be attributed instead of
// guessed: long tasks say whether the main thread was running JS at all, and
// the media marks say whether an un-preloaded voice line decoded right there.
async function installHitchProbe(page) {
  await page.evaluateOnNewDocument(() => {
    const probe = { marks: [], longTasks: [] };
    window.__benchProbe = probe;
    const MARK_CAP = 2000;
    const note = (label) => {
      // Evict oldest rather than stop recording: the boss track alone fires a
      // few marks per second, so a hard stop would blind the LAST and most
      // interesting phase while keeping the first.
      probe.marks.push({ label, at: performance.now() });
      if (probe.marks.length > MARK_CAP) probe.marks.splice(0, probe.marks.length - MARK_CAP);
    };
    window.__benchMark = note;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          probe.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
          if (probe.longTasks.length > MARK_CAP) {
            probe.longTasks.splice(0, probe.longTasks.length - MARK_CAP);
          }
        }
      }).observe({ entryTypes: ['longtask'] });
    } catch {
      /* no longtask support: gaps stay unattributed rather than mislabelled */
    }
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function patchedPlay(...args) {
      const src = String(this.currentSrc || this.src || '');
      note(`media-play:${src.slice(src.lastIndexOf('/') + 1)}`);
      return play.apply(this, args);
    };
    const AudioCtx = window.AudioContext ?? window.webkitAudioContext;
    if (AudioCtx?.prototype?.decodeAudioData) {
      const decode = AudioCtx.prototype.decodeAudioData;
      AudioCtx.prototype.decodeAudioData = function patchedDecode(...args) {
        note('decodeAudioData');
        return decode.apply(this, args);
      };
    }
  });
}

async function enterObserver(page, fixture, origin, prewarm) {
  await installHitchProbe(page);
  await page.evaluateOnNewDocument((session) => {
    localStorage.setItem(
      'woc_session',
      JSON.stringify({ token: session.token, username: session.username }),
    );
  }, fixture);
  await page.goto(nythraxisHitchObserverUrl({ origin, gfx: GFX, prewarm }), {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#btn-online', { timeout: BOOT_TIMEOUT_MS });
  await page.evaluate(() => document.querySelector('#btn-online')?.click());
  await enterOnlineProfilerCharacter(page, { name: fixture.characterName, cls: 'warrior' });
  await page
    .waitForSelector('#ws-continue:not([disabled])', { visible: true, timeout: 20000 })
    .catch(() => {});
  await page.evaluate(() => {
    const button = document.querySelector('#ws-continue');
    if (button && !button.disabled) button.click();
  });
  await page.waitForFunction(
    () => Boolean(window.__game?.world?.player && window.__game?.renderer?.perfStats),
    { timeout: BOOT_TIMEOUT_MS, polling: 250 },
  );
  const gl = await page.evaluate(() => window.__game.renderer.perfStats().glRenderer ?? '');
  if (/swiftshader|llvmpipe|software/i.test(gl)) {
    throw new Error(`software GL renderer ("${gl}")`);
  }
  await dismissEntryOverlays(page);
  await page.evaluate(() => {
    for (const btn of document.querySelectorAll('button, .close, [aria-label="Close"]')) {
      const label = (btn.getAttribute('aria-label') ?? btn.textContent ?? '').trim();
      if (label === 'Close' || label === 'x' || label === 'X') btn.click();
    }
  });
}

async function measureWindow(page, ms, afterStart) {
  const pending = page.evaluate(
    async (durationMs, wantProgramDiff) => {
      const g = window.__game;
      const programKeys = () =>
        wantProgramDiff
          ? (g.renderer.webgl.info.programs ?? []).map((p) => `${p.name}\t${p.cacheKey}`)
          : null;
      const keysBefore = programKeys();
      const before = g.renderer.perfStats();
      g.perf.reset();
      const gaps = [];
      const stamped = [];
      const windowStart = performance.now();
      let last = windowStart;
      let raf = true;
      const tick = () => {
        const now = performance.now();
        const gap = now - last;
        gaps.push(gap);
        if (gap >= 50) stamped.push({ at: now, ms: gap });
        last = now;
        if (raf) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      await new Promise((r) => setTimeout(r, durationMs));
      raf = false;
      const windowEnd = performance.now();
      const probe = window.__benchProbe ?? { marks: [], longTasks: [] };
      const inWindow = (at) => at >= windowStart && at <= windowEnd;
      const after = g.renderer.perfStats();
      const s = g.perf.report();
      const sorted = [...gaps].sort((a, b) => b - a);
      let players = 0;
      for (const e of g.world.entities.values()) if (e.kind === 'player') players++;
      return {
        worstGaps: sorted.slice(0, 6).map((v) => Math.round(v * 10) / 10),
        stampedGaps: stamped.sort((a, b) => b.ms - a.ms).slice(0, 8),
        longTasks: probe.longTasks.filter((task) => inWindow(task.startTime)),
        marks: probe.marks.filter((mark) => inWindow(mark.at)),
        stallsOver150: gaps.filter((v) => v >= 150).length,
        stallsOver50: gaps.filter((v) => v >= 50).length,
        programsDelta: after.programs - before.programs,
        texturesDelta: after.textures - before.textures,
        viewsAfter: after.views,
        visiblePlayers: players,
        hitchByCause: s.hitches?.byCause ?? null,
        traceWorst: (s.devTrace?.frames ?? []).slice(0, 3).map((f) => ({
          frameMs: f.frameMs,
          scoreMs: f.scoreMs,
          reasons: f.reasons,
          stall: f.stallAttribution
            ? {
                submitMs: f.stallAttribution.submitMs,
                programDelta: f.stallAttribution.programDelta,
                createdViewTypes: f.stallAttribution.createdViewTypes,
              }
            : null,
        })),
        newProgramKeys: (() => {
          if (!wantProgramDiff) return null;
          const beforeSet = new Set(keysBefore);
          return programKeys().filter((k) => !beforeSet.has(k));
        })(),
      };
    },
    ms,
    process.env.BENCH_PROGRAM_DIFF === '1',
  );
  // Handled before anything can throw: if afterStart rejects, runLeg's finally
  // closes the browser, this evaluate rejects with nobody attached, and the
  // unhandled rejection kills the process, losing BOTH the real error and the
  // evidence file.
  const settled = pending.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await sleep(400);
  const extra = afterStart ? await afterStart() : null;
  const outcome = await settled;
  if (outcome.error) throw outcome.error;
  const result = outcome.value;
  const merged = extra ? { ...result, ...extra } : result;
  merged.gapAttribution = attributeHitchGaps({
    gaps: merged.stampedGaps,
    longTasks: merged.longTasks,
    marks: merged.marks,
  });
  return merged;
}

async function flipSoulRend(page) {
  return page.evaluate(() => {
    const world = window.__game.world;
    window.__benchMark?.('flip-start');
    const flipStart = performance.now();
    let soulRendFlips = 0;
    const pin = (visual) => {
      if (!visual?.setSoulRend) return;
      if (!visual.__benchSoulRendPinned) {
        const orig = visual.setSoulRend.bind(visual);
        visual.setSoulRend = () => orig(true);
        visual.__benchSoulRendPinned = true;
      }
      visual.setSoulRend(true);
      soulRendFlips++;
    };
    for (const [id, view] of window.__game.renderer.views) {
      const entity = world.entities.get(id);
      if (entity?.kind !== 'player') continue;
      pin(view.visual);
      pin(view.sheepVisual);
      pin(view.bearVisual);
      pin(view.catVisual);
      pin(view.travelVisual);
      pin(view.metamorphVisual);
    }
    window.__benchMark?.('flip-end');
    return { soulRendFlips, soulRendFlipMs: Math.round(performance.now() - flipStart) };
  });
}

// The membership RULE stays in the pure helper the tests pin, and runs here on
// the live readout: an inline copy in the page would be a second rule free to
// drift from the pinned one.
async function awaitInsideArena(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const player = await page.evaluate(() => {
      const live = window.__game?.world?.player;
      return live ? { dungeonId: live.dungeonId ?? null, pos: { x: live.pos.x } } : null;
    });
    if (isInsideNythraxisArena(player)) return;
    if (Date.now() > deadline) {
      throw new Error(`observer never entered ${NYTHRAXIS_DUNGEON_ID} (last x=${player?.pos?.x})`);
    }
    await sleep(200);
  }
}

async function teleportObserver(page, pos) {
  await page.evaluate(
    (x, z) => {
      window.__game.world.chat(`/dev tp ${x} ${z}`);
    },
    pos.x,
    pos.z,
  );
}

// The boss enters the client's world only once the observer is inside the mob
// interest radius, so this doubles as the walk-in and as the first-sight
// measurement of the Nythraxis rig itself.
async function awaitBossView(page, timeoutMs) {
  return page
    .waitForFunction(
      (templateId) => {
        const world = window.__game?.world;
        const renderer = window.__game?.renderer;
        if (!world || !renderer) return null;
        for (const [id, entity] of world.entities) {
          if (entity.templateId !== templateId || entity.dead) continue;
          if (!renderer.views.has(id)) continue;
          return { id, x: entity.pos.x, z: entity.pos.z };
        }
        return null;
      },
      { timeout: timeoutMs, polling: 50 },
      NYTHRAXIS_BOSS_TEMPLATE_ID,
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null);
}

function logPhase(name, result) {
  const extras = [];
  if (result.soulRendFlips != null) extras.push(`soulRend=${result.soulRendFlips}`);
  if (result.soulRendFlipMs != null) extras.push(`flip=${result.soulRendFlipMs}ms`);
  if (result.bossSeen != null) extras.push(`boss=${result.bossSeen}`);
  if (result.aldricSeen != null)
    extras.push(`aldric=${result.aldricSeen}:${result.aldricKind ?? '?'}`);
  console.log(
    `  ${name}: worst=${result.worstGaps?.[0] ?? 0}ms stalls>150=${result.stallsOver150} programs+${result.programsDelta} players=${result.visiblePlayers}${
      extras.length ? ` ${extras.join(' ')}` : ''
    }`,
  );
  if (result.gapAttribution?.length) {
    console.log(`    gaps: ${formatHitchGapAttribution(result.gapAttribution)}`);
  }
}

// Runs on BOTH legs on purpose. Settling only the warm leg would hand it, and
// only it, up to three minutes of extra idle before every later phase, letting
// unrelated lazy work finish there and nowhere else: the boss and aldric rows
// would stop being like-for-like.
async function settlePrograms(page) {
  const deadline = Date.now() + 180000;
  let last = -1;
  let stableSince = Date.now();
  for (;;) {
    const programs = await page.evaluate(() => window.__game.renderer.perfStats().programs);
    if (programs !== last) {
      last = programs;
      stableSince = Date.now();
      console.log(`  prewarm settling: programs=${programs}`);
    }
    if (Date.now() - stableSince > 12000) break;
    if (Date.now() > deadline) {
      console.log('  prewarm settle timeout, continuing');
      break;
    }
    await sleep(2000);
  }
  console.log(`  settled at programs=${last}`);
}

async function runLeg({ origin, fixture, roster, prewarm, name }) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'woc-nyth-hitch-'));
  const browser = await puppeteer.launch({
    ...profilerBrowserLaunchOptions({
      browserPath: BROWSER_PATH,
      userDataDir: profileDir,
      headless: false,
      width: 1600,
      height: 900,
      extraArgs: [
        '--disable-gpu-shader-disk-cache',
        '--enable-gpu-rasterization',
        '--use-gl=angle',
        '--use-angle=gl',
        '--enable-webgl',
        '--no-sandbox',
        '--mute-audio',
      ],
    }),
  });
  try {
    const page = await browser.newPage();
    page.on('dialog', (dialog) => void dialog.accept().catch(() => {}));
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
    console.log(`entering observer (${name}, prewarm=${prewarm})...`);
    await enterObserver(page, fixture, origin, prewarm);
    await page.evaluate(() => window.__game.world.chat('/dev god'));
    await sleep(200);
    await page.evaluate(() => window.__game.world.chat('/dev raid reset'));
    await sleep(200);

    // World entry prewarms every static NPC model of the spawn zone, and the
    // Eastbrook brother_aldric shares npc_aldric with the raid Aldric. When
    // that is already true here, the catalog's Aldric arm is a no-op and the
    // aldric row below says nothing about the prewarm either way.
    const aldricVisualWarmAtEntry = await page.evaluate(
      (key) => window.__game?.renderer?.prewarmedNpcModels?.has(key) ?? null,
      NYTHRAXIS_ALDRIC_VISUAL_KEY,
    );
    console.log(
      `  ${name} ${NYTHRAXIS_ALDRIC_VISUAL_KEY} already warm from the entry zone: ${aldricVisualWarmAtEntry}`,
    );

    console.log(`  ${name} entry: /dev raid normal`);
    const entry = await measureWindow(page, ENTRY_MS, async () => {
      await page.evaluate(() => window.__game.world.chat('/dev raid normal'));
      return null;
    });
    logPhase('entry', entry);
    await awaitInsideArena(page, 30000);
    await settlePrograms(page);

    const arena = await page.evaluate(() => {
      const pos = window.__game.world.player.pos;
      return { x: pos.x, z: pos.z };
    });
    console.log(
      `  ${name} arrival: ${roster.bots.length} geared bots -> ${arena.x.toFixed(1)}, ${arena.z.toFixed(1)}`,
    );
    const arrival = await measureWindow(page, WAVE_MS, async () => {
      roster.placeAll(arena);
      return null;
    });
    logPhase('arrival', arrival);
    await settlePrograms(page);

    // The arena entry pad sits 92 yd from the boss spawn, past the server's mob
    // interest radius, so the boss is absent from world.entities until the
    // observer walks in. Walk to the Aldric spawn point (50 yd out, clear of the
    // pull radius) and measure the first sight of Nythraxis on the way.
    const bossSpawn = nythraxisBossSpawnFromEntry(arena);
    const walkIn = aldricSpawnStandingPos(bossSpawn, NYTHRAXIS_ALDRIC_SPAWN_DIST);
    let seenBoss = null;
    console.log(
      `  ${name} boss: walk in to ${walkIn.x.toFixed(1)}, ${walkIn.z.toFixed(1)} (${planarDistance(walkIn, bossSpawn).toFixed(0)} yd out, interest ${MOB_INTEREST_RADIUS})`,
    );
    const bossSight = await measureWindow(page, WAVE_MS, async () => {
      await teleportObserver(page, walkIn);
      seenBoss = await awaitBossView(page, Math.max(2000, WAVE_MS - 1000));
      return { bossSeen: seenBoss ? 1 : 0 };
    });
    logPhase('boss', bossSight);
    if (!seenBoss) {
      throw new Error(
        `Nythraxis never entered interest from ${walkIn.x.toFixed(1)}, ${walkIn.z.toFixed(1)} (expected spawn ${bossSpawn.x.toFixed(1)}, ${bossSpawn.z.toFixed(1)})`,
      );
    }
    await settlePrograms(page);

    const boss = seenBoss;
    const drift = planarDistance(boss, bossSpawn);
    const aldricStand = aldricSpawnStandingPos(boss, NYTHRAXIS_ALDRIC_SPAWN_DIST);
    console.log(
      `  ${name} aldric: stand ${aldricStand.x.toFixed(1)}, ${aldricStand.z.toFixed(1)} (layout drift ${drift.toFixed(1)} yd); pull at boss; /dev hp ${NYTHRAXIS_PHASE_TWO_HP_PERCENT}`,
    );
    if (drift > 1) await teleportObserver(page, aldricStand);
    roster.placeAll({ x: boss.x, z: boss.z });
    await sleep(400);
    await page.evaluate((id) => {
      window.__game.world.targetEntity(id);
    }, boss.id);
    await sleep(1500);

    const aldric = await measureWindow(page, WAVE_MS, async () => {
      await page.evaluate((percent) => {
        window.__benchMark?.('dev-hp');
        window.__game.world.chat(`/dev hp ${percent}`);
      }, NYTHRAXIS_PHASE_TWO_HP_PERCENT);
      await page
        .waitForFunction(
          (templateId) => {
            const world = window.__game?.world;
            const renderer = window.__game?.renderer;
            if (!world || !renderer) return false;
            for (const [id, entity] of world.entities) {
              if (entity.templateId !== templateId || entity.dead) continue;
              if (entity.kind !== 'npc') continue;
              return renderer.views.has(id);
            }
            return false;
          },
          { timeout: Math.max(2000, WAVE_MS - 1000), polling: 50 },
          NYTHRAXIS_ALDRIC_TEMPLATE_ID,
        )
        .catch(() => {});
      return page.evaluate((templateId) => {
        window.__benchMark?.('aldric-view');
        let aldricSeen = 0;
        let aldricKind = null;
        for (const entity of window.__game.world.entities.values()) {
          if (entity.templateId !== templateId || entity.dead) continue;
          aldricSeen++;
          aldricKind = entity.kind;
        }
        return { aldricSeen, aldricKind };
      }, NYTHRAXIS_ALDRIC_TEMPLATE_ID);
    });
    logPhase('aldric', aldric);
    if (!aldric.aldricSeen || aldric.aldricKind !== 'npc') {
      throw new Error(
        `Aldric did not spawn as an NPC via the 70% transition (seen=${aldric.aldricSeen} kind=${aldric.aldricKind}); the bots must pull Nythraxis for the encounter driver to run`,
      );
    }
    await settlePrograms(page);

    console.log(`  ${name} soulRend: pin setSoulRend(true) so sync cannot clear it (${WAVE_MS}ms)`);
    const soulRend = await measureWindow(page, WAVE_MS, async () => flipSoulRend(page));
    logPhase('soulRend', soulRend);
    // Without this, a leg where the bots never landed reports worst=16ms,
    // programs+0, no stall: byte for byte what a perfect prewarm looks like.
    if (!soulRend.soulRendFlips || soulRend.visiblePlayers <= roster.bots.length) {
      throw new Error(
        `soulRend measured nothing: flips=${soulRend.soulRendFlips} visiblePlayers=${soulRend.visiblePlayers} (expected the observer plus ${roster.bots.length} bots)`,
      );
    }

    roster.placeAll(GEARED_ARRIVAL_PEN);
    await sleep(500);
    return { entry, arrival, boss: bossSight, aldric, soulRend, arena, aldricVisualWarmAtEntry };
  } finally {
    await browser.close().catch(() => {});
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

async function main() {
  const BOTS = Number(process.env.BENCH_BOTS ?? 6);
  if (!Number.isInteger(BOTS) || BOTS <= 0 || BOTS > 40) {
    throw new Error('BENCH_BOTS must be an integer from 1 to 40');
  }
  const LEGS = parseNythraxisHitchLegs(process.env.BENCH_LEGS);
  assertLoopbackUrl(SERVER, 'SERVER_URL');
  assertLoopbackUrl(`http://localhost:${PORT}/`, 'BENCH_PORT');
  assertLoopbackDatabaseUrl(DB_URL);
  console.log(
    `nythraxis hitch bench: label=${LABEL} sha=${headSha} legs=${LEGS.join(',')} bots=${BOTS}`,
  );
  await requireOnlineProfilerCapability(SERVER);
  const roster = new GearedArrivalRoster({
    serverUrl: SERVER,
    databaseUrl: DB_URL,
    count: BOTS,
    runId: `${Date.now().toString(36)}${process.pid.toString(36)}`,
  });
  const origin = `http://localhost:${PORT}/`;
  const vite = await startVite();
  let fixture = null;
  try {
    console.log(`setting up ${BOTS} geared bots at the holding pen...`);
    await roster.prepare({ center: GEARED_ARRIVAL_PEN });
    godRoster(roster);
    fixture = await createGearedObserverFixture(SERVER, roster.runId);
    roster.observerUsername = fixture.username;
    // Created here rather than through the character creator in the first leg,
    // so BOTH legs can be parked in the same Aldric-free zone before entering.
    fixture.characterId = await createObserverCharacter(fixture);
    await sleep(500);

    const legs = {};
    for (const name of LEGS) {
      const prewarm = name === 'warm';
      await parkObserver(fixture, ALDRIC_FREE_PARK_POS);
      legs[name] = await runLeg({ origin, fixture, roster, prewarm, name });
    }

    const evidence = {
      label: LABEL,
      headSha,
      dirty,
      gfx: GFX,
      startedAt: stamp,
      bots: BOTS,
      fixtureSha256: roster.fixtureSha256,
      fixture: roster.evidence(),
      legs,
    };
    if (legs.cold && legs.warm) {
      evidence.compare = printCompare(legs.cold, legs.warm);
    }
    if (Object.values(legs).some((leg) => leg.aldricVisualWarmAtEntry)) {
      console.log(
        `\nnote: ${NYTHRAXIS_ALDRIC_VISUAL_KEY} was already warm at world entry despite the park,`,
      );
      console.log(
        'so the aldric row measures a model that leg already had. Check the park destination.',
      );
    }
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2));
    console.log(`\n${LABEL} @ ${headSha}${dirty ? ' (dirty)' : ''}`);
    console.log(`evidence: ${OUT}`);
  } finally {
    vite.kill('SIGTERM');
    await roster.close().catch((error) => console.warn(`fixture cleanup failed: ${error.message}`));
  }
}

await main();
