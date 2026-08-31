// Live-browser proof for the Soulwell-in-Thornhollow-Fields fix (PR evidence,
// not a repo test): the general Interact key used to route unconditionally to
// the battleground's deliberate flag press whenever a match was active, on
// the assumption the field held no other interactable. A Warlock's Soulwell
// can be summoned right at the team's own flag stand, and every Interact
// press there (or anywhere else in the field) was swallowed by a doomed flag
// grab: "There is no flag within reach."
//
// Boots the offline world as a Warlock, force-starts a solo Thornhollow
// Fields match via /dev bg, teleports to the caller's own flag (never
// grabbable: bgFlagAction only ever takes the ENEMY flag), casts Soulwell
// right there, then presses the Interact key and reads the result: the error
// toast text and whether a Soul Stone was actually granted.
//
// Ticks are driven ONLY by the offline client's own ambient rAF/fixed-step
// loop (main.ts), never a manual world.tick() call, EXCEPT for fast-forwarding
// the form-up countdown below (pure administrative setup, not the mechanic
// under test; the actual countdown -> active transition still runs on its
// real code path on the very next real tick). The CALLER toggles the fix
// in/out of the worktree between the two invocations (git stash -u the
// changed/added files around the "before" run), so "before" and "after"
// differ only in which code this worktree runs, not in what the script does.
//
//   node scripts/soulwell_bg_flag_shot.mjs <before|after>
//
// Env: BROWSER_PATH, SHOT_PORT (5189).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const LABEL = process.argv[2];
if (LABEL !== 'before' && LABEL !== 'after') {
  throw new Error('usage: node scripts/soulwell_bg_flag_shot.mjs <before|after>');
}
const PORT = Number(process.env.SHOT_PORT ?? 5189);
const OUT_DIR = path.join('docs', 'screenshots', 'soulwell-battleground-flag-interact');
fs.mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    const booted = await enterOfflineGame(page, { charClass: 'warlock', charName: 'Bramwick' });
    if (!booted) throw new Error('offline world did not boot');
    await sleep(500);

    // Max level: guarantees Soulwell (learnLevel 8) is known and mana is plentiful.
    await page.evaluate(() => window.__game.world.chat('/dev level 20'));
    await sleep(200);

    // Force-start Thornhollow Fields (queues a stationary dev bot for the other side).
    await page.evaluate(() => window.__game.world.chat('/dev bg'));
    const queued = await page
      .waitForFunction(() => window.__game.world.bgInfo?.match != null, {
        timeout: 15000,
        polling: 200,
      })
      .then(() => true)
      .catch(() => false);
    if (!queued) throw new Error('/dev bg never produced a match');
    // Fast-forward the 8s form-up countdown: administrative setup, not the
    // mechanic under test. The transition itself still runs for real on the
    // very next tick (src/sim/social/battleground.ts tickCountdown).
    await page.evaluate(() => {
      const world = window.__game.world;
      const match = world.bgMatches.get(world.player.id);
      if (match) match.timer = 0.01;
    });
    const active = await page
      .waitForFunction(() => window.__game.world.bgInfo?.match?.state === 'active', {
        timeout: 15000,
        polling: 100,
      })
      .then(() => true)
      .catch(() => false);
    if (!active) {
      const bgInfo = await page.evaluate(() => JSON.stringify(window.__game?.world?.bgInfo));
      throw new Error(`battleground match never reached the active state; bgInfo=${bgInfo}`);
    }
    console.log(`${LABEL}: battleground match active`);

    // Teleport to the caller's OWN flag: bgFlagAction only ever grabs the
    // ENEMY flag, so standing here is the exact reported repro (a Soulwell
    // built at the team's own base, next to its flag).
    const flag = await page.evaluate(() => {
      const world = window.__game.world;
      const myTeam = world.bgInfo.match.myTeam;
      const teamColors = [0xd1413a, 0x3a78d1]; // BG_TEAM_COLORS (Crimson, Azure)
      for (const e of world.entities.values()) {
        if (e.kind === 'object' && e.templateId === 'bg_flag' && e.color === teamColors[myTeam]) {
          return { x: e.pos.x, z: e.pos.z };
        }
      }
      return null;
    });
    if (!flag) throw new Error('own flag entity not found');
    // 1.5 yd off the pole: inside BG_PICKUP_RADIUS (2.5), clear of its collider.
    await page.evaluate(
      (x, z) => window.__game.world.chat(`/dev tp ${x} ${z + 1.5}`),
      flag.x,
      flag.z,
    );
    await sleep(300);
    const playerId = await page.evaluate(() => window.__game.world.player.id);

    // Cast Soulwell right there (3s cast, out of combat, spawns 2.6-4.8 yd in
    // front of the caster, who has not moved).
    await page.evaluate(() => window.__game.world.castAbility('soulwell'));
    const soulwellUp = await page
      .waitForFunction(
        (pid) =>
          [...window.__game.world.entities.values()].some(
            (e) => e.objectItemId === 'soulwell' && e.soulwell?.ownerId === pid,
          ),
        // The cast itself is 3 sim-seconds on the real ambient loop; generous
        // under frame-rate throttling from concurrent CPU load.
        { timeout: 45000, polling: 100 },
        playerId,
      )
      .then(() => true)
      .catch(() => false);
    if (!soulwellUp) throw new Error('Soulwell never landed after castAbility');

    const distances = await page.evaluate((pid) => {
      const world = window.__game.world;
      const player = world.entities.get(pid);
      const well = [...world.entities.values()].find(
        (e) => e.objectItemId === 'soulwell' && e.soulwell?.ownerId === pid,
      );
      const flag = [...world.entities.values()].find(
        (e) => e.kind === 'object' && e.templateId === 'bg_flag',
      );
      const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
      return {
        playerToFlag: flag ? d2(player.pos, flag.pos) : null,
        playerToSoulwell: well ? d2(player.pos, well.pos) : null,
      };
    }, playerId);
    console.log(`${LABEL}: soulwell placed`, distances);

    const soulStonesBefore = await page.evaluate(
      (pid) => window.__game.world.countItem('soul_stone', pid),
      playerId,
    );

    // Dismiss the software-rendering banner before the shot (real driver
    // state, not part of the scenario).
    await page.evaluate(() => {
      for (const btn of document.querySelectorAll('button')) {
        if (btn.textContent?.trim() === 'Dismiss') btn.click();
      }
    });

    // The Interact key (default KeyF). A real CDP-level keypress (like
    // esc_run_shot.mjs's Escape), the actual key path a player's browser
    // delivers, not a bare window.dispatchEvent.
    await page.keyboard.press('f');

    // Poll briefly for either the error toast or the granted stone: whichever
    // this worktree's code path actually produces.
    await page
      .waitForFunction(
        (pid, before) => {
          const errText = document.querySelector('#error-msg')?.textContent ?? '';
          return (
            errText.trim().length > 0 || window.__game.world.countItem('soul_stone', pid) > before
          );
        },
        // The error toast specifically requires the sim's emitted event to be
        // drained on the next real tick and handed to the HUD, unlike the
        // synchronous stone grant; generous under frame-rate throttling.
        { timeout: 20000, polling: 50 },
        playerId,
        soulStonesBefore,
      )
      .catch(() => {});
    await sleep(150);

    const errorText = await page.evaluate(
      () => document.querySelector('#error-msg')?.textContent ?? '',
    );
    const soulStonesAfter = await page.evaluate(
      (pid) => window.__game.world.countItem('soul_stone', pid),
      playerId,
    );

    const outFile = path.join(OUT_DIR, `${LABEL}-soulwell-flag-interact.png`);
    await page.screenshot({ path: outFile });
    console.log(`wrote ${outFile}`);

    const report = {
      label: LABEL,
      distances,
      soulStonesBefore,
      soulStonesAfter,
      errorText,
      checks: {
        grantedStone: soulStonesAfter > soulStonesBefore,
        sawFlagError: /flag/i.test(errorText),
      },
    };
    fs.writeFileSync(path.join(OUT_DIR, `${LABEL}-report.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));

    const expected =
      LABEL === 'before'
        ? report.checks.sawFlagError && !report.checks.grantedStone
        : report.checks.grantedStone && !report.checks.sawFlagError;
    console.log(
      expected
        ? `PASS: ${LABEL} matches the expected (buggy vs fixed) behavior.`
        : `FAIL: ${LABEL} did NOT match the expected behavior, see report above.`,
    );
    if (!expected) process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
    vite.kill('SIGTERM');
  }
}

await main();
