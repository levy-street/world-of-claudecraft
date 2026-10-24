// Evidence frames of the dungeon trash pass's second wave in a live offline
// world: the Gravecaller Adept's Gravespark Volley, the Bastion Revenant's
// Throatlight, the Drowned Sergeant's Loose on My Mark, the Moonlit Siren's
// Call of the Shallows and the Moonmantle Ray's heroic Heartpearl. Each one
// set up with /dev spawns (or its real pack), framed, saved frame by frame and
// joined into one strip per mechanic. Evidence tooling, not a repo test.
//
//   node scripts/trash_wave2_shot.mjs [outDir] [seq ...]
//
// Env: SHOT_URL (http://127.0.0.1:5254/), BROWSER_PATH, SHOT_PRESET (4),
// SHOT_W / SHOT_H (1280x720), SHOT_GPU=0 to force SwiftShader.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5254/';
const OUT = process.argv[2] ?? path.join('tmp', 'trash_wave2');
const ONLY = process.argv.slice(3);
const W = Number(process.env.SHOT_W ?? 1280);
const H = Number(process.env.SHOT_H ?? 720);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Each sequence: the dungeon and difficulty, where to stand, the mobs to
// spawn (/dev <d> spawn <type>, each 10 yd ahead, the player turned by
// `spread` between spawns), an action, the kit cast to force on a template
// (/dev trashkit cast <key>) and the frames (ms after the trigger) to save.
const SEQS = [
  {
    id: 'andanada_chispas',
    d: 'crypt',
    tp: 'cloister',
    spawn: ['adept'],
    force: { template: 'crypt_gravecaller_adept', key: 'nova' },
    cast: 'crypt_gravespark_volley',
    frames: [100, 1000, 2000, 2700, 3150, 3600],
    cam: { yaw: 0.6, pitch: 0.5, dist: 22 },
  },
  {
    id: 'luz_garganta',
    d: 'bastion',
    tp: 'flats',
    spawn: ['revenant', 'revenant'],
    spread: 0.7,
    action: 'killRevenant',
    actionAfter: 600,
    frames: [100, 600, 1200, 1800, 2400, 3200],
    cam: { yaw: 0.4, pitch: 0.5, dist: 18 },
  },
  {
    id: 'luz_garganta_heroico',
    d: 'bastion',
    heroic: true,
    tp: 'flats',
    spawn: ['revenant', 'revenant'],
    spread: 0.7,
    action: 'killRevenant',
    actionAfter: 600,
    frames: [200, 1200, 2400, 3200, 4500],
    cam: { yaw: 0.4, pitch: 0.5, dist: 18 },
  },
  {
    id: 'a_mi_marca',
    d: 'bastion',
    tp: 'towerone',
    keepPack: 'r1',
    pull: 'drowned_sergeant',
    force: { template: 'drowned_sergeant', key: 'order' },
    cast: 'bastion_loose_on_my_mark',
    frames: [100, 700, 1400, 1950, 2150, 2500],
    cam: { yaw: 2.4, pitch: 0.55, dist: 22 },
  },
  {
    id: 'canto_bajios',
    d: 'temple',
    tp: 'colonnade',
    spawn: ['siren'],
    spawnDist: 16,
    force: { template: 'moonlit_siren', key: 'lure' },
    cast: 'temple_call_of_the_shallows',
    frames: [100, 900, 1800, 2700, 3100, 3800],
    cam: { yaw: 1.2, pitch: 0.42, dist: 18 },
  },
  {
    id: 'perla_corazon_heroico',
    d: 'temple',
    heroic: true,
    tp: 'colonnade',
    spawn: ['sentinel', 'templeguard'],
    spread: 0.9,
    action: 'breakCocoon',
    actionAfter: 1200,
    frames: [100, 600, 1400, 2400, 3600, 5200],
    cam: { yaw: 0.8, pitch: 0.55, dist: 18 },
  },
];

async function strip(files, out) {
  const rootRequire = createRequire(import.meta.url);
  const cliRequire = createRequire(rootRequire.resolve('@gltf-transform/cli'));
  const sharp = (await import(pathToFileURL(cliRequire.resolve('sharp')).href)).default;
  const w = Math.round(W / 2);
  const h = Math.round(H / 2);
  const cols = Math.min(files.length, 3);
  const rows = Math.ceil(files.length / cols);
  const tiles = await Promise.all(
    files.map(async (f, i) => ({
      input: await sharp(f).resize(w, h).toBuffer(),
      left: (i % cols) * w,
      top: Math.floor(i / cols) * h,
    })),
  );
  await sharp({
    create: { width: cols * w, height: rows * h, channels: 3, background: '#000' },
  })
    .composite(tiles)
    .png()
    .toFile(out);
}

const chat = (page, c) => page.evaluate((cmd) => window.__game.world.chat(cmd), c);

/** The scripted page actions (the offline world is the Sim itself). */
async function action(page, name) {
  return page.evaluate((n) => {
    const w = window.__game.world;
    const ctx = w.ctx;
    const me = w.player;
    const mobs = [...w.entities.values()].filter((e) => e.kind === 'mob' && !e.dead);
    // The nearest living one (the dungeon's own packs carry more of each).
    const first = (t) =>
      mobs
        .filter((e) => e.templateId === t)
        .sort(
          (a, b) =>
            Math.hypot(a.pos.x - me.pos.x, a.pos.z - me.pos.z) -
            Math.hypot(b.pos.x - me.pos.x, b.pos.z - me.pos.z),
        )[0];
    if (n === 'killRevenant') {
      const r = first('bastion_revenant');
      if (r) ctx.handleDeath(r, me);
    }
    if (n === 'breakCocoon') {
      const ray = first('pearlguard_sentinel');
      if (ray) {
        ray.hp = Math.floor(ray.maxHp * 0.29);
        // The cocoon closes on the next kit tick; burst it a beat later.
        setTimeout(() => {
          const ward = ray.auras.find((a) => a.id === 'temple_pearl_carapace_ward');
          if (ward) ctx.dealDamage(me, ray, ward.value + 5, false, 'physical', 'Strike', 'hit');
        }, 400);
      }
    }
    return true;
  }, name);
}

async function waitCast(page, cast, timeout = 45000) {
  return page
    .waitForFunction(
      (c) => {
        for (const e of window.__game.world.entities.values())
          if (e.castingAbility === c && e.castTotal > 0) return true;
        return false;
      },
      { timeout, polling: 30 },
      cast,
    )
    .then(() => true)
    .catch(() => false);
}

const CLEAR_PACKS = {
  crypt: ['c1', 'c2', 'c3', 'c4', 'p1', 'drake'],
  bastion: ['f1', 'f2', 'fa', 'fb', 'f3', 'rc', 'r2'],
  temple: ['g4', 'g5', 'pa'],
};

async function enter(page, seq) {
  await chat(page, `/dev ${seq.d} enter ${seq.heroic ? 'heroic' : 'normal'}`);
  await sleep(1500);
  await chat(page, `/dev ${seq.d} reset`);
  await sleep(2500);
  for (const pack of CLEAR_PACKS[seq.d])
    if (pack !== seq.keepPack) await chat(page, `/dev ${seq.d} kill ${pack}`);
  await sleep(800);
  await chat(page, `/dev ${seq.d} tp ${seq.tp}`);
  await sleep(1500);
}

async function frameCam(page, cam) {
  await page.evaluate((c) => {
    const input = window.__game.input;
    input.camYaw = c.yaw;
    input.camPitch = c.pitch;
    input.camDist = c.dist * 0.62;
  }, cam);
}

async function shoot(page, seq, out, frames, files) {
  const t0 = Date.now();
  for (const at of frames) {
    const wait = at - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    await frameCam(page, seq.cam);
    const file = path.join(out, `${seq.id}_f${String(at).padStart(5, '0')}.png`);
    await page.screenshot({ path: file });
    files.push(file);
  }
}

/** Target the first living `template` and force its kit cast `key` now. */
async function force(page, f) {
  await page.evaluate((t) => {
    const w = window.__game.world;
    const me = w.player;
    const mob = [...w.entities.values()]
      .filter((e) => e.kind === 'mob' && !e.dead && e.templateId === t)
      .sort(
        (a, b) =>
          Math.hypot(a.pos.x - me.pos.x, a.pos.z - me.pos.z) -
          Math.hypot(b.pos.x - me.pos.x, b.pos.z - me.pos.z),
      )[0];
    if (mob) w.player.targetId = mob.id;
  }, f.template);
  await chat(page, `/dev trashkit cast ${f.key}`);
}

async function runSeq(page, seq) {
  const out = OUT;
  await enter(page, seq);
  const dist = seq.spawnDist ?? 10;
  for (let i = 0; i < (seq.spawn ?? []).length; i++) {
    await page.evaluate(
      (o) => {
        const p = window.__game.world.player;
        p.facing += o.turn;
        p.prevFacing = p.facing;
      },
      { turn: i === 0 ? 0 : (seq.spread ?? 0.3) },
    );
    if (dist !== 10) {
      await page.evaluate((back) => {
        const p = window.__game.world.player;
        p.pos.x -= Math.sin(p.facing) * back;
        p.pos.z -= Math.cos(p.facing) * back;
        p.prevPos = { ...p.pos };
      }, dist - 10);
    }
    await chat(page, `/dev ${seq.d} spawn ${seq.spawn[i]}`);
    await sleep(250);
  }
  if (seq.pull) {
    // Walk into the real pack: aggro it on the player.
    await page.evaluate((t) => {
      const w = window.__game.world;
      const mob = [...w.entities.values()].find(
        (e) => e.kind === 'mob' && !e.dead && e.templateId === t,
      );
      if (mob) w.ctx.aggroMob(mob, w.player, false);
    }, seq.pull);
    await sleep(1500);
  }
  await frameCam(page, seq.cam);
  const files = [];
  if (seq.force) {
    await sleep(600);
    await force(page, seq.force);
  }
  if (seq.cast) {
    const ok = await waitCast(page, seq.cast);
    if (!ok) console.log('NO CAST', seq.id);
  } else if (seq.action) {
    if (seq.actionAfter) await sleep(seq.actionAfter);
    await action(page, seq.action);
  }
  await shoot(page, seq, out, seq.frames, files);
  await strip(files, path.join(out, `${seq.id}_tira.png`));
  console.log('STRIP', path.join(out, `${seq.id}_tira.png`));
}

async function main() {
  const gpu = process.env.SHOT_GPU !== '0';
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: [
      `--window-size=${W},${H}`,
      ...(gpu
        ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
        : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    ],
    defaultViewport: { width: W, height: H },
    protocolTimeout: 240000,
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 300));
    });
    await page.evaluateOnNewDocument((preset) => {
      try {
        localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: preset }));
      } catch {
        /* ignore */
      }
    }, PRESET);
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 180000 });
    const booted = await enterOfflineGame(page, {
      charClass: 'warrior',
      charName: 'Tombwarden',
      gameBootTimeoutMs: 180000,
      selectorTimeoutMs: 90000,
      settleMs: 4000,
    });
    if (!booted) throw new Error('offline world did not boot');
    // Immortal, not god: the mechanics land on the player at their real size.
    for (const cmd of ['/dev level 20', '/dev immortal']) {
      await chat(page, cmd);
      await sleep(1300);
    }
    await page.addStyleTag({ content: '#ui, #nameplates { display: none !important; }' });
    const FIELDS = {
      crypt: 'hollowCryptField',
      bastion: 'sunkenBastionField',
      temple: 'drownedTempleField',
    };
    const loaded = new Set();
    for (const seq of SEQS) {
      if (ONLY.length && !ONLY.includes(seq.id)) continue;
      try {
        await runSeq(page, seq);
        if (!loaded.has(seq.d)) {
          // The interior streams in on the first entry: re-run the first
          // sequence of each dungeon once it has loaded, for clean frames.
          await page
            .waitForFunction(
              (name) => {
                let found = false;
                window.__game.renderer.scene.traverse((o) => {
                  if (o.name === name) found = true;
                });
                return found;
              },
              { timeout: 120000, polling: 1000 },
              FIELDS[seq.d],
            )
            .catch(() => console.log('FIELD NOT SEEN', FIELDS[seq.d]));
          loaded.add(seq.d);
          await sleep(4000);
          await runSeq(page, seq);
        }
      } catch (e) {
        console.log('SEQ FAILED', seq.id, e.message);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
