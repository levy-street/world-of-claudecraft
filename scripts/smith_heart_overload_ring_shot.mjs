// Evidence captures for the Masterless Strength's Overload ring (the room's
// centre: src/render/smith_heart_fx/final_overload_ring.ts): the clock ring
// round the central well filling in the colour of the quarter the boss
// drinks, its warning from four fifths full, the red centre warning (no
// floating text), and a far view from a quarter's rim. Each shot is
// forced through the real dev verbs (`/dev heart final quarter`, `/dev heart
// final fill`, `/dev heart final root`) in a pulled fight, every other clock
// of the fight held so the shot shows the ring. Evidence tooling, not a repo
// test. Needs a dev Vite serving the worktree (dev commands are implied
// offline).
//
//   node scripts/smith_heart_overload_ring_shot.mjs <outDir>
//
// Env: SHOT_URL (http://127.0.0.1:5199/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4), SHOT_SHOTS (comma list of shot names, default all),
// SHOT_VIDEO (a shot name to film as a burst too), SHOT_UI (1 keeps the HUD).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5199/';
const OUT = process.argv[2] ?? path.join('tmp', 'smith_heart_overload_ring');
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const KEEP_UI = process.env.SHOT_UI === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ANCHOR = { x: 128.25, z: 112.25 };
const ROOM = { x: 188, z: 172 };

/** Each shot: the quarter the boss stands in ('ring' the centre), the bar's
 *  fill, where the witness stands (bearing from the room's centre, degrees,
 *  and its distance) and the camera ([yaw off its facing, pitch, distance]). */
const SHOTS = {
  hammer_25: { zone: 'hammer', fill: 25, at: [341, 36], cam: [0, 0.45, 30] },
  hammer_60: { zone: 'hammer', fill: 60, at: [341, 36], cam: [0, 0.45, 30] },
  hammer_90: { zone: 'hammer', fill: 90, at: [341, 36], cam: [0, 0.45, 30] },
  heat_25: { zone: 'heat', fill: 25, at: [72, 36], cam: [0, 0.45, 30] },
  heat_60: { zone: 'heat', fill: 60, at: [72, 36], cam: [0, 0.45, 30] },
  heat_90: { zone: 'heat', fill: 90, at: [72, 36], cam: [0, 0.45, 30] },
  quench_60: { zone: 'quench', fill: 60, at: [251, 36], cam: [0, 0.45, 30] },
  breath_60: { zone: 'breath', fill: 60, at: [161, 36], cam: [0, 0.45, 30] },
  centre: { zone: 'ring', fill: 0, at: [200, 34], cam: [0, 0.42, 30], wait: 9000 },
  far_rim: { zone: 'hammer', fill: 60, at: [252, 50], cam: [0, 0.22, 9] },
  far_rim_heat: { zone: 'heat', fill: 90, at: [71, 50], cam: [0, 0.22, 9] },
  top: { zone: 'hammer', fill: 60, at: [341, 20], cam: [0, 1.2, 70] },
  rise: { zone: 'heat', fill: 70, at: [72, 36], cam: [0, 0.45, 30] },
};
const pick = (process.env.SHOT_SHOTS ?? Object.keys(SHOTS).join(',')).split(',');

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
    if (m.type() === 'error' || /THREE\.WebGLProgram|shader error/i.test(m.text()))
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
    charName: 'Witness',
    gameBootTimeoutMs: 180000,
    selectorTimeoutMs: 90000,
    settleMs: 4000,
  });
  if (!booted) throw new Error('offline world did not boot');
  const chat = async (c, wait = 900) => {
    const reply = await page.evaluate((line) => window.__game.world.chat(line), c);
    if (reply) console.log(c, '->', String(reply).slice(0, 160));
    await sleep(wait);
  };
  for (const c of ['/dev level 20', '/dev god', '/dev heart enter']) await chat(c, 1500);
  await chat('/dev heart kill trash', 600);
  await chat('/dev heart gates', 600);
  await chat('/dev heart tp final', 4000);
  await page.waitForFunction(
    () => !document.querySelector('#loading-screen')?.classList.contains('visible'),
    { timeout: 240000, polling: 500 },
  );
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
  if (!KEEP_UI) await page.addStyleTag({ content: '#ui { display: none !important; }' });
  const O = await page.evaluate(
    ([ax, az]) => {
      const p = window.__game.world.player;
      return { x: p.pos.x - ax, z: p.pos.z - az };
    },
    [ANCHOR.x, ANCHOR.z],
  );
  // Every other clock of the fight held, re-held every half second.
  await page.evaluate(() => {
    const hold = () => {
      for (const e of window.__game.world.entities.values()) {
        const st =
          e.kind === 'mob' && e.templateId === 'heart_masterless_strength'
            ? e.smithHeartFinal
            : null;
        if (!st) continue;
        for (const v of ['heat', 'quench', 'breath', 'hammer'])
          if (st.stars?.clock) st.stars.clock[v] = 1e9;
        st.anvilClock = 1e9;
        if (st.kit)
          for (const k of Object.keys(st.kit)) if (typeof st.kit[k] === 'number') st.kit[k] = 1e9;
        if (st.elements) {
          st.elements.strikeClock = 1e9;
          st.elements.polarityClock = 1e9;
        }
      }
    };
    hold();
    setInterval(hold, 500);
  });
  /** Each quarter's bearing from the room's centre (degrees). */
  const BEARING = { hammer: 161, heat: 252, quench: 71, breath: 341, ring: 0 };
  // A dev-only tank holds the boss where the shot wants it: in the middle of
  // its quarter, or on the centre ring, its threat pinned every half second.
  const holdTank = (zone) =>
    page.evaluate(
      ([o, room, bearing, r]) => {
        const w = window.__game.world;
        const cx = o.x + room.x;
        const cz = o.z + room.z;
        const b = (bearing * Math.PI) / 180;
        window.__tankAt = { x: cx + Math.sin(b) * r, z: cz + Math.cos(b) * r };
        if (window.__tankHold) return;
        window.__tankHold = true;
        const id = w.addPlayer('warrior', 'Tank');
        window.__tankId = id;
        const hold = () => {
          const t = w.entities.get(window.__tankId);
          if (!t) return;
          t.devGod = true;
          const g = w.ctx.groundPos(window.__tankAt.x, window.__tankAt.z);
          t.pos = { ...g };
          t.prevPos = { ...g };
          w.ctx.rebucket(t);
          for (const e of w.entities.values())
            if (e.kind === 'mob' && e.templateId === 'heart_masterless_strength' && !e.dead) {
              e.threat?.set?.(t.id, 1e9);
              e.forcedTargetId = t.id;
              e.forcedTargetTimer = 9999;
              e.aggroTargetId = t.id;
              const bg = w.ctx.groundPos(window.__tankAt.x + 3, window.__tankAt.z);
              e.pos = { ...bg };
              e.prevPos = { ...bg };
              w.ctx.rebucket(e);
            }
        };
        hold();
        setInterval(hold, 250);
      },
      [O, ROOM, BEARING[zone] ?? 0, zone === 'ring' ? 4 : 34],
    );
  const place = (shot) =>
    page.evaluate(
      ([o, room, at, cam]) => {
        const w = window.__game.world;
        const p = w.player;
        const cx = o.x + room.x;
        const cz = o.z + room.z;
        const b = (at[0] * Math.PI) / 180;
        const x = cx + Math.sin(b) * at[1];
        const z = cz + Math.cos(b) * at[1];
        const g = w.ctx.groundPos(x, z);
        p.pos = { ...g };
        p.prevPos = { ...g };
        p.facing = Math.atan2(cx - x, cz - z);
        p.prevFacing = p.facing;
        w.ctx.rebucket(p);
        window.__ringCam = cam;
        if (!window.__ringHold) {
          window.__ringHold = true;
          const input = window.__game.input;
          const hold = () => {
            const c = window.__ringCam;
            input.zoomMax = Math.max(input.zoomMax, c[2]);
            input.camYaw = w.player.facing + c[0];
            input.camPitch = c[1];
            input.camDist = c[2];
            requestAnimationFrame(hold);
          };
          requestAnimationFrame(hold);
        }
      },
      [O, ROOM, shot.at, shot.cam],
    );
  fs.mkdirSync(OUT, { recursive: true });
  let lastZone = null;
  for (const name of pick) {
    const shot = SHOTS[name];
    if (!shot) continue;
    if (shot.zone !== lastZone) {
      await chat('/dev heart final reset', 1500);
      // The centre in a live fight: pulled in a quarter, then moved onto the
      // ring (out of a fight `quarter ring` forces the final phase instead).
      const first = shot.zone === 'ring' ? 'hammer' : shot.zone;
      await chat(`/dev heart final quarter ${first}`, 1200);
      await chat('/dev heart final pull', 1500);
      await chat('/dev heart final root', 600);
      if (shot.zone === 'ring') await chat('/dev heart final quarter ring', 600);
      lastZone = shot.zone;
    }
    await holdTank(shot.zone);
    await place(shot);
    if (shot.zone !== 'ring') await chat(`/dev heart final fill ${shot.zone} ${shot.fill}`, 200);
    await sleep(shot.wait ?? 2200);
    await place(shot);
    await sleep(400);
    const file = path.join(OUT, `${name}.jpg`);
    fs.writeFileSync(file, await page.screenshot({ type: 'jpeg', quality: 90 }));
    console.log('SHOT', file);
    if (process.env.SHOT_VIDEO === name) {
      const frames = [];
      const t0 = Date.now();
      while (Date.now() - t0 < Number(process.env.SHOT_SECONDS ?? 8) * 1000) {
        const t = (Date.now() - t0) / 1000;
        const f = path.join(OUT, `${name}_burst_${String(frames.length).padStart(3, '0')}.jpg`);
        fs.writeFileSync(f, await page.screenshot({ type: 'jpeg', quality: 85 }));
        frames.push({ file: f, t });
      }
      try {
        const require = createRequire(import.meta.url);
        const ffmpeg = require('ffmpeg-static');
        const list = path.join(OUT, `${name}_frames.txt`);
        const lines = [];
        for (let i = 0; i < frames.length; i++) {
          const d = i + 1 < frames.length ? frames[i + 1].t - frames[i].t : 0.2;
          lines.push(`file '${path.resolve(frames[i].file).replace(/\\/g, '/')}'`, `duration ${d}`);
        }
        lines.push(`file '${path.resolve(frames[frames.length - 1].file).replace(/\\/g, '/')}'`);
        fs.writeFileSync(list, lines.join('\n'));
        const video = path.join(OUT, `${name}.mp4`);
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
          video,
        ]);
        for (const f of frames) fs.rmSync(f.file, { force: true });
        fs.rmSync(list, { force: true });
        console.log('VIDEO', video);
      } catch (e) {
        console.log('no video:', e.message);
      }
    }
  }
} finally {
  await browser.close();
}
