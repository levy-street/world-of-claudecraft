// Repeatable before/after screenshots for the mobile HUD layout PRD.
//
// Usage:
//   SHOT_PHASE=before URL=http://127.0.0.1:5174/ node scripts/mobile_hud_layout_shots.mjs
//   SHOT_PHASE=after  URL=http://127.0.0.1:5173/ node scripts/mobile_hud_layout_shots.mjs
//
// Six PNGs are written under docs/screenshots/mobile-hud-layout/.

import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.URL || 'http://127.0.0.1:5173/';
const PHASE = process.env.SHOT_PHASE;
if (PHASE !== 'before' && PHASE !== 'after') {
  throw new Error('SHOT_PHASE must be "before" or "after"');
}

const OUT_DIR = 'docs/screenshots/mobile-hud-layout';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const IGNORED_CONSOLE = /502|Bad Gateway|fetch project stats/i;

const SHOTS = [
  {
    name: 'compact-rest',
    width: 740,
    height: 360,
    dsf: 3,
    leftHanded: false,
    consumablesOpen: false,
    partyExpanded: false,
  },
  {
    name: 'compact-consumables',
    width: 740,
    height: 360,
    dsf: 3,
    leftHanded: false,
    consumablesOpen: true,
    partyExpanded: false,
  },
  {
    name: 'iphone-target-party',
    width: 844,
    height: 390,
    dsf: 3,
    leftHanded: false,
    consumablesOpen: false,
    partyExpanded: true,
  },
  {
    name: 'compact-left-handed',
    width: 740,
    height: 360,
    dsf: 3,
    leftHanded: true,
    consumablesOpen: false,
    partyExpanded: false,
  },
  {
    name: 'iphone-portrait',
    width: 390,
    height: 844,
    dsf: 3,
    leftHanded: false,
    consumablesOpen: false,
    partyExpanded: false,
  },
  {
    name: 'tablet-landscape',
    width: 1024,
    height: 768,
    dsf: 2,
    leftHanded: false,
    consumablesOpen: false,
    partyExpanded: false,
  },
];

async function flipViewport(page, cdp, shot) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: shot.width,
    height: shot.height,
    deviceScaleFactor: shot.dsf,
    mobile: true,
    screenWidth: shot.width,
    screenHeight: shot.height,
    positionX: 0,
    positionY: 0,
  });
  await cdp.send('Emulation.resetPageScaleFactor').catch(() => {});
  await page.evaluate(() => {
    document.body.classList.add('mobile-touch', 'game-active');
    window.dispatchEvent(new Event('resize'));
  });
  await sleep(400);
  await page.evaluate(() => document.body.classList.add('mobile-touch', 'game-active'));
  await page.waitForFunction(
    () => {
      const attack = document.getElementById('mobile-action-attack');
      return !!attack && attack.getBoundingClientRect().width > 0;
    },
    { timeout: 12000 },
  );
  await sleep(250);
}

async function buildState(page) {
  await page.evaluate(() => {
    const sim = window.__game.sim;
    const player = sim.player;
    const roster = [
      ['Brightoak', 'druid'],
      ['Stormcaller', 'shaman'],
      ['Nightblade', 'rogue'],
      ['Emberlyn', 'mage'],
    ];
    for (const [name, cls] of roster) {
      if ([...sim.entities.values()].some((entity) => entity.name === name)) continue;
      const pid = sim.addPlayer(cls, name);
      const entity = sim.entities.get(pid);
      if (entity) {
        entity.pos = { x: player.pos.x + 2, y: player.pos.y, z: player.pos.z + 2 };
        entity.prevPos = { ...entity.pos };
      }
      sim.partyInvite(pid);
      sim.partyAccept(pid);
    }
    if (!sim.inventory.some((slot) => slot.itemId === 'minor_healing_potion')) {
      sim.inventory.push({ itemId: 'minor_healing_potion', count: 3 });
    }
    if (!sim.inventory.some((slot) => slot.itemId === 'minor_mana_potion')) {
      sim.inventory.push({ itemId: 'minor_mana_potion', count: 3 });
    }
    player.hp = Math.max(1, player.maxHp - 60);
    let best = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const [id, entity] of sim.entities.entries()) {
      if (entity.kind !== 'mob' || !entity.hostile || entity.dead) continue;
      const next = Math.hypot(entity.pos.x - player.pos.x, entity.pos.z - player.pos.z);
      if (next < distance) {
        best = id;
        distance = next;
      }
    }
    if (best !== null) sim.targetEntity(best);
    window.__game.hud?.update?.(0.05);
  });
  await sleep(400);
}

async function applyShotState(page, shot) {
  await page.evaluate((next) => {
    window.__game.hud.closeAll?.();
    document.body.classList.toggle('mobile-left-handed', next.leftHanded);
    document.body.classList.remove(
      'mobile-window-open',
      'mobile-more-open',
      'mobile-chat-open',
      'mobile-camera-joystick-on',
    );
    window.dispatchEvent(new Event('resize'));
  }, shot);
  await sleep(350);
  await page.evaluate((next) => {
    const open = document.body.classList.contains('mobile-consumables-open');
    if (open !== next.consumablesOpen) {
      document.getElementById('mobile-consumables-toggle')?.click();
    }
    const party = document.getElementById('party-frames');
    if (!!party?.classList.contains('party-expanded') !== next.partyExpanded) {
      document.getElementById('party-chip')?.click();
    }
    window.__game.hud?.update?.(0.05);
  }, shot);
  await sleep(500);
}

mkdirSync(OUT_DIR, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => failures.push(`pageerror: ${String(error).slice(0, 240)}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !IGNORED_CONSOLE.test(message.text())) {
      failures.push(`console error: ${message.text().slice(0, 240)}`);
    }
  });
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1000);
  await enterOfflineGame(page, { charClass: 'warrior', charName: 'LayoutShots', settleMs: 1500 });
  await page.waitForFunction(() => window.__game?.sim && window.__game?.hud, {
    timeout: 15000,
  });
  await page.evaluate(() => document.querySelector('.tut-skip')?.click());
  await sleep(200);
  await buildState(page);

  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'pointer', value: 'coarse' },
      { name: 'hover', value: 'none' },
    ],
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  for (const shot of SHOTS) {
    await flipViewport(page, cdp, shot);
    await applyShotState(page, shot);
    const path = `${OUT_DIR}/${PHASE}-${shot.name}.png`;
    await page.screenshot({ path });
    console.log(`captured ${path}`);
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
