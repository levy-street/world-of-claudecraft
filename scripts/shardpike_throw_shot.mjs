import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const output = process.env.OUT_DIR ?? 'tmp/shardpike-throw';
const mobile = process.argv.includes('--mobile');
const viewport = mobile
  ? { width: 960, height: 540, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
  : { width: 1600, height: 900 };
fs.mkdirSync(output, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  args: ['--window-size=1600,900'],
  defaultViewport: viewport,
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5189/?gfx=high', {
    waitUntil: 'networkidle0',
    timeout: 180000,
  });
  console.log('launcher loaded');
  if (!(await enterOfflineGame(page, { charName: 'Piker', gameBootTimeoutMs: 180000 })))
    throw new Error('World failed to boot');
  console.log('world loaded');
  const bossId = await page.evaluate(async () => {
    (await import('/src/render/day_night_clock.ts')).setDayNightPhaseOverride(0.5);
    const { sim, input } = window.__game;
    const p = sim.player;
    sim.cfg.dayNightNowMs = () => 1350000;
    sim.setPlayerLevel(20);
    sim.addItem('skerrits_shardpike', 1, p.id);
    sim.equipItem('skerrits_shardpike');
    p.hp = p.maxHp = 100000;
    p.weaponStowed = false;
    const id = sim.spawnDevBoss('balgath_cyclops', p.pos.x, p.pos.z + 12);
    const boss = sim.entities.get(id);
    boss.pos.y = p.pos.y;
    boss.prevPos = { ...boss.pos };
    boss.spawnPos = { ...boss.pos };
    boss.moveSpeed = 0;
    boss.slumberRise = 9999;
    boss.facing = Math.PI;
    boss.prevFacing = Math.PI;
    p.facing = 0;
    p.targetId = id;
    input.camYaw = -0.7;
    input.camPitch = 0.3;
    input.camDist = 20;
    window.__shotBoss = id;
    return id;
  });
  await page.waitForFunction(
    (id) => window.__game.renderer.views.get(id)?.visual,
    { timeout: 120000 },
    bossId,
  );
  console.log('boss visible');
  await page.waitForFunction(() => window.__game.renderer.castVfxReadiness.ready(), {
    timeout: 120000,
  });
  console.log('VFX ready');
  await new Promise((resolve) => setTimeout(resolve, 5000));
  await page.evaluate(() => {
    const { sim, renderer } = window.__game;
    const tick = sim.tick.bind(sim),
      sync = renderer.sync.bind(renderer);
    sim.tick = () => [];
    renderer.sync = (alpha, _dt, ...rest) => sync(alpha, 0, ...rest);
    window.__shotStep = (count) => {
      for (let i = 0; i < count; i++) {
        for (const event of tick()) renderer.handleEvent(event);
        sync(1, 0.05, sim.player.facing);
      }
    };
  });
  await page.screenshot({ path: `${output}/ready.png` });
  console.log('ready captured');
  console.log(
    'held props',
    await page.evaluate(() => {
      const g = window.__game,
        nodes = [];
      g.renderer.views.get(g.sim.playerId).visual.root.traverse((n) => {
        if (n.userData.heldPropHolder)
          nodes.push({
            name: n.name,
            data: n.userData,
            visible: n.visible,
            children: n.children.length,
          });
      });
      return { nodes, ready: g.renderer.castVfxReadiness.snapshot() };
    }),
  );
  const start = await page.evaluate(() => {
    const { sim } = window.__game;
    const p = sim.player;
    p.onGround = true;
    p.vx = p.vy = p.vz = 0;
    sim.lanceBrace();
    const session = sim.players.get(p.id).lance;
    if (!session) throw new Error('Brace refused');
    session.phase = 'steadied';
    sim.lanceThrust();
    window.__shotStep(4);
    return {
      hp: sim.entities.get(window.__shotBoss).hp,
      throwCount: sim.pendingProjectiles.length,
      delayed: sim.delayedEvents.length,
      phase: sim.players.get(p.id).lance?.phase,
      distance: Math.hypot(
        p.pos.x - sim.entities.get(window.__shotBoss).pos.x,
        p.pos.z - sim.entities.get(window.__shotBoss).pos.z,
      ),
      gear: sim.players.get(p.id).equipment.mainhand,
    };
  });
  console.log('windup', start);
  await page.screenshot({ path: `${output}/windup.png` });
  await page.evaluate(() => window.__shotStep(6));
  if (
    !(await page.evaluate(() => window.__game.renderer.abilityVfxFx.shardpikeThrow.flights.size))
  ) {
    throw new Error('No physical spear flight at the release checkpoint');
  }
  console.log(
    'flight',
    await page.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const r = window.__game.renderer;
      return [...r.abilityVfxFx.shardpikeThrow.flights.values()].map((f) => ({
        at: f.at,
        aim: r.abilityVfxFx.shardpikeThrow.aim,
        box: f.prop && new THREE.Box3().setFromObject(f.prop.root),
        meshes: f.prop?.root.children.map((m) => ({
          name: m.name,
          visible: m.visible,
          positions: m.geometry.attributes.position.count,
          material: { visible: m.material.visible, opacity: m.material.opacity },
          scale: m.scale,
          position: m.position,
        })),
        scale: f.prop?.root.scale,
        visible: f.prop?.root.visible,
      }));
    }),
  );
  await page.screenshot({ path: `${output}/flight.png` });
  await page.evaluate(() => window.__shotStep(3));
  await page.screenshot({ path: `${output}/flight-mid.png` });
  await page.evaluate(() => {
    const { sim } = window.__game;
    const hp = sim.entities.get(window.__shotBoss).hp;
    for (let i = 0; i < 20 && sim.entities.get(window.__shotBoss).hp === hp; i++)
      window.__shotStep(1);
  });
  await page.screenshot({ path: `${output}/impact.png` });
  console.log(
    'pools',
    await page.evaluate(() => {
      const fx = window.__game.renderer.abilityVfxFx;
      return JSON.stringify({
        flipbooks: fx.flipbooks.slots
          .filter((s) => s.active)
          .map((s) => ({
            at: s.mesh.position,
            screen: s.mesh.position.clone().project(window.__game.renderer.camera),
            visible: s.mesh.visible,
            age: s.age,
            size: s.size,
            hdr: s.mat.uniforms.uHdr.value,
          })),
        rings: fx.rings.slots
          .filter((s) => s.active)
          .map((s) => ({
            at: s.mesh.position,
            visible: s.mesh.visible,
            age: s.age,
            intensity: s.intensity,
          })),
      });
    }),
  );
  await page.evaluate(() => window.__shotStep(2));
  await page.screenshot({ path: `${output}/impact-late.png` });
  const landed = await page.evaluate(() => ({
    hp: window.__game.sim.entities.get(window.__shotBoss).hp,
    flights: window.__game.renderer.abilityVfxFx.shardpikeThrow.flights.size,
  }));
  if (landed.hp !== start.hp - 150 || landed.flights !== 0) {
    throw new Error(`Throw did not land exactly once and clean up: ${JSON.stringify(landed)}`);
  }
  console.log(
    'result',
    await page.evaluate(() => ({
      hp: window.__game.sim.entities.get(window.__shotBoss).hp,
      effects: window.__game.renderer.abilityVfxFx.shardpikeThrow.flights.size,
      gpu: window.__game.renderer.perfStats().gpuPrep,
    })),
  );
} finally {
  await browser.close();
}
