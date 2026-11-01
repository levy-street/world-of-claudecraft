// Arc Bolt side-view capture: records the real in-game Shaman lightning bolt
// (ability id lightning_bolt) from the side, frame by frame, for a before/after
// review of its VFX. Boots the OFFLINE client (dev server on :5173), parks a
// Shaman a fixed distance from the nearest mob (a Proving Shore Training
// Effigy on a fresh character), locks a free camera side-on, casts the real
// ability through sim.castAbility, and steps a VIRTUAL clock in
// fixed 1/60 s frames (performance.now + requestAnimationFrame are driven from
// here), so the footage is smooth even under SwiftShader where a real frame
// takes far longer than 16 ms. Every captured frame is a screenshot of the
// actual renderer; nothing is drawn by this script. The page loads with
// ?fpscap=display: a paced frame ceiling re-arms on setTimeout, which the
// virtual clock does not drive.
//
// Usage: npm run dev (":5173") in another terminal, then
//   node scripts/arc_bolt_side_capture.mjs <label>
// Env knobs: ARC_TOD (dev /daynight phase 0..1; default null, and the game is
// day-only today so it has no effect), ARC_CAM_SIDE / ARC_CAM_HEIGHT (camera
// offset in yards), ARC_STAND_OFF, ARC_PRESET, ARC_LEAD_FRAMES, ARC_REC_FRAMES.
// Writes tmp/arc_bolt_live/<label>/frame_NNN.png and <label>.mp4 (30 fps of
// 60 fps virtual time, so the clip plays at half speed) plus <label>_rt.mp4
// (real speed).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const label = process.argv[2] ?? 'capture';
const OUT = path.join('tmp/arc_bolt_live', label);
const STAND_OFF = Number(process.env.ARC_STAND_OFF ?? 14); // yards caster to target
const PRESET = Number(process.env.ARC_PRESET ?? 4); // a VFX comparison keeps a rich preset
const FRAME_MS = 1000 / 60;
const LEAD_FRAMES = Number(process.env.ARC_LEAD_FRAMES ?? 70); // cast-bar time before recording
const REC_FRAMES = Number(process.env.ARC_REC_FRAMES ?? 110);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1280,720', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message ?? e)));

// String form: the virtual clock must be installed before any game module runs.
await page.evaluateOnNewDocument(`(() => {
  localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: ${PRESET} }));
  const realNow = performance.now.bind(performance);
  const realRaf = window.requestAnimationFrame.bind(window);
  const realCancel = window.cancelAnimationFrame.bind(window);
  const vt = { manual: false, now: 0, queue: new Map(), next: 1e9 };
  window.__vt = vt;
  performance.now = () => (vt.manual ? vt.now : realNow());
  vt.realCalls = 0;
  vt.manualCalls = 0;
  window.requestAnimationFrame = (cb) => {
    if (!vt.manual) { vt.realCalls++; return realRaf(cb); }
    vt.manualCalls++;
    const id = vt.next++;
    vt.queue.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    if (vt.queue.delete(id)) return;
    realCancel(id);
  };
  window.__vtEnable = () => { vt.now = realNow(); vt.manual = true; };
  window.__vtDisable = () => {
    vt.manual = false;
    const due = [...vt.queue.values()];
    vt.queue.clear();
    for (const cb of due) realRaf(cb);
  };
  window.__vtStep = (ms) => {
    vt.now += ms;
    const due = [...vt.queue.values()];
    vt.queue.clear();
    for (const cb of due) cb(vt.now);
  };
})();`);

// fpscap=display: no frame-rate ceiling, so the loop re-arms on plain rAF (a
// paced ceiling sleeps on setTimeout, which the virtual clock does not drive).
await page.goto(`${URL}/?fpscap=display`, { waitUntil: 'networkidle0', timeout: 90000 });
const booted = await enterOfflineGame(page, {
  charClass: 'shaman',
  settleMs: 6000,
  gameBootTimeoutMs: 180000,
  selectorTimeoutMs: 60000,
});
if (!booted) {
  await page.screenshot({ path: path.join(OUT, 'boot_fail.png') });
  console.error('FAIL: world did not boot', errors);
  await browser.close();
  process.exit(1);
}

const setup = await page.evaluate(
  `((standOff) => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  p.maxHp = Math.max(p.maxHp, 5000);
  p.hp = p.maxHp;
  p.maxResource = Math.max(p.maxResource, 5000);
  p.resource = p.maxResource;
  let mob = null;
  let best = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.ownerId === null && e.hostile !== false) {
      const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (d < best) { best = d; mob = e; }
    }
  }
  if (!mob) return { ok: false };
  mob.maxHp = Math.max(mob.maxHp, 100000);
  mob.hp = mob.maxHp;
  p.pos.x = mob.pos.x + standOff;
  p.pos.z = mob.pos.z;
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id);
  document.querySelector('.gpu-notice-dismiss')?.click();
  return { ok: true, mob: mob.id, name: mob.name };
})(${STAND_OFF})`,
);
if (!setup.ok) {
  console.error('FAIL: no mob found');
  await browser.close();
  process.exit(1);
}
// let the world settle around the new position (streaming, reveal gates)
await new Promise((r) => setTimeout(r, 6000));

// Locked side camera (the renderer's free editor camera: a fixed eye and
// look-at, so nothing chases the caster), an optional /daynight phase, and the
// HUD hidden so the frame shows only the world.
await page.evaluate(
  `((tod, side, height) => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  const mob = sim.entities.get(${setup.mob});
  const mx = (p.pos.x + mob.pos.x) / 2;
  const mz = (p.pos.z + mob.pos.z) / 2;
  const my = (p.pos.y + mob.pos.y) / 2 + 1.2;
  g.renderer.editorCam = {
    pos: { x: mx, y: my + height, z: mz + side },
    target: { x: mx, y: my, z: mz },
  };
  if (tod !== null) {
    // the /daynight dev chat hook (dev builds only), as gauntlet_night_shot.mjs does
    const input = document.querySelector('#chat-input');
    input.value = '/daynight ' + tod;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }
  const ui = document.getElementById('ui');
  if (ui) ui.style.visibility = 'hidden';
  p.hp = p.maxHp;
  window.__vtEnable();
})(${process.env.ARC_TOD ?? 'null'}, ${process.env.ARC_CAM_SIDE ?? -15}, ${process.env.ARC_CAM_HEIGHT ?? 2.5})`,
);
// The loop must be caught re-arming through the virtual rAF; if the pending arm
// at enable time was not a rAF (a cadence timer), hand back to the real clock
// for a moment and try again.
for (let attempt = 0; ; attempt++) {
  await new Promise((r) => setTimeout(r, 400));
  if (await page.evaluate('window.__vt.queue.size > 0')) break;
  if (attempt >= 20) {
    console.error('FAIL: the frame loop never armed on the virtual clock');
    await browser.close();
    process.exit(1);
  }
  await page.evaluate('window.__vtDisable()');
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate('window.__vtEnable()');
}
// a few frames on the virtual clock so lighting and reveal gates settle
for (let i = 0; i < 30; i++) await page.evaluate(`window.__vtStep(${FRAME_MS})`);
const t0 = await page.evaluate(
  `(() => { const s = window.__game.sim; s.castAbility('lightning_bolt'); return s.time; })()`,
);
for (let i = 0; i < LEAD_FRAMES; i++) await page.evaluate(`window.__vtStep(${FRAME_MS})`);
const t1 = await page.evaluate('window.__game.sim.time');
console.log(`sim advanced ${(t1 - t0).toFixed(3)} s over ${LEAD_FRAMES} virtual frames`);
console.log(
  await page.evaluate(
    `JSON.stringify({ realCalls: window.__vt.realCalls, manualCalls: window.__vt.manualCalls, manual: window.__vt.manual, queued: window.__vt.queue.size, dead: window.__game.sim.player.dead, hp: window.__game.sim.player.hp })`,
  ),
);
for (let i = 0; i < REC_FRAMES; i++) {
  await page.evaluate(`window.__vtStep(${FRAME_MS})`);
  await page.screenshot({ path: path.join(OUT, `frame_${String(i).padStart(3, '0')}.png`) });
}
const after = await page.evaluate(`(() => {
  const g = window.__game;
  return { stats: g.abilityVfxStats?.().lightning_bolt ?? null };
})()`);
await browser.close();

const enc = (fps, file) =>
  execFileSync(ffmpegPath, [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    String(fps),
    '-i',
    path.join(OUT, 'frame_%03d.png'),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '18',
    path.join('tmp/arc_bolt_live', file),
  ]);
enc(30, `${label}.mp4`);
enc(60, `${label}_rt.mp4`);
console.log(JSON.stringify({ label, setup, after, errors }, null, 2));
