// Visual QA for the SwordMaster class. Captures the responsive class selector,
// authored ability art, both equipped swords, Sword Aura, and area combat VFX.
// Needs the Vite dev server. Override it with GAME_URL when it is not on :5174.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL =
  (process.env.GAME_URL ?? 'http://127.0.0.1:5174') +
  `/?gfx=${encodeURIComponent(process.env.GFX ?? 'ultra')}`;
const OUT = 'docs/screenshots/swordmaster';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const COMBAT_ONLY = process.env.COMBAT_ONLY === '1';

fs.mkdirSync(OUT, { recursive: true });

const capture = (page, name) =>
  page.screenshot({ path: `${OUT}/${name}.webp`, type: 'webp', quality: 88 });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 90_000,
  args: [
    '--window-size=1440,960',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
  ],
  defaultViewport: { width: 1440, height: 960 },
});

const browserErrors = [];

async function preparePage(viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  page.on('pageerror', (error) => browserErrors.push(`PAGEERROR: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`CONSOLE: ${message.text()}`);
  });
  await page.evaluateOnNewDocument(() => {
    window.localStorage.setItem('woc.cameraModePrompt.shown', '1');
  });
  return page;
}

async function activateSelector(page, selector, useTouch) {
  await page.waitForSelector(selector, { visible: true, timeout: 30_000 });
  if (!useTouch) {
    await page.click(selector);
    return;
  }
  const center = await page.$eval(selector, (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  const receivesTouch = await page.evaluate(
    ({ query, x, y }) => {
      const target = document.querySelector(query);
      const hit = document.elementFromPoint(x, y);
      return target instanceof HTMLElement && hit instanceof Element && target.contains(hit);
    },
    { query: selector, ...center },
  );
  if (!receivesTouch) throw new Error(`${selector} does not receive pointer input at its center`);
  await page.touchscreen.tap(center.x, center.y);
}

async function openSwordmasterSelector(page, useTouch = false) {
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60_000 });
  await page.waitForSelector('#btn-offline', { timeout: 60_000 });
  await page.evaluate(() => document.querySelector('#btn-offline')?.click());
  await activateSelector(page, '#offline-select .mini-class[data-class="swordmaster"]', useTouch);
  await wait(1_200);
  return page.evaluate(() => {
    const selected = document.querySelector('#offline-select .mini-class.sel');
    const detail = document.querySelector('.class-detail-name, .cs-detail-name');
    return {
      selected: selected?.getAttribute('data-class') ?? null,
      detail: detail?.textContent?.trim() ?? null,
      classCount: document.querySelectorAll('#offline-select .mini-class').length,
    };
  });
}

let desktopSelector = null;
let mobileSelector = null;
let mobileLandscapeSelector = null;
if (!COMBAT_ONLY) {
  const desktop = await preparePage({ width: 1440, height: 960 });
  desktopSelector = await openSwordmasterSelector(desktop);
  await capture(desktop, 'after-desktop');
  await desktop.close();

  const mobile = await preparePage({
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  mobileSelector = await openSwordmasterSelector(mobile, true);
  await capture(mobile, 'after-mobile');
  await mobile.close();

  const mobileLandscape = await preparePage({
    width: 844,
    height: 390,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  mobileLandscapeSelector = await openSwordmasterSelector(mobileLandscape, true);
  const landscapeReachability = await mobileLandscape.evaluate(() => {
    const panel = document.querySelector('#offline-select');
    const leftColumn = panel?.querySelector('.charselect-col-left');
    const enter = panel?.querySelector('#btn-start-offline');
    const back = panel?.querySelector('#btn-offline-back');
    if (!(panel instanceof HTMLElement) || !(leftColumn instanceof HTMLElement)) return null;
    leftColumn.scrollTop = leftColumn.scrollHeight;
    const panelRect = panel.getBoundingClientRect();
    const visibleBottom = Math.min(window.innerHeight, panelRect.bottom);
    const buttonState = (element) => {
      if (!(element instanceof HTMLElement)) return { visible: false, touchReachable: false };
      const rect = element.getBoundingClientRect();
      const visible =
        rect.width > 0 &&
        rect.height >= 30 &&
        rect.top >= panelRect.top &&
        rect.bottom <= visibleBottom;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        visible,
        touchReachable: visible && hit instanceof Element && element.contains(hit),
      };
    };
    const enterState = buttonState(enter);
    const backState = buttonState(back);
    return {
      touchPoints: navigator.maxTouchPoints,
      panelWithinViewport:
        panelRect.left >= 0 &&
        panelRect.right <= window.innerWidth &&
        panelRect.top >= 0 &&
        panelRect.bottom <= window.innerHeight,
      scrollReachable:
        leftColumn.scrollHeight <= leftColumn.clientHeight + 1 || leftColumn.scrollTop > 0,
      enterVisible: enterState.visible,
      backVisible: backState.visible,
      enterTouchReachable: enterState.touchReachable,
      backTouchReachable: backState.touchReachable,
    };
  });
  mobileLandscapeSelector = { ...mobileLandscapeSelector, ...landscapeReachability };
  await wait(200);
  await capture(mobileLandscape, 'after-mobile-landscape');
  await mobileLandscape.close();
}

const page = await preparePage({ width: 1440, height: 960, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60_000 });
await page.evaluate(() => document.querySelector('#btn-offline')?.click());
await page.waitForSelector('#char-name', { visible: true, timeout: 30_000 });
await page.type('#char-name', 'Aozora');
await page.evaluate(() => {
  document.querySelector('#offline-select .mini-class[data-class="swordmaster"]')?.click();
  document.querySelector('#btn-start-offline')?.click();
});
await page.waitForFunction(() => window.__game?.sim?.player, {
  timeout: 90_000,
  polling: 300,
});
await page.keyboard.press('Escape');
await wait(2_500);

await page.evaluate(() => {
  document.querySelector('.camera-prompt-confirm')?.click();
  document.querySelector('.tut-skip')?.click();
});
await wait(500);

const staged = await page.evaluate(() => {
  const game = window.__game;
  const sim = game.sim;
  sim.setPlayerLevel(20);
  sim.setSpec('tempest');
  const player = sim.player;
  player.maxHp = 1_000_000;
  player.hp = player.maxHp;
  player.resource = player.maxResource;
  player.weaponStowed = false;
  player.prevPos = { ...player.pos };
  player.facing = 0;
  player.prevFacing = 0;

  const mobs = [...sim.entities.values()]
    .filter((entity) => entity.kind === 'mob' && entity.ownerId == null && !entity.dead)
    .slice(0, 8);
  const angles = [-1.05, -0.74, -0.42, -0.14, 0.14, 0.42, 0.74, 1.05];
  mobs.forEach((mob, index) => {
    const radius = 16 + (index % 2) * 0.7;
    const angle = angles[index];
    const at = sim.groundPos(
      player.pos.x + Math.sin(angle) * radius,
      player.pos.z + Math.cos(angle) * radius,
    );
    mob.pos = { ...at };
    mob.prevPos = { ...at };
    mob.facing = Math.atan2(player.pos.x - mob.pos.x, player.pos.z - mob.pos.z);
    mob.prevFacing = mob.facing;
    mob.maxHp = 1_000_000;
    mob.hp = mob.maxHp;
    mob.dead = false;
    mob.hostile = false;
    mob.moveSpeed = 0;
    mob.aiState = 'idle';
    mob.aggroTargetId = null;
    mob.inCombat = false;
    sim.rebucket(mob);
  });

  window.__swordmasterMobs = mobs.map((mob) => mob.id);
  game.input.camYaw = 2.6;
  game.input.camPitch = 0.2;
  game.input.camDist = 5.5;
  return {
    playerClass: player.templateId,
    mainhand: player.mainhandItemId,
    offhand: player.offhandItemId,
    dualWielding: player.dualWielding,
    offhandWeapon: player.offhandWeapon !== null,
    mobIds: mobs.map((mob) => mob.id),
  };
});

await wait(2_000);
await page.evaluate(() => {
  const game = window.__game;
  game.input.camYaw = 2.6;
  game.input.camPitch = 0.2;
  game.input.camDist = 5.5;
});
await wait(500);
await capture(page, 'after-twin-swords');

await page.evaluate(() => window.__game.hud.toggleSpellbook());
await wait(700);
await capture(page, 'after-abilities');
await page.evaluate(() => window.__game.hud.toggleSpellbook());
await wait(300);

const auraCast = await page.evaluate(() => {
  const sim = window.__game.sim;
  const player = sim.player;
  player.resource = player.maxResource;
  player.gcdRemaining = 0;
  player.cooldowns.delete('sword_aura');
  sim.castAbility('sword_aura', player.id);
  return {
    ability: player.castingAbility,
    remaining: player.castRemaining,
    total: player.castTotal,
  };
});
await wait(550);
await capture(page, 'after-sword-aura-cast');

await page.evaluate(() => {
  const sim = window.__game.sim;
  for (
    let tick = 0;
    tick < 30 && !sim.player.auras.some((aura) => aura.id === 'sword_aura');
    tick++
  ) {
    sim.tick();
  }
});

await page.waitForFunction(
  () => window.__game.sim.player.auras.some((aura) => aura.id === 'sword_aura'),
  { timeout: 8_000, polling: 100 },
);
const auraActive = await page.evaluate(() => {
  const player = window.__game.sim.player;
  const aura = player.auras.find((candidate) => candidate.id === 'sword_aura');
  return {
    aura: aura?.id ?? null,
    remaining: aura?.remaining ?? 0,
    strength: player.stats.str,
    agility: player.stats.agi,
  };
});
await wait(300);
await capture(page, 'after-sword-aura-active');

const cyclone = await page.evaluate(() => {
  const sim = window.__game.sim;
  const player = sim.player;
  const painter = window.__game.renderer.swordmasterFx;
  const paint = painter.paint.bind(painter);
  window.__swordmasterPaintCalls = [];
  painter.paint = (plan, sourceId, targetId) => {
    window.__swordmasterPaintCalls.push(plan);
    paint(plan, sourceId, targetId);
  };
  // Hold the real event-driven arc on its authored first frame long enough for
  // SwiftShader to rasterize a full-resolution screenshot.
  painter.update = () => {};
  const angles = [-1.05, -0.74, -0.42, -0.14, 0.14, 0.42, 0.74, 1.05];
  window.__swordmasterMobs.forEach((id, index) => {
    const mob = sim.entities.get(id);
    if (!mob) return;
    const radius = 4.8 + (index % 2) * 0.7;
    const angle = angles[index];
    const at = sim.groundPos(
      player.pos.x + Math.sin(angle) * radius,
      player.pos.z + Math.cos(angle) * radius,
    );
    mob.pos = { ...at };
    mob.prevPos = { ...at };
    mob.hp = mob.maxHp;
    mob.dead = false;
    mob.hostile = true;
    mob.moveSpeed = 0;
    mob.aiState = 'idle';
    mob.aggroTargetId = null;
    sim.rebucket(mob);
  });
  player.resource = player.maxResource;
  player.gcdRemaining = 0;
  player.cooldowns.delete('blade_cyclone');
  const targetsBefore = [...sim.entities.values()].filter(
    (entity) =>
      entity.kind === 'mob' &&
      entity.hostile &&
      !entity.dead &&
      Math.hypot(entity.pos.x - player.pos.x, entity.pos.z - player.pos.z) <= 9,
  ).length;
  sim.castAbility('blade_cyclone', player.id);
  window.__game.input.camYaw = 0.7;
  window.__game.input.camPitch = 0.42;
  window.__game.input.camDist = 11;
  return { targetsBefore, resourceAfter: player.resource };
});
await wait(150);
await capture(page, 'after-blade-cyclone');
cyclone.paintCalls = await page.evaluate(() => window.__swordmasterPaintCalls);

await page.evaluate(() => window.__game.hud.toggleTalents());
await wait(700);
await page.evaluate(() => {
  document.querySelector('#talents-window [data-tab="rows"]')?.click();
});
await wait(500);
await capture(page, 'after-talents');
await page.evaluate(() => window.__game.hud.toggleTalents());

console.log(
  JSON.stringify(
    {
      desktopSelector,
      mobileSelector,
      mobileLandscapeSelector,
      staged,
      auraCast,
      auraActive,
      cyclone,
      browserErrors,
    },
    null,
    2,
  ),
);

await browser.close();

const unexpectedBrowserErrors = browserErrors.filter(
  (message) =>
    !message.includes('502 (Bad Gateway)') &&
    !message.includes('Failed to fetch project stats') &&
    !message.includes('THREE.BufferGeometryUtils'),
);

const ok =
  (COMBAT_ONLY ||
    (desktopSelector?.selected === 'swordmaster' &&
      mobileSelector?.selected === 'swordmaster' &&
      mobileLandscapeSelector?.selected === 'swordmaster' &&
      desktopSelector?.classCount === 10 &&
      mobileSelector?.classCount === 10 &&
      mobileLandscapeSelector?.classCount === 10 &&
      mobileLandscapeSelector?.touchPoints > 0 &&
      mobileLandscapeSelector?.panelWithinViewport &&
      mobileLandscapeSelector?.scrollReachable &&
      mobileLandscapeSelector?.enterVisible &&
      mobileLandscapeSelector?.backVisible &&
      mobileLandscapeSelector?.enterTouchReachable &&
      mobileLandscapeSelector?.backTouchReachable)) &&
  staged.playerClass === 'swordmaster' &&
  staged.mainhand === 'worn_sword' &&
  staged.offhand === 'worn_sword' &&
  staged.dualWielding &&
  staged.offhandWeapon &&
  auraCast.ability === 'sword_aura' &&
  auraCast.total === 2 &&
  auraActive.aura === 'sword_aura' &&
  auraActive.remaining > 295 &&
  cyclone.targetsBefore >= 5 &&
  cyclone.paintCalls.some((plan) => plan.abilityId === 'blade_cyclone') &&
  unexpectedBrowserErrors.length === 0;

process.exit(ok ? 0 : 1);
