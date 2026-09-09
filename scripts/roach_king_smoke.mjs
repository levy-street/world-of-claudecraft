// Reproducible offline Rift encounter + visual smoke. Start Vite separately:
// npm run dev -- --host 127.0.0.1 --port 5185
// node scripts/roach_king_smoke.mjs [--mobile] [--low] [--headed] [--hardware]
// Add --natural-motion for short locomotion/melee/full-cast recordings and pose telemetry.
// Headless/SwiftShader is functional evidence only, never a smoothness claim.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { dismissEntryOverlays, enterOfflineGame } from './enter_offline_game.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';
import {
  captureRoachCorpseAngles,
  installRoachMotionProbe,
  roachBodyContactProbe,
  roachPoseFailures,
} from './lib/roach_king_pose_probe.mjs';
import {
  beginRoachMechanic,
  exerciseRoachNaturalMotion,
  finishRoachMechanic,
  pauseRoachScenario,
  prepareRoachKingScenario,
  roachScenarioSnapshot,
} from './lib/roach_king_scenario.mjs';

const mobile = process.argv.includes('--mobile');
const low = process.argv.includes('--low');
const hardware = process.argv.includes('--hardware');
const headed = process.argv.includes('--headed');
const deathOnly = process.argv.includes('--death-only');
const naturalMotion = process.argv.includes('--natural-motion') && !deathOnly;
const poseProbe = process.argv.includes('--pose-probe') || naturalMotion;
const profile = `${mobile ? 'mobile' : 'desktop'}-${low ? 'low' : 'high'}`;
const output = path.resolve(process.env.SHOT_OUT ?? 'tmp/roach-king-smoke');
const gameUrl = process.env.GAME_URL ?? 'http://127.0.0.1:5185';
const viewport = mobile
  ? { width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
  : { width: 1600, height: 900, deviceScaleFactor: 1 };
mkdirSync(output, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: !headed,
  defaultViewport: viewport,
  args: [
    `--window-size=${viewport.width},${viewport.height}`,
    ...(hardware ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
  ],
});
const page = await browser.newPage();
if (headed) await page.bringToFront();
const report = {
  profile,
  viewport,
  hardware,
  headed,
  deathOnly,
  pageErrors: [],
  consoleErrors: [],
  failedRequests: [],
  stages: {},
};
page.on('pageerror', (error) => report.pageErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error')
    report.consoleErrors.push({ text: message.text(), location: message.location() });
});
page.on('requestfailed', (request) =>
  report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }),
);
await suppressGpuNotice(page);
try {
  await page.evaluateOnNewDocument((minimal) => {
    localStorage.setItem('woc_unsupported_browser_dismissed', '1');
    localStorage.setItem(
      'woc_settings',
      JSON.stringify({
        graphicsPreset: minimal ? 1 : 5,
        terrainDetail: minimal ? 0 : 1,
        effectsQuality: minimal ? 0 : 1,
        shadowQuality: minimal ? 0 : 1,
      }),
    );
  }, low);
  await page.goto(`${gameUrl}/?gfx=${low ? 'low' : 'high'}&perf`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  assert(
    await enterOfflineGame(page, {
      charName: 'Roachwatcher',
      charClass: 'warrior',
      settleMs: 500,
      gameBootTimeoutMs: 180000,
      selectorTimeoutMs: 60000,
    }),
    'Offline boot failed',
  );
  await page.waitForFunction(
    () => !document.querySelector('#loading-screen')?.classList.contains('visible'),
    { timeout: 90000 },
  );
  await dismissEntryOverlays(page);
  await page.evaluate(() => document.querySelector('#tutorial-greeting .cd-ok')?.click());
  console.log(`${profile}: offline world ready`);
  report.fixture = await prepareRoachKingScenario(page);
  const id = report.fixture.bossId;
  async function capture(name, key) {
    if (headed) await page.bringToFront();
    await pauseRoachScenario(page, true);
    await page.waitForFunction(
      (bossId, visualKey) => {
        const view = window.__game.renderer.views.get(bossId);
        return (
          view?.visualKey === visualKey &&
          view.group.visible &&
          !view.compilePending &&
          !view.visualCompilePending
        );
      },
      { timeout: 90000 },
      id,
      key,
    );
    if (poseProbe) await page.evaluate(installRoachMotionProbe, id);
    if (name === 'coronation-end') {
      await page.waitForFunction(
        (bossId) => {
          const action = window.__game.renderer.views.get(bossId)?.visual?.actions.get('Transform');
          return action && action.time >= action.getClip().duration - 0.01;
        },
        { timeout: 15000 },
        id,
      );
    }
    await page.evaluate(() => document.querySelector('#tutorial-greeting .cd-ok')?.click());
    // Let real celebration timers drain; never hide earned gameplay messages.
    await page.waitForFunction(
      () => {
        const queue = window.__game.hud.bannerQueue;
        return (
          !queue?.isLive &&
          !queue?.depth &&
          Number(getComputedStyle(document.querySelector('#banner')).opacity) < 0.01
        );
      },
      { timeout: 90000 },
    );
    await page.waitForFunction(
      () =>
        !document.querySelector('#tutorial-greeting') &&
        !document.querySelector('#loading-screen')?.classList.contains('visible'),
      { timeout: 30000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    // Suppress only the dev diagnostic panel while capturing the game image.
    await page.evaluate(() => {
      const panel = document.querySelector('[title="Click to copy a JSON perf report"]');
      if (panel) panel.style.visibility = 'hidden';
    });
    await page.screenshot({ path: path.join(output, `${profile}-${name}.png`) });
    await page.evaluate(() => {
      const panel = document.querySelector('[title="Click to copy a JSON perf report"]');
      if (panel) panel.style.visibility = '';
    });
    report.stages[name] = await roachScenarioSnapshot(page, id);
    report.stages[name].pose = await page.evaluate(roachBodyContactProbe, id);
    console.log(`${profile}: captured ${name}`);
    if (naturalMotion && (name === 'hermit' || name === 'crowned')) {
      const startFrame = await page.evaluate(
        (visualKey) => window.__roachMotion[visualKey].frames.length,
        key,
      );
      const recorder = await page.screencast({
        path: path.join(output, `${profile}-${name}-motion.webm`),
        fps: 30,
      });
      try {
        await exerciseRoachNaturalMotion(page, id);
      } finally {
        await recorder.stop();
      }
      const endFrame = await page.evaluate(
        (visualKey) => window.__roachMotion[visualKey].frames.length,
        key,
      );
      report.stages[name].naturalMotion = {
        startFrame,
        endFrame,
        file: `${profile}-${name}-motion.webm`,
      };
      console.log(`${profile}: recorded natural ${name} motion`);
    }
  }
  // Let the ordinary tick drain entry/descent events before pausing the fixture.
  await page.waitForFunction(
    (bossId) => window.__game.renderer.views.has(bossId),
    { timeout: 90000 },
    id,
  );
  await capture('hermit', 'mob_asmon_hermit');
  const phases = [
    ['desk-slam', 'slam', 'rift_asmon_desk_slam', 'mob_asmon_hermit'],
    ['tribute', 'tribute', 'rift_asmon_tribute', 'mob_asmon_hermit'],
    ['coronation', 'coronation', 'rift_asmon_coronation', 'mob_asmon_hermit'],
    ['swarm', 'swarm', 'rift_asmon_swarm', 'mob_roach_king'],
    ['filth', 'filth', 'rift_asmon_filth', 'mob_roach_king'],
  ];
  for (const [label, phase, castId, key] of phases) {
    if (deathOnly && phase !== 'coronation') continue;
    await beginRoachMechanic(page, id, phase);
    await page.waitForFunction(
      (bossId, ability) => window.__game.sim.entities.get(bossId)?.castingAbility === ability,
      { timeout: 30000 },
      id,
      castId,
    );
    await capture(label, key);
    if (phase === 'coronation') {
      await pauseRoachScenario(page, false);
      await page.waitForFunction(
        (bossId) => window.__game.sim.entities.get(bossId).castRemaining < 0.8,
        { timeout: 15000 },
        id,
      );
      await capture('coronation-end', 'mob_asmon_hermit');
    }
    await finishRoachMechanic(page, id, phase === 'coronation');
    if (phase === 'coronation') await capture('crowned', 'mob_roach_king');
  }
  if (!deathOnly) {
    assert(
      report.stages.tribute.adds.some((add) => add.templateId === 'rift_garbage_beetle'),
      'Tribute adds missing',
    );
    assert(
      report.stages.swarm.adds.some((add) => add.templateId === 'rift_roachling'),
      'Crown adds missing',
    );
    assert(report.stages.filth.zones.length > 0, 'Filth warnings missing');
    for (const phase of ['desk-slam', 'swarm']) {
      assert(
        report.stages[phase].groundRunes.some(
          (rune) => rune.visible && rune.rings.some((ring) => ring.visible && ring.opacity > 0.4),
        ),
        `${phase} visible ground boundary missing`,
      );
    }
  }
  await pauseRoachScenario(page, false);
  await page.evaluate((bossId) => {
    const { sim } = window.__game;
    const boss = sim.entities.get(bossId);
    sim.ctx.dealDamage(sim.player, boss, boss.hp * 10, false, 'physical', undefined, 'hit', true);
    // Drain the real death event once, then hold simulation so automatic exit
    // proximity cannot remove the corpse before its authored animation finishes.
    const tick = window.__roachSmokeTick;
    sim.tick = (...args) => {
      const events = tick(...args);
      sim.tick = () => [];
      return events;
    };
  }, id);
  await page.waitForFunction(
    (bossId) => {
      const view = window.__game.renderer.views.get(bossId);
      const action = view?.visual?.actions?.get('Death');
      return (
        window.__game.sim.entities.get(bossId)?.dead &&
        action &&
        action.time >= action.getClip().duration - 0.05
      );
    },
    { timeout: 30000 },
    id,
  );
  await capture('death-end', 'mob_roach_king');
  await captureRoachCorpseAngles(
    page,
    id,
    ['left', 'right'].map((side) => path.join(output, `${profile}-death-${side}.png`)),
  );
  assert(
    report.stages['death-end'].boss.auras.includes('rift_roach_crown'),
    'Corpse lost its crown',
  );
  for (const stage of Object.values(report.stages)) {
    assert.equal(
      stage.boss.pooledGroundY,
      stage.boss.warningGroundY,
      'Pooled effects lost the raised arena support',
    );
  }
  const corpse = report.stages['death-end'].boss;
  assert.equal(corpse.farMeshVisible, false, 'Corpse QA must inspect the articulated rig');
  assert.equal(corpse.modelVisible, true, 'Corpse rig hidden');
  assert(
    corpse.corpseBounds && Math.abs(corpse.corpseBounds.minY - corpse.corpseBounds.viewY) < 0.3,
    `Corpse skin is not grounded: ${JSON.stringify(corpse.corpseBounds)}`,
  );
  assert(
    corpse.corpseBounds.maxY - corpse.corpseBounds.minY <= corpse.height * corpse.scale * 1.1,
    'Completed corpse is taller than its living stance',
  );
  report.motion = await page.evaluate(() => window.__roachMotion ?? {});
  assert.deepEqual(
    roachPoseFailures(report.stages, report.motion),
    [],
    'Body support or skin motion failed',
  );
  assert.equal(report.pageErrors.length, 0, 'Client runtime errors');
  assert(
    !report.consoleErrors.some((entry) => /shader|WebGL|THREE\./i.test(entry.text)),
    'Graphics console error',
  );
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.stack ?? String(error);
  await page.screenshot({ path: path.join(output, `${profile}-failure.png`) }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (poseProbe)
    report.motion = await page.evaluate(() => window.__roachMotion ?? {}).catch(() => ({}));
  writeFileSync(path.join(output, `${profile}.json`), JSON.stringify(report, null, 2));
  console.log(`${profile}: ${report.passed ? 'PASS' : 'FAIL'}; report ${output}/${profile}.json`);
  if (report.failure) console.error(report.failure);
  await browser.close();
}
