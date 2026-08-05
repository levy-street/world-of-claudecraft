// Source Cave encirclement browser E2E. Runs offline against `npm run dev`,
// drives the real sim and renderer through window.__game, asserts the reboot,
// wave, seal, and chest behavior, and writes evidence to docs/screenshots.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173/?gfx=high';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const OUT = process.env.SCREENSHOT_OUT ?? 'docs/screenshots';
fs.mkdirSync(OUT, { recursive: true });

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`PASS ${name}${detail ? `: ${detail}` : ''}`);
  } else {
    failed++;
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 60000,
  args: [
    '--window-size=1600,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
const benign = (text) => /502|Bad Gateway|project stats/i.test(text);
page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error' && !benign(message.text())) {
    errors.push(`CONSOLE: ${message.text()}`);
  }
});

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(2500);
  await page.evaluate(() => {
    document.querySelector('.server-select-option[data-mode="offline"]')?.click();
    document.querySelector('#btn-play')?.click();
  });
  await sleep(1200);
  await page.evaluate(() => {
    const name = document.querySelector('#char-name');
    if (name) name.value = 'Rebooter';
    document.querySelector('#offline-select .mini-class[data-class="warrior"]')?.click();
    document.querySelector('#btn-start-offline')?.click();
  });
  await page.waitForFunction(() => window.__game?.sim?.player?.pos, {
    timeout: 30000,
    polling: 200,
  });
  await sleep(1500);
  await page.evaluate(() => {
    const skip = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Skip Tutorial'),
    );
    skip?.click();
  });
  await sleep(400);

  const setup = await page.evaluate(() => {
    const game = window.__game;
    const sim = game.sim;
    const player = sim.player;
    sim.setPlayerLevel(20, player.id);
    sim.enterDungeon('source_cave', player.id);
    const instance = sim.instances.find(
      (candidate) => candidate.dungeonId === 'source_cave' && candidate.partyKey !== null,
    );
    const button = instance?.objectIds
      .map((id) => sim.entities.get(id))
      .find((entity) => entity?.templateId === 'source_cave_reboot');
    if (!instance || !button) return { ok: false };
    const bossSpec = sim.sourceCave.spec.mobs.find((mob) => mob.boss);
    const boss = instance.mobIds
      .map((id) => sim.entities.get(id))
      .find((entity) => entity?.templateId === `source_cave_${bossSpec?.login}`);
    if (!boss) return { ok: false };

    const chest = instance.objectIds
      .map((id) => sim.entities.get(id))
      .find((entity) => entity?.templateId === 'source_cave_chest_sealed');
    if (!chest) return { ok: false };

    player.maxHp = 999999;
    player.hp = player.maxHp;
    player.pos = { x: button.pos.x, y: button.pos.y, z: button.pos.z - 4.2 };
    player.prevPos = { ...player.pos };
    player.facing = 0;
    player.prevFacing = 0;
    player.targetId = null;
    sim.grid.update(player);
    sim.playerGrid.update(player);
    game.input.camYaw = 0;
    game.input.camPitch = 0.42;
    game.input.camDist = 17;
    return {
      ok: true,
      buttonId: button.id,
      chestId: chest.id,
      bossId: boss.id,
      mobIds: instance.mobIds,
      mobSeats: instance.mobIds.map((id) => {
        const mob = sim.entities.get(id);
        return { id, x: mob.pos.x, z: mob.pos.z };
      }),
    };
  });
  check('cave setup', setup.ok);
  if (!setup.ok) throw new Error('Source Cave button did not spawn');

  await page.waitForFunction(
    (buttonId) => window.__game?.renderer?.views?.has(buttonId),
    { timeout: 15000, polling: 100 },
    setup.buttonId,
  );
  // Let the opening camera/HUD fade settle so the screenshot proves the label
  // in the fully visible game shell, not only through its inline display style.
  await sleep(5500);

  const before = await page.evaluate(({ buttonId, mobIds, mobSeats }) => {
    const game = window.__game;
    const view = game.renderer.views.get(buttonId);
    let usesMushroomMaterial = false;
    view?.group.traverse((object) => {
      const material = object.material;
      if (material?.name?.startsWith('source-cave-reboot:')) usesMushroomMaterial = true;
    });
    const wandered = mobSeats.filter((seat) => {
      const mob = game.sim.entities.get(seat.id);
      return mob && Math.hypot(mob.pos.x - seat.x, mob.pos.z - seat.z) > 0.3;
    }).length;
    return {
      label: view?.nameEl?.textContent ?? '',
      labelColor: view?.nameEl ? getComputedStyle(view.nameEl).color : '',
      labelDisplay: view?.nameplate?.style?.display ?? 'none',
      usesMushroomMaterial,
      allFriendly: mobIds.every((id) => game.sim.entities.get(id)?.hostile === false),
      wandered,
      hemi: game.renderer.hemi?.intensity ?? 0,
      seal: (() => {
        const group = game.renderer.scene.getObjectByName('source-cave-centre-seal');
        const energy = group?.children.find(
          (child) => child.material?.name === 'source-cave-seal-aaa',
        );
        return {
          layers: group?.children.length ?? 0,
          mode: energy?.material?.uniforms?.uMode?.value ?? -1,
          occupancy: energy?.material?.uniforms?.uOccupancy?.value ?? -1,
        };
      })(),
    };
  }, setup);
  check('exact overhead label', before.label === 'Do not push the button', before.label);
  check('warning label reads red', before.labelColor === 'rgb(255, 68, 68)', before.labelColor);
  check('label visible at interaction range', before.labelDisplay !== 'none', before.labelDisplay);
  check('red mushroom builder is live', before.usesMushroomMaterial);
  check('all contributors start friendly', before.allFriendly);
  check(
    'friendly contributors amble around their seats',
    before.wandered > 0,
    `${before.wandered} moved`,
  );
  check(
    'server hall runs fully lit off the mains',
    before.hemi > 0.6,
    `hemi=${before.hemi.toFixed(2)}`,
  );
  check('centre seal has stone, energy, and metal layers', before.seal.layers === 3);
  check(
    'full muster charges the idle seal blue',
    before.seal.mode === 0 && before.seal.occupancy === 1,
    `mode=${before.seal.mode}, occupancy=${before.seal.occupancy}`,
  );

  await page.screenshot({ path: `${OUT}/source-cave-reboot-before-desktop.png` });
  await page.setViewport({ width: 430, height: 860, deviceScaleFactor: 1 });
  await sleep(900);
  await page.screenshot({ path: `${OUT}/source-cave-reboot-before-mobile.png` });
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
  await sleep(600);

  await page.evaluate(() => window.__game.sim.interact(window.__game.sim.player.id));
  await page.waitForFunction(
    (buttonId) => window.__game.sim.entities.get(buttonId)?.lootable === false,
    { timeout: 5000, polling: 50 },
    setup.buttonId,
  );
  await sleep(700);
  const after = await page.evaluate(({ buttonId, bossId, mobIds }) => {
    const game = window.__game;
    const sim = game.sim;
    const button = sim.entities.get(buttonId);
    const view = game.renderer.views.get(buttonId);
    const bossBubble = game.renderer.chatBubbles.get(bossId)?.el;
    const baseScaleY = view?.objectMesh?.userData.baseScaleY ?? 0;
    const sealGroup = game.renderer.scene.getObjectByName('source-cave-centre-seal');
    const sealEnergy = sealGroup?.children.find(
      (child) => child.material?.name === 'source-cave-seal-aaa',
    );
    return {
      buttonPersists: !!button && button.lootable === false,
      buttonViewVisible: view?.group.visible ?? false,
      buttonSquashed: !!view && view.objectMesh.scale.y < baseScaleY * 0.6,
      buttonLabelHidden: (view?.nameplate?.style?.display ?? 'none') === 'none',
      allHostile: mobIds.every((id) => sim.entities.get(id)?.hostile === true),
      allCalm: mobIds.every((id) => {
        const mob = sim.entities.get(id);
        return mob?.aiState === 'idle' && mob.aggroTargetId === null;
      }),
      bossYell: bossBubble?.textContent ?? '',
      bossYellStyled: bossBubble?.classList.contains('yell') ?? false,
      sealMode: sealEnergy?.material?.uniforms?.uMode?.value ?? -1,
    };
  }, setup);
  check('pressed button stays as an inert prop', after.buttonPersists);
  check('pressed button still renders', after.buttonViewVisible);
  check('pressed button reads pressed (squashed)', after.buttonSquashed);
  check('pressed button stops advertising its label', after.buttonLabelHidden);
  check('all contributors become hostile', after.allHostile);
  check('centre bubble keeps every contributor calm', after.allCalm);
  check('highest contributor yells', after.bossYell === 'What have you done?!', after.bossYell);
  check('reboot reaction uses yell presentation', after.bossYellStyled);
  check('intact encounter turns the seal dark red', after.sealMode === 1);
  // The staggered reactions land at 1.4s / 2.8s of SIM time after the press;
  // poll the chat log rather than sleeping a fixed wall-clock amount (headless
  // swiftshader frames can lag sim seconds behind real seconds).
  await page.waitForFunction(
    () => {
      const text = document.body.textContent ?? '';
      return text.includes("Hey, what's going on?") && text.includes('Guys, the server is down!');
    },
    { timeout: 10000, polling: 200 },
  );
  const chorus = await page.evaluate(() => {
    const text = document.body.textContent ?? '';
    return {
      whatsGoingOn: text.includes("Hey, what's going on?"),
      serverDown: text.includes('Guys, the server is down!'),
      hemi: window.__game.renderer.hemi?.intensity ?? 1,
    };
  });
  check('second contributor reacts', chorus.whatsGoingOn);
  check('third contributor reacts', chorus.serverDown);
  check(
    'pressing the button drops the room to backup power',
    chorus.hemi < 0.25 && chorus.hemi < before.hemi / 2,
    `hemi ${before.hemi.toFixed(2)} -> ${chorus.hemi.toFixed(2)}`,
  );
  await page.screenshot({ path: `${OUT}/source-cave-reboot-after-desktop.png` });

  await page.waitForFunction(
    () => {
      const instance = window.__game.sim.instances.find(
        (candidate) => candidate.dungeonId === 'source_cave' && candidate.partyKey !== null,
      );
      return instance?.sourceCaveEncounter?.activatedWaves?.has(0);
    },
    { timeout: 8000, polling: 100 },
  );
  const firstWave = await page.evaluate(() => {
    const sim = window.__game.sim;
    const instance = sim.instances.find(
      (candidate) => candidate.dungeonId === 'source_cave' && candidate.partyKey !== null,
    );
    const encounter = instance.sourceCaveEncounter;
    return {
      waveSize: encounter.waves[0].length,
      active: encounter.waves[0].every((id) => encounter.activeMobIds.has(id)),
    };
  });
  check('first deterministic wave advances after three seconds', firstWave.active);
  check('first live-roster wave contains eight contributors', firstWave.waveSize === 8);

  const manualPull = await page.evaluate(() => {
    const sim = window.__game.sim;
    const instance = sim.instances.find(
      (candidate) => candidate.dungeonId === 'source_cave' && candidate.partyKey !== null,
    );
    const encounter = instance.sourceCaveEncounter;
    const waveIndex = encounter.waves.findIndex((_, index) => !encounter.activatedWaves.has(index));
    const cohort = encounter.waves[waveIndex];
    const target = sim.entities.get(cohort[0]);
    sim.dealDamage(sim.player, target, 1, false, 'physical', null, 'hit');
    return {
      activated: encounter.activatedWaves.has(waveIndex),
      cohortActive: cohort.every((id) => encounter.activeMobIds.has(id)),
    };
  });
  check(
    'direct dormant pull wakes the whole cohort',
    manualPull.activated && manualPull.cohortActive,
  );

  // Chest phase: the reward chest is present and sealed from claim time; a
  // pre-clear interaction is denied, the clear arms a classic shared drop, and
  // looting it empties the chest into an inert prop.
  await page.evaluate(({ chestId }) => {
    const sim = window.__game.sim;
    const player = sim.player;
    const chest = sim.entities.get(chestId);
    player.pos = { x: chest.pos.x, y: chest.pos.y, z: chest.pos.z - 3 };
    player.prevPos = { ...player.pos };
    player.targetId = null;
    sim.grid.update(player);
    sim.playerGrid.update(player);
  }, setup);
  await page.waitForFunction(
    () => {
      const instance = window.__game.sim.instances.find(
        (candidate) => candidate.dungeonId === 'source_cave' && candidate.partyKey !== null,
      );
      return instance?.sourceCaveEncounter?.breached === true;
    },
    { timeout: 4000, polling: 50 },
  );
  await sleep(900);
  const breach = await page.evaluate(() => {
    const game = window.__game;
    const instance = game.sim.instances.find(
      (candidate) => candidate.dungeonId === 'source_cave' && candidate.partyKey !== null,
    );
    const group = game.renderer.scene.getObjectByName('source-cave-centre-seal');
    const energy = group?.children.find((child) => child.material?.name === 'source-cave-seal-aaa');
    return {
      allAwake: instance.sourceCaveEncounter.activeMobIds.size === instance.mobIds.length,
      sealMode: energy?.material?.uniforms?.uMode?.value ?? -1,
    };
  });
  check('leaving the seal wakes the full encirclement', breach.allAwake);
  check('breach turns the seal vivid red', breach.sealMode === 2);
  // The breach is latched, so return only the camera/player to the centre to
  // capture the vivid floor state instead of a screenshot of the chest alcove.
  await page.evaluate(({ buttonId }) => {
    const game = window.__game;
    const player = game.sim.player;
    const button = game.sim.entities.get(buttonId);
    player.pos = { x: button.pos.x, y: button.pos.y, z: button.pos.z - 4.2 };
    player.prevPos = { ...player.pos };
    player.targetId = null;
    game.sim.grid.update(player);
    game.sim.playerGrid.update(player);
    game.input.camYaw = 0;
    game.input.camPitch = 0.42;
    game.input.camDist = 17;
  }, setup);
  await sleep(700);
  await page.screenshot({ path: `${OUT}/source-cave-reboot-breach-desktop.png` });
  const sealedLook = await page.evaluate(({ chestId }) => {
    const game = window.__game;
    const chest = game.sim.entities.get(chestId);
    const view = game.renderer.views.get(chestId);
    return {
      template: chest?.templateId ?? '',
      viewVisible: view?.group.visible ?? false,
      hasSparkle: !!view?.sparkle,
      labelHidden: (view?.nameplate?.style?.display ?? 'none') === 'none',
    };
  }, setup);
  check('chest is the sealed template', sealedLook.template === 'source_cave_chest_sealed');
  check('sealed chest still renders in the room', sealedLook.viewVisible);
  check('sealed chest shows no sparkle', !sealedLook.hasSparkle);
  check('sealed chest shows no interact label, even at range', sealedLook.labelHidden);
  await page.evaluate(() => window.__game.sim.interact(window.__game.sim.player.id));
  // The deny is an error TOAST (hud #error-msg), never a nameplate label.
  await page.waitForFunction(
    () => {
      const el = document.querySelector('#error-msg');
      return el && el.textContent === 'Access denied.' && el.style.opacity === '1';
    },
    { timeout: 4000, polling: 100 },
  );
  const sealed = await page.evaluate(({ chestId }) => {
    const chest = window.__game.sim.entities.get(chestId);
    return {
      stillSealed:
        chest.templateId === 'source_cave_chest_sealed' &&
        chest.loot === null &&
        chest.lootRecipientIds === undefined,
      lootable: chest.lootable === true,
    };
  }, setup);
  check('sealed chest interaction shows the Access denied toast', true);
  check('sealed chest denies interaction', sealed.stillSealed && sealed.lootable);

  await page.evaluate(({ mobIds }) => {
    const sim = window.__game.sim;
    for (const id of mobIds) {
      const mob = sim.entities.get(id);
      if (mob && !mob.dead) {
        mob.hp = 0;
        mob.dead = true;
      }
    }
  }, setup);
  await page.waitForFunction(
    (chestId) => window.__game.sim.entities.get(chestId)?.templateId === 'source_cave_chest',
    { timeout: 8000, polling: 200 },
    setup.chestId,
  );
  // The sealed -> armed template swap rebuilds the view: label + sparkle appear.
  await page.waitForFunction(
    (chestId) => {
      const view = window.__game.renderer.views.get(chestId);
      return (
        !!view?.sparkle &&
        view.nameEl?.textContent === 'Press F to claim spoils' &&
        view.nameplate?.style?.display !== 'none'
      );
    },
    { timeout: 6000, polling: 150 },
    setup.chestId,
  );
  check('armed chest advertises label and sparkle', true);
  const cleared = await page.evaluate(({ chestId }) => {
    const sim = window.__game.sim;
    const chest = sim.entities.get(chestId);
    const items = chest.loot.items.map((slot) => slot.itemId);
    sim.interact(sim.player.id); // solo clearer: looter-takes-all direct grant
    return {
      items,
      counts: items.map((id) => sim.countItem(id, sim.player.id)),
      emptied: chest.loot === null,
      inert: chest.lootable === false,
      persists: sim.entities.has(chestId),
    };
  }, setup);
  check(
    'cleared chest hands out the classic shared drop',
    cleared.counts.every((count) => count >= 1),
    cleared.items.join(','),
  );
  check(
    'emptied chest stays in the room as an inert prop',
    cleared.emptied && cleared.inert && cleared.persists,
  );

  check('no browser errors', errors.length === 0, errors.slice(0, 5).join(' | '));
} finally {
  await browser.close();
}

console.log(`source cave reboot e2e: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
