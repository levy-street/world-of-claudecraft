// Captures one in-game snapshot per named boss attack for the player wiki, rendered by the
// REAL engine: the offline client (index.html through Vite, the same Sim + Renderer the
// game ships) is driven headless on swiftshader, each boss is staged with the game's own
// /dev playtest commands, each attack is forced (a /dev trigger) or waited for (its own
// timer), and the in-page probe (attack_snapshot_probe.js) freezes the sim at the attack's
// most readable moment so the telegraph or effect holds still for the screenshot.
//
// Output: public/encyclopedia-attacks/<mobTemplateId>__<attackKey>.webp (dark scene,
// ATTACK_PX wide) and scripts/wiki/attack_snapshots.json, mapping
// { mobTemplateId: { "<attack name as the wiki prints it>": "/encyclopedia-attacks/<file>" } }.
// A run MERGES into the existing manifest, so ONLY=<mobId,...> reruns one boss.
//
// Which attacks exist comes from attack_snapshot_targets.ts (the wiki's own name sources);
// how each boss is staged comes from attack_snapshot_stages.mjs. Gameplay code is not
// touched: the probe only wraps the live Sim instance's tick() from the page.
//
// Run: node scripts/wiki/render_attack_snapshots.mjs
//   ONLY=korgath_the_bound,morthen   restrict to these bosses
//   GAME_URL=http://127.0.0.1:5173   use an already running dev client instead of
//                                    starting Vite here (ATTACK_PORT, default 5241)
//   ATTACK_PX=384                    shipped width
//   REAL_GPU=1                       hardware WebGL (faster); default is swiftshader
//   UNSTAGED=1                       also try bosses with no stage (spawned; see the stages file)
//   KEEP_RAW=1                       also keep the full PNG frames under tmp/attacks/raw
// Windows: launch from PowerShell (Chrome fails to start from Git Bash on some machines).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { BROWSER_PATH } from '../browser_path.mjs';
import { enterOfflineGame } from '../enter_offline_game.mjs';
import { suppressGpuNotice } from '../lib/gpu_notice_suppress.mjs';
import { REJECTED, STAGES } from './attack_snapshot_stages.mjs';

const root = process.cwd();
const OUT_DIR = 'encyclopedia-attacks';
const outDir = path.join(root, 'public', OUT_DIR);
const rawDir = path.join(root, 'tmp', 'attacks', 'raw');
const manifestPath = path.join(root, 'scripts', 'wiki', 'attack_snapshots.json');
const OUT_PX = Number(process.env.ATTACK_PX || 384);
const PORT = Number(process.env.ATTACK_PORT || 5241);
// RETRY_REJECTED=1 captures ONLY the REJECTED entries again (for a fresh review) and keeps
// them; take an entry off REJECTED once its new frame passes review.
const RETRY_REJECTED = Boolean(process.env.RETRY_REJECTED);
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const TICK_HZ = 20;
// The page renders at SCALE x the 960 x 640 layout the stages were tuned on (same aspect, so
// the same framing), so the 660 x 500 crop is a real 1320 x 1000 render: the full-size
// image is downscaled from it, never upscaled.
const SCALE = 2;
const VIEW = { width: 960 * SCALE, height: 640 * SCALE, deviceScaleFactor: 1 };
// The square-ish centre of the frame the camera rig below aims the fight into.
const CLIP = { x: 150 * SCALE, y: 30 * SCALE, width: 660 * SCALE, height: 500 * SCALE };
const FULL_PX = Number(process.env.ATTACK_FULL_PX || 1024);
// MANIFEST_ONLY=1 recaptures only the attacks the manifest already ships (a re-shoot).
const MANIFEST_ONLY = Boolean(process.env.MANIFEST_ONLY);
// STAGE_TO=<dir> writes captures (thumb plus full/) there instead of public/ and leaves
// the manifest alone, so a re-shoot can be reviewed against the shipped frames first.
const STAGE_TO = process.env.STAGE_TO ? path.resolve(process.env.STAGE_TO) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const thumbDir = STAGE_TO ?? outDir;
const fullDir = path.join(thumbDir, 'full');
mkdirSync(fullDir, { recursive: true });
if (process.env.KEEP_RAW) mkdirSync(rawDir, { recursive: true });

export const attackKey = (name) =>
  name
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

// 1) The attack list, bundled from the wiki's own name sources (never import raw .ts).
const targetsBuilt = await esbuild.build({
  stdin: {
    contents: "export { attackTargets } from './scripts/wiki/attack_snapshot_targets.ts';",
    resolveDir: root,
    sourcefile: 'attack-targets-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  define: { 'import.meta.env': '{"PROD":true,"DEV":false}' },
  write: false,
  logLevel: 'silent',
});
const { attackTargets } = await import(
  `data:text/javascript;base64,${Buffer.from(targetsBuilt.outputFiles[0].text).toString('base64')}`
);
const BOSSES = attackTargets();
const totalAttacks = BOSSES.reduce((n, b) => n + b.attacks.length, 0);
console.log(`${BOSSES.length} bosses, ${totalAttacks} named attacks`);

// 2) The real client: this worktree's Vite dev server unless GAME_URL points at one.
let vite = null;
let gameUrl = process.env.GAME_URL;
if (!gameUrl) {
  const { createServer } = await import('vite');
  vite = await createServer({
    server: { port: PORT, strictPort: true, host: '127.0.0.1' },
    logLevel: 'error',
  });
  await vite.listen();
  gameUrl = `http://127.0.0.1:${PORT}`;
}

const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
const report = [];
const probeSource = readFileSync(
  path.join(root, 'scripts', 'wiki', 'attack_snapshot_probe.js'),
  'utf8',
);

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    `--window-size=${VIEW.width},${VIEW.height}`,
    ...(process.env.REAL_GPU
      ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
  ],
  defaultViewport: VIEW,
  protocolTimeout: 600_000,
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('PAGEERR', e.message.slice(0, 300)));
  await suppressGpuNotice(page);
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('woc_unsupported_browser_dismissed', '1');
    localStorage.setItem('woc.cameraModePrompt.shown', '1');
  });
  await page.goto(`${gameUrl}?gfx=medium`, { waitUntil: 'domcontentloaded', timeout: 600_000 });
  // #btn-offline is static HTML, so it exists long before a cold dev server has wired its
  // handler; a single early click is lost and the class picker never opens. Keep clicking
  // until the picker shows, then hand over to the shared entry flow.
  const pickerUntil = Date.now() + 900_000;
  for (;;) {
    const open = await page
      .evaluate(() => {
        document.querySelector('#btn-offline')?.click();
        const card = document.querySelector('#offline-select .mini-class');
        return Boolean(card && card.getBoundingClientRect().width > 0);
      })
      .catch(() => false);
    if (open) break;
    if (Date.now() > pickerUntil) throw new Error('class picker never opened');
    await sleep(5000);
  }
  const booted = await enterOfflineGame(page, {
    charName: 'Snapshotter',
    settleMs: 500,
    gameBootTimeoutMs: 600_000,
    selectorTimeoutMs: 600_000,
  });
  if (!booted) throw new Error('offline world did not boot');
  await page.addStyleTag({
    content:
      '#ui, #nameplates, #gpu-notice, #perf-nudge, #tutorial-greeting, #loot-settings-window, #options-menu, .camera-prompt-backdrop, .toast, .fct { display: none !important; }',
  });
  await page.evaluate(probeSource);
  // The real render size (a graphics tier can render below the page size): the full-size
  // file is only honest when the drawing buffer is at least the viewport.
  console.log(
    'drawing buffer',
    await page.evaluate(() => {
      const c = window.__game.renderer.renderer?.domElement ?? document.querySelector('canvas');
      return `${c.width}x${c.height} for ${innerWidth}x${innerHeight}`;
    }),
  );
  // The client's own cast-label resolver, so a bar label folds to the name the wiki prints.
  await page.evaluate(async () => {
    const m = await import('/src/ui/cast_display_name.ts');
    window.__attackProbe.castName = (label) => {
      try {
        return m.targetCastDisplayName(label);
      } catch {
        return label;
      }
    };
  });

  // Chat with the token bucket refilled: /dev lines are staging, not player chat, and the
  // throttle counts SIM time, which the probe may have frozen.
  const chat = (line) =>
    page.evaluate((l) => {
      const w = window.__game.world;
      w.ctx.chatTokens?.delete(w.playerId);
      w.chat(l);
    }, line);
  const status = () => page.evaluate(() => window.__attackProbe.status());
  /** Run the sim `seconds` (boosted), stopping early if the probe freezes on a catch. */
  const runFor = async (seconds, realLimitMs = 240_000) => {
    const start = (await status()).ticks;
    const until = Date.now() + realLimitMs;
    await page.evaluate(() => window.__attackProbe.boost(2));
    let s = await status();
    while (!s.frozen && s.ticks - start < seconds * TICK_HZ && Date.now() < until) {
      await sleep(250);
      s = await status();
    }
    await page.evaluate(() => window.__attackProbe.boost(0));
    return s;
  };

  // Keep the player still, facing the boss, and the chase camera parked behind and above
  // so the boss, the player and the ground between them fill the frame.
  await page.evaluate(() => {
    window.__frameRig = setInterval(() => {
      const g = window.__game;
      const w = g.world;
      const p = w.player;
      const boss =
        window.__attackProbe.bossId === null ? null : w.entities.get(window.__attackProbe.bossId);
      if (!p || !boss || boss.dead) return;
      // Keep the boss on the player: a boss that drops its target stops casting.
      if (!boss.inCombat || boss.targetId !== p.id) {
        try {
          w.ctx.aggroMob(boss, p, false);
        } catch {
          // A scripted boss may refuse; its own engage path holds it.
        }
      }
      p.vx = 0;
      p.vz = 0;
      if (p.dead) {
        p.dead = false;
        p.hp = p.maxHp;
      }
      const facing = Math.atan2(boss.pos.x - p.pos.x, boss.pos.z - p.pos.z);
      p.facing = facing;
      p.prevFacing = facing;
      const big = window.__frameBig ?? 1;
      const cam = window.__frameCam ?? {};
      g.input.camYaw = facing + (cam.yaw ?? 0.2);
      g.input.camPitch = cam.pitch ?? 1.0;
      g.input.camDist = (cam.dist ?? 22) * big;
    }, 40);
  });

  const findBoss = (mobId) =>
    page.evaluate((id) => {
      const w = window.__game.world;
      const p = w.player;
      let best = null;
      let bestD = Infinity;
      for (const e of w.entities.values()) {
        if (e.templateId !== id || e.dead) continue;
        const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
        if (d < bestD) {
          best = e;
          bestD = d;
        }
      }
      if (!best || bestD > 400) return null;
      try {
        w.ctx.aggroMob(best, p, false);
      } catch {
        // A scripted boss may refuse a plain aggro; its own engage path already ran.
      }
      // A big body needs a longer lens.
      window.__frameBig = Math.min(2, Math.max(1, (best.radius ?? 1) / 2.5));
      return { id: best.id, dist: bestD };
    }, mobId);

  /** Wait (real time, sim running) until the zone-loading curtain is down. */
  const waitCurtain = async (limitMs = 300_000) => {
    const until = Date.now() + limitMs;
    while (Date.now() < until) {
      const up = await page.evaluate(
        () => document.querySelector('#loading-screen')?.classList.contains('visible') ?? false,
      );
      if (!up) return true;
      await sleep(1000);
    }
    return false;
  };

  const capture = async (boss, name, how) => {
    // The GPU toast mounts late on software GL; it is shell chrome, never part of a still.
    await page.evaluate(() => {
      for (const id of ['gpu-notice', 'perf-nudge']) document.getElementById(id)?.remove();
    });
    // A few rendered frames with the sim frozen: the camera settles, the VFX hold still.
    // An impact (nova, slam, landed cast) is a VFX that blooms over real render time, so it
    // gets a longer hold than a telegraph, which is already fully drawn.
    const holdMs = how === 'cast' || how === 'windup' ? 0 : 280;
    await page.evaluate(
      (ms) =>
        new Promise((r) => {
          const t0 = performance.now();
          let n = 0;
          const step = () =>
            ++n >= 4 && performance.now() - t0 >= ms ? r() : requestAnimationFrame(step);
          requestAnimationFrame(step);
        }),
      holdMs,
    );
    const png = await page.screenshot({ clip: CLIP, type: 'png' });
    const file = `${boss.mobId}__${attackKey(name)}.webp`;
    if (process.env.KEEP_RAW)
      writeFileSync(path.join(rawDir, file.replace(/\.webp$/, '.png')), png);
    // Two files from the same frame: the page thumbnail and the click-to-enlarge full size
    // (the wiki derives /full/ from the thumbnail's path).
    const webp = await sharp(png)
      .resize({ width: OUT_PX })
      .webp({ quality: 82, effort: 6 })
      .toBuffer();
    const full = await sharp(png)
      .resize({ width: FULL_PX })
      .webp({ quality: 82, effort: 6 })
      .toBuffer();
    writeFileSync(path.join(thumbDir, file), webp);
    writeFileSync(path.join(fullDir, file), full);
    if (!STAGE_TO) {
      manifest[boss.mobId] ??= {};
      manifest[boss.mobId][name] = `/${OUT_DIR}/${file}`;
    }
    console.log(
      `  ok ${file} (${(webp.length / 1024).toFixed(1)} KB, full ${(full.length / 1024).toFixed(1)} KB)`,
    );
  };

  /** Arm the generic watcher and fight for `seconds`, capturing every attack it catches. */
  const idleFight = async (boss, bossId, wanted, seconds) => {
    const got = [];
    await page.evaluate(
      (id, attacks, done) => window.__attackProbe.arm(id, attacks, done),
      bossId,
      wanted,
      [],
    );
    const startTicks = (await status()).ticks;
    while (got.length < wanted.length) {
      const left = seconds - ((await status()).ticks - startTicks) / TICK_HZ;
      if (left <= 0) break;
      const s = await runFor(left);
      if (!s.frozen || !s.caught) break;
      await capture(boss, s.caught.name, s.caught.how);
      got.push(s.caught.name);
      await page.evaluate((n) => window.__attackProbe.release(n), s.caught.name);
    }
    const s = await status();
    return { got, labels: s.labels };
  };

  let lastDungeon = null;
  for (const boss of BOSSES) {
    if (only && !only.has(boss.mobId)) continue;
    const stage = STAGES[boss.mobId];
    // An unstaged boss (a world elite or a rift boss) would be fought on a borrowed floor,
    // where its attack is an untelegraphed shared nova and a rift boss draws no windup ring
    // outside a rift: those frames show no attack, so the path is opt-in for experiments.
    if (!stage && !process.env.UNSTAGED) {
      report.push({
        mobId: boss.mobId,
        total: boss.attacks.length,
        got: [],
        missed: [],
        why: 'no stage',
      });
      continue;
    }
    const wantedNames = boss.attacks
      .map((a) => a.name)
      .filter((n) => REJECTED.has(`${boss.mobId}|${n}`) === RETRY_REJECTED)
      .filter((n) => !MANIFEST_ONLY || Boolean(manifest[boss.mobId]?.[n]));
    if (MANIFEST_ONLY && wantedNames.length === 0) continue;
    const bossStart = Date.now();
    console.log(`\n${boss.mobId} (${boss.mobName}): ${wantedNames.length} attacks`);
    const row = { mobId: boss.mobId, total: boss.attacks.length, got: [], missed: [], why: '' };
    report.push(row);
    try {
      await page.evaluate(() => window.__attackProbe.disarm());
      await page.evaluate((c) => {
        window.__frameCam = c;
      }, stage?.camera ?? null);
      await chat('/dev level 60');
      await chat('/dev god');
      if (lastDungeon === 'spawn') await chat('/dev despawn spawned');
      if (stage?.rift) {
        // A rift boss in a real rift at its rank (rift_stage_page.js): only a boss a rift
        // floor spawned runs its rank kit and draws its windup rings.
        const staged = await page.evaluate(
          async (id, rank, citadel) => {
            const m = await import('/scripts/wiki/rift_stage_page.js');
            await m.leaveAnyRift();
            const s = m.seedFor(id, rank, citadel);
            if (!s) return { error: 'no seed for this boss' };
            return { ...m.stageRiftBoss(id, s.seed, s.baseLevel), seed: s.seed };
          },
          boss.mobId,
          stage.rift.rank ?? 'S',
          Boolean(stage.rift.citadel),
        );
        console.log(`  rift: ${JSON.stringify(staged)}`);
        if (staged.error) throw new Error(`rift staging: ${staged.error}`);
        lastDungeon = 'rift';
      } else if (stage) {
        for (const line of stage.setup) {
          await chat(line);
          await sleep(400);
        }
        lastDungeon = stage.setup[0].split(' ')[1];
      } else {
        // A world or rift boss: a quiet floor (the Gravewyrm Sanctum landing, its packs
        // cleared), then the boss spawned beside the player.
        if (lastDungeon !== 'spawn') {
          await chat('/dev sanctum enter normal');
          await sleep(400);
          await chat('/dev sanctum tp landing');
          await chat('/dev sanctum kill all');
        }
        await chat(`/dev spawn ${boss.mobId}`);
        lastDungeon = 'spawn';
      }
      await sleep(1500);
      await waitCurtain();
      // Lines that need the player already inside (a dungeon spawn lands beside them).
      for (const line of stage?.post ?? []) {
        await chat(line);
        await sleep(400);
      }
      await runFor(stage?.settle ?? 1.5);
      if (process.env.DEBUG_SHOT) {
        mkdirSync(rawDir, { recursive: true });
        await page.screenshot({ path: path.join(rawDir, `stage_${boss.mobId}.png`) });
      }
      let found = await findBoss(boss.mobId);
      // A boss that only engages close up (a landing cinematic, a flight): step in.
      if (found && stage?.approach) {
        await page.evaluate(
          (id, d) => {
            const w = window.__game.world;
            const b = w.entities.get(id);
            const p = w.player;
            const g = w.ctx.groundPos(b.pos.x, b.pos.z + d);
            p.pos = { ...g };
            p.prevPos = { ...g };
          },
          found.id,
          stage.approach,
        );
        await runFor(stage.approachSettle ?? 4);
        found = await findBoss(boss.mobId);
      }
      if (!found) {
        row.why = 'boss not found after staging';
        console.log(`  ${row.why}`);
        continue;
      }
      await page.evaluate((id) => window.__attackProbe.arm(id, [], []), found.id);
      await runFor(1);
      // Forced attacks, one by one.
      for (const [name, spec] of Object.entries(stage?.attacks ?? {})) {
        if (!wantedNames.includes(name) || row.got.includes(name)) continue;
        // A /dev trigger only answers an ENGAGED boss, and some encounters engage a few
        // seconds after the player arrives; so a trigger that shows nothing is re-aggroed and
        // retried, up to three tries.
        let s = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          await page.evaluate(
            (n, c, t, f) => window.__attackProbe.expect(n, c, t, f),
            name,
            spec.cast ?? null,
            spec.at === undefined ? null : Math.round(spec.at * TICK_HZ),
            spec.frac ?? null,
          );
          for (const line of spec.run) await chat(line);
          s = await runFor(Math.max(5, (spec.at ?? 0) + 4), 180_000);
          if (s.frozen) break;
          await page.evaluate(() => {
            window.__attackProbe.expected = null;
          });
          await findBoss(boss.mobId);
          await runFor(2);
        }
        if (s.frozen && s.caught?.name === name) {
          await capture(boss, name, s.caught.how);
          row.got.push(name);
          await page.evaluate((n) => window.__attackProbe.release(n), name);
        } else {
          console.log(`  no catch for ${name} (labels seen: ${Object.keys(s.labels).join(', ')})`);
        }
        await page.evaluate(() => {
          window.__attackProbe.expected = null;
        });
        await runFor(1.5);
      }
      // Timer-driven attacks: castIds from the stage, the target list's own castIds and
      // timers, and every remaining name for a display-name match.
      const castIds = stage?.casts ?? {};
      const wanted = boss.attacks
        .filter((a) => wantedNames.includes(a.name) && !row.got.includes(a.name))
        .map((a) => ({
          name: a.name,
          fold: a.fold,
          castId: castIds[a.name] ?? a.castId,
          timer: a.timer,
          windup: a.windup,
          fraction: stage?.fractions?.[a.name] ?? (a.castId || castIds[a.name] ? 0.6 : 0.5),
        }));
      const idle = stage ? (stage.idle ?? 0) : 60;
      if (wanted.length && idle > 0) {
        const { got, labels } = await idleFight(boss, found.id, wanted, idle);
        row.got.push(...got);
        console.log(`  labels seen: ${Object.keys(labels).join(', ') || 'none'}`);
      }
    } catch (e) {
      row.why = e.message.slice(0, 200);
      console.error(`  FAILED ${boss.mobId}: ${row.why}`);
    }
    row.missed = wantedNames.filter((n) => !row.got.includes(n));
    console.log(
      `  captured ${row.got.length}/${row.total} in ${Math.round((Date.now() - bossStart) / 1000)} s`,
    );
    writeFileSync(manifestPath, `${JSON.stringify(sortManifest(manifest), null, 2)}\n`);
  }
} finally {
  await browser.close();
  if (vite) await vite.close();
}

// Prune what review rejected (REJECTED) and what no stage produces any more, from the
// manifest and from public/, so a rerun never ships a frame a human threw out.
for (const [mobId, attacks] of Object.entries(manifest)) {
  for (const [name, url] of Object.entries(attacks)) {
    const rejected = REJECTED.has(`${mobId}|${name}`) && !RETRY_REJECTED;
    if (!rejected && (STAGES[mobId] || process.env.UNSTAGED)) continue;
    rmSync(path.join(root, 'public', url), { force: true });
    rmSync(path.join(root, 'public', url.replace(`/${OUT_DIR}/`, `/${OUT_DIR}/full/`)), {
      force: true,
    });
    delete attacks[name];
  }
  if (Object.keys(attacks).length === 0) delete manifest[mobId];
}
writeFileSync(manifestPath, `${JSON.stringify(sortManifest(manifest), null, 2)}\n`);
mkdirSync(path.join(root, 'tmp', 'attacks'), { recursive: true });
writeFileSync(
  path.join(root, 'tmp', 'attacks', 'last_run.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
const got = report.reduce((n, r) => n + r.got.length, 0);
console.log(`\ncaptured ${got} attack snapshots this run; manifest: ${manifestPath}`);

function sortManifest(m) {
  const out = {};
  for (const k of Object.keys(m).sort()) {
    out[k] = {};
    for (const n of Object.keys(m[k]).sort()) out[k][n] = m[k][n];
  }
  return out;
}
