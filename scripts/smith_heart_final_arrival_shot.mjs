// Evidence captures for the Masterless Strength's arrival (docs/design/raid/
// smith_heart.md section 5.17, "The arrival"; src/render/smith_heart_fx/
// final_arrival_core.ts): the scene replayed with `/dev heart arrival` and
// filmed from the Arrival Terrace as a burst of frames (the dormant statue,
// the veins running, the beam at its peak, its collapse, the rise, the
// roar), plus an mp4 of the burst when ffmpeg is at hand. A small raid of
// dev-only stand-in players stands on the terrace for scale. Evidence
// tooling, not a repo test. Needs a dev Vite serving the worktree
// (ALLOW_DEV_COMMANDS is implied offline).
//
//   node scripts/smith_heart_final_arrival_shot.mjs <outDir>
//
// Env: SHOT_URL (http://127.0.0.1:5197/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4), SHOT_SECONDS (14), SHOT_VIEW (terrace | low | wide).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5197/';
const OUT = process.argv[2] ?? path.join('tmp', 'smith_heart_final_arrival');
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const SECONDS = Number(process.env.SHOT_SECONDS ?? 14);
const VIEW = process.env.SHOT_VIEW ?? 'terrace';
const RAID = process.env.SHOT_RAID !== '0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The terrace's arrival and the platform's centre (instance-local). */
const ARRIVAL = { x: 128.25, z: 112.25 };
const BOSS = { x: 188, z: 172 };
/** Camera holds per view: [stand-at share from the arrival toward the boss,
 *  yaw off the facing, pitch (positive looks down), distance]. */
const VIEWS = {
  terrace: [0.18, -0.2, 0.04, 17],
  high: [0.3, 0.15, 0.5, 48],
  bridge: [0.3, 0.1, 0.12, 22],
  close: [0.55, 0.2, 0.22, 26],
  low: [0.12, 0.25, -0.08, 14],
};

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [`--window-size=${W},${H}`, '--use-angle=d3d11', '--ignore-gpu-blocklist'],
  defaultViewport: { width: W, height: H },
  protocolTimeout: 240000,
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || /THREE\.|shader|WebGL/i.test(m.text()))
      console.log('CONSOLE:', m.type(), m.text().slice(0, 400));
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
    charName: 'Heartwitness',
    gameBootTimeoutMs: 180000,
    selectorTimeoutMs: 90000,
    settleMs: 4000,
  });
  if (!booted) throw new Error('offline world did not boot');
  const chat = async (c, wait = 900) => {
    await page.evaluate((line) => window.__game.world.chat(line), c);
    await sleep(wait);
  };
  for (const c of ['/dev level 20', '/dev god', '/dev heart enter', '/dev noaggro'])
    await chat(c, 1500);
  await chat('/dev heart kill trash', 600);
  await chat('/dev heart gates', 600);
  await chat('/dev heart tp final', 4000);
  await page.waitForFunction(
    () => {
      let found = false;
      window.__game.renderer.scene.traverse((o) => {
        if (o.name === 'smith-heart-final-fx') found = true;
      });
      return found;
    },
    { timeout: 180000, polling: 1000 },
  );
  await page.addStyleTag({ content: '#ui { display: none !important; }' });
  // The slot's origin from where the terrace set us down.
  const O = await page.evaluate(
    ([ax, az]) => {
      const p = window.__game.world.player;
      return { x: p.pos.x - ax, z: p.pos.z - az };
    },
    [ARRIVAL.x, ARRIVAL.z],
  );
  console.log('origin', O);
  const [share, yaw, pitch, dist] = VIEWS[VIEW] ?? VIEWS.terrace;
  await page.evaluate(
    ([ox, oz, ax, az, bx, bz, share, yaw, pitch, dist, raid]) => {
      const w = window.__game.world;
      const p = w.player;
      const x = ax + (bx - ax) * share;
      const z = az + (bz - az) * share;
      const g = w.ctx.groundPos(ox + x, oz + z);
      p.pos = { ...g };
      p.prevPos = { ...g };
      p.facing = Math.atan2(bx - x, bz - z);
      p.prevFacing = p.facing;
      w.ctx.rebucket(p);
      // A few raiders on the terrace for scale.
      const classes = raid ? ['paladin', 'mage', 'priest', 'rogue', 'hunter'] : [];
      classes.forEach((c, i) => {
        const id = w.addPlayer(c, `Raider${i + 1}`);
        const e = w.entities.get(id);
        e.devGod = true;
        const a = p.facing + (i - 2) * 0.32;
        const r = 6 + (i % 2) * 2.5;
        const q = w.ctx.groundPos(g.x + Math.sin(a) * r, g.z + Math.cos(a) * r);
        e.pos = { ...q };
        e.prevPos = { ...q };
        e.facing = p.facing;
        w.ctx.rebucket(e);
      });
      const input = window.__game.input;
      const hold = () => {
        input.zoomMax = Math.max(input.zoomMax, dist);
        input.camYaw = p.facing + yaw;
        input.camPitch = pitch;
        input.camDist = dist;
        requestAnimationFrame(hold);
      };
      requestAnimationFrame(hold);
    },
    [O.x, O.z, ARRIVAL.x, ARRIVAL.z, BOSS.x, BOSS.z, share, yaw, pitch, dist, RAID],
  );
  // Past any loading curtain the move raised, then a settle.
  await sleep(1500);
  await page.waitForFunction(
    () => !document.querySelector('#loading-screen')?.classList.contains('visible'),
    { timeout: 240000, polling: 500 },
  );
  await sleep(Number(process.env.SHOT_SETTLE ?? 5000));
  fs.mkdirSync(OUT, { recursive: true });
  // The scene: the heart sleeps a moment, then wakes with us in the Heart.
  await chat('/dev heart arrival', 0);
  const t0 = Date.now();
  const frames = [];
  while (Date.now() - t0 < SECONDS * 1000) {
    const t = (Date.now() - t0) / 1000;
    const file = path.join(OUT, `f_${String(frames.length).padStart(3, '0')}_${t.toFixed(2)}.png`);
    fs.writeFileSync(file, await page.screenshot());
    frames.push({ file, t });
  }
  console.log('frames', frames.length);
  // An mp4 of the burst at its real pace (each frame held to the next).
  try {
    const require = createRequire(import.meta.url);
    const ffmpeg = require('ffmpeg-static');
    const list = path.join(OUT, 'frames.txt');
    const lines = [];
    for (let i = 0; i < frames.length; i++) {
      const d = i + 1 < frames.length ? frames[i + 1].t - frames[i].t : 0.2;
      lines.push(`file '${path.resolve(frames[i].file).replace(/\\/g, '/')}'`, `duration ${d}`);
    }
    lines.push(`file '${path.resolve(frames[frames.length - 1].file).replace(/\\/g, '/')}'`);
    fs.writeFileSync(list, lines.join('\n'));
    execFileSync(ffmpeg, [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      list,
      '-vf',
      'fps=30,format=yuv420p',
      '-c:v',
      'libx264',
      '-crf',
      '20',
      path.join(OUT, `entrada_${VIEW}.mp4`),
    ]);
    console.log('VIDEO', path.join(OUT, `entrada_${VIEW}.mp4`));
  } catch (e) {
    console.log('no video:', e.message);
  }
} finally {
  await browser.close();
}
