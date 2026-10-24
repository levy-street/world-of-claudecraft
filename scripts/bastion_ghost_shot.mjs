// Real offline encounter evidence. Start Vite, then:
// SHOT_URL=http://127.0.0.1:5367 node scripts/bastion_ghost_shot.mjs [outDir]
// SHOT_PRESET=1 exercises the identical actionable floor on low graphics.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const out = process.argv[2] ?? 'tmp/bastion-ghost-evidence';
const preset = Number(process.env.SHOT_PRESET ?? 4);
const tier = preset <= 1 ? 'low' : 'ultra';
const url = new URL(process.env.SHOT_URL ?? 'http://127.0.0.1:5367/');
url.searchParams.set('gfx', tier);
fs.mkdirSync(out, { recursive: true });
const errors = [];
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'],
  defaultViewport: {
    width: Number(process.env.SHOT_W ?? 1600),
    height: Number(process.env.SHOT_H ?? 900),
  },
  protocolTimeout: 240000,
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => {
    if (!errors.includes(e.message)) errors.push(e.message);
  });
  await page.evaluateOnNewDocument((preset) => {
    localStorage.setItem(
      'woc_settings',
      JSON.stringify({ graphicsPreset: preset, graphicsDefaultApplied: true }),
    );
  }, preset);
  await page.goto(url.href, {
    waitUntil: 'networkidle0',
    timeout: 180000,
  });
  if (
    !(await enterOfflineGame(page, {
      charClass: 'warrior',
      charName: 'Ghostwatch',
      gameBootTimeoutMs: 180000,
      selectorTimeoutMs: 90000,
      settleMs: 4000,
    }))
  )
    throw new Error('Offline world did not boot');
  for (const command of [
    '/dev level 20',
    '/dev god',
    '/dev bastion enter',
    '/dev bastion gates',
    '/dev bastion tp cisternyard',
  ]) {
    await page.evaluate((cmd) => window.__game.world.chat(cmd), command);
    await sleep(1200);
  }
  await sleep(7000);
  const graphics = await page.evaluate(async () => (await import('/src/render/gfx.ts')).GFX.tier);
  if (graphics !== tier) throw new Error(`Expected graphics tier ${tier}, got ${graphics}`);
  await page.evaluate(() => {
    const game = window.__game;
    const sim = game.world;
    for (const e of sim.entities.values()) {
      if (e.kind === 'mob' && e.templateId !== 'turretback_hermit') {
        e.dead = true;
        e.hp = 0;
      }
    }
    sim.player.devNoAggro = true;
    sim.player.autoAttack = false;
    game.input.camYaw = 0.55;
    game.input.camPitch = 0.55;
    game.input.camDist = 30;
    // Freeze only the offline simulation at a real encounter stage. Browser
    // screenshots can take longer than the 0.6s impact, so wall-time sleeps
    // alone silently capture the next recovery instead of the cannon fire.
    const tick = sim.tick.bind(sim);
    sim.tick = (...args) => {
      if (window.__ghostShotHold) return [];
      const events = tick(...args);
      const boss = [...sim.entities.values()].find((e) => e.templateId === 'turretback_hermit');
      const action = boss?.bastionFight?.action;
      const wanted = window.__ghostShotStage;
      if (
        wanted &&
        action?.stage === wanted &&
        action.elapsed >= (wanted === 'warning' ? 1.2 : 0.15)
      )
        window.__ghostShotHold = true;
      return events;
    };
  });
  await page.addStyleTag({ content: '#ui, #nameplates { display:none!important; }' });
  const evidence = [];
  for (const move of ['broadside', 'anchor', 'boarding']) {
    await page.evaluate(async (move) => {
      const sim = window.__game.world;
      window.__ghostShotHold = false;
      window.__ghostShotStage = 'warning';
      const { tickGhostCaptain, startGhostCaptainMove } = await import(
        '/src/sim/encounters/sunken_bastion/ghost_captain.ts'
      );
      const boss = [...sim.entities.values()].find((e) => e.templateId === 'turretback_hermit');
      const inst = sim.instances.find(
        (i) => i.dungeonId === 'sunken_bastion' && i.mobIds.includes(boss.id),
      );
      tickGhostCaptain(sim.ctx, inst, boss, false);
      const p = sim.player;
      boss.pos = sim.ctx.groundPos(p.pos.x, p.pos.z + 10);
      boss.prevPos = { ...boss.pos };
      boss.homePos = { ...boss.pos };
      boss.hp = boss.maxHp;
      boss.dead = false;
      boss.inCombat = true;
      boss.aiState = 'attack';
      boss.aggroTargetId = p.id;
      boss.threat.set(p.id, 1);
      boss.castingAbility = null;
      sim.ctx.grid.update(boss);
      tickGhostCaptain(sim.ctx, inst, boss, true);
      if (!startGhostCaptainMove(sim.ctx, inst, boss, move))
        throw new Error(`Could not start ${move}`);
      p.targetId = boss.id;
    }, move);
    await page.waitForFunction(() => window.__ghostShotHold === true, { timeout: 30000 });
    await sleep(200);
    const file = path.join(out, `${move}-warning.png`);
    await page.screenshot({ path: file });
    evidence.push(
      await page.evaluate(
        (move) => ({
          move,
          cues: [...window.__game.world.entities.values()]
            .filter((e) => e.templateId?.startsWith('ghost_'))
            .map((e) => ({
              template: e.templateId,
              x: e.pos.x,
              y: e.pos.y,
              z: e.pos.z,
              yaw: e.facing,
              remaining: e.castRemaining,
              total: e.castTotal,
            })),
        }),
        move,
      ),
    );
    console.log('SHOT', file);
    await page.evaluate(() => {
      window.__ghostShotStage = 'active';
      window.__ghostShotHold = false;
    });
    await page.waitForFunction(() => window.__ghostShotHold === true, { timeout: 30000 });
    await sleep(200);
    await page.screenshot({ path: path.join(out, `${move}-impact.png`) });
    evidence.push(
      await page.evaluate(
        (move) => ({
          move,
          phase: 'impact',
          cues: [...window.__game.world.entities.values()]
            .filter((e) => e.templateId?.startsWith('ghost_'))
            .map((e) => ({
              template: e.templateId,
              remaining: e.castRemaining,
              total: e.castTotal,
            })),
        }),
        move,
      ),
    );
  }
  fs.writeFileSync(
    path.join(out, 'evidence.json'),
    JSON.stringify({ graphics, evidence, errors }, null, 2),
  );
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
}
