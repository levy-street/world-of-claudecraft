// Before/after proof for issue #2889 round 2 (Task 15): visual.ts's playHit()
// already picked randomly from ClipMap.hit, but every kaykit()/skeletonClips()
// rig shipped exactly one entry (Hit_A), so the randomness never had anything
// to pick between. This forces a player warrior and a skeleton mob's rig
// through Hit_A and Hit_B_Stagger back to back (bypassing playHit()'s own
// randomness and cooldown so the capture is deterministic) and captures both
// poses side by side, desktop and mobile.
//
// On the BASE commit (before this task) Hit_B_Stagger does not resolve for
// any consumer's AnimationMixer, so the forced Hit_B_Stagger request silently
// no-ops (playOneShot's `if (!a) return`) and the rig is caught still holding
// its prior pose: run this same script checked out at HEAD~1 for the "before"
// half of the pair.
//
// Usage: BROWSER_PATH=... GAME_URL=http://localhost:5188 SHOTS_DIR=tmp/hitvariety \
//   LABEL=after node scripts/hit_variety_shot.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5188';
const SHOTS_DIR = process.env.SHOTS_DIR ?? 'tmp/hitvariety';
const LABEL = process.env.LABEL ?? 'after';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 844, height: 390 }; // landscape (mobile is landscape-only in-game)

async function captureViewport(viewport, tag) {
  const isMobile = tag.includes('mobile');
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: [
      `--window-size=${viewport.width},${viewport.height}`,
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log(`PAGEERROR(${tag}): ${e.message}`));
  await page.setViewport({
    width: viewport.width,
    height: viewport.height,
    isMobile,
    hasTouch: isMobile,
    deviceScaleFactor: isMobile ? 2 : 1,
  });
  if (isMobile) {
    const client = await page.target().createCDPSession();
    await client.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'pointer', value: 'coarse' }],
    });
  }

  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 90000 });
  const booted = await enterOfflineGame(page, {
    charClass: 'warrior',
    charName: 'Brannok',
    gameBootTimeoutMs: 60000,
    selectorTimeoutMs: 30000,
  });
  console.log(`[${tag}] booted: ${booted}`);

  // Stage: park the player in the open, spawn/reskin a nearby mob as a
  // skeleton, hide HUD chrome, and aim the camera at both rigs.
  await page.evaluate(() => {
    const g = window.__game;
    const sim = g.sim;
    const p = sim.player;
    document.getElementById('gpu-notice')?.remove();
    for (const id of ['ui', 'nameplates']) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
    p.gm = true;
    p.hp = p.maxHp;
    p.pos.x = 80;
    p.pos.z = -30;
    p.pos.y = sim.groundPos(p.pos.x, p.pos.z).y;
    p.prevPos = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
    p.facing = 0;

    let mob = null;
    let d = 1e9;
    for (const e of sim.entities.values()) {
      if (e.kind === 'mob' && !e.dead) {
        const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
        if (dd < d) {
          d = dd;
          mob = e;
        }
      }
    }
    // drowned_dead: a plain 'undead' family mob (src/sim/content/zone2.ts) with
    // no MOB_KEYS override, so visualKeyFor falls through to FAMILY_KEYS.undead
    // (skel_minion), the exact kaykit()/skeletonClips() consumer under test.
    mob.templateId = 'drowned_dead';
    mob.name = 'Skeleton';
    mob.hostile = false;
    mob.hp = mob.maxHp;
    mob.pos.x = p.pos.x + 1.6;
    mob.pos.z = p.pos.z - 0.2;
    mob.pos.y = sim.groundPos(mob.pos.x, mob.pos.z).y;
    mob.prevPos = { x: mob.pos.x, y: mob.pos.y, z: mob.pos.z };
    mob.facing = Math.PI * 0.75;

    // Close, 3/4-angle camera (a pure behind view hides the lean the whole
    // point of this shot is to show): a modest yaw offset plus a tight zoom.
    g.input.camYaw = 0.7;
    g.input.camPitch = 0.18;
    g.input.camDist = 4.2;
    window.__hitVarietyMobId = mob.id;
  });

  // updateBaseVisual swaps the mob's rig asynchronously (asset fetch), so poll
  // for the skel_minion visual key rather than guessing a fixed delay.
  await page
    .waitForFunction(
      () => {
        const g = window.__game;
        const id = window.__hitVarietyMobId;
        return g?.renderer?.views?.get(id)?.visualKey === 'skel_minion';
      },
      { timeout: 15000 },
    )
    .catch(() => console.log(`[${tag}] WARNING: skel_minion visual swap did not resolve in time`));
  await sleep(300);

  // Force a specific hit clip on a rig, bypassing playHit()'s own randomness
  // and hitCooldown guard so the capture is deterministic. Runtime JS erases
  // TypeScript's `private`, so playOneShot is directly callable here exactly
  // as it is at tests/anim_pipeline_batch1.test.ts-adjacent call sites.
  async function forceClip(entityId, clipName, holdAtMs, attempts = 5) {
    let requested = false;
    let actual = null;
    for (let i = 0; i < attempts; i++) {
      requested = await page.evaluate(
        (id, clip) => {
          const g = window.__game;
          const view = g.renderer.views.get(id);
          const visual = view?.visual;
          if (!visual) return false;
          visual.hitCooldown = 0;
          visual.currentIsOneShot = false;
          visual.playOneShot(clip, 1.2);
          return true;
        },
        entityId,
        clipName,
      );
      await sleep(holdAtMs);
      actual = await page.evaluate((id) => {
        const view = window.__game.renderer.views.get(id);
        const current = view?.visual?.current;
        return current?.getClip ? current.getClip().name : null;
      }, entityId);
      if (actual === clipName) break;
      // The requested clip's donor GLB (an animUrls entry) may still be
      // fetching after the base visual swap resolves; give it another beat
      // and retry rather than capturing a stale pose.
      await sleep(500);
    }
    console.log(
      `[${tag}] requested ${clipName} on ${entityId}: found view=${requested}, playing=${actual}`,
    );
  }

  const playerId = await page.evaluate(() => window.__game.sim.player.id);
  const mobId = await page.evaluate(() => window.__hitVarietyMobId);

  // Hit_A: same clip both before and after this task, the constant control shot.
  await forceClip(playerId, 'Hit_A', 260);
  await page.screenshot({ path: `${SHOTS_DIR}/${LABEL}_player_hit_a_${tag}.png` });
  await forceClip(mobId, 'Hit_A', 260);
  await page.screenshot({ path: `${SHOTS_DIR}/${LABEL}_skeleton_hit_a_${tag}.png` });

  // Hit_B_Stagger: only resolves after this task. Held mid lean-peak (~300ms
  // into the 520ms clip, matching the build script's P_leanPeak sample point)
  // so the off-balance lean reads clearly in a still.
  await sleep(500); // let Hit_A's one-shot clamp/fade settle back to idle first
  await forceClip(playerId, 'Hit_B_Stagger', 300);
  await page.screenshot({ path: `${SHOTS_DIR}/${LABEL}_player_hit_b_${tag}.png` });
  await forceClip(mobId, 'Hit_B_Stagger', 300);
  await page.screenshot({ path: `${SHOTS_DIR}/${LABEL}_skeleton_hit_b_${tag}.png` });

  await browser.close();
  console.log(`[${tag}] done`);
}

const onlyDesktop = process.env.MOBILE_ONLY !== '1';
const onlyMobile = process.env.DESKTOP_ONLY !== '1';
if (onlyDesktop) await captureViewport(DESKTOP, 'desktop');
if (onlyMobile) await captureViewport(MOBILE, 'mobile');
