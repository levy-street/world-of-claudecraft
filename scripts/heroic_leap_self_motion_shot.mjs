// Live-browser proof for the Vaulting Charge (heroic_leap) self-motion fix
// (PR evidence, not a repo test): registers an account, levels a fresh
// warrior to 6, teleports to open ground, casts the leap, and samples BOTH
// the authoritative mirrored position (window.__game.world.player.pos, always
// correct: it is the server's own truth) and the actually DRAWN local-player
// position (window.__game.renderer.selfRenderPosition, what self_motion.ts /
// self_prediction.ts feed the mesh) once per animation frame through the
// ~0.6s flight. On the bug the drawn Y tracks the ground while the true Y
// arcs into the air (the local kernel has no notion of the airborne arc and
// keeps predicting ordinary grounded movement over it); on the fix the two
// stay in lockstep because self-motion prediction suspends for the duration
// of the flight, the same way it already does for a ledge climb.
//
// This needs a LIVE ONLINE session (not the offline entry): the offline
// client never runs the self-motion prediction layer at all, so it cannot
// exhibit the bug. Point it at an already-running server + client:
//
//   node scripts/heroic_leap_self_motion_shot.mjs <before|after> <gameUrl>
//
// Env: BROWSER_PATH.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const LABEL = process.argv[2];
const GAME_URL = process.argv[3];
if ((LABEL !== 'before' && LABEL !== 'after') || !GAME_URL) {
  throw new Error('usage: node scripts/heroic_leap_self_motion_shot.mjs <before|after> <gameUrl>');
}
const OUT_DIR = path.join('docs', 'screenshots', 'heroic-leap-self-motion');
fs.mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Eastbrook Vale open field: flat (-3.05yd across a 20yd run), dry, no
// nearby colliders, well clear of any instanced band.
const TP_X = 0;
const TP_Z = 0;

const uniq = Date.now()
  .toString(36)
  .slice(-6)
  .replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
const USER = `leapshot${uniq}`;
const CHAR_NAME = `Leap${uniq[0].toUpperCase()}${uniq.slice(1)}`;

async function overlayText(page, text) {
  await page.evaluate((t) => {
    let el = document.getElementById('leap-shot-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'leap-shot-overlay';
      el.style.cssText =
        'position:fixed;left:12px;top:12px;z-index:999999;background:rgba(0,0,0,0.78);' +
        'color:#fff;font:15px monospace;padding:10px 14px;border-radius:6px;white-space:pre;';
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    protocolTimeout: 60000,
    args: ['--window-size=1280,800', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1280, height: 800 },
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
      } catch {
        /* ignore */
      }
    });

    console.log(`[${LABEL}] loading ${GAME_URL} ...`);
    await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(800);

    await page.evaluate(() => {
      document.querySelector('#btn-online').click();
    });
    await sleep(200);
    await page.evaluate(() => {
      const form = document.querySelector('#login-panel');
      if (form.dataset.authMode !== 'register') document.querySelector('#btn-auth-toggle').click();
    });
    await sleep(200);
    await page.evaluate((u) => {
      document.querySelector('#login-user').value = u;
      document.querySelector('#login-pass').value = 'leapshot-pass-1';
      document.querySelector('#login-email').value = `${u}@example.com`;
      document.querySelector('#login-panel').requestSubmit();
    }, USER);
    // Fresh account: registration lands on the realm list (single realm
    // here), which must be picked before character select ever shows.
    await page.waitForFunction(
      () => !document.querySelector('#realm-panel')?.hasAttribute('hidden'),
      { timeout: 10000, polling: 200 },
    );
    console.log(`[${LABEL}] at realm list`);
    await page.waitForFunction(() => document.querySelectorAll('.realm-row').length > 0, {
      timeout: 10000,
      polling: 200,
    });
    await page.evaluate(() => document.querySelector('.realm-row').click());
    // A brand-new account has an empty roster: selecting the realm routes
    // straight to charcreate-panel, skipping charselect-panel entirely. An
    // account with characters lands on charselect-panel instead, where
    // "New Character" opens the same charcreate-panel.
    await page.waitForFunction(
      () =>
        !document.querySelector('#charcreate-panel')?.hasAttribute('hidden') ||
        !document.querySelector('#charselect-panel')?.hasAttribute('hidden'),
      { timeout: 10000, polling: 200 },
    );
    if (
      await page.evaluate(
        () => document.querySelector('#charselect-panel')?.hasAttribute('hidden') === false,
      )
    ) {
      console.log(`[${LABEL}] at char select`);
      await page.evaluate(() => document.querySelector('#btn-new-character').click());
      await page.waitForFunction(
        () => !document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
        { timeout: 10000, polling: 200 },
      );
    }
    console.log(`[${LABEL}] at char create`);
    await page.evaluate((name) => {
      document.querySelector('#new-char-name').value = name;
      document.querySelector('#charcreate-panel .mini-class[data-class="warrior"]').click();
      document.querySelector('#btn-create-char').click();
    }, CHAR_NAME);
    await sleep(700);
    const entered = await page.evaluate((name) => {
      const rows = [...document.querySelectorAll('.char-row')];
      const row = rows.find((r) => r.querySelector('.char-name')?.textContent === name);
      if (!row) return false;
      row.querySelector('.enter-world-btn').click();
      return true;
    }, CHAR_NAME);
    if (!entered) throw new Error(`could not enter world as ${CHAR_NAME}`);
    // Cold swiftshader asset preload (hundreds of GLBs on first boot) can
    // take well over 20s; measured ~27s locally.
    await page.waitForFunction(
      () => {
        const g = window.__game;
        return g?.world && g.world.entities.size > 0;
      },
      { timeout: 90000, polling: 500 },
    );
    console.log(`[${LABEL}] in world (entities present)`);
    // entities.size > 0 fires while the "Entering the World..." loading
    // curtain is still up (the arrival cover holds presentation until the
    // scene's own GPU programs settle); the self-render position is not
    // meaningful until the curtain is actually gone.
    await page
      .waitForFunction(
        () => {
          const el = document.querySelector('#loading-screen');
          return el ? !el.classList.contains('visible') : true;
        },
        { timeout: 30000, polling: 200 },
      )
      .catch(() => console.log(`[${LABEL}] WARNING: loading curtain wait timed out`));
    console.log(`[${LABEL}] loading curtain gone`);
    await sleep(1500);

    // Dismiss the new-character NPC greeting / tutorial popup so they never
    // sit across the keeper.
    await page.evaluate(() => {
      for (const btn of document.querySelectorAll('button')) {
        const t = btn.textContent?.trim();
        if (t === 'Understood' || t === 'Skip Tutorial' || t === 'Dismiss') btn.click();
      }
    });
    await sleep(200);

    await page.evaluate(() => window.__game.world.chat('/dev level 6'));
    await sleep(300);
    await page.evaluate((x, z) => window.__game.world.chat(`/dev tp ${x} ${z}`), TP_X, TP_Z);
    // A teleport across a zone boundary can re-raise the same loading
    // curtain (a scene rebuild), which must be gone before the self-render
    // position means anything.
    await sleep(300);
    await page
      .waitForFunction(
        () => {
          const el = document.querySelector('#loading-screen');
          return el ? !el.classList.contains('visible') : true;
        },
        { timeout: 30000, polling: 200 },
      )
      .catch(() => console.log(`[${LABEL}] WARNING: post-teleport curtain wait timed out`));

    // The teleport is a large instant jump; the display's own rewind-limited
    // catch-up (self_render_position_core.ts, capped at 12yd/s) can still be
    // gliding toward it well after the authoritative position has already
    // landed. Settling on THAT residual before casting is what the leap
    // itself would otherwise be blamed for, so poll drawnY vs trueY down to
    // a tight tolerance (or a bounded fallback wait) before proceeding.
    const settleDeadline = Date.now() + 4000;
    let settled = false;
    while (Date.now() < settleDeadline) {
      const s = await page.evaluate(
        () =>
          new Promise((resolve) => {
            requestAnimationFrame(() => {
              const p = window.__game.world.player;
              const r = window.__game.renderer;
              resolve({ trueY: p.pos.y, drawnY: r.selfRenderPosition.y });
            });
          }),
      );
      if (Math.abs(s.trueY - s.drawnY) < 0.05) {
        settled = true;
        break;
      }
    }
    console.log(`[${LABEL}] display settled after teleport: ${settled}`);

    const before = await page.evaluate(() => {
      const p = window.__game.world.player;
      return { x: p.pos.x, y: p.pos.y, z: p.pos.z, leaping: !!p.leaping };
    });
    console.log(`[${LABEL}] positioned at`, JSON.stringify(before));

    // Aim 12yd ahead along +x (the heroic_leap.test.ts convention): flat,
    // open ground the whole way, no facing dependency since castAbilityAt
    // takes a world-space aim point directly. Cast AND sample in one
    // in-browser rAF loop: a Node round trip per sample costs 50-800ms under
    // swiftshader, which is coarser than the whole ~600ms flight, so the
    // whole capture runs client-side and returns the array once, done.
    const aim = { x: before.x + 12, z: before.z };
    const samples = await page.evaluate(
      (aim) =>
        new Promise((resolve) => {
          const out = [];
          const deadline = performance.now() + 1400;
          window.__game.world.castAbilityAt('heroic_leap', aim);
          function tick() {
            const p = window.__game.world.player;
            const r = window.__game.renderer;
            out.push({
              t: performance.now(),
              trueY: p.pos.y,
              drawnY: r.selfRenderPosition.y,
              trueX: p.pos.x,
              leaping: !!p.leaping,
            });
            if (performance.now() < deadline) requestAnimationFrame(tick);
            else resolve(out);
          }
          requestAnimationFrame(tick);
        }),
      aim,
    );
    const t0 = samples[0]?.t ?? 0;
    for (const s of samples) s.t -= t0;
    console.log(`[${LABEL}] collected ${samples.length} in-browser samples`);
    const apexSample = samples.reduce((a, b) => (b.trueY > a.trueY ? b : a), samples[0]);
    console.log(
      `[${LABEL}] apex @ t=${apexSample.t.toFixed(0)}ms trueY=${apexSample.trueY.toFixed(2)} ` +
        `drawnY=${apexSample.drawnY.toFixed(2)} gap=${(apexSample.trueY - apexSample.drawnY).toFixed(2)}yd`,
    );
    fs.writeFileSync(path.join(OUT_DIR, `${LABEL}-samples.json`), JSON.stringify(samples, null, 2));

    // Freeze the frame nearest the true apex and shoot it with the numeric
    // proof burned into the overlay (the climb_stall_shot.mjs precedent:
    // sim numbers next to the pixels).
    const gap = apexSample.trueY - apexSample.drawnY;
    await overlayText(
      page,
      `${LABEL}\nt=${apexSample.t.toFixed(0)}ms of ~600ms flight\n` +
        `authoritative Y (server truth): ${apexSample.trueY.toFixed(2)}\n` +
        `drawn Y (local self-render):    ${apexSample.drawnY.toFixed(2)}\n` +
        `gap: ${gap.toFixed(2)}yd ${Math.abs(gap) > 0.5 ? '(BUG: clipped toward the ground)' : '(matches: arcing correctly)'}`,
    );
    await sleep(100);
    await page.screenshot({ path: path.join(OUT_DIR, `${LABEL}-mid-flight.png`) });

    // Let it land, then one more shot + readout for the record.
    await sleep(700);
    const landed = await page.evaluate(() => {
      const p = window.__game.world.player;
      return { x: p.pos.x, y: p.pos.y, z: p.pos.z, onGround: p.onGround };
    });
    console.log(`[${LABEL}] landed at`, JSON.stringify(landed));
  } finally {
    await browser.close().catch(() => {});
  }
}

await main();
