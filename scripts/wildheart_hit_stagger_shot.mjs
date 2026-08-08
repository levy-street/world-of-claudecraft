// Before/after screenshots for the Wildheart Hit_Stagger clip (issue #2889
// round 2, Task 17): spawns a wildheart_stalker in the offline client, drives
// the renderer's public triggerHit(entityId) directly (real playHit path,
// not a synthetic pose), and captures it holding the peak hit-reaction pose.
// Overrides Math.random so the "after" capture is deterministic between the
// two clips ClipMap.hit now offers, rather than leaving it to chance.
// Timeouts are generous and each viewport gets one internal retry: this
// machine runs many parallel worktree agents, so navigation and world-boot
// can be slow, or occasionally drop a frame, under contention.
//
//   BROWSER_PATH=<chrome> GAME_URL=http://localhost:5190 node scripts/wildheart_hit_stagger_shot.mjs <before|after>
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { dismissEntryOverlays, enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5190';
const PHASE = process.argv[2] === 'after' ? 'after' : 'before';
const OUT = `docs/screenshots/wildheart_hit_stagger`;
fs.mkdirSync(OUT, { recursive: true });

async function attempt(viewport, label) {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: [
      `--window-size=${viewport.width},${viewport.height}`,
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
    defaultViewport: viewport,
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log(`[${label}] PAGEERROR: ${e.message}`));

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await enterOfflineGame(page, {
      charName: 'Basinwalker',
      settleMs: 3000,
      gameBootTimeoutMs: 60000,
      selectorTimeoutMs: 30000,
    });
    await dismissEntryOverlays(page);

    // Spawn a wildheart_stalker several yards in front of the player (clear
    // of the player's own body in the third-person frame), zoom the camera
    // in, and pin the clip index deterministically: Math.random -> 0 picks
    // Hit (index 0 of ClipMap.hit); Math.random -> ~1 picks the last entry
    // (Hit_Stagger once this change lands, or wraps back to Hit pre-change
    // when hit.length is 1).
    const setup = await page.evaluate((forceLast) => {
      const g = window.__game;
      const sim = g.sim;
      const p = sim.player;
      p.maxHp = 100000;
      p.hp = 100000;

      const template = 'wildheart_stalker';
      const level = Math.max(sim.entities.get(sim.playerId)?.level ?? 20, 20);
      // Offline dev command path (mirrors /dev spawn): route through the
      // same chat command surface the real game uses, so this exercises the
      // actual spawn path rather than hand-building an entity.
      sim.chat(`/dev spawn ${template} 1 ${level}`, p.id);
      let mob = null;
      for (const e of sim.entities.values()) {
        if (e.kind === 'mob' && e.templateId === template && !e.dead) mob = e;
      }
      if (!mob) throw new Error('wildheart_stalker did not spawn');

      mob.pos.x = p.pos.x + 6;
      mob.pos.z = p.pos.z;
      p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
      g.input.camYaw = p.facing;
      g.input.camDist = 10;
      sim.targetEntity?.(mob.id);

      // Deterministic clip pick for playHit()'s Math.random() draw.
      window.__origRandom = Math.random;
      Math.random = () => (forceLast ? 0.999 : 0);

      return { mobId: mob.id, name: mob.name };
    }, PHASE === 'after');

    console.log(`[${label}] spawned`, setup.name, 'id', setup.mobId);

    // Let the camera settle onto the new zoom/yaw and the mob's Idle loop
    // start before triggering the reaction, and clear the one-shot login
    // banner (the Ravenpost "new mail" toast) and the GPU-acceleration
    // notice so neither overlays the shot.
    await new Promise((r) => setTimeout(r, 1500));
    await page.evaluate(() => {
      const gpuNotice = document.getElementById('gpu-notice');
      if (gpuNotice) gpuNotice.hidden = true;
      const banner = document.getElementById('banner');
      if (banner) banner.style.opacity = '0';
    });

    // Real playHit path: the renderer's public triggerHit(entityId), the
    // same call the damage-event handler makes on a landed hit.
    await page.evaluate((mobId) => {
      window.__game.renderer.triggerHit(mobId);
    }, setup.mobId);

    // Capture both phases at the SAME wall-clock delay after the trigger:
    // the whole point of Hit_Stagger is that it is a slower, longer clip
    // (1.5s total vs Hit's 0.7s), so at one fixed moment after impact the
    // base Hit (index 0, always picked pre-change) has already swung past
    // its own peak and is most of the way back to Idle, while Hit_Stagger
    // is still climbing from its early-onset pose toward the peak. A
    // same-timestamp comparison reads the difference; two different hold
    // times chosen to land near each clip's OWN peak would not, since both
    // peaks are sampled from the identical Hit donor keyframe by design.
    const holdMs = 500;
    await new Promise((r) => setTimeout(r, holdMs));

    await page.evaluate(() => {
      Math.random = window.__origRandom;
      const gpuNotice = document.getElementById('gpu-notice');
      if (gpuNotice) gpuNotice.hidden = true;
      const banner = document.getElementById('banner');
      if (banner) banner.style.opacity = '0';
    });

    await page.screenshot({ path: `${OUT}/${PHASE}-${label}.png` });
    console.log(`[${label}] wrote ${OUT}/${PHASE}-${label}.png`);
  } finally {
    await browser.close();
  }
}

async function run(viewport, label) {
  const attempts = 2;
  for (let i = 1; i <= attempts; i++) {
    try {
      await attempt(viewport, label);
      return;
    } catch (err) {
      console.log(`[${label}] attempt ${i} failed: ${err.message}`);
      if (i === attempts) throw err;
    }
  }
}

await run({ width: 1280, height: 800 }, 'desktop');
await run({ width: 844, height: 390 }, 'mobile');
