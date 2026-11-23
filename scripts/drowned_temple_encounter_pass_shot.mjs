// Evidence frames of the Drowned Temple's second encounter pass in a live
// offline world: the Mere Hydra's Combined Breath (the Frostlocked Torrent's
// Ice Wall breaking the next Tsunami, the Venom Current, the Toxic Rime),
// Ysolei calling the moon (the Moonlight Tears, the Full Moon: the eclipse and
// the moon falling), the Moonmantle Ray (its Wingbeat, its Nacre Cocoon, its
// death) and the Moonbridge forming on the fallen Colossus's beam. Each
// sequence is saved frame by frame and joined into one strip. Evidence
// tooling, not a repo test.
//
//   node scripts/drowned_temple_encounter_pass_shot.mjs [outDir] [seq ...]
//
// Env: SHOT_URL (http://127.0.0.1:5247/), BROWSER_PATH, SHOT_PRESET (4),
// SHOT_W / SHOT_H (1280x720), SHOT_GPU=0 to force SwiftShader.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5247/';
const OUT = process.argv[2] ?? path.join('tmp', 'drowned_temple_encounter_pass');
const ONLY = process.argv.slice(3);
const W = Number(process.env.SHOT_W ?? 1280);
const H = Number(process.env.SHOT_H ?? 720);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HEADS = ['mere_hydra_head_left', 'mere_hydra_head_center', 'mere_hydra_head_right'];

// at: instance-local spot; face: sim yaw; cam: yaw/pitch/dist; pull: the
// bosses to pull; steps: each a /dev temple trigger (or a page action) and
// the frames (ms after it) to save; ui: keep the HUD (the bridge's banner).
const SEQS = [
  {
    id: 'hidra_hielo_muro',
    dir: 'hidra',
    at: [7, 70],
    face: Math.PI,
    yaw: 0.35,
    pitch: 0.62,
    dist: 40,
    pull: HEADS,
    steps: [
      { trigger: 'frostlock', frames: [300, 1100, 1900, 2150, 2600, 4200] },
      { trigger: 'tsunami', frames: [1200, 3000, 4300, 4650, 5000, 5800] },
    ],
  },
  {
    id: 'hidra_corriente',
    dir: 'hidra',
    at: [7, 70],
    face: Math.PI,
    yaw: 0.35,
    pitch: 0.7,
    dist: 36,
    pull: HEADS,
    steps: [{ trigger: 'current', frames: [400, 1300, 1800, 2200, 3300, 4800] }],
  },
  {
    id: 'hidra_escarcha',
    dir: 'hidra',
    at: [7, 70],
    face: Math.PI,
    yaw: 0.35,
    pitch: 0.7,
    dist: 36,
    pull: HEADS,
    steps: [{ trigger: 'rime', frames: [400, 1500, 2200, 3600, 5200, 6150, 6500, 7200] }],
  },
  {
    id: 'ysolei_lagrimas',
    dir: 'ysolei',
    at: [-12, 194],
    face: -Math.PI / 2,
    yaw: -0.9,
    pitch: 0.6,
    dist: 44,
    pull: ['ysolei'],
    steps: [{ trigger: 'tears', frames: [600, 1800, 2900, 3150, 3500, 5000, 7000, 9000] }],
  },
  {
    id: 'ysolei_eclipse',
    dir: 'ysolei',
    at: [-12, 194],
    face: -Math.PI / 2,
    yaw: -0.9,
    pitch: 0.42,
    dist: 46,
    pull: ['ysolei'],
    steps: [
      { trigger: 'fullmoon', frames: [600, 3500, 7000] },
      { action: 'breakWard', frames: [150, 600, 1400, 3000, 5200] },
    ],
  },
  {
    id: 'ysolei_luna_cae',
    dir: 'ysolei',
    at: [-12, 194],
    face: -Math.PI / 2,
    yaw: -0.9,
    pitch: 0.42,
    dist: 46,
    pull: ['ysolei'],
    steps: [{ trigger: 'fullmoon', frames: [1000, 6000, 11000, 12150, 12500, 13200, 15000] }],
  },
  {
    id: 'manta',
    dir: 'manta',
    at: [0, -70],
    face: 0,
    yaw: 2.3,
    pitch: 0.3,
    dist: 18,
    steps: [
      { action: 'spawnManta', frames: [1500, 5800, 6900, 7250, 7600, 8400] },
      { trigger: 'cocoon', frames: [400, 1500, 3500] },
      { action: 'killManta', frames: [300, 1200, 2400] },
    ],
  },
  {
    id: 'puente_rayo',
    dir: 'puente',
    fresh: true,
    // From the Altar Landing, looking back east up the bridge at the terrace.
    at: [33, 213],
    face: Math.PI / 2,
    yaw: Number(process.env.SHOT_BRIDGE_YAW ?? Math.PI / 2),
    pitch: 0.3,
    dist: 14,
    ui: true,
    steps: [{ action: 'killColossus', frames: [150, 450, 800, 1150, 1500, 1900, 2400, 3600] }],
  },
];

async function strip(files, out) {
  const rootRequire = createRequire(import.meta.url);
  const cliRequire = createRequire(rootRequire.resolve('@gltf-transform/cli'));
  const sharp = (await import(pathToFileURL(cliRequire.resolve('sharp')).href)).default;
  const w = Math.round(W / 2);
  const h = Math.round(H / 2);
  const cols = Math.min(files.length, 4);
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

async function action(page, name) {
  if (name === 'spawnManta') return chat(page, '/dev temple spawn manta');
  if (name === 'killColossus') return chat(page, '/dev temple kill colossus');
  if (name === 'killManta')
    return page.evaluate(() => {
      const sim = window.__game.world;
      for (const e of sim.entities.values())
        if (e.kind === 'mob' && !e.dead && e.templateId === 'pearlguard_sentinel' && e.inCombat)
          sim.ctx.handleDeath(e, sim.player);
    });
  if (name === 'breakWard')
    return page.evaluate(() => {
      const sim = window.__game.world;
      for (const e of sim.entities.values())
        for (const a of e.auras ?? []) if (a.id === 'temple_plenilune_ward') a.value = 0;
    });
}

async function setup(page) {
  for (const cmd of [
    '/dev level 20',
    '/dev god',
    '/dev temple enter',
    '/dev temple gates',
    '/dev temple kill trash',
  ]) {
    await chat(page, cmd);
    await sleep(1300);
  }
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
      charName: 'Moonwader',
      gameBootTimeoutMs: 180000,
      selectorTimeoutMs: 90000,
      settleMs: 4000,
    });
    if (!booted) throw new Error('offline world did not boot');
    await setup(page);
    await page.waitForFunction(
      () => {
        let found = false;
        window.__game.renderer.scene.traverse((o) => {
          if (o.name === 'drownedTempleField') found = true;
        });
        return found;
      },
      { timeout: 180000, polling: 1000 },
    );
    await sleep(5000);
    const hideUi = await page.addStyleTag({
      content: '#ui, #nameplates { display: none !important; }',
    });
    await chat(page, '/dev temple tp landing');
    await sleep(900);
    const originOf = () =>
      page.evaluate(() => {
        const p = window.__game.world.player;
        return { x: p.pos.x, z: p.pos.z + 230 };
      });
    let origin = await originOf();
    for (const seq of SEQS) {
      if (ONLY.length && !ONLY.includes(seq.id)) continue;
      const out = path.join(OUT, seq.dir);
      fs.mkdirSync(out, { recursive: true });
      if (seq.fresh) {
        // A fresh run with the gates closed, so the bridge is seen forming.
        await chat(page, '/dev temple reset');
        await sleep(2500);
        await chat(page, '/dev temple kill trash');
        await sleep(1200);
        // A fresh claim may sit in another slot: measure its origin again.
        await chat(page, '/dev temple tp landing');
        await sleep(900);
        origin = await originOf();
      }
      // The HUD stays hidden except where it is the evidence (the banner).
      await hideUi.evaluate((el, show) => {
        el.disabled = show;
      }, !!seq.ui);
      const [lx, lz] = seq.at;
      await chat(page, `/dev tp ${origin.x + lx} ${origin.z + lz}`);
      await sleep(2500);
      if (seq.pull) {
        await page.evaluate((ids) => {
          const sim = window.__game.world;
          for (const e of sim.entities.values()) {
            if (e.kind !== 'mob' || e.dead || !ids.includes(e.templateId)) continue;
            e.maxHp = Math.max(e.maxHp, 1e6);
            e.hp = e.maxHp;
            sim.aggroMob(e, sim.player, false);
          }
        }, seq.pull);
        await sleep(1500);
      }
      await page.evaluate((s) => {
        const p = window.__game.world.player;
        p.facing = s.face;
        p.prevFacing = s.face;
        const input = window.__game.input;
        input.camYaw = s.yaw ?? 0;
        input.camPitch = s.pitch;
        input.camDist = s.dist;
      }, seq);
      await sleep(1200);
      const files = [];
      for (const [k, step] of seq.steps.entries()) {
        if (step.trigger) await chat(page, `/dev temple trigger ${step.trigger}`);
        if (step.action) await action(page, step.action);
        const t0 = Date.now();
        for (const at of step.frames) {
          const wait = at - (Date.now() - t0);
          if (wait > 0) await sleep(wait);
          const file = path.join(out, `${seq.id}_${k}_${String(at).padStart(5, '0')}.png`);
          await page.screenshot({ path: file });
          files.push(file);
        }
      }
      await strip(files, path.join(out, `${seq.id}_tira.png`));
      console.log('STRIP', path.join(out, `${seq.id}_tira.png`));
      // Drop the fight before the next sequence.
      await page.evaluate(() => {
        const sim = window.__game.world;
        for (const e of sim.entities.values()) {
          if (e.kind !== 'mob' || e.dead || !e.inCombat) continue;
          e.inCombat = false;
          e.aggroTargetId = null;
          e.aiState = 'evade';
        }
      });
      await sleep(1500);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
