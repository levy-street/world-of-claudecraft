// Local browser acceptance for the authored druid cat. Run with a Vite server:
// GAME_URL=http://127.0.0.1:5187 node scripts/druid_cat_game_check.mjs
// Uses real offline commands, sim ticks, HUD event routing and renderer sync.
// Teleports and death/water fixtures are local staging; no product debug API.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { advanceDruidCat as advance, recordDruidCat } from './lib/druid_cat_game_runtime.mjs';
import { assertLoopbackUrl } from './lib/loopback_guard.mjs';

const url = assertLoopbackUrl(process.env.GAME_URL ?? 'http://127.0.0.1:5187', 'GAME_URL');
const out = path.resolve('tmp/druid-cat-game-check');
fs.mkdirSync(out, { recursive: true });
const report = { url: url.href, checks: [], errors: [], screenshots: [], traces: {} };
const assetHash = () =>
  createHash('sha256')
    .update(fs.readFileSync('public/models/creatures/druid_cat_form.glb'))
    .digest('hex');
report.assetSha256 = assetHash();
function check(name, ok, detail) {
  report.checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` ${JSON.stringify(detail)}` : ''}`);
}
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});

async function capture(page, name) {
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file });
  report.screenshots.push(file);
}
async function scenario(page, name, command, expected) {
  const trace = await advance(page, command);
  report.traces[name] = trace;
  const last = trace.at(-1);
  check(
    name,
    (!expected || trace.some((s) => s.clip === expected)) &&
      trace.every((s) => s.key === 'form_cat' && s.bones === 49 && s.finite),
    last,
  );
  return trace;
}

try {
  for (const mobile of [false, true]) {
    const label = mobile ? 'mobile-low' : 'desktop-low';
    const page = await browser.newPage();
    page.on('pageerror', (error) =>
      report.errors.push({ label, type: 'pageerror', text: error.message }),
    );
    page.on('console', (message) => {
      if (message.type() === 'error')
        report.errors.push({
          label,
          type: 'console',
          text: message.text(),
          url: message.location().url,
        });
    });
    if (mobile) await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1 }));
    });
    console.log(`Booting ${label}`);
    await page.goto(url.href, { waitUntil: 'networkidle0', timeout: 90000 });
    const booted = await enterOfflineGame(page, {
      charClass: 'druid',
      charName: 'Catcheck',
      selectorTimeoutMs: 60000,
      gameBootTimeoutMs: 120000,
    });
    check(`${label} offline boot`, booted);
    if (!booted) throw new Error('Offline druid did not boot');
    await page.evaluate(() => {
      const g = window.__game;
      g.sim.setPlayerLevel(20);
      g.sim.applyTalents({ spec: 'feral', rows: {} });
      g.sim.player.resource = g.sim.player.maxResource;
      g.sim.player.gcdRemaining = 0;
      g.sim.castAbility('cat_form');
      g.input.camDist = 6;
      document.querySelector('.gpu-notice-dismiss')?.click();
    });
    await page.waitForFunction(
      () => {
        const g = window.__game;
        const v = g.renderer.views.get(g.sim.playerId);
        return v?.catVisual?.root.visible && !v.formCompilePending;
      },
      { timeout: 120000 },
    );
    check(
      `${label} real cat form cast`,
      await page.evaluate(() => window.__game.sim.player.auras.some((a) => a.kind === 'form_cat')),
    );
    let shamanId;
    if (!mobile) {
      shamanId = await page.evaluate(() => {
        const g = window.__game;
        const id = g.sim.addPlayer('shaman', 'Wolfcheck', {
          bot: true,
          tutorialGreetingSent: true,
        });
        g.sim.setPlayerLevel(20, id);
        const p = g.sim.entities.get(id);
        p.pos = g.sim.groundPos(g.sim.player.pos.x + 3, g.sim.player.pos.z);
        p.prevPos = { ...p.pos };
        g.sim.rebucket(p);
        g.sim.castAbility('ghost_wolf', id);
        return id;
      });
      await page.waitForFunction(
        (id) => {
          const v = window.__game.renderer.views.get(id);
          return v?.catVisual?.root.visible && !v.formCompilePending;
        },
        { timeout: 120000 },
        shamanId,
      );
      check(
        'shaman retains original wolf',
        await page.evaluate(
          (id) => window.__game.renderer.views.get(id).catVisual.key === 'form_ghost_wolf',
          shamanId,
        ),
      );
    }
    // Let the already queued frame finish, then own time stepping locally.
    await page.evaluate(() => {
      window.requestAnimationFrame = () => 0;
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    // The level grant makes a transient deed banner; it is not part of a pose capture.
    await page.addStyleTag({ content: '#banner { display: none !important; }' });
    await scenario(page, `${label} idle`, { reset: true, steps: 25 }, 'Idle_Look');
    await capture(page, `${label}-idle`);
    if (!mobile) {
      await page.evaluate((id) => {
        const g = window.__game;
        const wolf = g.sim.entities.get(id);
        wolf.pos = g.sim.groundPos(-351, -2);
        wolf.prevPos = { ...wolf.pos };
        g.sim.rebucket(wolf);
      }, shamanId);
      await advance(page, { steps: 3 });
      await capture(page, 'desktop-cat-and-shaman-wolf');
    }
    const run = await scenario(page, `${label} run`, { move: { forward: true }, steps: 25 }, 'Run');
    check(
      `${label} run cadence matches seven yards per second`,
      Math.abs(run.at(-1).speed - 7) < 0.01 && Math.abs(run.at(-1).rate - 7 / 9.13075) < 0.01,
    );
    await capture(page, `${label}-run`);
    if (mobile) {
      await page.close();
      continue;
    }
    const dash = await scenario(
      page,
      'dash',
      { reset: true, cast: 'dash', move: { forward: true }, steps: 20 },
      'Run',
    );
    check(
      'dash cadence matches ten and a half yards per second',
      Math.abs(dash.at(-1).speed - 10.5) < 0.01 &&
        Math.abs(dash.at(-1).rate - 10.5 / 9.13075) < 0.01,
    );
    await scenario(
      page,
      'slowed run',
      { reset: true, slow: 0.5, move: { forward: true }, steps: 25 },
      'Run',
    );
    await scenario(
      page,
      'slow walk',
      { reset: true, slow: 0.3, move: { forward: true }, steps: 25 },
      'Walk',
    );
    await scenario(page, 'backpedal', { reset: true, move: { back: true }, steps: 25 }, 'WalkBack');
    await scenario(page, 'prowl idle', { reset: true, cast: 'prowl', steps: 20 }, 'ProwlIdle');
    await scenario(page, 'prowl walk', { move: { forward: true }, steps: 25 }, 'ProwlWalk');
    await capture(page, 'desktop-prowl');
    await scenario(page, 'prowl backpedal', { move: { back: true }, steps: 20 }, 'ProwlWalk');
    await scenario(page, 'jump', { reset: true, move: { jump: true }, steps: 4 }, 'Jump');
    await capture(page, 'desktop-jump');
    const jump = await scenario(page, 'jump touchdown', { steps: 35 }, 'Land');
    check(
      'jump remains airborne until physical touchdown',
      jump.every((s) => s.clip !== 'Land' || s.onGround),
    );
    await scenario(page, 'repeated hop', { move: { jump: true }, steps: 30 }, 'Jump');
    const water = await page.evaluate(async () => {
      const { waterLevelAt, groundHeight } = await import('/src/sim/world.ts');
      const seed = window.__game.sim.cfg.seed;
      for (let x = -380; x <= -350; x += 5)
        for (let z = 45; z <= 65; z += 5) {
          const water = waterLevelAt(x, z, seed);
          if (Number.isFinite(water) && groundHeight(x, z, seed) < water - 2)
            return { x, y: water - 0.75, z };
        }
      throw new Error('No deep water fixture found');
    });
    await scenario(
      page,
      'surface paddling',
      { reset: true, position: water, stage: { onGround: false }, steps: 12 },
      'Swim',
    );
    await capture(page, 'desktop-swim-idle');
    await scenario(page, 'surface stroke', { move: { forward: true }, steps: 16 }, 'Swim');
    await capture(page, 'desktop-swim-surface');
    await scenario(
      page,
      'dive stroke',
      { position: { ...water, y: water.y - 1.5 }, move: { forward: true }, steps: 12 },
      'Swim',
    );
    await capture(page, 'desktop-swim-deep');
    await scenario(
      page,
      'resurface stroke',
      { position: water, move: { forward: true }, steps: 12 },
      'Swim',
    );
    await scenario(
      page,
      'jump into water',
      {
        reset: true,
        position: { ...water, y: water.y + 3 },
        stage: { onGround: false, vy: -1 },
        steps: 25,
      },
      'Swim',
    );
    check(
      'water entry does not play ground landing',
      !report.traces['jump into water'].some((s) => s.clip === 'Land'),
    );
    await advance(page, { reset: true, steps: 20 });
    const targetId = await page.evaluate(async () => {
      const { createMob } = await import('/src/sim/entity.ts');
      const g = window.__game;
      const p = g.sim.player;
      const dummy = createMob(
        g.sim.nextId++,
        g.MOBS.forest_wolf,
        1,
        g.sim.groundPos(p.pos.x, p.pos.z + 2),
      );
      dummy.hp = dummy.maxHp = 100000;
      dummy.hostile = true;
      dummy.aggroRadius = 0;
      dummy.moveSpeed = 0;
      g.sim.addEntity(dummy);
      g.sim.targetEntity(dummy.id);
      g.sim.startAutoAttack();
      return dummy.id;
    });
    await scenario(page, 'combat stance and autos', { steps: 70 }, 'Idle_Look');
    await capture(page, 'desktop-combat');
    for (const [ability, clip] of [
      ['claw', 'Attack_Left'],
      ['rake', 'Attack_Right'],
      ['ferocious_bite', 'Bite'],
      ['rip', 'Finisher'],
    ]) {
      await page.evaluate(() => {
        const g = window.__game;
        g.sim.stopAutoAttack();
        g.sim.player.comboPoints = 5;
        g.sim.player.auras = g.sim.player.auras.filter((a) => a.kind !== 'old_blood');
      });
      await scenario(page, `ability ${ability}`, { cast: ability, steps: 16 }, clip);
    }
    await page.evaluate((id) => {
      const g = window.__game;
      const target = g.sim.entities.get(id);
      target.dead = true;
      target.hp = 0;
      target.pos.x -= 100;
      g.sim.rebucket(target);
    }, targetId);
    // The rip Finisher above runs 0.9s; give the one-shot room to fade before the sit
    // base takes over, or the first sample still reads the attack.
    await scenario(page, 'sit down', { reset: true, chat: '/sit', steps: 6 }, 'Idle_Look');
    await scenario(page, 'seated loop', { steps: 45 }, 'Idle_Look');
    await capture(page, 'desktop-sit');
    await scenario(
      page,
      'death pose',
      { reset: true, stage: { dead: true, hp: 0 }, renderOnly: true, steps: 40 },
      'Death',
    );
    await capture(page, 'desktop-death');
    await scenario(
      page,
      'recovery',
      { stage: { dead: false, hp: 800 }, renderOnly: true, steps: 1 },
      'Idle_Look',
    );
    await scenario(page, 'recovery idle', { reset: true, steps: 40 }, 'Idle_Look');
    console.log('Recording actual gameplay frames');
    report.video = await recordDruidCat(page, out);
    await page.close();
  }
} catch (error) {
  report.errors.push({ type: 'harness', text: error.stack });
  console.error(error);
} finally {
  // A Vite-only offline session has no presence/stats backend; existing delayed
  // NPC preloads log their retry before becoming available. Keep all evidence.
  report.backgroundIssues = report.errors.filter(
    (error) =>
      error.type === 'console' &&
      (/\/api\/(site-presence|project-stats)$/.test(error.url ?? '') ||
        /^character visual unavailable, skipping view \((npc_modular_walking_staff|mob_training_dummy)\): Error: character asset not preloaded:/.test(
          error.text,
        )),
  );
  const unexpected = report.errors.filter((error) => !report.backgroundIssues.includes(error));
  check('no cat rig, browser runtime or harness errors', unexpected.length === 0, unexpected);
  check('tested GLB did not change during acceptance', report.assetSha256 === assetHash());
  fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
process.exitCode = report.checks.every((c) => c.ok) ? 0 : 1;
