// Evidence captures for the Smith's Heart's big in-fight moments: the
// Masterless Strength's Weight of the Anvil (src/render/smith_heart_fx/
// final_anvil_core.ts) and the Hammer Council's Mountain's Wrath and
// Mountain's Rush (council_strike_core.ts), each forced through its real dev
// verb (`/dev heart final anvil`, `/dev heart council wrath`, `/dev heart
// council rush`) in a pulled fight with a small raid of dev-only stand-ins,
// and filmed as a burst of frames plus an mp4 of the burst when ffmpeg is at
// hand. Evidence tooling, not a repo test. Needs a dev Vite serving the
// worktree (ALLOW_DEV_COMMANDS is implied offline).
//
//   node scripts/smith_heart_mechanic_shot.mjs <outDir>
//
// Env: SHOT_URL (http://127.0.0.1:5196/), SHOT_W / SHOT_H (1600x900),
// SHOT_PRESET (4), SHOT_WHAT (anvil | wrath | rush), SHOT_SECONDS (by what),
// SHOT_VIEW (raid | high | close), SHOT_SETTLE (9000), SHOT_TAG (file prefix).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5196/';
const OUT = process.argv[2] ?? path.join('tmp', 'smith_heart_mechanic');
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 900);
const PRESET = Number(process.env.SHOT_PRESET ?? 4);
const WHAT = process.env.SHOT_WHAT ?? 'anvil';
const VIEW = process.env.SHOT_VIEW ?? 'raid';
const TAG = process.env.SHOT_TAG ?? `${WHAT}_${VIEW}`;
const SECONDS = Number(process.env.SHOT_SECONDS ?? { anvil: 9.5, wrath: 7, rush: 10 }[WHAT] ?? 9);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Per mechanic: the area to enter, the root that says its fx are built,
 *  the boss to stand off from (the witness and the raid stand `standOff`
 *  yards from it on `bearing`, or toward `toward`), the setup and the
 *  trigger. */
const PLANS = {
  anvil: {
    tp: 'final',
    fxRoot: 'smith-heart-final-kit-fx',
    /** Where the area sets us down, and the room's middle (instance-local):
     *  the witness stands off from the boss toward it. */
    anchor: { x: 128.25, z: 112.25 },
    toward: { x: 188, z: 172 },
    bossTemplate: 'heart_masterless_strength',
    standOff: 26,
    raid: 4,
    raidSpread: 2.2,
    setup: [
      '/dev heart final reset',
      '/dev heart final quarter hammer',
      '/dev heart final pull',
      '/dev heart final root',
    ],
    pre: ['/dev heart final root'],
    trigger: '/dev heart final anvil',
  },
  wrath: {
    tp: 'gallery',
    fxRoot: 'smith-heart-council-fx',
    anchor: { x: -98, z: -232 },
    /** The pit's middle (instance-local): the witness stands there. */
    spot: { x: 8, z: -170 },
    bossTemplate: 'heart_hammer_guardian',
    standOff: 24,
    // The Quarry is walled in: the camera stays behind the witness.
    views: { raid: [0, 0.2, 24], high: [0.15, 0.75, 36], close: [0.35, 0.18, 18] },
    raid: 5,
    raidSpread: 7,
    setup: ['/dev heart council reset', '/dev heart council pull'],
    trigger: '/dev heart council wrath',
  },
  rush: {
    tp: 'gallery',
    fxRoot: 'smith-heart-council-fx',
    anchor: { x: -98, z: -232 },
    /** The pit's middle (instance-local): the witness stands there. */
    spot: { x: 8, z: -170 },
    bossTemplate: 'heart_hammer_guardian',
    standOff: 24,
    // The Quarry is walled in: the camera stays behind the witness.
    views: { raid: [0, 0.2, 24], high: [0.15, 0.75, 36], close: [0.35, 0.18, 18] },
    raid: 5,
    raidSpread: 7,
    setup: ['/dev heart council reset', '/dev heart council pull'],
    trigger: '/dev heart council rush',
  },
};
/** Camera holds per view: [yaw off the witness's facing, pitch (positive
 *  looks down), distance]. */
const VIEWS = {
  raid: [1.15, 0.06, 40],
  high: [0.3, 0.78, 52],
  close: [0.9, 0.28, 22],
};
const plan = PLANS[WHAT];
if (!plan) throw new Error(`SHOT_WHAT: one of ${Object.keys(PLANS).join(', ')}`);

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
  await chat(`/dev heart tp ${plan.tp}`, 4000);
  await page.waitForFunction(
    (name) => {
      let found = false;
      window.__game.renderer.scene.traverse((o) => {
        if (o.name === name) found = true;
      });
      return found;
    },
    { timeout: 180000, polling: 1000 },
    plan.fxRoot,
  );
  await page.addStyleTag({ content: '#ui { display: none !important; }' });
  // The slot's origin from where the area set us down.
  const anchor = plan.anchor ?? { x: 0, z: 0 };
  const O = await page.evaluate(
    ([ax, az]) => {
      const p = window.__game.world.player;
      return { x: p.pos.x - ax, z: p.pos.z - az };
    },
    [anchor.x, anchor.z],
  );
  const toward = plan.toward ? { x: O.x + plan.toward.x, z: O.z + plan.toward.z } : null;
  const spot = plan.spot ? { x: O.x + plan.spot.x, z: O.z + plan.spot.z } : null;
  const views = { ...VIEWS, ...(plan.views ?? {}) };
  const [yaw, pitch, dist] = views[VIEW] ?? views.raid;
  const place = () =>
    page.evaluate(
      ([tmpl, standOff, bearing0, toward, spot, raid, spread, yaw, pitch, dist]) => {
        const w = window.__game.world;
        const p = w.player;
        let boss = null;
        for (const e of w.entities.values())
          if (e.kind === 'mob' && e.templateId === tmpl && !e.dead) boss = e;
        const bx = boss ? boss.pos.x : p.pos.x;
        const bz = boss ? boss.pos.z : p.pos.z;
        const bearing = toward ? Math.atan2(toward.x - bx, toward.z - bz) : bearing0;
        const sx = spot ? spot.x : bx + Math.sin(bearing) * standOff;
        const sz = spot ? spot.z : bz + Math.cos(bearing) * standOff;
        const move = (e, x, z) => {
          const g = w.ctx.groundPos(x, z);
          e.pos = { ...g };
          e.prevPos = { ...g };
          e.facing = Math.atan2(bx - x, bz - z);
          e.prevFacing = e.facing;
          w.ctx.rebucket(e);
        };
        move(p, sx, sz);
        window.__shotRaid ??= [];
        const classes = ['paladin', 'mage', 'priest', 'rogue', 'hunter', 'druid'].slice(0, raid);
        classes.forEach((c, i) => {
          let id = window.__shotRaid[i];
          if (id === undefined) {
            id = w.addPlayer(c, `Raider${i + 1}`);
            window.__shotRaid[i] = id;
          }
          const e = w.entities.get(id);
          e.devGod = true;
          const a = (i / raid) * Math.PI * 2 + 0.4;
          move(e, sx + Math.sin(a) * spread, sz + Math.cos(a) * spread);
        });
        if (!window.__shotHold) {
          window.__shotHold = true;
          const input = window.__game.input;
          const hold = () => {
            input.zoomMax = Math.max(input.zoomMax, dist);
            input.camYaw = p.facing + yaw;
            input.camPitch = pitch;
            input.camDist = dist;
            requestAnimationFrame(hold);
          };
          requestAnimationFrame(hold);
        }
      },
      [
        plan.bossTemplate,
        plan.standOff,
        plan.bearing ?? 0,
        toward,
        spot,
        plan.raid,
        plan.raidSpread,
        yaw,
        pitch,
        dist,
      ],
    );
  await place();
  await sleep(1500);
  await page.waitForFunction(
    () => !document.querySelector('#loading-screen')?.classList.contains('visible'),
    { timeout: 240000, polling: 500 },
  );
  for (const c of plan.setup) await chat(c, 1200);
  await place();
  await sleep(Number(process.env.SHOT_SETTLE ?? 9000));
  await place();
  fs.mkdirSync(OUT, { recursive: true });
  for (const c of plan.pre ?? []) await chat(c, 100);
  await chat(plan.trigger, 0);
  const t0 = Date.now();
  const frames = [];
  while (Date.now() - t0 < SECONDS * 1000) {
    const t = (Date.now() - t0) / 1000;
    const file = path.join(
      OUT,
      `${TAG}_${String(frames.length).padStart(3, '0')}_${t.toFixed(2)}.jpg`,
    );
    fs.writeFileSync(file, await page.screenshot({ type: 'jpeg', quality: 90 }));
    frames.push({ file, t });
    // SHOT_PROBE=1: what the look drew a couple of seconds in (a dev read).
    if (process.env.SHOT_PROBE === '1' && frames.length === 30)
      console.log(
        'PROBE',
        await page.evaluate(() => {
          const out = [];
          window.__game.renderer.scene.traverse((o) => {
            if (!/Strike|Anvil/.test(o.name)) return;
            let v = true;
            for (let p = o; p; p = p.parent) if (!p.visible) v = false;
            const w = o.getWorldPosition(o.position.clone());
            out.push(
              `${o.name}:${v ? 'on' : 'off'}@${w.x.toFixed(1)},${w.y.toFixed(1)},${w.z.toFixed(1)}`,
            );
          });
          return out.join(' | ');
        }),
      );
  }
  console.log('frames', frames.length);
  try {
    const require = createRequire(import.meta.url);
    const ffmpeg = require('ffmpeg-static');
    const list = path.join(OUT, `${TAG}_frames.txt`);
    const lines = [];
    for (let i = 0; i < frames.length; i++) {
      const d = i + 1 < frames.length ? frames[i + 1].t - frames[i].t : 0.2;
      lines.push(`file '${path.resolve(frames[i].file).replace(/\\/g, '/')}'`, `duration ${d}`);
    }
    lines.push(`file '${path.resolve(frames[frames.length - 1].file).replace(/\\/g, '/')}'`);
    fs.writeFileSync(list, lines.join('\n'));
    const video = path.join(OUT, `${TAG}.mp4`);
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
    console.log('VIDEO', video);
  } catch (e) {
    console.log('no video:', e.message);
  }
} finally {
  await browser.close();
}
