// Local-only review of the real Vharok encounter, simulation cues, and production painter.
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from '../../browser_path.mjs';
import { enterOfflineGame } from '../../enter_offline_game.mjs';
import { suppressGpuNotice } from '../../lib/gpu_notice_suppress.mjs';

const output = 'tmp/orbital-lightning-game';
mkdirSync(output, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  args: ['--use-angle=swiftshader'],
  defaultViewport: { width: 1440, height: 900 },
});
const results = [];
try {
  for (const tier of (process.argv[2] ?? 'ultra,low').split(',')) {
    const page = await browser.newPage();
    await suppressGpuNotice(page);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.evaluateOnNewDocument(
      (preset) =>
        localStorage.setItem(
          'woc_settings',
          JSON.stringify({ graphicsPreset: preset, graphicsDetected: true }),
        ),
      tier === 'low' ? 1 : 4,
    );
    await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5187', {
      waitUntil: 'networkidle0',
      timeout: 120000,
    });
    if (
      !(await enterOfflineGame(page, {
        charName: 'Stormwatch',
        selectorTimeoutMs: 120000,
        gameBootTimeoutMs: 180000,
      }))
    )
      throw new Error('Game did not boot');
    await page.waitForFunction(
      () => {
        const el = document.getElementById('loading-screen');
        return !el || getComputedStyle(el).display === 'none';
      },
      { timeout: 180000 },
    );
    await page.evaluate(async () => {
      const { sim, renderer } = window.__game;
      sim.devCommands = true;
      sim.chat('/dev hoard storm');
      const inst = sim.riftInstances.find((entry) => entry.vault && entry.partyKey !== null);
      const boss = sim.entities.get(inst.bossId);
      if (boss.templateId !== 'rift_boss_storm') throw new Error('Wrong boss');
      for (const id of inst.mobIds) {
        const mob = sim.entities.get(id);
        if (!mob || mob.id === boss.id) continue;
        mob.hostile = false;
        mob.aggroRadius = 0;
        mob.pos = sim.ctx.groundPos(boss.pos.x + 35, boss.pos.z + 35);
        mob.prevPos = { ...mob.pos };
        mob.spawnPos = { ...mob.pos };
      }
      sim.player.damageImmune = true;
      sim.player.pos = sim.ctx.groundPos(boss.pos.x, boss.pos.z + 10);
      sim.player.prevPos = { ...sim.player.pos };
      boss.damageImmune = true;
      boss.aiState = 'chase';
      boss.targetId = sim.player.id;
      boss.aggroTargetId = sim.player.id;
      boss.threat.set(sim.player.id, 100);
      const { tickHoardBossMechanics } = await import('/src/sim/rift/hoard_boss.ts');
      tickHoardBossMechanics(sim.ctx);
      inst.hoardBoss.cues = [];
      inst.hoardBoss.sequenceStep = 2;
      inst.hoardBoss.markTimer = 0;
      tickHoardBossMechanics(sim.ctx);
      const originalTick = sim.tick.bind(sim);
      sim.tick = () => [];
      renderer.editorCam = {
        pos: renderer.camera.position
          .clone()
          .set(boss.pos.x + 13, boss.pos.y + 14, boss.pos.z + 17),
        target: renderer.camera.position.clone().set(boss.pos.x, boss.pos.y + 1.5, boss.pos.z),
      };
      window.__orbitalReview = { inst, boss, originalTick, tick: 0, start: { ...boss.pos } };
    });
    await page.waitForFunction(() => window.__game.renderer.riftDeathZoneVisuals?.hoardOrbital, {
      timeout: 120000,
    });
    await page.evaluate(async () => {
      await window.__game.renderer.riftDeathZoneVisuals.hoardOrbital.readyForEntry;
    });
    for (const [label, tick] of [
      ['summon', 7],
      ['charge', 38],
      ['wave-one', 49],
      ['wave-two', 139],
      ['wave-three', 229],
      ['aftermath', 270],
      ['clean', 305],
    ]) {
      const state = await page.evaluate((targetTick) => {
        const review = window.__orbitalReview;
        while (review.tick < targetTick) {
          review.originalTick();
          review.tick++;
        }
        const fx = window.__game.renderer.riftDeathZoneVisuals.hoardOrbital;
        return {
          tick: review.tick,
          boss: review.boss.templateId,
          stationary: review.boss.pos.x === review.start.x && review.boss.pos.z === review.start.z,
          cueCount: window.__game.sim.hoardBossCues().length,
          coreVertices: fx.slots[0].orbs[0].geometry.attributes.position.count,
        };
      }, tick);
      await new Promise((resolve) => setTimeout(resolve, 400));
      await page.screenshot({ path: `${output}/${tier}-${label}.png` });
      results.push({ tier, label, ...state });
      console.log(JSON.stringify(results.at(-1)));
    }
    results.push({ tier, errors });
    await page.close();
  }
} finally {
  await browser.close();
  writeFileSync(`${output}/evidence.json`, JSON.stringify(results, null, 2));
}
