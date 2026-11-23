// Capture the Blender-built Balgath in the real client: idle, walk, run, his swings and
// slams, the glare, the blind, the death, his telegraphs, and the Knucklebone form running.
// Offline world, headless browser, a Vite dev server already running.
//
//   GAME_URL=http://127.0.0.1:5189/?gfx=high OUT_DIR=<dir> node scripts/balgath_model_shots.mjs
//
// The world clock is driven by hand (__shotStep) so every pose is captured at a known time
// into its clip rather than wherever the frame happened to land.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const output = process.env.OUT_DIR ?? 'tmp/balgath-model';
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
fs.mkdirSync(output, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  args: ['--window-size=1600,900'],
  defaultViewport: { width: 1600, height: 900 },
  protocolTimeout: 900000,
});
const want = (name) => !only || only.has(name);
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('CONSOLE', msg.text().slice(0, 300));
  });
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5189/?gfx=high', {
    waitUntil: 'networkidle0',
    timeout: 300000,
  });
  if (!(await enterOfflineGame(page, { charName: 'Foreman', gameBootTimeoutMs: 300000 })))
    throw new Error('World failed to boot');
  console.log('world loaded');
  const bossId = await page.evaluate(async () => {
    (await import('/src/render/day_night_clock.ts')).setDayNightPhaseOverride(0.5);
    const { sim, input } = window.__game;
    const p = sim.player;
    sim.cfg.dayNightNowMs = () => 1350000;
    sim.devCommands = true;
    sim.setPlayerLevel(20);
    sim.setGm(p.id, true);
    p.hp = p.maxHp = 100000;
    // His crater (WORLD_BOSSES pos 147, 310): the player on its south floor, him on the
    // north, the camera up on the south rim looking down into the bowl.
    p.pos.x = 147;
    p.pos.z = 297;
    p.pos.y = sim.groundPos(147, 297).y;
    p.prevPos = { ...p.pos };
    // A clean stage: no scheduled Balgath, no muster, no wildlife in the frame.
    for (const e of [...sim.entities.values()])
      if (e.kind === 'mob' || e.kind === 'npc') sim.entities.delete(e.id);
    const id = sim.spawnDevBoss('balgath_cyclops', p.pos.x, p.pos.z + 18);
    const boss = sim.entities.get(id);
    boss.pos.y = sim.groundPos(boss.pos.x, boss.pos.z).y;
    boss.prevPos = { ...boss.pos };
    boss.spawnPos = { ...boss.pos };
    boss.slumberRise = 9999;
    boss.facing = Math.PI;
    boss.prevFacing = Math.PI;
    p.facing = 0;
    input.camYaw = -0.45;
    input.camPitch = 0.34;
    input.camDist = 26;
    window.__shotBoss = id;
    return id;
  });
  await page.waitForFunction(
    (id) => window.__game.renderer.views.get(id)?.visual,
    {
      timeout: 300000,
    },
    bossId,
  );
  await page.waitForFunction(() => window.__game.renderer.castVfxReadiness.ready(), {
    timeout: 300000,
  });
  await page
    .waitForFunction(
      () => !document.querySelector('#loading-screen')?.classList.contains('visible'),
      { timeout: 300000 },
    )
    .catch(() => console.log('loading curtain still up: lifting it'));
  await page.evaluate(() => {
    document.querySelector('#loading-screen')?.classList.remove('visible', 'fade');
    // The software-GL notice is a headless artefact, not part of the scene.
    for (const el of document.querySelectorAll('div'))
      if (el.childElementCount < 4 && /without GPU acceleration/.test(el.textContent ?? ''))
        el.style.display = 'none';
  });
  await new Promise((resolve) => setTimeout(resolve, 6000));
  console.log('boss visible');
  await page.evaluate(() => {
    const { sim, renderer } = window.__game;
    const tick = sim.tick.bind(sim);
    const sync = renderer.sync.bind(renderer);
    sim.tick = () => [];
    renderer.sync = (alpha, _dt, ...rest) => sync(alpha, 0, ...rest);
    window.__shotStep = (count, live = false, move = null) => {
      for (let i = 0; i < count; i++) {
        if (move) move();
        const events = live ? tick() : [];
        for (const event of events) renderer.handleEvent(event);
        sync(1, 0.05, sim.player.facing);
      }
    };
    window.__boss = () => sim.entities.get(window.__shotBoss);
    window.__reset = () => {
      const p = sim.player;
      p.pos = { ...sim.groundPos(147, 297) };
      p.prevPos = { ...p.pos };
      p.vx = p.vy = p.vz = 0;
      p.facing = 0;
      p.hp = p.maxHp;
      const b = window.__boss();
      b.dead = false;
      b.hp = b.maxHp;
      b.auras = b.auras.filter((a) => a.id !== 'eye_ward_blinded');
      b.pos = { ...b.spawnPos };
      b.prevPos = { ...b.pos };
      b.facing = Math.PI;
      b.prevFacing = Math.PI;
    };
    window.__cue = (ability) =>
      renderer.handleEvent({
        type: 'spellfx',
        sourceId: window.__shotBoss,
        targetId: window.__shotBoss,
        school: 'physical',
        fx: 'windup',
        ability,
      });
  });
  const shot = async (name) => {
    await page.screenshot({ path: `${output}/${name}.png` });
    console.log('shot', name);
  };
  const step = (n, live = false) => page.evaluate((c, l) => window.__shotStep(c, l), n, live);

  if (want('idle')) {
    await step(40);
    await shot('01-idle');
  }
  if (want('walk')) {
    await page.evaluate(() => {
      const b = window.__boss();
      window.__shotStep(36, false, () => {
        b.prevPos = { ...b.pos };
        b.pos.z -= 4.6 * 0.05;
        b.pos.y = window.__game.sim.groundPos(b.pos.x, b.pos.z).y;
      });
    });
    await shot('02-walk');
    await page.evaluate(() => {
      const b = window.__boss();
      window.__shotStep(30, false, () => {
        b.prevPos = { ...b.pos };
        b.pos.z -= 6.6 * 0.05;
        b.pos.y = window.__game.sim.groundPos(b.pos.x, b.pos.z).y;
      });
    });
    await shot('03-run');
    await page.evaluate(() => window.__reset());
    await step(30);
  }
  const attacks = [
    ['04-swipe', null, 12],
    ['05-punch', null, 13],
    ['06-clobber', null, 14],
    ['07-hammer', 'mob_balgath_hammer', 25],
    ['08-cleave', 'mob_balgath_cleave', 30],
    ['09-smash', 'mob_pulse_windup', 23],
    ['10-stomp', 'mob_stomp_windup', 14],
    ['11-toss', 'mob_balgath_boulder', 22],
    ['12-glare', 'mob_balgath_glare', 48],
    ['13-burden', 'mob_balgath_burden', 22],
  ];
  if (want('attacks')) {
    for (const [name, ability, at] of attacks) {
      await page.evaluate((a) => {
        if (a) window.__cue(a);
        else window.__game.renderer.triggerAttack(window.__shotBoss);
      }, ability);
      await step(at);
      await shot(name);
      await step(60);
    }
  }
  if (want('blinded')) {
    await page.evaluate(() => {
      const b = window.__boss();
      b.auras.push({
        id: 'eye_ward_blinded',
        name: 'Blinded',
        kind: 'vulnerability',
        value: 0,
        remaining: 14,
        duration: 14,
        sourceId: b.id,
        school: 'physical',
      });
      window.__cue('mob_eye_ward_blinded');
    });
    await step(20);
    await shot('14-blinded');
    await step(60);
    await shot('15-blinded-loop');
    await page.evaluate(() => window.__reset());
    await step(40);
  }
  if (want('telegraphs')) {
    // The real sim, his mechanics forced through the dev command, so the rings are the
    // shipped telegraphs at their true sizes.
    await page.evaluate(() => {
      const { sim, input } = window.__game;
      sim.devCommands = true;
      // The forced mechanics refuse a boss still standing up from his bed.
      const b = window.__boss();
      b.slumberRise = 0;
      b.asleep = false;
      input.camPitch = 0.6;
      input.camDist = 44;
    });
    for (const [verb, at] of [
      ['smash', 14],
      ['stomp', 14],
      ['hammer', 16],
      ['cleave', 22],
      ['wreck', 16],
      ['boulder', 24],
      ['burden', 40],
      ['starwake', 80],
    ]) {
      await page.evaluate((v) => window.__game.sim.chat(`/dev balgath ${v}`), verb);
      await step(at, true);
      await shot(`20-telegraph-${verb}`);
      await step(120, true);
      await page.evaluate(() => {
        const p = window.__game.sim.player;
        p.hp = p.maxHp;
      });
    }
    await page.evaluate(() => {
      const { input } = window.__game;
      input.camPitch = 0.34;
      input.camDist = 26;
      window.__reset();
    });
    await step(40);
  }
  if (want('death')) {
    // A real kill (the sim's own death path), then the clock by hand again.
    await page.evaluate(() => {
      const { sim, input } = window.__game;
      window.__reset();
      input.camYaw = -0.45;
      input.camPitch = 0.34;
      input.camDist = 26;
      window.__shotStep(10);
      sim.player.targetId = window.__shotBoss;
      sim.chat('/dev killtarget');
      window.__shotStep(1, true);
    });
    await step(21);
    await shot('16-death-falling');
    await step(60);
    await shot('17-death-lying');
  }
  if (want('form')) {
    await page.evaluate(() => {
      const { sim, input } = window.__game;
      sim.entities.delete(window.__shotBoss);
      const p = sim.player;
      sim.addItem('knucklebone_of_balgath', 1, p.id);
      sim.equipItem('knucklebone_of_balgath');
      p.cooldowns.clear();
      sim.useItem('knucklebone_of_balgath');
      // On the crater floor, seen from the side as he runs north across it.
      p.pos = { ...sim.groundPos(147, 292) };
      p.prevPos = { ...p.pos };
      p.facing = 0;
      input.camYaw = -2.0;
      input.camPitch = 0.12;
      input.camDist = 10;
    });
    await page.evaluate(() => window.__shotStep(10, true));
    await page.waitForFunction(
      () => {
        window.__shotStep(1);
        const v = window.__game.renderer.views.get(window.__game.sim.playerId);
        return v?.metamorphVisual?.assetKey === 'form_foreman' && v.metamorphVisual.root.visible;
      },
      { timeout: 120000 },
    );
    await step(20);
    await shot('18-form-idle');
    await page.evaluate(() => {
      const p = window.__game.sim.player;
      p.facing = 0;
      window.__shotStep(26, false, () => {
        p.prevPos = { ...p.pos };
        p.pos.z += 7 * 0.05;
        p.pos.y = window.__game.sim.groundPos(p.pos.x, p.pos.z).y;
      });
    });
    await shot('19-form-run');
    await page.evaluate(() => {
      const p = window.__game.sim.player;
      window.__shotStep(9, false, () => {
        p.prevPos = { ...p.pos };
        p.pos.z += 7 * 0.05;
        p.pos.y = window.__game.sim.groundPos(p.pos.x, p.pos.z).y;
      });
    });
    await shot('19b-form-run');
  }
} finally {
  await browser.close();
}
