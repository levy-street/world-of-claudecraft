// Before/after capture for mob_bear's bespoke Bear_Attack clip (issue
// #2889 round 2, scripts/build_bear_anims.mjs). Spawns an old_cragmaw
// (the MOB_KEYS template that resolves to the mob_bear visual) next to an
// offline player and lets it close in and swing.
//
// old_cragmaw's attackSpeed is 1.7s, so a fixed short sleep after aggro is
// unreliable: it can land before the mob's first swing fires at all. Instead
// this polls the live renderer for CharacterVisual.isMidOneShot on the mob's
// own EntityView (window.__game.renderer.views), which flips true the instant
// its attack one-shot (Bear_Attack after this change, the shared Punch/Weapon
// before it) starts playing, then waits a further beat to land mid-clip
// (past the windup, inside the crouch-to-swipe ramp) rather than on the
// first frame.
//   BROWSER_PATH=... MODE=before node scripts/bear_attack_shot.mjs
//   BROWSER_PATH=... MODE=after  node scripts/bear_attack_shot.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const MODE = process.env.MODE ?? 'after';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  protocolTimeout: 120000,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--window-size=1280,760',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1280, height: 760 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
// gameBootTimeoutMs raised past the 30s default: this repo's own
// documented capture environment (sustained multi-worktree CPU contention)
// has been observed taking ~40s to preload the full asset set under headless
// SwiftShader before window.__game.sim.player appears.
const booted = await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Fenwick',
  gameBootTimeoutMs: 90000,
});
console.log('offline boot:', booted);
await page.evaluate(() => document.querySelector('.gpu-notice-dismiss')?.click());
await sleep(600);

await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(15);
  sim.player.gm = true;
  sim.player.maxHp = 99999;
  sim.player.hp = 99999;
  sim.chat('/dev spawn old_cragmaw');
});
await sleep(500);

const mobId = await page.evaluate(() => {
  const sim = window.__game.sim;
  const me = sim.player;
  let nearest = null;
  let best = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const d = (e.pos.x - me.pos.x) ** 2 + (e.pos.z - me.pos.z) ** 2;
    if (d < best) {
      best = d;
      nearest = e;
    }
  }
  if (!nearest) return null;
  nearest.pos = {
    x: me.pos.x + Math.sin(me.facing) * 3,
    y: me.pos.y,
    z: me.pos.z + Math.cos(me.facing) * 3,
  };
  sim.targetEntity(nearest.id);
  nearest.autoAttack = true;
  nearest.targetId = me.id;
  return nearest.id;
});
console.log('spawned mob id:', mobId);

// old_cragmaw's attackSpeed is 1.7s, and natural proximity aggro (rather
// than any field this script sets) is what actually starts combat, so the
// time to the first swing varies with tick/scan cadence and can stretch well
// past a couple of seconds under load. A fixed extra sleep after the one-shot
// starts is ALSO unreliable on its own: under sustained CPU contention the
// browser's own render cadence gets so chunky (observed here: a ~0.8s clip
// advancing in four or five real frames total) that a fixed delay can just as
// easily overshoot past the whole one-shot into the settle-to-idle tail as
// undershoot it. So this drives the wait from inside the page with
// requestAnimationFrame, reading the live AnimationAction's own `time` /
// clip `duration` to capture only once playback is 30 to 80% through the
// clip (past the windup, inside the crouch-to-swipe ramp for Bear_Attack;
// mid-swing for the old Punch/Weapon), whatever the local frame rate.
let swingCapture = { caught: false, reason: 'no-mob' };
if (mobId !== null) {
  swingCapture = await page.evaluate(async (id) => {
    const g = window.__game;
    const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
    function sample() {
      const v = g.renderer.views.get(id);
      const vis = v?.visual;
      const action = vis?.current;
      const clip = action?.getClip?.();
      return {
        isMidOneShot: !!vis?.isMidOneShot,
        time: action?.time ?? 0,
        duration: clip?.duration ?? 0,
        clipName: clip?.name ?? null,
      };
    }
    const deadline = performance.now() + 20000;
    let s = sample();
    while (!s.isMidOneShot && performance.now() < deadline) {
      await nextFrame();
      s = sample();
    }
    if (!s.isMidOneShot) return { caught: false, reason: 'never-started', ...s };
    while (performance.now() < deadline) {
      const frac = s.duration > 0 ? s.time / s.duration : 0;
      if (frac >= 0.3 && frac <= 0.8) return { caught: true, frac, ...s };
      if (!s.isMidOneShot) return { caught: false, reason: 'ended-before-window', frac, ...s };
      await nextFrame();
      s = sample();
    }
    return { caught: false, reason: 'timed-out', ...s };
  }, mobId);
}
console.log('swing capture:', JSON.stringify(swingCapture));
if (!swingCapture.caught) {
  // Best-effort fallback: still better than screenshotting pre-combat.
  await sleep(1200);
}

// The instant level-15 jump above queues several deed-unlock celebration
// banners (BannerQueue, src/ui/banner_queue.ts); one can still be live over
// the HUD when the swing lands. It is cosmetic and unrelated to the clip
// under test, so hide it rather than let it obscure the mob in the capture.
await page.evaluate(() => {
  const banner = document.getElementById('banner');
  if (banner) banner.style.display = 'none';
});

await page.screenshot({ path: `tmp/bear-attack-${MODE}.png` });
console.log(`wrote tmp/bear-attack-${MODE}.png`);
await browser.close();
