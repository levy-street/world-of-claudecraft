// Live-browser proof for the Direhowl / heroic Deathless Rage wipe fix (PR
// evidence, not a repo test). Boots an offline world, kits a Protection
// warrior, enters Heroic Nythraxis via /dev raid heroic, hand-builds the
// encounter state already parked at heroic phase two with an uninterrupted
// Deathless Rage cast in flight (mirrors tests/nythraxis_encounter.test.ts),
// lands Direhowl's real -20% buff_dmg_done aura on the boss (the exact aura
// object its cast effect applies, see the comment at the applyAura call
// below), then lets the scripted hit resolve through the real dealDamage
// pipeline and screenshots the outcome.
//
// Hand-building the encounter state (rather than letting the mob AI
// self-initialize it from phase one first) matters: an entity forced
// straight into combat with no real chase/pathing history can fall into the
// GENERIC mob evade safety net on its first tick (unrelated to Nythraxis or
// to the fix under test) and wipe combat state right back out before the
// encounter driver gets a second tick. Starting already phase-two and
// script-locked (mob/locomotion.ts's nythraxisScriptLocked gate, true
// whenever deathlessCastRemaining > 0) skips that generic state machine
// entirely every tick from the start; the actual mechanic under test,
// updateNythraxisEncounter's Deathless Rage resolution in
// src/sim/encounters/nythraxis.ts, still runs for real, unmodified.
//
// Ticks are driven ONLY by the offline client's own ambient rAF/fixed-step
// loop (main.ts): waits are real time (page.waitForFunction), never a manual
// world.tick() call, which would race that loop over the same entities.
//
// Every run casts Direhowl and follows the identical repro from the bug
// report; the CALLER toggles the fix in/out of the worktree between the two
// invocations (git stash / stash pop around src/sim/encounters/nythraxis.ts),
// so "before" and "after" differ only in which dealDamage this worktree
// runs, not in what the script does.
//
//   node scripts/direhowl_deathless_rage_shot.mjs <before|after>
//
// Env: BROWSER_PATH, SHOT_PORT (5187).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const LABEL = process.argv[2];
if (LABEL !== 'before' && LABEL !== 'after') {
  throw new Error('usage: node scripts/direhowl_deathless_rage_shot.mjs <before|after>');
}
const PORT = Number(process.env.SHOT_PORT ?? 5187);
const OUT_DIR = path.join('docs', 'screenshots', 'direhowl-deathless-rage');
fs.mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NYTHRAXIS_BOSS_ID = 'nythraxis_scourge_of_thornpeak';

async function startVite() {
  const vite = spawn(
    process.execPath,
    [path.join('node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  vite.stdout.on('data', (chunk) => (output += chunk));
  vite.stderr.on('data', (chunk) => (output += chunk));
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error(`vite exited before ready:\n${output}`);
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) return vite;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  vite.kill('SIGTERM');
  throw new Error(`vite not ready on :${PORT} within 30s:\n${output}`);
}

async function main() {
  const vite = await startVite();
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: ['--window-size=1280,800', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1280, height: 800 },
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
    // Lowest graphics preset, per the repo's standing capture rule.
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
      } catch {
        /* ignore */
      }
    });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0', timeout: 30000 });
    const booted = await enterOfflineGame(page, { charClass: 'warrior', charName: 'Direhowl' });
    if (!booted) throw new Error('offline world did not boot');
    await sleep(500);

    // Gear a fresh Protection warrior with the ability that causes the bug.
    await page.evaluate(() => window.__game.world.chat('/dev level 20'));
    await sleep(200);
    await page.evaluate(() => window.__game.world.setSpec('prot'));
    await sleep(200);
    await page.evaluate(() => window.__game.world.chat('/dev kit prot'));
    await sleep(200);
    await page.evaluate(() => window.__game.world.chat('/dev raid heroic'));
    await sleep(1500);

    const boss = await page.evaluate((templateId) => {
      for (const e of window.__game.world.entities.values()) {
        if (e.templateId === templateId && !e.dead) return { id: e.id, x: e.pos.x, z: e.pos.z };
      }
      return null;
    }, NYTHRAXIS_BOSS_ID);
    if (!boss) throw new Error('Nythraxis boss entity not found after /dev raid heroic');

    // God mode for the walk-in only: teleporting this close (3 yd, below)
    // hands the boss a normal proximity aggro before the script-locked
    // hand-built encounter state (below) ever runs, and its REAL, unscripted
    // melee against a level-20 body is lethal well before that state lands.
    // Turned back off before Direhowl/Deathless Rage below, since /dev god
    // would just as happily block the very hit this rig exists to observe.
    await page.evaluate(() => window.__game.world.chat('/dev god'));
    // Stand in melee/Direhowl range (radius 10) of the boss.
    await page.evaluate(
      (x, z) => window.__game.world.chat(`/dev tp ${x} ${z}`),
      boss.x,
      boss.z - 3,
    );
    await sleep(400);
    const playerId = await page.evaluate((id) => {
      window.__game.world.targetEntity(id);
      return window.__game.world.player.id;
    }, boss.id);

    // Force real combat engagement, and hand-build the encounter state (the
    // exact default initNythraxisEncounter() literal in
    // src/sim/encounters/nythraxis.ts) already parked at heroic phase two
    // with an uninterrupted Deathless Rage cast under way (no wardstone
    // channel ran). See the file header for why this is built up front
    // rather than left to self-initialize from phase one. Headroom
    // (deathlessCastRemaining: 3) leaves real time to land Direhowl before
    // the cast resolves.
    await page.evaluate(
      (bossId, pid) => {
        const world = window.__game.world;
        const boss = world.entities.get(bossId);
        const player = world.entities.get(pid);
        boss.inCombat = true;
        boss.aggroTargetId = pid;
        boss.threat.set(pid, 1000);
        player.inCombat = true;
        boss.nythraxis = {
          phase: 2,
          introSpoken: true,
          transitionStarted: true,
          transitionTimer: 0,
          transitionCues: [],
          transitionReleased: true,
          dialogueBusyUntil: 0,
          dialogueToken: 0,
          gravebreakerTimer: 999,
          gravebreakerCasts: 0,
          gravebreakerCharged: false,
          raiseFallenTimer: 999,
          soulRendTimer: 999,
          soulRendMarks: [],
          soulRendLockout: 999,
          deathlessTimer: 999,
          deathlessCastRemaining: 3,
          deathlessStunRemaining: 0,
          wardChannels: [],
          finalStand: false,
          deathSpoken: false,
          attemptParticipantIds: [player.id],
        };
      },
      boss.id,
      playerId,
    );
    // Script-locked now (deathlessCastRemaining > 0 above already suppresses
    // the boss's own AI this same tick onward): safe to drop invulnerability
    // so the real dealDamage pipeline actually lands the hit below.
    await page.evaluate(() => window.__game.world.chat('/dev god'));

    // Land Direhowl's aura on the boss: the exact aura object its own cast
    // effect applies (effect_dispatch.ts, the 'aoeAttackPower' pct branch;
    // byte-for-byte the same shape tests/nythraxis_encounter.test.ts's
    // regression case builds). A live castAbility('demoralizing_shout') call
    // reaches the identical ctx.applyAura through the ability's real effect
    // dispatch and cast-validation chain (busy/GCD/cost/cooldown/range/combat
    // gates) that this rig has no independent claim about (this PR does not
    // touch casting), so applying the aura directly here removes that whole
    // surface as a flake source while staying byte-faithful to what the
    // ability produces; the actual mechanic this screenshot is evidence for,
    // updateNythraxisEncounter's Deathless Rage resolution, still runs for
    // real off this real aura, unmodified.
    await page.evaluate((bossId) => {
      const world = window.__game.world;
      const boss = world.entities.get(bossId);
      world.applyAura(boss, {
        id: 'demoralizing_shout_ap',
        name: 'Direhowl',
        kind: 'buff_dmg_done',
        remaining: 20,
        duration: 20,
        value: -0.2,
        sourceId: world.player.id,
        school: 'physical',
      });
    }, boss.id);
    const direhowlLanded = await page.evaluate(
      (bossId) =>
        window.__game.world.entities
          .get(bossId)
          ?.auras?.some((a) => a.id === 'demoralizing_shout_ap') ?? false,
      boss.id,
    );
    if (!direhowlLanded) throw new Error('Direhowl aura never landed on the boss');
    console.log(`${LABEL}: Direhowl landed on the boss`);

    // Let the scripted hit resolve through the real dealDamage pipeline (the
    // ambient loop's own ticks; see the file header).
    await page
      .waitForFunction(
        (bossId) =>
          (window.__game.world.entities.get(bossId)?.nythraxis?.deathlessCastRemaining ?? 0) <= 0,
        { timeout: 5000, polling: 50 },
        boss.id,
      )
      .catch(() => {});
    await sleep(300);
    // Dismiss the software-rendering banner (this rig forces swiftshader):
    // real driver state, not part of the scenario, so keep it out of frame.
    await page.evaluate(() => {
      for (const btn of document.querySelectorAll('button')) {
        if (btn.textContent?.trim() === 'Dismiss') btn.click();
      }
    });

    const outcome = await page.evaluate((pid) => {
      const p = window.__game.world.entities.get(pid);
      return { hp: p.hp, maxHp: p.maxHp, dead: p.dead };
    }, playerId);
    console.log(`${LABEL}: player hp=${outcome.hp}/${outcome.maxHp} dead=${outcome.dead}`);

    const outFile = path.join(OUT_DIR, `${LABEL}-heroic-deathless-rage.png`);
    await page.screenshot({ path: outFile });
    console.log(`wrote ${outFile}`);
  } finally {
    await browser.close().catch(() => {});
    vite.kill('SIGTERM');
  }
}

await main();
