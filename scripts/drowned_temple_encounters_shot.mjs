// Evidence frames of the Drowned Temple encounter pass in a live offline
// world: Choirmother Selthe the caster (Moonwater Bolt gathering and flying,
// the Drowning Aria's beam, the Mere Surge's wedge and its wave) and the
// Tideglass Colossus's Tideglass Fracture (the floor cracking, red and clear
// slices, the charge, the detonation, the safe slices moving), plus the
// Moonbridge the Colossus opens. Each sequence is saved frame by frame and
// joined into one strip. Evidence tooling, not a repo test.
//
//   node scripts/drowned_temple_encounters_shot.mjs [outDir] [seq ...]
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
const OUT = process.argv[2] ?? path.join('tmp', 'drowned_temple_encounters');
const ONLY = process.argv.slice(3);
const W = Number(process.env.SHOT_W ?? 1280);
const H = Number(process.env.SHOT_H ?? 720);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// at: instance-local spot; face: sim yaw; cam: yaw/pitch/dist; pull: the boss
// to pull; trigger: the /dev temple trigger; frames: ms after the trigger.
const SEQS = [
  {
    id: 'selthe_bolt',
    at: [7, -4],
    face: -0.5,
    yaw: 1.2,
    pitch: 0.22,
    dist: 20,
    pull: 'choirmother_selthe',
    trigger: 'bolt',
    frames: [200, 900, 1500, 1950, 2080, 2250],
  },
  {
    id: 'selthe_aria',
    at: [8, -6],
    face: -0.6,
    yaw: 1.3,
    pitch: 0.26,
    dist: 22,
    pull: 'choirmother_selthe',
    trigger: 'aria',
    frames: [300, 1000, 2050, 3000, 4100],
  },
  {
    id: 'selthe_surge',
    at: [0, -6],
    face: 0,
    yaw: 0.9,
    pitch: 0.5,
    dist: 28,
    pull: 'choirmother_selthe',
    trigger: 'surge',
    frames: [400, 1500, 2600, 3050, 3250, 3500],
  },
  {
    id: 'coloso_fractura',
    at: [72, 196],
    face: 0.8,
    yaw: 0.8,
    pitch: 0.82,
    dist: 34,
    pull: 'tideglass_colossus',
    trigger: 'fracture',
    frames: [800, 2200, 3600, 4050, 4300, 5200, 6100, 6550, 7700, 8600, 9050],
  },
  {
    id: 'puente_lunar',
    at: [70, 208],
    face: -Math.PI / 2,
    yaw: -Math.PI / 2 + 0.4,
    pitch: 0.25,
    dist: 16,
    kill: 'colossus',
    frames: [500, 1500, 3200],
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
    for (const cmd of [
      '/dev level 20',
      '/dev god',
      '/dev temple enter',
      '/dev temple gates',
      '/dev temple kill trash',
    ]) {
      await page.evaluate((c) => window.__game.world.chat(c), cmd);
      await sleep(1300);
    }
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
    await page.addStyleTag({ content: '#ui, #nameplates { display: none !important; }' });
    await page.evaluate(() => window.__game.world.chat('/dev temple tp landing'));
    await sleep(900);
    const origin = await page.evaluate(() => {
      const p = window.__game.world.player;
      return { x: p.pos.x, z: p.pos.z + 230 };
    });
    for (const seq of SEQS) {
      if (ONLY.length && !ONLY.includes(seq.id)) continue;
      const [lx, lz] = seq.at;
      await page.evaluate(
        (c) => window.__game.world.chat(c),
        `/dev tp ${origin.x + lx} ${origin.z + lz}`,
      );
      await sleep(2500);
      if (seq.kill) {
        await page.evaluate((c) => window.__game.world.chat(c), `/dev temple kill ${seq.kill}`);
        await sleep(400);
      }
      if (seq.pull) {
        await page.evaluate((id) => {
          const sim = window.__game.world;
          for (const e of sim.entities.values()) {
            if (e.kind !== 'mob' || e.dead || e.templateId !== id) continue;
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
      if (seq.trigger)
        await page.evaluate(
          (c) => window.__game.world.chat(c),
          `/dev temple trigger ${seq.trigger}`,
        );
      const t0 = Date.now();
      const files = [];
      for (const at of seq.frames) {
        const wait = at - (Date.now() - t0);
        if (wait > 0) await sleep(wait);
        const file = path.join(OUT, `${seq.id}_${String(at).padStart(5, '0')}.png`);
        await page.screenshot({ path: file });
        files.push(file);
      }
      const probe = await page.evaluate(() => {
        const sim = window.__game.world;
        const out = [];
        for (const e of sim.entities.values())
          if (e.templateFight) out.push(`${e.templateId}:${e.castingAbility}`);
        return out.join(' ');
      });
      console.log('SEQ', seq.id, probe);
      await strip(files, path.join(OUT, `${seq.id}_tira.png`));
      console.log('STRIP', path.join(OUT, `${seq.id}_tira.png`));
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
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
